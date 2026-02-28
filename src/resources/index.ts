import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OmopHubClient } from '../client/api.js';
import type { Vocabulary } from '../client/types.js';
import { vocabularyCache } from '../utils/cache.js';

const PAGE_SIZE = 100;

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

export function registerResources(server: McpServer, client: OmopHubClient): void {
  // Static resource: vocabulary catalog
  server.resource('vocabulary-list', 'omophub://vocabularies', async (uri) => {
    const cacheKey = 'vocabularies:all';
    let cached = vocabularyCache.get(cacheKey) as { data: Vocabulary[] } | undefined;

    if (!cached) {
      const vocabs = await fetchAllVocabularies(client, 'resource:vocabulary-list');
      cached = { data: vocabs };
      vocabularyCache.set(cacheKey, cached);
    }

    const vocabs = cached.data;
    const text = vocabs
      .map(
        (v) =>
          `${v.vocabulary_id}: ${v.vocabulary_name}${v.concept_count ? ` (${v.concept_count.toLocaleString()} concepts)` : ''}`,
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

  server.resource('vocabulary-details', vocabularyTemplate, async (uri, variables) => {
    const vocabularyId = String(variables.vocabulary_id);

    const cacheKey = 'vocabularies:all';
    let cached = vocabularyCache.get(cacheKey) as { data: Vocabulary[] } | undefined;

    if (!cached) {
      const vocabs = await fetchAllVocabularies(client, 'resource:vocabulary-details');
      cached = { data: vocabs };
      vocabularyCache.set(cacheKey, cached);
    }

    const vocab = cached.data.find(
      (v) => v.vocabulary_id.toLowerCase() === vocabularyId.toLowerCase(),
    );

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
      vocab.concept_count ? `Total Concepts: ${vocab.concept_count.toLocaleString()}` : null,
      vocab.standard_concept_count
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
