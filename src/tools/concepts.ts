import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import { resolveClient } from '../client/resolve.js';
import type { ApiResponse, Concept } from '../client/types.js';
import { formatConcept } from '../formatters/index.js';
import { conceptCache } from '../utils/cache.js';
import { formatErrorForMcp } from '../utils/errors.js';
import {
  conceptOutput,
  containsRecordFields,
  formattedResult,
  readAnnotations,
  recordInputError,
} from './contract.js';

export function lookupConceptById(client: OmopHubClient, id: number) {
  return client.request<Concept>(`/concepts/${id}`, undefined, 'get_concept');
}

export function lookupConceptByCode(client: OmopHubClient, vocabularyId: string, code: string) {
  return client.request<Concept | Concept[]>(
    `/concepts/by-code/${encodeURIComponent(vocabularyId)}/${encodeURIComponent(code)}`,
    undefined,
    'get_concept_by_code',
  );
}

export function registerConceptTools(
  server: McpServer,
  client: OmopHubClient,
  cache: typeof conceptCache | null = conceptCache,
): void {
  server.registerTool(
    'get_concept',
    {
      title: 'Look up a concept by numeric OMOP ID',
      annotations: readAnnotations,
      outputSchema: conceptOutput.extend({ vocab_release: z.string().optional() }),
      description:
        'Get detailed information about a specific OMOP concept by its numeric concept_id. Returns the concept name, vocabulary, domain, concept class, standard status, valid dates, and synonyms. After searching by name, pass the selected numeric concept_id here to verify the concept code and vocabulary release.',
      inputSchema: {
        concept_id: z.number().describe('The OMOP concept_id (numeric identifier)'),
      },
    },
    async ({ concept_id }, extra) => {
      try {
        const rc = resolveClient(extra, client);
        const cacheKey = `concept:${concept_id}`;
        let response = cache?.get(cacheKey) as ApiResponse<Concept> | undefined;
        if (!response) {
          response = await lookupConceptById(rc, concept_id);
          cache?.set(cacheKey, response);
        }

        const { text, json } = formatConcept(response.data, response.meta?.vocab_release);
        return formattedResult(text, json);
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'get_concept');
        return formattedResult(text, json, true);
      }
    },
  );

  server.registerTool(
    'get_concept_by_code',
    {
      title: 'Look up a source concept by vocabulary and code',
      annotations: readAnnotations,
      outputSchema: z.object({ concepts: z.array(conceptOutput) }),
      description:
        "Look up an OMOP concept using a vocabulary-specific code and vocabulary ID. Both parameters are required to avoid ambiguity - the same code can exist in multiple vocabularies (e.g., 'E11' exists in both ICD10CM and ICD10). If multiple concepts share the same code within a vocabulary, all matches are returned - prefer the one with standard_concept='S'.",
      inputSchema: {
        vocabulary_id: z
          .string()
          .max(50)
          .describe(
            "The vocabulary system. Examples: 'ICD10CM', 'SNOMED', 'RxNorm', 'LOINC', 'HCPCS', 'NDC'",
          ),
        concept_code: z
          .string()
          .max(50)
          .describe(
            "The vocabulary-specific code. Examples: 'E11.9' (ICD-10), '44054006' (SNOMED), '4850' (LOINC)",
          ),
      },
    },
    async ({ vocabulary_id, concept_code }, extra) => {
      if (containsRecordFields([concept_code, vocabulary_id])) return recordInputError();
      try {
        const rc = resolveClient(extra, client);
        const cacheKey = `code:${vocabulary_id}:${concept_code}`;
        const cached = cache?.get(cacheKey) as ApiResponse<Concept | Concept[]> | undefined;

        if (cached) {
          const concepts = Array.isArray(cached.data) ? cached.data : [cached.data];
          const formatted = concepts.map((c) => formatConcept(c));
          return {
            structuredContent: { concepts },
            content: [
              ...formatted.map((f) => ({ type: 'text' as const, text: f.text })),
              { type: 'text' as const, text: JSON.stringify(concepts) },
            ],
          };
        }

        const response = await lookupConceptByCode(rc, vocabulary_id, concept_code);
        cache?.set(cacheKey, response);

        const concepts = Array.isArray(response.data) ? response.data : [response.data];
        const formatted = concepts.map((c) => formatConcept(c));

        return {
          structuredContent: { concepts },
          content: [
            ...formatted.map((f) => ({ type: 'text' as const, text: f.text })),
            { type: 'text' as const, text: JSON.stringify(concepts) },
          ],
        };
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'get_concept_by_code');
        return formattedResult(text, json, true);
      }
    },
  );
}
