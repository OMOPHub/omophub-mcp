import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the session leak that caused repeated OOM crashes:
 * the SDK only fires transport.onclose from close(), which it calls solely
 * from the DELETE handler, so clients that vanished without a clean shutdown
 * leaked their transport and McpServer forever.
 */

interface MockTransportOptions {
  sessionIdGenerator: () => string;
  onsessioninitialized: (id: string) => void;
}

const liveTransports = new Set<MockTransport>();

class MockTransport {
  sessionId: string | undefined;
  onclose: (() => void) | undefined;
  closed = false;
  private readonly options: MockTransportOptions;

  constructor(options: MockTransportOptions) {
    this.options = options;
    liveTransports.add(this);
  }

  // Mirrors the real transport: the session registers on the initialize
  // request. A GET opens a long-lived SSE stream (response stays open until
  // the client disconnects); everything else gets an immediate JSON response.
  handleRequest(req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void> {
    const isInit = (body as { method?: string } | undefined)?.method === 'initialize';
    if (isInit && !this.sessionId) {
      this.sessionId = this.options.sessionIdGenerator();
      this.options.onsessioninitialized(this.sessionId);
    }
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // Resolve only when the client disconnects — like a real SSE stream.
      return new Promise<void>((resolve) => res.once('close', () => resolve()));
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    res.writeHead(200, headers);
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    liveTransports.delete(this);
    this.onclose?.();
    return Promise.resolve();
  }
}

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  // biome-ignore lint/complexity/useArrowFunction: must be callable with `new`
  StreamableHTTPServerTransport: vi.fn(function (options: MockTransportOptions) {
    return new MockTransport(options);
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OmopHubClient } from '../../src/client/api.js';
import { startHttpTransport, sweepIdleSessions } from '../../src/transports/http.js';

const serverCloses: Array<() => void> = [];

function createMockServerFactory(): (client: OmopHubClient) => McpServer {
  return vi.fn(() => {
    const close = vi.fn();
    serverCloses.push(close);
    return {
      // Mirrors the SDK: connect() chains onto the existing onclose handler
      // rather than replacing it, so app cleanup still runs.
      connect: vi.fn((transport: MockTransport) => {
        const previous = transport.onclose;
        transport.onclose = () => {
          previous?.();
          close();
        };
        return Promise.resolve();
      }),
    };
  }) as unknown as (client: OmopHubClient) => McpServer;
}

function createMockClient(): OmopHubClient {
  return { baseUrl: 'https://api.test.com/v1' } as unknown as OmopHubClient;
}

async function startServer(): Promise<{ server: Server; url: string }> {
  const server = await startHttpTransport(createMockServerFactory(), createMockClient(), 0);
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Unexpected address');
  return { server, url: `http://localhost:${String(addr.port)}` };
}

async function initializeSession(url: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    }),
  });
  expect(res.status).toBe(200);
}

describe('HTTP transport session lifecycle', () => {
  let server: Server | undefined;

  afterEach(async () => {
    for (const transport of [...liveTransports]) await transport.close();
    liveTransports.clear();
    serverCloses.length = 0;
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  it('reaps sessions idle past the timeout, releasing transport and McpServer', async () => {
    const started = await startServer();
    server = started.server;

    await initializeSession(started.url);
    expect(liveTransports.size).toBe(1);

    // Client vanishes without sending DELETE — nothing else would ever clean up.
    const wellPastTimeout = Date.now() + 31 * 60 * 1000;
    expect(sweepIdleSessions(wellPastTimeout)).toBe(1);

    expect(liveTransports.size).toBe(0);
    expect(serverCloses).toHaveLength(1);
    expect(serverCloses[0]).toHaveBeenCalledTimes(1); // McpServer released too
  });

  it('leaves recently active sessions alone', async () => {
    const started = await startServer();
    server = started.server;

    await initializeSession(started.url);

    expect(sweepIdleSessions(Date.now())).toBe(0);
    expect(liveTransports.size).toBe(1);
  });

  it('does not reap a session kept alive by ongoing requests', async () => {
    const started = await startServer();
    server = started.server;

    await initializeSession(started.url);
    const sessionId = [...liveTransports][0]?.sessionId;
    expect(sessionId).toBeDefined();

    // A request 40 min in refreshes lastSeenAt, so a sweep at 45 min spares it.
    const fortyMinutes = Date.now() + 40 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(fortyMinutes);
    await fetch(started.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'mcp-session-id': sessionId as string },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    vi.restoreAllMocks();

    expect(sweepIdleSessions(fortyMinutes + 5 * 60 * 1000)).toBe(0);
    expect(liveTransports.size).toBe(1);
  });

  it('spares a session with an open SSE stream, then reaps it once the stream closes', async () => {
    const started = await startServer();
    server = started.server;

    await initializeSession(started.url);
    const sessionId = [...liveTransports][0]?.sessionId;
    expect(sessionId).toBeDefined();

    // Open the long-lived GET SSE stream and keep it open (the fetch hangs
    // until we abort). This is the case a last-request-based sweep would wrongly
    // reap: the client is connected but sends no further requests.
    const controller = new AbortController();
    const streamDone = fetch(started.url, {
      method: 'GET',
      headers: { 'mcp-session-id': sessionId as string, Accept: 'text/event-stream' },
      signal: controller.signal,
    }).catch(() => {
      /* aborted below */
    });
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the GET reach the server

    // Far past the idle timeout, but the open stream keeps it alive.
    expect(sweepIdleSessions(Date.now() + 31 * 60 * 1000)).toBe(0);
    expect(liveTransports.size).toBe(1);

    // Client disconnects the stream.
    controller.abort();
    await streamDone;
    await new Promise((resolve) => setTimeout(resolve, 50)); // let res 'close' fire

    // Disconnect reset the idle clock, so an immediate sweep still spares it...
    expect(sweepIdleSessions(Date.now())).toBe(0);
    // ...but with no open stream, it's reaped once past the timeout.
    expect(sweepIdleSessions(Date.now() + 31 * 60 * 1000)).toBe(1);
    expect(liveTransports.size).toBe(0);
  });

  it('survives a client aborting mid-body without an unhandled rejection', async () => {
    const started = await startServer();
    server = started.server;

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);

    try {
      // The body must stall mid-stream: a small body arrives in one packet
      // before the abort lands, so the read loop never rejects and the bug
      // is not exercised. Send a chunk, then hang, then abort.
      const controller = new AbortController();
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0",'));
          // never close — leaves the server's `for await` loop pending
        },
      });

      const pending = fetch(started.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        duplex: 'half',
        signal: controller.signal,
      } as RequestInit & { duplex: 'half' });

      await new Promise((resolve) => setTimeout(resolve, 50)); // let the chunk land
      controller.abort();
      await expect(pending).rejects.toThrow();

      // Give the aborted read loop a turn to reject.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(rejections).toEqual([]);

      // Server still serving.
      const health = await fetch(`${started.url}/health`);
      expect(health.status).toBe(200);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});
