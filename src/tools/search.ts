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
      page_size: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe('Number of results to return (1-50, default 10)'),
    },
    async ({ query, vocabulary_ids, domain_ids, standard_concept, page, page_size }, extra) => {
      try {
        const rc = resolveClient(extra, client);
        const params: Record<string, string | number | boolean | undefined> = {
          query,
          page: page ?? 1,
          page_size: page_size ?? 10,
        };

        // Map PRD param names to actual API params
        if (vocabulary_ids) params.vocabularies = vocabulary_ids;
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
