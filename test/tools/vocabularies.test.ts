import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OmopHubClient } from '../../src/client/api.js';
import { registerVocabularyTools } from '../../src/tools/vocabularies.js';
import { vocabularyCache } from '../../src/utils/cache.js';
import vocabulariesResponse from '../fixtures/vocabularies-response.json';
import { createMockClient, createMockServer } from '../helpers/mock-server.js';

// The fixture matches the real API shape (data.vocabularies). Build the unwrapped
// version that the tool handler stores in cache after unwrapping.
const unwrappedResponse = {
  ...vocabulariesResponse,
  data: vocabulariesResponse.data.vocabularies,
};

describe('list_vocabularies', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    vocabularyCache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches vocabularies with include_stats', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => vocabulariesResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request('/vocabularies', {
      include_stats: true,
      page_size: 100,
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('include_stats')).toBe('true');
    expect(parsed.searchParams.get('page_size')).toBe('100');
  });

  it('returns all vocabularies', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => vocabulariesResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    const response = await client.request('/vocabularies');

    expect(response.success).toBe(true);
    expect(response.data.vocabularies).toBeDefined();
    expect(response.data.vocabularies).toHaveLength(4);
  });

  it('caches vocabulary responses', async () => {
    vocabularyCache.set('vocabularies:all', unwrappedResponse);
    const cached = vocabularyCache.get('vocabularies:all');
    expect(cached).toEqual(unwrappedResponse);
  });

  describe('tool handler via mock server', () => {
    it('registers list_vocabularies tool', () => {
      const server = createMockServer();
      const client = createMockClient();
      registerVocabularyTools(server as never, client as never);

      expect(server.tool).toHaveBeenCalledOnce();
      expect(server.tools.has('list_vocabularies')).toBe(true);
    });

    it('fetches from API on cache miss and caches result', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(vocabulariesResponse);

      registerVocabularyTools(server as never, client as never);
      const handler = server.tools.get('list_vocabularies')!;

      const result = await handler({});

      expect(client.request).toHaveBeenCalledWith(
        '/vocabularies',
        { include_stats: true, page_size: 100 },
        'list_vocabularies',
      );
      expect(result.content).toHaveLength(2);
      expect(result.isError).toBeUndefined();
      expect(vocabularyCache.has('vocabularies:all')).toBe(true);
    });

    it('returns cached data without API call on cache hit', async () => {
      const server = createMockServer();
      const client = createMockClient();
      vocabularyCache.set('vocabularies:all', unwrappedResponse);

      registerVocabularyTools(server as never, client as never);
      const handler = server.tools.get('list_vocabularies')!;

      const result = await handler({});

      expect(client.request).not.toHaveBeenCalled();
      expect(result.content).toHaveLength(2);
    });

    it('passes search filter through to formatter', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(vocabulariesResponse);

      registerVocabularyTools(server as never, client as never);
      const handler = server.tools.get('list_vocabularies')!;

      const result = await handler({ search: 'SNOMED' });

      expect(result.content).toHaveLength(2);
      // The first text content should contain the search-filtered results
      expect(result.content[0].text).toContain('SNOMED');
    });

    it('returns error content on failure', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockRejectedValueOnce(new Error('Network error'));

      registerVocabularyTools(server as never, client as never);
      const handler = server.tools.get('list_vocabularies')!;

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(2);
    });
  });
});
