import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import { resolveClient } from '../client/resolve.js';
import { formatErrorForMcp } from '../utils/errors.js';

interface SimilarConcept {
  concept_id: number;
  concept_name: string;
  domain_id: string;
  vocabulary_id: string;
  concept_class_id: string;
  standard_concept: string | null;
  concept_code: string;
  similarity_score: number;
  similarity_explanation?: string;
}

interface SimilarResponse {
  similar_concepts: SimilarConcept[];
  search_metadata: {
    original_query?: string;
    algorithm_used: string;
    similarity_threshold: number;
    total_candidates?: number;
    results_returned: number;
    processing_time_ms?: number;
  };
}

export function registerSimilarTools(server: McpServer, client: OmopHubClient): void {
  server.tool(
    'find_similar_concepts',
    "Find medical concepts similar to a reference concept, name, or natural language query. Supports three algorithms: 'semantic' (neural embeddings — best for meaning), 'lexical' (text matching — best for typos), 'hybrid' (combined — default). Provide exactly ONE of: concept_id, concept_name, or query. Use this to explore related concepts, find alternative codes, or build phenotype concept sets. Tip: For drug vocabularies like RxNorm, use drug class names ('ACE inhibitors', 'beta blockers', 'antihypertensives') rather than symptom descriptions ('medications for high blood pressure') — the embedding model aligns better with clinical terminology than lay language.",
    {
      concept_id: z.number().optional().describe('Find concepts similar to this OMOP concept ID'),
      concept_name: z
        .string()
        .max(500)
        .optional()
        .describe('Find concepts similar to this concept name'),
      query: z
        .string()
        .max(500)
        .optional()
        .describe('Find concepts matching this natural language description'),
      algorithm: z
        .enum(['semantic', 'lexical', 'hybrid'])
        .default('hybrid')
        .describe(
          "Similarity algorithm: 'semantic' (meaning), 'lexical' (text), 'hybrid' (both). Default 'hybrid'.",
        ),
      similarity_threshold: z
        .number()
        .min(0)
        .max(1)
        .default(0.7)
        .describe('Minimum similarity score (0.0-1.0). Default 0.7.'),
      page_size: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe('Number of results (1-100, default 20)'),
      vocabulary_ids: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Comma-separated vocabulary IDs to filter results. Examples: 'SNOMED', 'ICD10CM'.",
        ),
      domain_ids: z
        .string()
        .max(200)
        .optional()
        .describe("Comma-separated domain IDs to filter results. Examples: 'Condition', 'Drug'."),
    },
    async (
      {
        concept_id,
        concept_name,
        query,
        algorithm,
        similarity_threshold,
        page_size,
        vocabulary_ids,
        domain_ids,
      },
      extra,
    ) => {
      try {
        const rc = resolveClient(extra, client);
        // Validate exactly one input source
        const provided = [concept_id, concept_name, query].filter((v) => v !== undefined).length;
        if (provided !== 1) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Provide exactly one of concept_id, concept_name, or query.',
              },
            ],
            isError: true,
          };
        }

        const body: Record<string, unknown> = {
          algorithm: algorithm ?? 'hybrid',
          similarity_threshold: similarity_threshold ?? 0.7,
          page_size: page_size ?? 20,
        };

        if (concept_id !== undefined) body.concept_id = concept_id;
        if (concept_name !== undefined) body.concept_name = concept_name;
        if (query !== undefined) body.query = query;
        if (vocabulary_ids)
          body.vocabulary_ids = vocabulary_ids
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        if (domain_ids)
          body.domain_ids = domain_ids
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

        const response = await rc.post<SimilarResponse>(
          '/search/similar',
          body,
          'find_similar_concepts',
        );

        const data = response.data;
        const concepts = data?.similar_concepts ?? [];
        const meta = data?.search_metadata;

        if (concepts.length === 0) {
          const source = concept_id ? `concept ${concept_id}` : (concept_name ?? query ?? '');
          return {
            content: [
              {
                type: 'text' as const,
                text: `No similar concepts found for ${source}. Try lowering the similarity threshold or using a different algorithm.`,
              },
              {
                type: 'text' as const,
                text: JSON.stringify({ similar_concepts: [], search_metadata: meta }),
              },
            ],
          };
        }

        const source = concept_id
          ? `concept ID ${concept_id}`
          : concept_name
            ? `"${concept_name}"`
            : `"${query}"`;

        const lines = concepts.map((c, i) => {
          const std =
            c.standard_concept === 'S'
              ? ' [Standard]'
              : c.standard_concept === 'C'
                ? ' [Classification]'
                : '';
          const score = Number.isFinite(c.similarity_score) ? c.similarity_score.toFixed(2) : 'N/A';
          let line = `${i + 1}. **${c.concept_name}** (ID: ${c.concept_id}) — score: ${score}\n   ${c.vocabulary_id} | ${c.domain_id} | Code: ${c.concept_code}${std}`;
          if (c.similarity_explanation) {
            line += `\n   _${c.similarity_explanation}_`;
          }
          return line;
        });

        const algoLabel = meta?.algorithm_used ?? algorithm ?? 'hybrid';
        const text = `Found ${concepts.length} concepts similar to ${source} (${algoLabel} algorithm):\n\n${lines.join('\n\n')}`;

        return {
          content: [
            { type: 'text' as const, text },
            {
              type: 'text' as const,
              text: JSON.stringify({ similar_concepts: concepts, search_metadata: meta }),
            },
          ],
        };
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'find_similar_concepts');
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
