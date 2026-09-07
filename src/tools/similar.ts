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
  /** Absent when the request set include_scores=false. */
  similarity_score?: number;
  /** The field both API docs specify. */
  explanation?: string;
  /**
   * @deprecated Duplicate of `explanation`, emitted by the API for one release.
   * This tool read only this name while the API emitted only `explanation`, so
   * explanations silently vanished from every result.
   */
  similarity_explanation?: string;
}

interface SimilarResponse {
  similar_concepts: SimilarConcept[];
  search_metadata: {
    original_query?: string;
    algorithm_used: string;
    similarity_threshold: number;
    /**
     * How many concepts cleared `similarity_threshold` inside the bounded
     * retrieval pool - not how many were evaluated.
     */
    total_candidates?: number;
    results_returned: number;
    processing_time_ms?: number;
    /**
     * True when retrieval hit its candidate bound, so the totals count only
     * what qualified inside the pool searched, not the whole corpus.
     */
    totals_are_lower_bound?: boolean;
    /** Set when a fallback served the request instead of what was asked for. */
    degraded_from?: string;
  };
}

export function registerSimilarTools(server: McpServer, client: OmopHubClient): void {
  server.tool(
    'find_similar_concepts',
    "Find medical concepts similar to a reference concept, name, or natural language query. Supports three algorithms: 'semantic' (neural embeddings — best for meaning, and the default), 'lexical' (text matching — best for typos), 'hybrid' (combined). Provide exactly ONE of: concept_id, concept_name, or query. Use this to explore related concepts, find alternative codes, or build phenotype concept sets. Tip: For drug vocabularies like RxNorm, use drug class names ('ACE inhibitors', 'beta blockers', 'antihypertensives') rather than symptom descriptions ('medications for high blood pressure') — the embedding model aligns better with clinical terminology than lay language.",
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
        .default('semantic')
        .describe(
          "Similarity algorithm: 'semantic' (meaning), 'lexical' (text), 'hybrid' (both). Default 'semantic', matching the API.",
        ),
      similarity_threshold: z
        .number()
        .min(0)
        .max(1)
        .default(0.7)
        .describe('Minimum similarity score (0.0-1.0). Default 0.7.'),
      // Ceiling matches the API's own cap on POST /v1/search/similar (page_size
      // 1-1000). It was 100 here, which silently made the MCP the binding
      // constraint: a caller asking for 500 got a schema rejection even though
      // the API would have served it. Keep the two in step.
      //
      // Note this is ranked similarity, not set membership — raising the ceiling
      // returns more of a fuzzy ordering, it does not make the result exhaustive.
      // Building a complete code list is a mappings/hierarchy job, not this tool.
      page_size: z
        .number()
        .min(1)
        .max(1000)
        .default(20)
        .describe('Number of results (1-1000, default 20)'),
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
      concept_class_ids: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Comma-separated concept class IDs to filter results. Examples: 'Clinical Finding', 'Ingredient'.",
        ),
      // Sized from page_size alone and never from page: every algorithm ranks a
      // bounded candidate pool, so reachable depth is roughly pool/page_size
      // pages. Asking beyond it returns an empty page rather than an error.
      page: z.number().min(1).default(1).describe('Page of results (1-based, default 1)'),
      // The formatter renders `explanation`, but the API omits it unless asked,
      // so without this flag the rendering could only ever fire on a fixture.
      include_explanations: z
        .boolean()
        .default(false)
        .describe('Include a short explanation of why each concept matched. Default false.'),
    },
    async (
      {
        concept_id,
        concept_name,
        query,
        algorithm,
        similarity_threshold,
        page,
        page_size,
        vocabulary_ids,
        domain_ids,
        concept_class_ids,
        include_explanations,
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
          algorithm: algorithm ?? 'semantic',
          // `??` rather than `||`: 0 is a threshold the API accepts and
          // honours, and it must not fall through to the default.
          similarity_threshold: similarity_threshold ?? 0.7,
          page: page ?? 1,
          page_size: page_size ?? 20,
        };

        if (include_explanations !== undefined) {
          body.include_explanations = include_explanations;
        }

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
        if (concept_class_ids)
          body.concept_class_ids = concept_class_ids
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
        // Pagination lives in the response envelope, not in `data`. Rebuilding
        // the output from `similar_concepts` and `search_metadata` alone
        // dropped it, so a caller given a `page` argument had no way to learn
        // whether another page existed.
        const pagination = response.meta?.pagination;
        // `has_next` is the documented signal to page on; `total_pages` can be a
        // lower bound when the candidate pool was saturated. Build this before
        // the empty branch so an empty requested page is not presented as an
        // empty search.
        const pageNote = pagination
          ? `\n\nPage ${pagination.page} of ${pagination.total_pages}${
              pagination.has_next
                ? ` — more results available, request page ${pagination.page + 1}.`
                : ' — no further pages.'
            }`
          : '';

        if (concepts.length === 0) {
          const source = concept_id ? `concept ${concept_id}` : (concept_name ?? query ?? '');
          return {
            content: [
              {
                type: 'text' as const,
text: pagination && pagination.page > pagination.total_pages
  ? `No results on page ${pagination.page} for ${source}. There ${pagination.total_pages === 1 ? 'is' : 'are'} only ${pagination.total_pages} page${pagination.total_pages === 1 ? '' : 's'}; results exist on earlier pages.`
  : `No similar concepts found for ${source}. Try lowering the similarity threshold or using a different algorithm.${pageNote}`,
              },
              {
                type: 'text' as const,
                text: JSON.stringify({
                  similar_concepts: [],
                  search_metadata: meta,
                  pagination,
                }),
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
          const score =
            typeof c.similarity_score === 'number' && Number.isFinite(c.similarity_score)
              ? c.similarity_score.toFixed(2)
              : 'N/A';
          let line = `${i + 1}. **${c.concept_name}** (ID: ${c.concept_id}) — score: ${score}\n   ${c.vocabulary_id} | ${c.domain_id} | Code: ${c.concept_code}${std}`;
          // `explanation` is the documented name; the alias is read only so
          // that an older API deployment still renders.
          const explanation = c.explanation ?? c.similarity_explanation;
          if (explanation) {
            line += `\n   _${explanation}_`;
          }
          return line;
        });

        const algoLabel = meta?.algorithm_used ?? algorithm ?? 'semantic';
        // Say so when the algorithm that ran is not the one that was asked
        // for, rather than presenting the fallback as what was requested.
        const degraded = meta?.degraded_from
          ? ` — ${meta.degraded_from} was requested but only its ${algoLabel} half could run`
          : '';
        const text = `Found ${concepts.length} concepts similar to ${source} (${algoLabel} algorithm${degraded}):\n\n${lines.join('\n\n')}${pageNote}`;

        return {
          content: [
            { type: 'text' as const, text },
            {
              type: 'text' as const,
              text: JSON.stringify({
                similar_concepts: concepts,
                search_metadata: meta,
                pagination,
              }),
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
