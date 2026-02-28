import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import type { ApiResponse, HierarchyResponse, RawHierarchyResponse } from '../client/types.js';
import { formatHierarchy } from '../formatters/index.js';
import { hierarchyCache } from '../utils/cache.js';
import { formatErrorForMcp } from '../utils/errors.js';

export function registerHierarchyTools(server: McpServer, client: OmopHubClient): void {
  server.tool(
    'get_hierarchy',
    "Navigate the vocabulary hierarchy for a concept. Use direction='up' for ancestors (broader terms like 'Diabetes mellitus' → 'Metabolic disease'), direction='down' for descendants (narrower terms, essential for building concept sets in phenotype definitions), or direction='both' for full hierarchical context. Results are capped at max_results nodes (default 500). If truncated, the response will indicate total available count so you can narrow with vocabulary_ids or reduce max_levels.",
    {
      concept_id: z.number().describe('The OMOP concept_id'),
      direction: z
        .enum(['up', 'down', 'both'])
        .default('both')
        .describe(
          "Hierarchy direction: 'up' for ancestors, 'down' for descendants, 'both' for full context (default: 'both')",
        ),
      max_levels: z
        .number()
        .optional()
        .describe("Maximum levels to traverse (default 5 for 'up', 10 for 'down', 5/3 for 'both')"),
      max_results: z
        .number()
        .min(1)
        .max(500)
        .default(500)
        .describe(
          'Maximum number of nodes to return (1-500, default 500). Use a smaller value for broad concepts.',
        ),
      vocabulary_ids: z
        .string()
        .max(200)
        .optional()
        .describe('Comma-separated vocabulary IDs to filter results. Leave empty for all.'),
    },
    async ({ concept_id, direction, max_levels, max_results, vocabulary_ids }) => {
      try {
        const cacheKey = `hierarchy:${concept_id}:${direction}:${max_levels}:${max_results}:${vocabulary_ids}`;
        const cached = hierarchyCache.get(cacheKey) as
          | { response: unknown; direction: 'up' | 'down' | 'both' }
          | undefined;

        if (cached) {
          const { text, json } = formatHierarchy(
            cached.response as Parameters<typeof formatHierarchy>[0],
            cached.direction,
          );
          return {
            content: [
              { type: 'text' as const, text },
              { type: 'text' as const, text: json },
            ],
          };
        }

        // Route to correct API endpoint based on direction
        const endpointMap = {
          up: 'ancestors',
          down: 'descendants',
          both: 'hierarchy',
        } as const;

        const endpoint = endpointMap[direction ?? 'both'];
        const params: Record<string, string | number | boolean | undefined> = {};

        if (max_levels) params.max_levels = max_levels;
        if (max_results) params.page_size = max_results;
        if (vocabulary_ids) params.vocabulary_ids = vocabulary_ids;

        const rawResponse = await client.request<RawHierarchyResponse>(
          `/concepts/${concept_id}/${endpoint}`,
          params,
          'get_hierarchy',
        );

        // API returns flat concept fields — normalize into { concept: {...} } for formatter
        const raw = rawResponse.data;
        const totalAncestors =
          raw.total_ancestors ?? raw.hierarchy_summary?.total_ancestors;
        const totalDescendants =
          raw.total_descendants ?? raw.hierarchy_summary?.total_descendants;

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
            total_ancestors: totalAncestors,
            total_descendants: totalDescendants,
          },
        };

        hierarchyCache.set(cacheKey, { response, direction: direction ?? 'both' });
        const { text, json } = formatHierarchy(response, direction ?? 'both');

        return {
          content: [
            { type: 'text' as const, text },
            { type: 'text' as const, text: json },
          ],
        };
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'get_hierarchy');
        return {
          content: [
            { type: 'text' as const, text },
            { type: 'text' as const, text: json },
          ],
          isError: true,
        };
      }
    },
  );
}
