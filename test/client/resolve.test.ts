import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OmopHubClient } from '../../src/client/api.js';
import { resolveClient } from '../../src/client/resolve.js';

describe('resolveClient', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const defaultClient = new OmopHubClient('oh_default', 'https://api.test.com/v1');

  it('returns defaultClient when no headers are present', () => {
    expect(resolveClient({}, defaultClient)).toBe(defaultClient);
  });

  it('returns defaultClient when requestInfo has no headers', () => {
    expect(resolveClient({ requestInfo: {} }, defaultClient)).toBe(defaultClient);
  });

  it('returns defaultClient when no Authorization header', () => {
    expect(
      resolveClient(
        { requestInfo: { headers: { 'content-type': 'application/json' } } },
        defaultClient,
      ),
    ).toBe(defaultClient);
  });

  it('returns defaultClient for non-Bearer auth header', () => {
    expect(
      resolveClient({ requestInfo: { headers: { authorization: 'Basic abc123' } } }, defaultClient),
    ).toBe(defaultClient);
  });

  it('returns defaultClient for empty Bearer token', () => {
    expect(
      resolveClient({ requestInfo: { headers: { authorization: 'Bearer   ' } } }, defaultClient),
    ).toBe(defaultClient);
  });

  it('creates a new client for a valid Bearer token', () => {
    const extra = { requestInfo: { headers: { authorization: 'Bearer oh_user_key_123' } } };
    const result = resolveClient(extra, defaultClient);

    expect(result).not.toBe(defaultClient);
    expect(result.baseUrl).toBe(defaultClient.baseUrl);
  });

  it('returns the cached client for the same token on subsequent calls', () => {
    const extra = { requestInfo: { headers: { authorization: 'Bearer oh_cached_key' } } };
    const first = resolveClient(extra, defaultClient);
    const second = resolveClient(extra, defaultClient);

    expect(first).toBe(second);
  });

  it('creates different clients for different tokens', () => {
    const extra1 = { requestInfo: { headers: { authorization: 'Bearer oh_key_1' } } };
    const extra2 = { requestInfo: { headers: { authorization: 'Bearer oh_key_2' } } };

    const client1 = resolveClient(extra1, defaultClient);
    const client2 = resolveClient(extra2, defaultClient);

    expect(client1).not.toBe(client2);
  });

  it('handles Authorization header with capital A', () => {
    const extra = { requestInfo: { headers: { Authorization: 'Bearer oh_capital_key' } } };
    const result = resolveClient(extra, defaultClient);

    expect(result).not.toBe(defaultClient);
  });

  it('handles array-valued authorization header', () => {
    const extra = { requestInfo: { headers: { authorization: ['Bearer oh_array_key', 'other'] } } };
    const result = resolveClient(extra, defaultClient);

    expect(result).not.toBe(defaultClient);
  });

  it('returns defaultClient when array authorization has no values', () => {
    const extra = { requestInfo: { headers: { authorization: [] as string[] } } };
    const result = resolveClient(extra, defaultClient);

    expect(result).toBe(defaultClient);
  });

  it('prunes the client cache when it exceeds the max size', () => {
    // Capture the original client for key 0 before filling the cache
    const firstExtra = { requestInfo: { headers: { authorization: 'Bearer oh_prune_key_0' } } };
    const originalClient = resolveClient(firstExtra, defaultClient);
    expect(originalClient).not.toBe(defaultClient);

    // Create 101 more unique clients to trigger pruning (MAX_CACHED_CLIENTS = 100)
    // Key 0 was the least-recently-used and should be evicted
    for (let i = 1; i <= 101; i++) {
      const extra = { requestInfo: { headers: { authorization: `Bearer oh_prune_key_${i}` } } };
      resolveClient(extra, defaultClient);
    }

    // Resolve key 0 again — should be a cache miss (evicted), returning a NEW instance
    const resultAfterEviction = resolveClient(firstExtra, defaultClient);

    expect(resultAfterEviction).not.toBe(originalClient); // Proves eviction happened
    expect(resultAfterEviction).not.toBe(defaultClient);
    expect(resultAfterEviction.baseUrl).toBe(defaultClient.baseUrl);
  });
});
