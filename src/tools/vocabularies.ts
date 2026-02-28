import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import type { ApiResponse, Vocabulary } from '../client/types.js';
import { formatVocabularyList } from '../formatters/index.js';
import { vocabularyCache } from '../utils/cache.js';
import { formatErrorForMcp } from '../utils/errors.js';

export function registerVocabularyTools(server: McpServer, client: OmopHubClient): void {
  server.tool(
    'list_vocabularies',
    'List all available medical vocabularies in the OMOP standardized vocabulary system with concept counts and metadata. Use this to understand what terminology systems are available (SNOMED CT, ICD-10-CM, RxNorm, LOINC, etc.) and their scope.',
    {
      search: z.string().max(200).optional().describe('Optional search term to filter vocabularies by name'),
    },
    async ({ search }) => {
      try {
        const cacheKey = 'vocabularies:all';
        let response = vocabularyCache.get(cacheKey) as ApiResponse<Vocabulary[]> | undefined;

        if (!response) {
          const rawResponse = await client.request<{ vocabularies: Vocabulary[] }>(
            '/vocabularies',
            { include_stats: true, page_size: 100 },
            'list_vocabularies',
          );
          // API wraps array in { vocabularies: [...] } — unwrap for formatter
          response = {
            ...rawResponse,
            data: rawResponse.data.vocabularies,
          };
          vocabularyCache.set(cacheKey, response);
        }

        const { text, json } = formatVocabularyList(response, search);

        return {
          content: [
            { type: 'text' as const, text },
            { type: 'text' as const, text: json },
          ],
        };
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'list_vocabularies');
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
