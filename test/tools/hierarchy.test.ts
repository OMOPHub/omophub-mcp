import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OmopHubClient } from '../../src/client/api.js';
import { registerHierarchyTools } from '../../src/tools/hierarchy.js';
import { hierarchyCache } from '../../src/utils/cache.js';
import hierarchyResponse from '../fixtures/hierarchy-response.json';
import { createMockClient, createMockServer } from '../helpers/mock-server.js';

describe('get_hierarchy', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    hierarchyCache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes direction="up" to ancestors endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => hierarchyResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request('/concepts/201826/ancestors', {}, 'get_hierarchy');

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/concepts/201826/ancestors');
  });

  it('routes direction="down" to descendants endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => hierarchyResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request('/concepts/201826/descendants', {}, 'get_hierarchy');

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/concepts/201826/descendants');
  });

  it('routes direction="both" to hierarchy endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => hierarchyResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request('/concepts/201826/hierarchy', {}, 'get_hierarchy');

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/concepts/201826/hierarchy');
  });

  it('passes max_levels and page_size params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => hierarchyResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request('/concepts/201826/descendants', {
      max_levels: 3,
      page_size: 100,
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('max_levels')).toBe('3');
    expect(parsed.searchParams.get('page_size')).toBe('100');
  });

  it('returns hierarchy with ancestors and descendants', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => hierarchyResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    const response = await client.request('/concepts/201826/hierarchy');

    const data = response.data as typeof hierarchyResponse.data;
    expect(data.concept_id).toBe(201826);
    expect(data.ancestors).toHaveLength(2);
    expect(data.descendants).toHaveLength(2);
  });

  describe('tool handler via mock server', () => {
    it('registers get_hierarchy tool', () => {
      const server = createMockServer();
      const client = createMockClient();
      registerHierarchyTools(server as never, client as never);

      expect(server.tool).toHaveBeenCalledOnce();
      expect(server.tools.has('get_hierarchy')).toBe(true);
    });

    it('routes direction="up" to /ancestors endpoint', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(hierarchyResponse);

      registerHierarchyTools(server as never, client as never);
      const handler = server.tools.get('get_hierarchy')!;

      await handler({ concept_id: 201826, direction: 'up', max_results: 500 });

      expect(client.request).toHaveBeenCalledWith(
        '/concepts/201826/ancestors',
        expect.objectContaining({ page_size: 500 }),
        'get_hierarchy',
      );
    });

    it('routes direction="down" to /descendants endpoint', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(hierarchyResponse);

      registerHierarchyTools(server as never, client as never);
      const handler = server.tools.get('get_hierarchy')!;

      await handler({ concept_id: 201826, direction: 'down', max_results: 100 });

      expect(client.request).toHaveBeenCalledWith(
        '/concepts/201826/descendants',
        expect.objectContaining({ page_size: 100 }),
        'get_hierarchy',
      );
    });

    it('routes direction="both" to /hierarchy endpoint', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(hierarchyResponse);

      registerHierarchyTools(server as never, client as never);
      const handler = server.tools.get('get_hierarchy')!;

      await handler({ concept_id: 201826, direction: 'both', max_results: 500 });

      expect(client.request).toHaveBeenCalledWith(
        '/concepts/201826/hierarchy',
        expect.objectContaining({ page_size: 500 }),
        'get_hierarchy',
      );
    });

    it('defaults direction to "both"', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(hierarchyResponse);

      registerHierarchyTools(server as never, client as never);
      const handler = server.tools.get('get_hierarchy')!;

      await handler({ concept_id: 201826, max_results: 500 });

      expect(client.request).toHaveBeenCalledWith(
        '/concepts/201826/hierarchy',
        expect.anything(),
        'get_hierarchy',
      );
    });

    it('maps max_results to page_size and passes max_levels', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(hierarchyResponse);

      registerHierarchyTools(server as never, client as never);
      const handler = server.tools.get('get_hierarchy')!;

      await handler({
        concept_id: 201826,
        direction: 'down',
        max_levels: 3,
        max_results: 100,
        vocabulary_ids: 'SNOMED',
      });

      expect(client.request).toHaveBeenCalledWith(
        '/concepts/201826/descendants',
        { max_levels: 3, page_size: 100, vocabulary_ids: 'SNOMED' },
        'get_hierarchy',
      );
    });

    it('caches hierarchy response and returns cached data', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(hierarchyResponse);

      registerHierarchyTools(server as never, client as never);
      const handler = server.tools.get('get_hierarchy')!;

      // First call — cache miss
      await handler({ concept_id: 201826, direction: 'up', max_results: 500 });
      expect(client.request).toHaveBeenCalledOnce();

      // Second call — cache hit
      const result = await handler({ concept_id: 201826, direction: 'up', max_results: 500 });
      expect(client.request).toHaveBeenCalledOnce(); // no second call
      expect(result.content).toHaveLength(2);
    });

    it('returns error content on failure', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockRejectedValueOnce(new Error('API error'));

      registerHierarchyTools(server as never, client as never);
      const handler = server.tools.get('get_hierarchy')!;

      const result = await handler({ concept_id: 999, direction: 'both', max_results: 500 });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(2);
    });
  });
});
