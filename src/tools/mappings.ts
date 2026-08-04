import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import { resolveClient } from '../client/resolve.js';
import type { MappingsResponse } from '../client/types.js';
import { formatMappings } from '../formatters/index.js';
import { formatErrorForMcp } from '../utils/errors.js';

export function registerMappingTools(server: McpServer, client: OmopHubClient): void {
  server.tool(
    'map_concept',
    "Find mappings FROM a source concept TO equivalent concepts in other vocabularies. The concept_id you provide is always the SOURCE — results show what it maps TO. Returns cross-vocabulary mappings with relationship types and mapping quality. If no mappings exist, the response explicitly states 'No mappings found' with mapped=false in JSON — never returns ambiguous empty results. Example: provide a SNOMED concept_id and filter by target_vocabularies='ICD10CM' to get the ICD-10 equivalent. PAGINATED: results are one page of a possibly larger set — total_mappings is the full count and has_more says whether further pages exist. When building a complete code list, keep incrementing page until has_more is false; a single call is not the whole answer.",
    {
      concept_id: z.number().describe('The source OMOP concept_id to map FROM'),
      target_vocabularies: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Comma-separated vocabulary IDs to map TO. Examples: 'ICD10CM', 'SNOMED', 'RxNorm'. Omit to see all available mappings.",
        ),
      page: z.number().min(1).default(1).describe('Page number (1-based, default 1)'),
      // Ceiling is 200 because the API clamps page_size on GET requests to
      // CACHE_LIMITS.MAX_PAGE_SIZE. Declaring 1000 here would let a caller ask for
      // a page they can never receive, and the response would quietly be a
      // different size than requested.
      page_size: z
        .number()
        .min(1)
        .max(200)
        .default(100)
        .describe(
          'Mappings per page (1-200, default 100). A concept can have thousands — check has_more in the response and increment page until it is false, otherwise your code list will be incomplete.',
        ),
    },
    async ({ concept_id, target_vocabularies, page, page_size }, extra) => {
      try {
        const rc = resolveClient(extra, client);
        const params: Record<string, string | number | boolean | undefined> = {
          page: page ?? 1,
          page_size: page_size ?? 100,
        };

        // Map PRD param to actual API param (target_vocabularies → target_vocabulary)
        if (target_vocabularies) params.target_vocabulary = target_vocabularies;

        const response = await rc.request<MappingsResponse>(
          `/concepts/${concept_id}/mappings`,
          params,
          'map_concept',
        );

        const { text, json } = formatMappings(response, concept_id);

        return {
          content: [
            { type: 'text' as const, text },
            { type: 'text' as const, text: json },
          ],
        };
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'map_concept');
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
