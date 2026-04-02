import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import { resolveClient } from '../client/resolve.js';
import type { ApiResponse, Vocabulary } from '../client/types.js';
import { formatVocabularyList } from '../formatters/index.js';
import { vocabularyCache } from '../utils/cache.js';
import { formatErrorForMcp } from '../utils/errors.js';

const PAGE_SIZE = 100;

async function fetchAllVocabularies(client: OmopHubClient): Promise<Vocabulary[]> {
  const all: Vocabulary[] = [];
  let page = 1;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const raw = await client.request<{ vocabularies: Vocabulary[] }>(
      '/vocabularies',
      { include_stats: true, page_size: PAGE_SIZE, page },
      'list_vocabularies',
    );
    const batch = raw.data.vocabularies;
    all.push(...batch);

    if (batch.length < PAGE_SIZE || !raw.meta?.pagination?.has_next) break;
    page++;
  }

  return all;
}

export function registerVocabularyTools(server: McpServer, client: OmopHubClient): void {
  server.tool(
    'list_vocabularies',
    'List all available medical vocabularies in the OMOP standardized vocabulary system with concept counts and metadata. Use this to understand what terminology systems are available (SNOMED CT, ICD-10-CM, RxNorm, LOINC, etc.) and their scope.',
    {
      search: z
        .string()
        .max(200)
        .optional()
        .describe('Optional search term to filter vocabularies by name'),
    },
    async ({ search }, extra) => {
      try {
        const rc = resolveClient(extra, client);
        const cacheKey = 'vocabularies:all';
        let vocabs = vocabularyCache.get(cacheKey) as Vocabulary[] | undefined;

        if (!vocabs) {
          vocabs = await fetchAllVocabularies(rc);
          vocabularyCache.set(cacheKey, vocabs);
        }

        const response: ApiResponse<Vocabulary[]> = {
          success: true,
          data: vocabs,
          meta: {
            pagination: {
              total_items: vocabs.length,
              page: 1,
              page_size: vocabs.length,
              total_pages: 1,
              has_next: false,
              has_previous: false,
            },
          },
        };

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
