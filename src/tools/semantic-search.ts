import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import type { SearchResult } from '../client/types.js';
import { formatErrorForMcp } from '../utils/errors.js';

interface SemanticResult extends SearchResult {
  similarity_score: number;
  matched_text?: string;
}

export function registerSemanticSearchTools(server: McpServer, client: OmopHubClient): void {
  server.tool(
    'semantic_search',
    "Search for medical concepts using natural language with neural embeddings. Unlike keyword search, semantic search understands clinical meaning — 'heart attack' finds 'Myocardial infarction', 'high blood sugar' finds 'Hyperglycemia'. Returns concepts ranked by similarity score. Use this when the user describes symptoms, conditions, or treatments in everyday language rather than exact medical terminology.",
    {
      query: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .describe('Natural language description of the medical concept to find'),
      vocabulary_ids: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Comma-separated vocabulary IDs to filter by. Examples: 'SNOMED', 'ICD10CM', 'RxNorm'.",
        ),
      domain_ids: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Comma-separated domain IDs to filter by. Examples: 'Condition', 'Drug', 'Measurement'.",
        ),
      standard_concept: z
        .enum(['S', 'C'])
        .optional()
        .describe("Filter by standard concept status: 'S' for Standard, 'C' for Classification."),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe('Minimum similarity score (0.0-1.0). Higher = stricter matching. Default 0.5.'),
      page_size: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe('Number of results to return (1-50, default 10)'),
    },
    async ({ query, vocabulary_ids, domain_ids, standard_concept, threshold, page_size }) => {
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          query,
          page_size: page_size ?? 10,
          threshold: threshold ?? 0.5,
        };

        if (vocabulary_ids) params.vocabulary_ids = vocabulary_ids;
        if (domain_ids) params.domain_ids = domain_ids;
        if (standard_concept) params.standard_concept = standard_concept;

        const response = await client.request<{ results: SemanticResult[] }>(
          '/concepts/semantic-search',
          params,
          'semantic_search',
        );

        const results = response.data?.results ?? [];

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No semantic matches found for "${query}". Try different wording or lower the similarity threshold.`,
              },
              { type: 'text' as const, text: JSON.stringify({ results: [], query, threshold }) },
            ],
          };
        }

        const lines = results.map((r, i) => {
          const std =
            r.standard_concept === 'S'
              ? ' [Standard]'
              : r.standard_concept === 'C'
                ? ' [Classification]'
                : '';
          const score = Number.isFinite(r.similarity_score) ? r.similarity_score.toFixed(2) : 'N/A';
          return `${i + 1}. **${r.concept_name}** (ID: ${r.concept_id}) — similarity: ${score}\n   ${r.vocabulary_id} | ${r.domain_id} | Code: ${r.concept_code}${std}`;
        });

        const text = `Found ${results.length} semantic matches for "${query}":\n\n${lines.join('\n\n')}`;

        return {
          content: [
            { type: 'text' as const, text },
            { type: 'text' as const, text: JSON.stringify({ results, query, threshold }) },
          ],
        };
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'semantic_search');
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
