import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import type { MappingsResponse } from '../client/types.js';
import { formatMappings } from '../formatters/index.js';
import { formatErrorForMcp } from '../utils/errors.js';

export function registerMappingTools(server: McpServer, client: OmopHubClient): void {
  server.tool(
    'map_concept',
    "Find mappings FROM a source concept TO equivalent concepts in other vocabularies. The concept_id you provide is always the SOURCE — results show what it maps TO. Returns cross-vocabulary mappings with relationship types and mapping quality. If no mappings exist, the response explicitly states 'No mappings found' with mapped=false in JSON — never returns ambiguous empty results. Example: provide a SNOMED concept_id and filter by target_vocabularies='ICD10CM' to get the ICD-10 equivalent.",
    {
      concept_id: z.number().describe('The source OMOP concept_id to map FROM'),
      target_vocabularies: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Comma-separated vocabulary IDs to map TO. Examples: 'ICD10CM', 'SNOMED', 'RxNorm'. Omit to see all available mappings.",
        ),
    },
    async ({ concept_id, target_vocabularies }) => {
      try {
        const params: Record<string, string | number | boolean | undefined> = {};

        // Map PRD param to actual API param (target_vocabularies → target_vocabulary)
        if (target_vocabularies) params.target_vocabulary = target_vocabularies;

        const response = await client.request<MappingsResponse>(
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
