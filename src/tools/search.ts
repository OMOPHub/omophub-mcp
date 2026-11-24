import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import { resolveClient } from '../client/resolve.js';
import type { SearchResult } from '../client/types.js';
import { formatConceptList } from '../formatters/index.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { lookupConceptById } from './concepts.js';
import {
  booleanArgument,
  conceptOutput,
  containsRecordFields,
  formattedResult,
  inputError,
  numericArgument,
  readAnnotations,
  recordInputError,
} from './contract.js';

export function registerSearchTools(server: McpServer, client: OmopHubClient): void {
  server.registerTool(
    'search_concepts',
    {
      title: 'Search terminology by name',
      annotations: readAnnotations,
      outputSchema: z.looseObject({
        results: z.array(conceptOutput),
        verified_concept: conceptOutput
          .extend({
            vocabulary_id: z.string(),
            concept_code: z.string(),
            vocab_release: z.string().optional(),
          })
          .optional(),
        page: z.number(),
        total: z.number(),
      }),
      description:
        'Search a vocabulary by term or synonym. When the user asks to look up the matching concept or report its vocabulary release, set verify_match to true. A unique match then gets a second API read by its numeric ID. Multiple matches are returned for selection.',
      inputSchema: {
        verify_match: booleanArgument
          .optional()
          .describe(
            'Set true for a verified concept ID, vocabulary code and release. Uses one extra API read only for a unique match.',
          ),
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
            "Use only the requested vocabulary IDs. For a SNOMED search use 'SNOMED'. Separate multiple requested IDs with a comma. Omit to search all vocabularies.",
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
        page: numericArgument(z.number().min(1))
          .default(1)
          .describe('Page number (1-based, default 1)'),
        // 200 is the API's effective ceiling for GET requests: the route validator
        // allows 1000 but paginationLimitsMiddleware clamps page_size to
        // CACHE_LIMITS.MAX_PAGE_SIZE. Declaring more than the server will honour
        // means a caller asks for N and silently receives 200.
        page_size: numericArgument(z.number().min(1).max(200))
          .default(10)
          .describe('Number of results to return (1-200, default 10)'),
      },
    },
    async (
      { query, verify_match, vocabulary_ids, domain_ids, standard_concept, page, page_size },
      extra,
    ) => {
      if (containsRecordFields([query, vocabulary_ids, domain_ids])) return recordInputError();
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

        if (verify_match && !response.success)
          return inputError('SEARCH_FAILED', 'OMOPHub could not verify the search result.');
        const { text, json } = formatConceptList(response, query);
        if (!verify_match || !response.data.length) return formattedResult(text, json);
        // A single row on a page does not establish a unique match across pages.
        if (response.meta?.pagination?.total_items !== 1 || response.data.length !== 1)
          return formattedResult(`${text}\n\nSelect a candidate to verify with get_concept.`, json);

        const [candidate] = response.data;
        if (!Number.isSafeInteger(candidate.concept_id))
          return inputError('INVALID_CANDIDATE', 'The search result has no valid OMOP concept ID.');
        const detail = await lookupConceptById(rc, candidate.concept_id);
        const match = detail.data;
        if (
          !detail.success ||
          !match ||
          match.concept_id !== candidate.concept_id ||
          match.vocabulary_id !== candidate.vocabulary_id ||
          match.concept_code !== candidate.concept_code
        )
          return inputError(
            'UNVERIFIED_CONCEPT',
            'The concept lookup could not confirm the search result.',
          );

        const release = detail.meta?.vocab_release;
        const verified = {
          concept_id: match.concept_id,
          concept_name: match.concept_name,
          vocabulary_id: match.vocabulary_id,
          concept_code: match.concept_code,
          vocab_release: release,
        };
        return formattedResult(
          [
            `Verified concept name: ${match.concept_name}`,
            `OMOP concept ID: ${match.concept_id}`,
            `${match.vocabulary_id} code: ${match.concept_code}`,
            `Vocabulary release: ${release ?? 'unavailable'}`,
          ].join('\n'),
          JSON.stringify({ verified_concept: verified, ...JSON.parse(json) }),
        );
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'search_concepts');
        return formattedResult(
          verify_match ? `OMOPHub could not verify the concept. ${text}` : text,
          json,
          true,
        );
      }
    },
  );
}
