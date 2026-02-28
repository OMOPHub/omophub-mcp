import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OmopHubClient } from '../../src/client/api.js';
import { registerConceptTools } from '../../src/tools/concepts.js';
import { conceptCache } from '../../src/utils/cache.js';
import conceptResponse from '../fixtures/concept-response.json';
import { createMockClient, createMockServer } from '../helpers/mock-server.js';

describe('get_concept / get_concept_by_code', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    conceptCache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches concept by ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => conceptResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    const response = await client.request('/concepts/201826');

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty('concept_id', 201826);
    expect(response.data).toHaveProperty('concept_name', 'Type 2 diabetes mellitus');
  });

  it('fetches concept by vocabulary code using correct path', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => conceptResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request('/concepts/by-code/ICD10CM/E11.9');

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/concepts/by-code/ICD10CM/E11.9');
  });

  it('caches concept responses', async () => {
    const data = conceptResponse;
    conceptCache.set('concept:201826', data);

    const cached = conceptCache.get('concept:201826');
    expect(cached).toEqual(data);
  });

  it('caches code-based lookups', async () => {
    const data = conceptResponse;
    conceptCache.set('code:ICD10CM:E11.9', data);

    const cached = conceptCache.get('code:ICD10CM:E11.9');
    expect(cached).toEqual(data);
  });

  describe('get_concept handler via mock server', () => {
    it('registers both concept tools', () => {
      const server = createMockServer();
      const client = createMockClient();
      registerConceptTools(server as never, client as never);

      expect(server.tool).toHaveBeenCalledTimes(2);
      expect(server.tools.has('get_concept')).toBe(true);
      expect(server.tools.has('get_concept_by_code')).toBe(true);
    });

    it('fetches from API on cache miss and caches result', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(conceptResponse);

      registerConceptTools(server as never, client as never);
      const handler = server.tools.get('get_concept')!;

      const result = await handler({ concept_id: 201826 });

      expect(client.request).toHaveBeenCalledWith('/concepts/201826', undefined, 'get_concept');
      expect(result.content).toHaveLength(2);
      expect(result.isError).toBeUndefined();
      expect(conceptCache.has('concept:201826')).toBe(true);
    });

    it('returns cached data without API call on cache hit', async () => {
      const server = createMockServer();
      const client = createMockClient();
      conceptCache.set('concept:201826', conceptResponse);

      registerConceptTools(server as never, client as never);
      const handler = server.tools.get('get_concept')!;

      const result = await handler({ concept_id: 201826 });

      expect(client.request).not.toHaveBeenCalled();
      expect(result.content).toHaveLength(2);
    });

    it('returns error content on failure', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockRejectedValueOnce(new Error('API error'));

      registerConceptTools(server as never, client as never);
      const handler = server.tools.get('get_concept')!;

      const result = await handler({ concept_id: 999 });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(2);
    });
  });

  describe('get_concept_by_code handler via mock server', () => {
    it('fetches from API with encoded URL and caches result', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(conceptResponse);

      registerConceptTools(server as never, client as never);
      const handler = server.tools.get('get_concept_by_code')!;

      const result = await handler({ vocabulary_id: 'ICD10CM', concept_code: 'E11.9' });

      expect(client.request).toHaveBeenCalledWith(
        '/concepts/by-code/ICD10CM/E11.9',
        undefined,
        'get_concept_by_code',
      );
      expect(result.content.length).toBeGreaterThanOrEqual(2);
      expect(conceptCache.has('code:ICD10CM:E11.9')).toBe(true);
    });

    it('handles array response data', async () => {
      const arrayResponse = {
        success: true,
        data: [conceptResponse.data, conceptResponse.data],
        meta: conceptResponse.meta,
      };

      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(arrayResponse);

      registerConceptTools(server as never, client as never);
      const handler = server.tools.get('get_concept_by_code')!;

      const result = await handler({ vocabulary_id: 'SNOMED', concept_code: '44054006' });

      // Should have 2 text blocks (one per concept) + 1 JSON block
      expect(result.content).toHaveLength(3);
    });

    it('returns cached data on cache hit', async () => {
      const server = createMockServer();
      const client = createMockClient();
      conceptCache.set('code:ICD10CM:E11.9', conceptResponse);

      registerConceptTools(server as never, client as never);
      const handler = server.tools.get('get_concept_by_code')!;

      const result = await handler({ vocabulary_id: 'ICD10CM', concept_code: 'E11.9' });

      expect(client.request).not.toHaveBeenCalled();
      expect(result.content.length).toBeGreaterThanOrEqual(2);
    });

    it('URL-encodes special characters in vocabulary_id and concept_code', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(conceptResponse);

      registerConceptTools(server as never, client as never);
      const handler = server.tools.get('get_concept_by_code')!;

      await handler({ vocabulary_id: 'ICD10 CM', concept_code: 'E11/9' });

      expect(client.request).toHaveBeenCalledWith(
        '/concepts/by-code/ICD10%20CM/E11%2F9',
        undefined,
        'get_concept_by_code',
      );
    });

    it('returns error content on failure', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockRejectedValueOnce(new Error('Not found'));

      registerConceptTools(server as never, client as never);
      const handler = server.tools.get('get_concept_by_code')!;

      const result = await handler({ vocabulary_id: 'SNOMED', concept_code: '999' });

      expect(result.isError).toBe(true);
    });
  });
});
