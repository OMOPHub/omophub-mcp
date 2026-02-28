import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import type { ApiResponse, Concept } from '../client/types.js';
import { formatConcept } from '../formatters/index.js';
import { conceptCache } from '../utils/cache.js';
import { formatErrorForMcp } from '../utils/errors.js';

export function registerConceptTools(server: McpServer, client: OmopHubClient): void {
  server.tool(
    'get_concept',
    'Get detailed information about a specific OMOP concept by its numeric concept_id. Returns the concept name, vocabulary, domain, concept class, standard status, valid dates, and synonyms. Use this when you already have a concept_id and need its details.',
    {
      concept_id: z.number().describe('The OMOP concept_id (numeric identifier)'),
    },
    async ({ concept_id }) => {
      try {
        const cacheKey = `concept:${concept_id}`;
        const cached = conceptCache.get(cacheKey) as ApiResponse<Concept> | undefined;

        if (cached) {
          const { text, json } = formatConcept(cached.data);
          return {
            content: [
              { type: 'text' as const, text },
              { type: 'text' as const, text: json },
            ],
          };
        }

        const response = await client.request<Concept>(
          `/concepts/${concept_id}`,
          undefined,
          'get_concept',
        );

        conceptCache.set(cacheKey, response);
        const { text, json } = formatConcept(response.data);

        return {
          content: [
            { type: 'text' as const, text },
            { type: 'text' as const, text: json },
          ],
        };
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'get_concept');
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

  server.tool(
    'get_concept_by_code',
    "Look up an OMOP concept using a vocabulary-specific code and vocabulary ID. Both parameters are required to avoid ambiguity — the same code can exist in multiple vocabularies (e.g., 'E11' exists in both ICD10CM and ICD10). If multiple concepts share the same code within a vocabulary, all matches are returned — prefer the one with standard_concept='S'.",
    {
      vocabulary_id: z
        .string()
        .max(50)
        .describe(
          "The vocabulary system. Examples: 'ICD10CM', 'SNOMED', 'RxNorm', 'LOINC', 'CPT4', 'HCPCS', 'NDC'",
        ),
      concept_code: z
        .string()
        .max(50)
        .describe(
          "The vocabulary-specific code. Examples: 'E11.9' (ICD-10), '44054006' (SNOMED), '4850' (LOINC)",
        ),
    },
    async ({ vocabulary_id, concept_code }) => {
      try {
        const cacheKey = `code:${vocabulary_id}:${concept_code}`;
        const cached = conceptCache.get(cacheKey) as ApiResponse<Concept | Concept[]> | undefined;

        if (cached) {
          const concepts = Array.isArray(cached.data) ? cached.data : [cached.data];
          const formatted = concepts.map((c) => formatConcept(c));
          return {
            content: [
              ...formatted.map((f) => ({ type: 'text' as const, text: f.text })),
              { type: 'text' as const, text: JSON.stringify(concepts) },
            ],
          };
        }

        // Actual API uses /concepts/by-code/{vocabulary_id}/{concept_code}
        const response = await client.request<Concept | Concept[]>(
          `/concepts/by-code/${encodeURIComponent(vocabulary_id)}/${encodeURIComponent(concept_code)}`,
          undefined,
          'get_concept_by_code',
        );

        conceptCache.set(cacheKey, response);

        const concepts = Array.isArray(response.data) ? response.data : [response.data];
        const formatted = concepts.map((c) => formatConcept(c));

        return {
          content: [
            ...formatted.map((f) => ({ type: 'text' as const, text: f.text })),
            { type: 'text' as const, text: JSON.stringify(concepts) },
          ],
        };
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'get_concept_by_code');
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
