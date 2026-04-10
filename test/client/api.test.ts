import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OmopHubClient } from '../../src/client/api.js';
import { OmopHubApiError } from '../../src/utils/errors.js';

describe('OmopHubClient', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends correct auth and user-agent headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    });

    const client = new OmopHubClient('oh_testkey123', 'https://api.test.com/v1');
    await client.request('/concepts/1');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer oh_testkey123');
    expect(headers['User-Agent']).toMatch(/^omophub-mcp\//);
    expect(headers['X-MCP-Client']).toBe('true');
    expect(url).toBe('https://api.test.com/v1/concepts/1');
  });

  it('sends X-MCP-Tool header when toolName is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request('/search/concepts', { query: 'diabetes' }, 'search_concepts');

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers['X-MCP-Tool']).toBe('search_concepts');
  });

  it('appends query parameters correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request('/search/concepts', {
      query: 'diabetes',
      page_size: 10,
      vocabularies: 'SNOMED,ICD10CM',
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('query')).toBe('diabetes');
    expect(parsed.searchParams.get('page_size')).toBe('10');
    expect(parsed.searchParams.get('vocabularies')).toBe('SNOMED,ICD10CM');
  });

  it('skips undefined and empty params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request('/search/concepts', {
      query: 'test',
      vocabularies: undefined,
      domain: '',
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.has('vocabularies')).toBe(false);
    expect(parsed.searchParams.has('domain')).toBe(false);
  });

  it('throws OmopHubApiError on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => JSON.stringify({ error: { message: 'Concept not found' } }),
      headers: new Headers(),
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await expect(client.request('/concepts/999999')).rejects.toThrow(OmopHubApiError);
    await expect(client.request('/concepts/999999')).rejects.toMatchObject({
      status: 404,
      message: 'Concept not found',
    });
  });

  it('retries on 429 with Retry-After header', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => '{"message":"Rate limited"}',
        headers: new Headers({ 'Retry-After': '0' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    const result = await client.request('/search/concepts', { query: 'test' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
  });

  describe('post()', () => {
    it('sends POST request with correct headers and body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { results: [] } }),
      });

      const client = new OmopHubClient('oh_testkey123', 'https://api.test.com/v1');
      await client.post(
        '/search/semantic',
        { query: 'diabetes', page_size: 10 },
        'semantic_search',
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.test.com/v1/search/semantic');
      expect(options.method).toBe('POST');

      const headers = options.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer oh_testkey123');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['User-Agent']).toMatch(/^omophub-mcp\//);
      expect(headers['X-MCP-Client']).toBe('true');
      expect(headers['X-MCP-Tool']).toBe('semantic_search');

      expect(options.body).toBe(JSON.stringify({ query: 'diabetes', page_size: 10 }));
    });

    it('throws OmopHubApiError on non-OK POST response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => JSON.stringify({ error: { message: 'Invalid query' } }),
      });

      const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
      await expect(
        client.post('/search/semantic', { query: '' }, 'semantic_search'),
      ).rejects.toThrow(OmopHubApiError);
    });
  });

  it('retries on network error and eventually throws', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await expect(client.request('/concepts/1')).rejects.toThrow('ECONNREFUSED');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('falls back to response text when error body is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'plain text error',
      headers: new Headers(),
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await expect(client.request('/broken')).rejects.toMatchObject({
      status: 500,
      message: 'plain text error',
    });
  });

  it('falls back to response.message when error.message is absent', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify({ message: 'top-level message' }),
      headers: new Headers(),
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await expect(client.request('/bad')).rejects.toMatchObject({
      message: 'top-level message',
    });
  });

  describe('post() retries and error handling', () => {
    it('retries POST on 429 rate limit', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          text: async () => '{"message":"Rate limited"}',
          headers: new Headers({ 'Retry-After': '0' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, data: {} }),
        });

      const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
      const result = await client.post('/fhir/resolve', { code: '123' }, 'fhir_resolve');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    it('throws network errors immediately on POST (no retry)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
      await expect(client.post('/fhir/resolve', { code: '123' })).rejects.toThrow('ECONNREFUSED');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to plain text on non-JSON POST error body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: async () => '<html>Bad Gateway</html>',
      });

      const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
      await expect(client.post('/fhir/resolve', {})).rejects.toMatchObject({
        status: 502,
        message: '<html>Bad Gateway</html>',
      });
    });

    it('omits analytics headers when opted out', async () => {
      vi.stubEnv('OMOPHUB_ANALYTICS_OPTOUT', 'true');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });

      const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
      await client.post('/fhir/resolve', { code: '123' }, 'fhir_resolve');

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['X-MCP-Client']).toBeUndefined();
      expect(headers['X-MCP-Tool']).toBeUndefined();
    });
  });

  it('respects analytics opt-out', async () => {
    vi.stubEnv('OMOPHUB_ANALYTICS_OPTOUT', 'true');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    });

    const client = new OmopHubClient('oh_key', 'https://api.test.com/v1');
    await client.request('/concepts/1', undefined, 'get_concept');

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers['X-MCP-Client']).toBeUndefined();
    expect(headers['X-MCP-Tool']).toBeUndefined();
  });
});
