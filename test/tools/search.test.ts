import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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

  it('constructs URL with vocabulary_ids query param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => searchResponse,
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request(
      '/search/concepts',
      {
        query: 'diabetes',
        vocabulary_ids: 'SNOMED,ICD10CM',
        page_size: 10,
      },
      'search_concepts',
    );

    const [url] = mockFetch.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('vocabulary_ids')).toBe('SNOMED,ICD10CM');
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

      expect(server.registerTool).toHaveBeenCalledOnce();
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

    const candidate = searchResponse.data[0];
    const unique = {
      ...searchResponse,
      data: [candidate],
      meta: {
        pagination: {
          ...searchResponse.meta.pagination,
          total_items: 1,
          total_pages: 1,
          has_next: false,
        },
      },
    };
    const verifiedArgs = {
      query: 'diabetes',
      vocabulary_ids: candidate.vocabulary_id,
      verify_match: true,
    };

    it('loads a unique candidate by its returned ID and reports the lookup release', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(unique).mockResolvedValueOnce({
        success: true,
        data: { ...candidate, concept_name: 'Verified name' },
        meta: { vocab_release: 'fixture-release' },
      });
      registerSearchTools(server as never, client as never);
      const result = await server.tools.get('search_concepts')!(verifiedArgs);
      expect(client.request.mock.calls).toEqual([
        [
          '/search/concepts',
          { query: 'diabetes', vocabulary_ids: candidate.vocabulary_id, page: 1, page_size: 10 },
          'search_concepts',
        ],
        [`/concepts/${candidate.concept_id}`, undefined, 'get_concept'],
      ]);
      expect(result.structuredContent.verified_concept).toEqual({
        concept_id: candidate.concept_id,
        concept_name: 'Verified name',
        vocabulary_id: candidate.vocabulary_id,
        concept_code: candidate.concept_code,
        vocab_release: 'fixture-release',
      });
      expect(result.content[0].text).toContain('Vocabulary release: fixture-release');
    });

    it.each([
      ['true', true, 2],
      ['false', false, 1],
    ] as const)('normalizes the literal flag %s before charging for a lookup', async (flag, enabled, reads) => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(unique).mockResolvedValueOnce({
        success: true,
        data: candidate,
        meta: { vocab_release: 'fixture-release' },
      });
      registerSearchTools(server as never, client as never);
      const schema = z.object(server.registerTool.mock.calls[0][1].inputSchema as z.ZodRawShape);
      const input = { ...verifiedArgs, verify_match: flag, page: '1', page_size: '10' };
      const args = schema.parse(input);
      expect(args).toMatchObject({ verify_match: enabled, page: 1, page_size: 10 });
      expect(schema.safeParse({ ...input, verify_match: 'yes' }).success).toBe(false);
      expect(schema.safeParse({ ...input, page_size: '201' }).success).toBe(false);
      await server.tools.get('search_concepts')!(args);
      expect(client.request).toHaveBeenCalledTimes(reads);
    });

    it.each([
      [unique, false],
      [{ ...unique, data: [] }, true],
      [{ ...unique, meta: undefined }, true],
      [{ ...unique, meta: searchResponse.meta }, true],
      [searchResponse, true],
    ] as const)('only looks up an explicitly requested unique match', async (response, verify_match) => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(response);
      registerSearchTools(server as never, client as never);
      const result = await server.tools.get('search_concepts')!({ ...verifiedArgs, verify_match });
      expect(client.request).toHaveBeenCalledTimes(1);
      expect(result.structuredContent.results).toHaveLength(response.data.length);
      expect(result.structuredContent).not.toHaveProperty('verified_concept');
    });

    it.each([
      { success: false, data: candidate },
      { success: true, data: { ...candidate, concept_id: candidate.concept_id + 1 } },
      { success: true, data: { ...candidate, concept_code: 'different' } },
      new Error('lookup unavailable'),
    ])('does not publish verified identifiers or a release from a failed lookup', async (detail) => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(unique);
      if (detail instanceof Error) client.request.mockRejectedValueOnce(detail);
      else client.request.mockResolvedValueOnce(detail);
      registerSearchTools(server as never, client as never);
      const result = await server.tools.get('search_concepts')!(verifiedArgs);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.parse(result.content[1].text)).toHaveProperty('error_code');
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

      // Regression: this asserted `vocabularies`, which is not a parameter the
      // API recognises. Unknown query params are ignored rather than rejected, so
      // the filter silently did nothing — a search for NDC returned RxNorm, dm+d,
      // VANDF and others with no NDC rows at all. The test locked the bug in.
      expect(client.request).toHaveBeenCalledWith(
        '/search/concepts',
        expect.objectContaining({
          vocabulary_ids: 'SNOMED,ICD10CM',
          domain_ids: 'Condition',
          standard_concept: 'S',
          page: 2,
          page_size: 20,
        }),
        'search_concepts',
      );
    });

    it('never sends the unrecognised `vocabularies` param', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(searchResponse);

      registerSearchTools(server as never, client as never);
      const handler = server.tools.get('search_concepts')!;

      await handler({ query: 'rosuvastatin', vocabulary_ids: 'NDC' });

      const sentParams = client.request.mock.calls[0][1] as Record<string, unknown>;
      expect(sentParams).not.toHaveProperty('vocabularies');
      expect(sentParams.vocabulary_ids).toBe('NDC');
    });

    // Wojtek's second report: validity was returned by the API and discarded
    // here, so a deprecated code was indistinguishable from a live one.
    it('surfaces validity dates and invalid_reason', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce({
        success: true,
        data: [
          {
            concept_id: 1,
            concept_name: 'live code',
            vocabulary_id: 'NDC',
            domain_id: 'Drug',
            concept_class_id: '11-digit NDC',
            standard_concept: null,
            concept_code: '00000000001',
            valid_start_date: '2009-01-01',
            valid_end_date: '2099-12-31',
            invalid_reason: null,
          },
          {
            concept_id: 2,
            concept_name: 'retired code',
            vocabulary_id: 'NDC',
            domain_id: 'Drug',
            concept_class_id: '11-digit NDC',
            standard_concept: null,
            concept_code: '00000000002',
            valid_start_date: '2009-01-01',
            valid_end_date: '2018-06-30',
            invalid_reason: 'D',
          },
        ],
      });

      registerSearchTools(server as never, client as never);
      const handler = server.tools.get('search_concepts')!;

      const result = await handler({ query: 'x', vocabulary_ids: 'NDC' });

      const text = result.content[0].text as string;
      expect(text).toContain('2099-12-31');
      expect(text).toContain('INVALID: D');

      const json = JSON.parse(result.content[1].text as string);
      expect(json.results[0].valid_end_date).toBe('2099-12-31');
      expect(json.results[0].invalid_reason).toBeNull();
      expect(json.results[1].invalid_reason).toBe('D');
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
