import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import { resolveClient } from '../client/resolve.js';
import type { MappingsResponse } from '../client/types.js';
import { formatMappings } from '../formatters/index.js';
import { formatErrorForMcp, OmopHubApiError } from '../utils/errors.js';
import { lookupConceptByCode } from './concepts.js';
import {
  containsRecordFields,
  formattedResult,
  inputError,
  mappingOutput,
  numericArgument,
  readAnnotations,
  recordInputError,
} from './contract.js';

export function registerMappingTools(server: McpServer, client: OmopHubClient): void {
  server.registerTool(
    'map_concept',
    {
      title: 'Map a source concept',
      annotations: readAnnotations,
      outputSchema: z.looseObject({
        source_concept_id: z.number(),
        mapped: z
          .boolean()
          .nullable()
          .describe('Null when the source was verified but quota prevented checking its mappings.'),
        mappings: z.array(mappingOutput),
        mapping_error: z
          .looseObject({
            status: z.literal(429),
            error_code: z.literal('MONTHLY_LIMIT_EXCEEDED'),
            resets_at: z.string().datetime().optional(),
          })
          .optional(),
        message: z.string().optional(),
      }),
      description:
        'Map a source vocabulary code or a known numeric OMOP concept ID to another vocabulary. For ICD10CM to SNOMED, supply vocabulary_id="ICD10CM", the original concept_code and target_vocabularies="SNOMED". The tool resolves the exact source code before reading its mappings. Report only the targets in successful mappings rows. On error, the mapping is unverified. Follow has_more for further pages.',
      inputSchema: {
        on_monthly_limit: z
          .enum(['error', 'return_source'])
          .optional()
          .describe(
            'Return an explicitly partial report if the source lookup succeeds and monthly quota blocks the mapping read. Defaults to an MCP error.',
          ),
        vocabulary_id: z
          .string()
          .min(1)
          .max(50)
          .optional()
          .describe('Source vocabulary for an exact code lookup'),
        concept_code: z
          .string()
          .min(1)
          .max(50)
          .optional()
          .describe('Original code in the source vocabulary'),
        concept_id: z
          .number()
          .optional()
          .describe('Known numeric source OMOP ID, as an alternative to a vocabulary and code'),
        target_vocabularies: z
          .string()
          .max(200)
          .optional()
          .describe(
            "Comma-separated vocabulary IDs to map TO. Examples: 'ICD10CM', 'SNOMED', 'RxNorm'. Omit to see all available mappings.",
          ),
        page: numericArgument(z.number().int().min(1))
          .default(1)
          .describe('Page number (1-based, default 1)'),
        // Ceiling is 200 because the API clamps page_size on GET requests to
        // CACHE_LIMITS.MAX_PAGE_SIZE. Declaring 1000 here would let a caller ask for
        // a page they can never receive, and the response would quietly be a
        // different size than requested.
        page_size: numericArgument(z.number().int().min(1).max(200))
          .default(100)
          .describe(
            'Mappings per page (1-200, default 100). A concept can have thousands — check has_more in the response and increment page until it is false, otherwise your code list will be incomplete.',
          ),
      },
    },
    async (
      {
        concept_id,
        vocabulary_id,
        concept_code,
        target_vocabularies,
        page,
        page_size,
        on_monthly_limit,
      },
      extra,
    ) => {
      if (containsRecordFields([vocabulary_id, concept_code, target_vocabularies]))
        return recordInputError();
      let sourceId = concept_id;
      try {
        const rc = resolveClient(extra, client);
        if (sourceId === undefined) {
          if (!vocabulary_id || !concept_code)
            return inputError(
              'INVALID_SOURCE',
              'Provide a numeric concept_id or both vocabulary_id and concept_code. OMOPHub could not verify the mapping.',
            );
          const lookup = await lookupConceptByCode(rc, vocabulary_id, concept_code);
          const matches = Array.isArray(lookup.data) ? lookup.data : [lookup.data];
          const [source] = matches;
          if (
            !lookup.success ||
            matches.length !== 1 ||
            !source ||
            !Number.isSafeInteger(source.concept_id) ||
            source.vocabulary_id !== vocabulary_id ||
            source.concept_code !== concept_code
          )
            return inputError(
              'UNRESOLVED_SOURCE',
              'OMOPHub could not verify the mapping. Use get_concept_by_code to select a unique source concept.',
            );
          sourceId = source.concept_id;
        } else if (vocabulary_id !== undefined || concept_code !== undefined) {
          return inputError(
            'INVALID_SOURCE',
            'Supply one source selector. OMOPHub could not verify the mapping.',
          );
        }
        const params: Record<string, string | number | boolean | undefined> = {
          page: page ?? 1,
          page_size: page_size ?? 100,
        };

        // Map PRD param to actual API param (target_vocabularies → target_vocabulary)
        if (target_vocabularies) params.target_vocabulary = target_vocabularies;

        const response = await rc.request<MappingsResponse>(
          `/concepts/${sourceId}/mappings`,
          params,
          'map_concept',
        );

        if (
          !response.success ||
          !Array.isArray(response.data?.mappings) ||
          (response.data.source_concept && response.data.source_concept.concept_id !== sourceId)
        ) {
          return inputError('UNVERIFIED_MAPPING', 'OMOPHub could not verify the mapping.');
        }
        const { text, json } = formatMappings(response, sourceId);

        return formattedResult(text, json);
      } catch (error) {
        // The general 404 formatter echoes the upstream message. A failed lookup
        // cannot substantiate a target, even if its error body mentions one.
        if (error instanceof OmopHubApiError && error.status === 404)
          return inputError('NOT_FOUND', 'OMOPHub could not verify the mapping.');
        const { text, json } = formatErrorForMcp(error, 'map_concept');
        const explanation = `OMOPHub could not verify the mapping. ${text}`;
        if (
          on_monthly_limit === 'return_source' &&
          concept_id === undefined &&
          sourceId !== undefined &&
          error instanceof OmopHubApiError &&
          error.status === 429 &&
          error.info.code === 'monthly_limit_exceeded'
        ) {
          return formattedResult(
            explanation,
            JSON.stringify({
              source_concept_id: sourceId,
              mapped: null,
              mappings: [],
              mapping_error: { ...JSON.parse(json), status: 429 },
              message: explanation,
            }),
          );
        }
        return formattedResult(explanation, json, true);
      }
    },
  );
}
