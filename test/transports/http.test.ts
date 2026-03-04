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
import { startHttpTransport } from '../../src/transports/http.js';

function createMockServer(): McpServer {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpServer;
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
    const mcpServer = createMockServer();
    server = await startHttpTransport(mcpServer, 0);

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://localhost:${String(addr.port)}/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('returns 404 for unknown paths', async () => {
    const mcpServer = createMockServer();
    server = await startHttpTransport(mcpServer, 0);

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://localhost:${String(addr.port)}/unknown`);
    expect(res.status).toBe(404);
  });

  it('handles CORS preflight requests', async () => {
    const mcpServer = createMockServer();
    server = await startHttpTransport(mcpServer, 0);

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
    const mcpServer = createMockServer();
    server = await startHttpTransport(mcpServer, 0);

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');

    const res = await fetch(`http://localhost:${String(addr.port)}/health`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('connects MCP server to transport', async () => {
    const mcpServer = createMockServer();
    server = await startHttpTransport(mcpServer, 0);

    expect(mcpServer.connect).toHaveBeenCalled();
  });
});
