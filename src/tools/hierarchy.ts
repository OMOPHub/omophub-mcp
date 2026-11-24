import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import { resolveClient } from '../client/resolve.js';
import type { ApiResponse, HierarchyResponse, RawHierarchyResponse } from '../client/types.js';
import { formatHierarchy } from '../formatters/index.js';
import { hierarchyCache } from '../utils/cache.js';
import { formatErrorForMcp } from '../utils/errors.js';
import {
  containsRecordFields,
  formattedResult,
  inputError,
  numericArgument,
  readAnnotations,
  recordInputError,
  terminologyRecord,
} from './contract.js';

export function registerHierarchyTools(
  server: McpServer,
  client: OmopHubClient,
  cache: typeof hierarchyCache | null = hierarchyCache,
): void {
  server.registerTool(
    'get_hierarchy',
    {
      title: 'List descendants or ancestors of an OMOP concept',
      annotations: readAnnotations,
      outputSchema: z.looseObject({
        concept_id: z.number(),
        direction: z.enum(['up', 'down', 'both']),
        has_more: z.boolean().optional(),
        next_page: z.number().int().positive().optional(),
        truncated: z.boolean().optional(),
        ancestors: z.array(terminologyRecord).optional(),
        descendants: z.array(terminologyRecord).optional(),
      }),
      description:
        "List descendants of a known OMOP concept using direction='down', or ancestors using 'up'. Use page=1 and the requested page_size. For all pages, repeat this tool with next_page while has_more is true. Read truncated to determine whether the upstream row cap was reached. A combined view cannot establish exhaustive coverage.",
      inputSchema: {
        concept_id: numericArgument(z.number()).describe('The OMOP concept_id'),
        direction: z
          .enum(['up', 'down', 'both'])
          .default('both')
          .describe(
            "Hierarchy direction: 'up' for ancestors, 'down' for descendants, 'both' for full context (default: 'both')",
          ),
        max_levels: numericArgument(z.number())
          .optional()
          .describe(
            "Maximum levels to traverse (default 5 for 'up', 10 for 'down', 5/3 for 'both')",
          ),
        page: numericArgument(z.number().int().min(1))
          .optional()
          .describe(
            'Page of ancestors or descendants. Combined views support only the first page.',
          ),
        page_size: numericArgument(z.number().int().min(1).max(200))
          .optional()
          .describe('Nodes per direction or page. Overrides max_results.'),
        max_results: numericArgument(z.number().min(1).max(200))
          .default(200)
          .describe(
            'Maximum number of nodes to return (1-200, default 200). Use a smaller value for broad concepts.',
          ),
        vocabulary_ids: z
          .string()
          .max(200)
          .optional()
          .describe('Comma-separated vocabulary IDs to filter results. Leave empty for all.'),
      },
    },
    async (
      { concept_id, direction, max_levels, max_results, page, page_size, vocabulary_ids },
      extra,
    ) => {
      if (containsRecordFields(vocabulary_ids)) return recordInputError();
      const combined = (direction ?? 'both') === 'both';
      if (combined && page !== undefined && page > 1)
        return inputError('INVALID_PAGE', 'Choose up or down to request another hierarchy page.');
      const size = page_size ?? max_results ?? 200;
      try {
        const rc = resolveClient(extra, client);
        const cacheKey = `hierarchy:${concept_id}:${direction}:${max_levels}:${size}:${page ?? 1}:${vocabulary_ids}`;
        const cached = cache?.get(cacheKey) as
          | { response: unknown; direction: 'up' | 'down' | 'both' }
          | undefined;

        if (cached) {
          const { text, json } = formatHierarchy(
            cached.response as Parameters<typeof formatHierarchy>[0],
            cached.direction,
          );
          return formattedResult(text, json);
        }

        // Route to correct API endpoint based on direction
        const endpointMap = {
          up: 'ancestors',
          down: 'descendants',
          both: 'hierarchy',
        } as const;

        const endpoint = endpointMap[direction ?? 'both'];
        const params: Record<string, string | number | boolean | undefined> = {};

        if (max_levels !== undefined) params.max_levels = max_levels;
        params[combined ? 'max_results' : 'page_size'] = size;
        if (!combined && page !== undefined) params.page = page;
        if (vocabulary_ids) params.vocabulary_ids = vocabulary_ids;

        const rawResponse = await rc.request<RawHierarchyResponse>(
          `/concepts/${concept_id}/${endpoint}`,
          params,
          'get_hierarchy',
        );

        // API returns flat concept fields — normalize into { concept: {...} } for formatter
        const raw = rawResponse.data;
        const totalAncestors = raw.total_ancestors ?? raw.hierarchy_summary?.total_ancestors;
        const totalDescendants = raw.total_descendants ?? raw.hierarchy_summary?.total_descendants;

        const response: ApiResponse<HierarchyResponse> = {
          ...rawResponse,
          data: {
            concept: {
              concept_id: raw.concept_id,
              concept_name: raw.concept_name ?? `Concept ${raw.concept_id}`,
              vocabulary_id: raw.vocabulary_id ?? '',
              domain_id: '',
              concept_class_id: '',
              standard_concept: null,
              concept_code: '',
            },
            ancestors: raw.ancestors,
            descendants: raw.descendants,
            truncated: raw.hierarchy_summary?.truncated,
            total_ancestors: totalAncestors,
            total_descendants: totalDescendants,
          },
        };

        cache?.set(cacheKey, { response, direction: direction ?? 'both' });
        const { text, json } = formatHierarchy(response, direction ?? 'both');

        return formattedResult(text, json);
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'get_hierarchy');
        return formattedResult(text, json, true);
      }
    },
  );
}
