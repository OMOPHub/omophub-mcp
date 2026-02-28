import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OmopHubClient } from '../../src/client/api.js';
import { registerSearchTools } from '../../src/tools/search.js';
import searchResponse from '../fixtures/search-response.json';
import { createMockClient, createMockServer } from '../helpers/mock-server.js';

describe('search_concepts', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps vocabulary_ids to vocabularies API param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => searchResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request(
      '/search/concepts',
      {
        query: 'diabetes',
        vocabularies: 'SNOMED,ICD10CM',
        page_size: 10,
      },
      'search_concepts',
    );

    const [url] = mockFetch.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('vocabularies')).toBe('SNOMED,ICD10CM');
    expect(parsed.searchParams.get('query')).toBe('diabetes');
    expect(parsed.searchParams.get('page_size')).toBe('10');
  });

  it('returns results with correct structure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => searchResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    const response = await client.request('/search/concepts', {
      query: 'type 2 diabetes',
    });

    expect(response.success).toBe(true);
    expect(Array.isArray(response.data)).toBe(true);
    expect(response.meta?.pagination?.total_items).toBe(42);
  });

  it('passes standard_concept filter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => searchResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request('/search/concepts', {
      query: 'diabetes',
      standard_concept: 'S',
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('standard_concept')).toBe('S');
  });

  describe('tool handler via mock server', () => {
    it('registers search_concepts tool', () => {
      const server = createMockServer();
      const client = createMockClient();
      registerSearchTools(server as never, client as never);

      expect(server.tool).toHaveBeenCalledOnce();
      expect(server.tools.has('search_concepts')).toBe(true);
    });

    it('calls API and returns formatted content on success', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(searchResponse);

      registerSearchTools(server as never, client as never);
      const handler = server.tools.get('search_concepts')!;

      const result = await handler({
        query: 'diabetes',
        page: 1,
        page_size: 10,
      });

      expect(client.request).toHaveBeenCalledWith(
        '/search/concepts',
        expect.objectContaining({ query: 'diabetes', page: 1, page_size: 10 }),
        'search_concepts',
      );
      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBeUndefined();
    });

    it('maps vocabulary_ids and domain_ids parameters', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(searchResponse);

      registerSearchTools(server as never, client as never);
      const handler = server.tools.get('search_concepts')!;

      await handler({
        query: 'diabetes',
        vocabulary_ids: 'SNOMED,ICD10CM',
        domain_ids: 'Condition',
        standard_concept: 'S',
        page: 2,
        page_size: 20,
      });

      expect(client.request).toHaveBeenCalledWith(
        '/search/concepts',
        expect.objectContaining({
          vocabularies: 'SNOMED,ICD10CM',
          domain_ids: 'Condition',
          standard_concept: 'S',
          page: 2,
          page_size: 20,
        }),
        'search_concepts',
      );
    });

    it('uses default pagination values', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(searchResponse);

      registerSearchTools(server as never, client as never);
      const handler = server.tools.get('search_concepts')!;

      await handler({ query: 'test' });

      expect(client.request).toHaveBeenCalledWith(
        '/search/concepts',
        expect.objectContaining({ page: 1, page_size: 10 }),
        'search_concepts',
      );
    });

    it('returns error content on failure', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockRejectedValueOnce(new Error('Network error'));

      registerSearchTools(server as never, client as never);
      const handler = server.tools.get('search_concepts')!;

      const result = await handler({ query: 'diabetes', page: 1, page_size: 10 });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(2);
    });
  });
});
