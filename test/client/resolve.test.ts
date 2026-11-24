import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OmopHubClient } from '../../src/client/api.js';
import { resolveClient } from '../../src/client/resolve.js';

describe('resolveClient', () => {
  const defaultClient = new OmopHubClient('oh_stdio_fixture', 'https://api.test/v1');

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the stdio client', () => {
    expect(resolveClient({}, defaultClient)).toBe(defaultClient);
  });

  it.each([
    {},
    { authorization: 'Bearer oh_unverified' },
  ])('requires transport authorization for HTTP handlers', (headers) => {
    expect(() => resolveClient({ requestInfo: { headers } }, defaultClient)).toThrow(
      'Missing HTTP request credential',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when transport authorization supplied no API credential', () => {
    expect(() => resolveClient({ authInfo: {} }, defaultClient)).toThrow(
      'Missing upstream API credential',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the request credential for a caller API key or exchanged token', async () => {
    const extra = {
      authInfo: { extra: { upstreamAccessToken: 'oh_caller_fixture' } },
      requestInfo: { headers: { 'x-omophub-app-grant': 'ignored' } },
    };
    await resolveClient(extra, defaultClient).request('/vocabularies');
    const [, options] = vi.mocked(fetch).mock.lastCall!;
    const headers = new Headers(options?.headers);
    expect(headers.get('authorization')).toBe('Bearer oh_caller_fixture');
    expect(headers.has('x-omophub-app-grant')).toBe(false);
  });

  it('uses only the verified grant and internal API client for hosted reads', async () => {
    const hostedClient = new OmopHubClient(
      'service-fixture',
      'https://api.internal/v1',
      'verified-grant',
    );
    const extra = {
      authInfo: { extra: { hostedClient } },
      requestInfo: {
        headers: { authorization: 'Bearer user-token', 'x-omophub-app-grant': 'ignored' },
      },
    };
    await resolveClient(extra, defaultClient).request('/concepts/201826');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.internal/v1/concepts/201826',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer service-fixture',
          'X-OMOPHub-App-Grant': 'verified-grant',
        }),
        redirect: 'error',
      }),
    );
  });

  it('refuses to send the hosted service credential outside its configured API origin', async () => {
    const client = new OmopHubClient('service-secret', 'https://api.internal', 'verified-grant');
    await expect(client.request('.other.test/path')).rejects.toThrow('configured API origin');
    expect(fetch).not.toHaveBeenCalled();
  });
});
