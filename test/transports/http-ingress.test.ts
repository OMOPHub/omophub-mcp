import { request, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OmopHubClient } from '../../src/client/api.js';
import { startHttpTransport } from '../../src/transports/http.js';
import { createHttpIngressPolicy } from '../../src/transports/http-ingress.js';
import { httpOAuthFromEnv } from '../../src/transports/oauth.js';

let server: Server | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (server?.listening) await new Promise<void>((resolve) => server?.close(() => resolve()));
});

function readHeaders(port: number, path: string, headers: Record<string, string>, method = 'GET') {
  return new Promise<{ status?: number; origin?: string; vary?: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers, method }, (res) => {
      res.resume();
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          origin: res.headers['access-control-allow-origin'],
          vary: res.headers.vary,
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

describe('HTTP ingress policy', () => {
  it('defaults to loopback, admits configured authorities and returns exact CORS headers', async () => {
    vi.stubEnv('MCP_HOST', '');
    vi.stubEnv('MCP_ALLOWED_HOSTS', 'internal.example.test:3100');
    vi.stubEnv('MCP_ALLOWED_ORIGINS', 'https://console.example.test');
    const oauth = httpOAuthFromEnv({
      OMOPHUB_OAUTH_ISSUER: 'https://issuer.example.test/api/auth',
      OMOPHUB_OAUTH_MCP_RESOURCE: 'https://mcp.example.test/mcp',
      OMOPHUB_OAUTH_API_RESOURCE: 'https://api.example.test/v1',
      OMOPHUB_OAUTH_CLIENT_ID: 'fixture',
      OMOPHUB_OAUTH_CLIENT_SECRET: 'fixture',
    });
    const factory = vi.fn();
    server = await startHttpTransport(factory, new OmopHubClient(undefined), 0, { oauth });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    expect(address.address).toBe('127.0.0.1');
    const native = await readHeaders(address.port, '/.well-known/oauth-protected-resource/mcp', {
      Host: 'mcp.example.test',
    });
    expect(native).toEqual({ status: 200, origin: undefined, vary: 'Origin' });
    const browser = await readHeaders(
      address.port,
      '/mcp',
      {
        Host: 'internal.example.test:3100',
        Origin: 'https://console.example.test',
      },
      'OPTIONS',
    );
    expect(browser).toEqual({
      status: 204,
      origin: 'https://console.example.test',
      vary: 'Origin',
    });
    for (const headers of [
      { Host: 'unlisted.example.test', Origin: 'https://console.example.test' },
      { Host: 'internal.example.test:3101', Origin: 'https://console.example.test' },
      { Host: 'mcp.example.test', Origin: 'https://unlisted.example.test' },
      { Host: 'mcp.example.test', Origin: 'null' },
      { Host: 'mcp.example.test', Origin: 'https://console.example.test:8443' },
    ]) {
      expect(await readHeaders(address.port, '/mcp', headers, 'OPTIONS')).toEqual({
        status: 403,
        origin: undefined,
        vary: 'Origin',
      });
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    { MCP_ALLOWED_HOSTS: '*' },
    { MCP_ALLOWED_HOSTS: 'mcp.example.test/path' },
    { MCP_ALLOWED_ORIGINS: '*' },
    { MCP_ALLOWED_ORIGINS: 'https://console.example.test/path' },
  ])('rejects invalid allowlists at startup', (env) => {
    expect(() => createHttpIngressPolicy(undefined, env)).toThrow();
  });
});
