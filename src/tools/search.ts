import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import { resolveClient } from '../client/resolve.js';
import type { SearchResult } from '../client/types.js';
import { formatConceptList } from '../formatters/index.js';
import { formatErrorForMcp } from '../utils/errors.js';

export function registerSearchTools(server: McpServer, client: OmopHubClient): void {
  server.tool(
    'search_concepts',
    "Search for medical concepts across OHDSI standardized vocabularies by name, synonym, or clinical term. Returns matching concepts with IDs, names, vocabulary, domain, and standard status. Use this when you need to find the OMOP concept ID for a medical term. Examples: 'type 2 diabetes', 'metformin 500mg', 'systolic blood pressure', 'HbA1c'.",
    {
      query: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .describe('The medical term or concept name to search for'),
      vocabulary_ids: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Comma-separated vocabulary IDs to filter by. Examples: 'SNOMED', 'ICD10CM', 'RxNorm', 'LOINC'. Leave empty to search all vocabularies.",
        ),
      domain_ids: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Comma-separated domain IDs to filter by. Examples: 'Condition', 'Drug', 'Measurement', 'Procedure'. Leave empty for all domains.",
        ),
      standard_concept: z
        .enum(['S', 'C'])
        .optional()
        .describe(
          "Filter by standard concept status: 'S' for Standard, 'C' for Classification. Omit to search all.",
        ),
      page: z.number().min(1).default(1).describe('Page number (1-based, default 1)'),
      // 200 is the API's effective ceiling for GET requests: the route validator
      // allows 1000 but paginationLimitsMiddleware clamps page_size to
      // CACHE_LIMITS.MAX_PAGE_SIZE. Declaring more than the server will honour
      // means a caller asks for N and silently receives 200.
      page_size: z
        .number()
        .min(1)
        .max(200)
        .default(10)
        .describe('Number of results to return (1-200, default 10)'),
    },
    async ({ query, vocabulary_ids, domain_ids, standard_concept, page, page_size }, extra) => {
      try {
        const rc = resolveClient(extra, client);
        const params: Record<string, string | number | boolean | undefined> = {
          query,
          page: page ?? 1,
          page_size: page_size ?? 10,
        };

        // GET /v1/search/concepts validates `vocabulary_ids`. This sent
        // `vocabularies`, which the API does not recognise — and unknown query
        // params are ignored rather than rejected, so the filter silently did
        // nothing and the search ranged over every vocabulary. A user asking for
        // NDC got RxNorm, dm+d, VANDF, NDFRT and others, with zero NDC rows.
        //
        // semantic_search and get_hierarchy already send `vocabulary_ids`; this
        // tool was the only one out of step.
        if (vocabulary_ids) params.vocabulary_ids = vocabulary_ids;
        if (domain_ids) params.domain_ids = domain_ids;
        if (standard_concept) params.standard_concept = standard_concept;

        const response = await rc.request<SearchResult[]>(
          '/search/concepts',
          params,
          'search_concepts',
        );

        const { text, json } = formatConceptList(response, query);

        return {
          content: [
            { type: 'text' as const, text },
            { type: 'text' as const, text: json },
          ],
        };
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'search_concepts');
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
