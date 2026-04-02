import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OmopHubClient } from '../client/api.js';
import { resolveClient } from '../client/resolve.js';
import type { Vocabulary } from '../client/types.js';
import { vocabularyCache } from '../utils/cache.js';

const PAGE_SIZE = 100;
const CACHE_KEY = 'vocabularies:all';

async function fetchAllVocabularies(
  client: OmopHubClient,
  toolName: string,
): Promise<Vocabulary[]> {
  const all: Vocabulary[] = [];
  let page = 1;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const raw = await client.request<{ vocabularies: Vocabulary[] }>(
      '/vocabularies',
      { include_stats: true, page_size: PAGE_SIZE, page },
      toolName,
    );
    const batch = raw.data.vocabularies;
    all.push(...batch);

    if (batch.length < PAGE_SIZE || !raw.meta?.pagination?.has_next) break;
    page++;
  }

  return all;
}

async function getCachedVocabularies(
  client: OmopHubClient,
  toolName: string,
): Promise<Vocabulary[]> {
  const cached = vocabularyCache.get(CACHE_KEY) as { data: Vocabulary[] } | undefined;
  if (cached) return cached.data;

  const vocabs = await fetchAllVocabularies(client, toolName);
  vocabularyCache.set(CACHE_KEY, { data: vocabs });
  return vocabs;
}

export function registerResources(server: McpServer, client: OmopHubClient): void {
  // Static resource: vocabulary catalog
  server.resource('vocabulary-list', 'omophub://vocabularies', async (uri, extra) => {
    const rc = resolveClient(extra, client);
    const vocabs = await getCachedVocabularies(rc, 'resource:vocabulary-list');
    const text = vocabs
      .map(
        (v) =>
          `${v.vocabulary_id}: ${v.vocabulary_name}${v.concept_count != null ? ` (${v.concept_count.toLocaleString()} concepts)` : ''}`,
      )
      .join('\n');

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/plain',
          text: `OMOP Vocabulary Catalog\n${'='.repeat(40)}\n\n${text}`,
        },
      ],
    };
  });

  // Resource template: individual vocabulary details
  const vocabularyTemplate = new ResourceTemplate('omophub://vocabularies/{vocabulary_id}', {
    list: undefined,
  });

  server.resource('vocabulary-details', vocabularyTemplate, async (uri, variables, extra) => {
    const rc = resolveClient(extra, client);
    const vocabularyId = String(variables.vocabulary_id);
    const vocabs = await getCachedVocabularies(rc, 'resource:vocabulary-details');

    const vocab = vocabs.find((v) => v.vocabulary_id.toLowerCase() === vocabularyId.toLowerCase());

    if (!vocab) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Vocabulary "${vocabularyId}" not found.`,
          },
        ],
      };
    }

    const lines = [
      `Vocabulary: ${vocab.vocabulary_id}`,
      `Name: ${vocab.vocabulary_name}`,
      vocab.vocabulary_version ? `Version: ${vocab.vocabulary_version}` : null,
      vocab.vocabulary_reference ? `Reference: ${vocab.vocabulary_reference}` : null,
      vocab.concept_count != null
        ? `Total Concepts: ${vocab.concept_count.toLocaleString()}`
        : null,
      vocab.standard_concept_count != null
        ? `Standard Concepts: ${vocab.standard_concept_count.toLocaleString()}`
        : null,
    ].filter(Boolean);

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/plain',
          text: lines.join('\n'),
        },
      ],
    };
  });
}
