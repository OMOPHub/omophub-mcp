import type { Server } from 'node:http';
import { createRemoteJWKSet, customFetch, exportJWK, generateKeyPair } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn(() => ({
    handleRequest: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/version.js', () => ({
  VERSION: '1.0.0-test',
}));

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OmopHubClient } from '../../src/client/api.js';
import { startHttpTransport } from '../../src/transports/http.js';
import {
  acceptsMcpAudience,
  httpOAuthFromEnv,
  preloadSigningKey,
} from '../../src/transports/oauth.js';

function createMockServerFactory(): (client: OmopHubClient) => McpServer {
  return vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
  })) as unknown as (client: OmopHubClient) => McpServer;
}

function createMockClient(): OmopHubClient {
  return { baseUrl: 'https://api.test.com/v1' } as unknown as OmopHubClient;
}

it('limits the second MCP audience to UserInfo on an openid grant', () => {
  const mcp = 'https://mcp.example.test/mcp';
  const userInfo = 'https://issuer.example.test/api/auth/oauth2/userinfo';
  const api = 'https://api.example.test/v1';
  const scopes = ['openid', 'vocabulary:read'];
  expect(acceptsMcpAudience(mcp, ['vocabulary:read'], mcp, userInfo)).toBe(true);
  expect(acceptsMcpAudience([userInfo, mcp], scopes, mcp, userInfo)).toBe(true);
  expect(acceptsMcpAudience([mcp, userInfo], ['vocabulary:read'], mcp, userInfo)).toBe(false);
  for (const audience of [userInfo, api, [mcp, api], [mcp, userInfo, api]]) {
    expect(acceptsMcpAudience(audience, scopes, mcp, userInfo)).toBe(false);
  }
});

it('requires a single complete credential mode for hosted OAuth', () => {
  const base = {
    OMOPHUB_OAUTH_ISSUER: 'https://issuer.example.test',
    OMOPHUB_OAUTH_MCP_RESOURCE: 'https://mcp.example.test/mcp',
  };
  const service = {
    OMOPHUB_MCP_SERVICE_TOKEN: 'service-secret',
    OMOPHUB_MCP_API_INTERNAL: 'https://api.internal/v1',
  };
  expect(httpOAuthFromEnv({ ...base, ...service })).toBeDefined();
  expect(() =>
    httpOAuthFromEnv({ ...base, OMOPHUB_MCP_SERVICE_TOKEN: 'service-secret' }),
  ).toThrow();
  expect(() =>
    httpOAuthFromEnv({ ...base, ...service, OMOPHUB_OAUTH_CLIENT_SECRET: 'exchange-secret' }),
  ).toThrow();
  expect(() =>
    httpOAuthFromEnv({
      ...base,
      ...service,
      OMOPHUB_MCP_API_INTERNAL: 'http://api.public.test/v1',
    }),
  ).toThrow();
});

it('acknowledges a staged key only when the cached verification key matches it', async () => {
  const jwk = async () => ({
    ...(await exportJWK((await generateKeyPair('ES256')).publicKey)),
    kid: 'next',
    alg: 'ES256',
  });
  const expected = await jwk();
  let published = await jwk();
  const fetchKeys = vi.fn(async () => Response.json({ keys: [published] }));
  const keys = createRemoteJWKSet(new URL('https://issuer.example.test/jwks'), {
    [customFetch]: fetchKeys,
  });
  await expect(preloadSigningKey(keys, expected)).rejects.toThrow('differs from the staged key');
  published = expected;
  await preloadSigningKey(keys, expected);
  await keys({ kid: expected.kid, alg: expected.alg });
  expect(fetchKeys).toHaveBeenCalledTimes(2);
});

const AUTHORIZATION = 'Bearer oh_transport_test';
const JSON_HEADERS = { Authorization: AUTHORIZATION, 'Content-Type': 'application/json' };

describe('HTTP Transport', () => {
  let server: Server;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it('starts HTTP server and serves health endpoint', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://127.0.0.1:${String(addr.port)}/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('challenges unauthenticated OAuth requests before SDK dispatch and serves resource metadata', async () => {
    const issuer = 'https://issuer.example.test/api/auth';
    const resource = 'https://mcp.example.test/mcp';
    const oauth = httpOAuthFromEnv({
      OMOPHUB_OAUTH_ISSUER: issuer,
      OMOPHUB_OAUTH_MCP_RESOURCE: resource,
      OMOPHUB_OAUTH_API_RESOURCE: 'https://api.example.test/v1',
      OMOPHUB_OAUTH_CLIENT_ID: 'fixture',
      OMOPHUB_OAUTH_CLIENT_SECRET: 'fixture',
    });
    const factory = createMockServerFactory();
    server = await startHttpTransport(factory, createMockClient(), 0, { oauth, host: '127.0.0.1' });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Unexpected address');
    const base = new URL(`http://127.0.0.1:${address.port}`);
    const response = await fetch(new URL('/mcp', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: expect.stringMatching(
          /terminology access is unavailable.*reconnect OMOPHub.*retry the lookup/i,
        ),
      },
      id: null,
    });
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"',
    );
    for (const method of ['GET', 'DELETE', 'POST']) {
      const stale = await fetch(new URL('/mcp', base), {
        method,
        headers: { 'mcp-session-id': 'stale-session', 'Content-Type': 'application/json' },
        body:
          method === 'POST'
            ? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
            : undefined,
      });
      expect(stale.status).toBe(401);
      expect(stale.headers.get('www-authenticate')).toBe(response.headers.get('www-authenticate'));
    }
    expect(factory).not.toHaveBeenCalled();
    const metadata = await fetch(new URL('/.well-known/oauth-protected-resource/mcp', base));
    expect(await metadata.json()).toEqual({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ['vocabulary:read'],
    });
  });

  it('returns 404 for unknown paths', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://127.0.0.1:${String(addr.port)}/unknown`);
    expect(res.status).toBe(404);
  });

  it('answers a same-origin browser preflight with its exact origin', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const origin = `http://127.0.0.1:${addr.port}`;
    const res = await fetch(`${origin}/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('omits the CORS allow-origin header for native health requests', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://127.0.0.1:${String(addr.port)}/health`);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it.each(['GET', 'DELETE'])('returns 400 for %s on /mcp without a session ID', async (method) => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://127.0.0.1:${String(addr.port)}/mcp`, {
      method,
      headers: { Authorization: AUTHORIZATION },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { jsonrpc: string; error: { code: number } };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error.code).toBe(-32000);
  });

  it.each([
    'GET',
    'POST',
    'DELETE',
  ])('returns the SDK session-not-found error for %s with a stale session', async (method) => {
    const factory = createMockServerFactory();
    server = await startHttpTransport(factory, createMockClient(), 0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');
    const res = await fetch(`http://127.0.0.1:${String(addr.port)}/mcp`, {
      method,
      headers: { ...JSON_HEADERS, 'mcp-session-id': 'non-existent-session' },
      body:
        method === 'POST'
          ? JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
          : undefined,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Session not found' },
      id: null,
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it('returns 400 for POST with invalid JSON body', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://127.0.0.1:${String(addr.port)}/mcp`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{ invalid json !!!',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      jsonrpc: string;
      error: { code: number; message: string };
    };
    expect(body.error.code).toBe(-32700);
    expect(body.error.message).toBe('Parse error');
  });

  it('returns 400 for POST without session and non-initialize request', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://127.0.0.1:${String(addr.port)}/mcp`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { jsonrpc: string; error: { message: string } };
    expect(body.error.message).toContain('No valid session ID');
  });

  it('rejects POST with body exceeding 1MB', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const largeBody = 'x'.repeat(1_100_000);
    try {
      const res = await fetch(`http://127.0.0.1:${String(addr.port)}/mcp`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: largeBody,
      });
      // Some runtimes return 413 before the socket closes
      expect(res.status).toBe(413);
    } catch (error) {
      // The server destroys the socket mid-upload, which causes fetch to
      // throw a TypeError wrapping a SocketError. Assert the specific
      // error shape so unrelated failures still fail the test.
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message).toMatch(/fetch failed|terminated|socket/i);
    }
  });

  it('handles / path the same as /mcp', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    // POST with valid JSON but no session and not initialize → 400
    const res = await fetch(`http://127.0.0.1:${String(addr.port)}/`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    expect(res.status).toBe(400);
  });
});
