import type { Server } from 'node:http';
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

function createMockServerFactory(): (client: OmopHubClient) => McpServer {
  return vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
  })) as unknown as (client: OmopHubClient) => McpServer;
}

function createMockClient(): OmopHubClient {
  return { baseUrl: 'https://api.test.com/v1' } as unknown as OmopHubClient;
}

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

    const res = await fetch(`http://localhost:${String(addr.port)}/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('returns 404 for unknown paths', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://localhost:${String(addr.port)}/unknown`);
    expect(res.status).toBe(404);
  });

  it('handles CORS preflight requests', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://localhost:${String(addr.port)}/mcp`, {
      method: 'OPTIONS',
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('sets CORS headers on all responses', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://localhost:${String(addr.port)}/health`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns 400 for GET on /mcp without session ID', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://localhost:${String(addr.port)}/mcp`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { jsonrpc: string; error: { code: number } };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error.code).toBe(-32000);
  });

  it('returns 400 for DELETE on /mcp without valid session', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://localhost:${String(addr.port)}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': 'non-existent-session' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for POST with invalid JSON body', async () => {
    server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://localhost:${String(addr.port)}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    const res = await fetch(`http://localhost:${String(addr.port)}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch(`http://localhost:${String(addr.port)}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch(`http://localhost:${String(addr.port)}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    expect(res.status).toBe(400);
  });
});
