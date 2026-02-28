import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OmopHubClient } from '../../src/client/api.js';
import { registerMappingTools } from '../../src/tools/mappings.js';
import mappingsResponse from '../fixtures/mappings-response.json';
import { createMockClient, createMockServer } from '../helpers/mock-server.js';

describe('map_concept', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps target_vocabularies to target_vocabulary API param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mappingsResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request(
      '/concepts/201826/mappings',
      {
        target_vocabulary: 'ICD10CM',
      },
      'map_concept',
    );

    const [url] = mockFetch.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/v1/concepts/201826/mappings');
    expect(parsed.searchParams.get('target_vocabulary')).toBe('ICD10CM');
  });

  it('returns mappings with correct structure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mappingsResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    const response = await client.request('/concepts/201826/mappings');

    expect(response.success).toBe(true);
    const data = response.data as typeof mappingsResponse.data;
    expect(data.mappings).toHaveLength(2);
    expect(data.source_concept.concept_id).toBe(201826);
  });

  it('handles empty mappings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          source_concept: {
            concept_id: 999,
            concept_name: 'Test',
            vocabulary_id: 'Test',
            concept_code: '999',
            domain_id: 'Test',
            standard_concept: null,
            concept_class_id: 'Test',
          },
          mappings: [],
          total_mappings: 0,
        },
      }),
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    const response = await client.request('/concepts/999/mappings');

    const data = response.data as { mappings: unknown[]; total_mappings: number };
    expect(data.mappings).toHaveLength(0);
    expect(data.total_mappings).toBe(0);
  });

  describe('tool handler via mock server', () => {
    it('registers map_concept tool', () => {
      const server = createMockServer();
      const client = createMockClient();
      registerMappingTools(server as never, client as never);

      expect(server.tool).toHaveBeenCalledOnce();
      expect(server.tools.has('map_concept')).toBe(true);
    });

    it('calls API and returns formatted content on success', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(mappingsResponse);

      registerMappingTools(server as never, client as never);
      const handler = server.tools.get('map_concept')!;

      const result = await handler({ concept_id: 201826 });

      expect(client.request).toHaveBeenCalledWith('/concepts/201826/mappings', {}, 'map_concept');
      expect(result.content).toHaveLength(2);
      expect(result.isError).toBeUndefined();
    });

    it('maps target_vocabularies parameter to target_vocabulary', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(mappingsResponse);

      registerMappingTools(server as never, client as never);
      const handler = server.tools.get('map_concept')!;

      await handler({ concept_id: 201826, target_vocabularies: 'ICD10CM' });

      expect(client.request).toHaveBeenCalledWith(
        '/concepts/201826/mappings',
        { target_vocabulary: 'ICD10CM' },
        'map_concept',
      );
    });

    it('handles empty mappings response', async () => {
      const emptyResponse = {
        success: true,
        data: {
          source_concept: mappingsResponse.data.source_concept,
          mappings: [],
          total_mappings: 0,
        },
      };

      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(emptyResponse);

      registerMappingTools(server as never, client as never);
      const handler = server.tools.get('map_concept')!;

      const result = await handler({ concept_id: 201826 });

      expect(result.content).toHaveLength(2);
      // formatMappings returns "No mappings found" for empty mappings
      expect(result.content[0].text).toContain('No mappings found');
    });

    it('returns error content on failure', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockRejectedValueOnce(new Error('API error'));

      registerMappingTools(server as never, client as never);
      const handler = server.tools.get('map_concept')!;

      const result = await handler({ concept_id: 999 });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(2);
    });
  });
});
