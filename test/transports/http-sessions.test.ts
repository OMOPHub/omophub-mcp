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

// When true, the mock keeps the initialize response open (like a streaming
// init) instead of ending it, so a test can observe the in-flight init.
let holdInit = false;

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
    if (req.method === 'GET' || (isInit && holdInit)) {
      const headers: Record<string, string> = isInit
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'text/event-stream' };
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
      res.writeHead(200, headers);
      // Resolve only when the client disconnects — like a long-lived stream.
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
import {
  pickEvictableSessionId,
  startHttpTransport,
  sweepIdleSessions,
  trackStream,
} from '../../src/transports/http.js';

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const INIT_PAYLOAD = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
});

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
    holdInit = false;
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
    // Let the (quick) init response close so its tracked stream is released.
    await new Promise((resolve) => setTimeout(resolve, 30));

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

  it('does not reap a session while a slow POST body is still uploading', async () => {
    const started = await startServer();
    server = started.server;

    await initializeSession(started.url);
    const sessionId = [...liveTransports][0]?.sessionId;
    await new Promise((resolve) => setTimeout(resolve, 30)); // release the init stream

    // A POST whose body starts but never finishes (a trickled/stalled upload).
    // The session must be marked active BEFORE the body is read, or a sweep
    // landing during the upload would reap it mid-request.
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0",'));
        // never close — the server's body read stays pending
      },
    });
    const pending = fetch(started.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'mcp-session-id': sessionId as string },
      body,
      duplex: 'half',
      signal: controller.signal,
    } as RequestInit & { duplex: 'half' }).catch(() => {
      /* aborted below */
    });
    await new Promise((resolve) => setTimeout(resolve, 50)); // request reaches the server

    // Mid-upload, far past the idle timeout — must NOT be reaped.
    expect(sweepIdleSessions(Date.now() + 31 * 60 * 1000)).toBe(0);
    expect(liveTransports.size).toBe(1);

    controller.abort();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Upload ended → reaped once past the timeout.
    expect(sweepIdleSessions(Date.now() + 31 * 60 * 1000)).toBe(1);
  });

  it('does not reap a session whose initialize response is still in flight', async () => {
    holdInit = true;
    const started = await startServer();
    server = started.server;

    const controller = new AbortController();
    const pending = fetch(started.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'slow-init', version: '1.0.0' },
        },
      }),
      signal: controller.signal,
    }).catch(() => {
      /* aborted below */
    });
    await new Promise((resolve) => setTimeout(resolve, 50)); // session created, init held open
    expect(liveTransports.size).toBe(1);

    // The init response is still streaming — the new session must not be reaped.
    expect(sweepIdleSessions(Date.now() + 31 * 60 * 1000)).toBe(0);

    controller.abort();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Init finished → reaped once past the timeout.
    expect(sweepIdleSessions(Date.now() + 31 * 60 * 1000)).toBe(1);
    expect(liveTransports.size).toBe(0);
  });

  it('times out a stalled POST upload and releases the session slot', async () => {
    process.env.OMOPHUB_REQUEST_BODY_TIMEOUT_MS = '150';
    try {
      const started = await startServer();
      server = started.server;
      await initializeSession(started.url);
      const sessionId = [...liveTransports][0]?.sessionId;
      await settle(30); // release the init stream

      // A body that starts but never finishes — held past the (tiny) timeout.
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(enc('{"jsonrpc":"2.0",'));
        },
      });
      const pending = fetch(started.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'mcp-session-id': sessionId as string },
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }).catch(() => {
        /* server may 408 or reset the in-flight upload */
      });

      await settle(250); // > 150ms timeout + margin

      // The timeout aborted the upload and released openStreams, so the now-idle
      // session is reapable. Without the timeout it would stay pinned forever.
      expect(sweepIdleSessions(Date.now() + 31 * 60 * 1000)).toBe(1);
      await pending;
    } finally {
      delete process.env.OMOPHUB_REQUEST_BODY_TIMEOUT_MS;
    }
  });

  it('rejects a new session with 503 when at capacity and all sessions stream', async () => {
    process.env.OMOPHUB_MAX_SESSIONS = '1';
    try {
      const started = await startServer();
      server = started.server;

      // Session 1, holding an open SSE stream → non-evictable.
      await initializeSession(started.url);
      const sessionId = [...liveTransports][0]?.sessionId;
      await settle(30); // release the init stream first
      const controller = new AbortController();
      const stream = fetch(started.url, {
        method: 'GET',
        headers: { 'mcp-session-id': sessionId as string, Accept: 'text/event-stream' },
        signal: controller.signal,
      }).catch(() => {
        /* aborted below */
      });
      await settle(50); // stream open → session 1 is streaming

      // Second initialize at cap=1, and the only session can't be evicted.
      const res = await fetch(started.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: INIT_PAYLOAD,
      });
      expect(res.status).toBe(503);
      expect(liveTransports.size).toBe(1); // no second session admitted

      controller.abort();
      await stream;
    } finally {
      delete process.env.OMOPHUB_MAX_SESSIONS;
    }
  });

  it('rejects a POST whose session is closed while its body is uploading', async () => {
    const started = await startServer();
    server = started.server;
    await initializeSession(started.url);
    const transport = [...liveTransports][0];
    const sessionId = transport?.sessionId;
    await settle(30); // release the init stream

    // Start a POST whose body we control: send a partial chunk, hold it open.
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        bodyController = streamController;
        streamController.enqueue(enc('{"jsonrpc":"2.0","id":1,"method":"tools/list"'));
      },
    });
    const pending = fetch(started.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'mcp-session-id': sessionId as string },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    await settle(50); // request in-flight, session marked active

    // Close the session out from under the in-flight upload.
    await transport?.close();
    await settle(20);

    // Now finish the body so the handler reaches the post-read re-check.
    bodyController?.enqueue(enc('}'));
    bodyController?.close();

    const res = await pending;
    expect(res.status).toBe(404); // dispatched to the dead session would be 200
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

describe('pickEvictableSessionId', () => {
  it('picks the oldest session by lastSeenAt', () => {
    const entries: Array<[string, { lastSeenAt: number; openStreams: number }]> = [
      ['a', { lastSeenAt: 300, openStreams: 0 }],
      ['b', { lastSeenAt: 100, openStreams: 0 }],
      ['c', { lastSeenAt: 200, openStreams: 0 }],
    ];
    expect(pickEvictableSessionId(entries)).toBe('b');
  });

  it('skips streaming sessions even when they are the oldest', () => {
    // 'b' is oldest but has an open stream, so it must not be chosen — the
    // eviction backstop must never disconnect an actively-connected client.
    const entries: Array<[string, { lastSeenAt: number; openStreams: number }]> = [
      ['a', { lastSeenAt: 300, openStreams: 0 }],
      ['b', { lastSeenAt: 100, openStreams: 2 }],
      ['c', { lastSeenAt: 200, openStreams: 0 }],
    ];
    expect(pickEvictableSessionId(entries)).toBe('c');
  });

  it('returns undefined when every session is streaming', () => {
    const entries: Array<[string, { lastSeenAt: number; openStreams: number }]> = [
      ['a', { lastSeenAt: 300, openStreams: 1 }],
      ['b', { lastSeenAt: 100, openStreams: 1 }],
    ];
    expect(pickEvictableSessionId(entries)).toBeUndefined();
  });

  it('returns undefined for no sessions', () => {
    expect(pickEvictableSessionId([])).toBeUndefined();
  });
});

describe('trackStream', () => {
  interface FakeRes {
    destroyed: boolean;
    writableEnded: boolean;
    once: (event: string, cb: () => void) => void;
    _handlers: Record<string, () => void>;
  }
  function fakeRes(opts: { destroyed?: boolean; writableEnded?: boolean } = {}): FakeRes {
    const handlers: Record<string, () => void> = {};
    return {
      destroyed: opts.destroyed ?? false,
      writableEnded: opts.writableEnded ?? false,
      once(event, cb) {
        handlers[event] = cb;
      },
      _handlers: handlers,
    };
  }
  // trackStream only reads {openStreams,lastSeenAt} and the res fields above.
  function fakeSession(): { transport: unknown; lastSeenAt: number; openStreams: number } {
    return { transport: {}, lastSeenAt: 0, openStreams: 0 };
  }
  // biome-ignore lint/suspicious/noExplicitAny: exercising trackStream with fakes
  const track = trackStream as unknown as (s: any, r: any) => void;

  it('increments openStreams and decrements when the response closes', () => {
    const session = fakeSession();
    const res = fakeRes();
    track(session, res);
    expect(session.openStreams).toBe(1);
    res._handlers.close?.(); // simulate the client disconnecting
    expect(session.openStreams).toBe(0);
    expect(session.lastSeenAt).toBeGreaterThan(0);
  });

  it('does not track (or pin) a response that is already destroyed', () => {
    const session = fakeSession();
    const res = fakeRes({ destroyed: true });
    track(session, res);
    expect(session.openStreams).toBe(0); // the pin-forever bug would make this 1
    expect(res._handlers.close).toBeUndefined(); // no dead listener attached
  });

  it('does not track a response that has already ended', () => {
    const session = fakeSession();
    const res = fakeRes({ writableEnded: true });
    track(session, res);
    expect(session.openStreams).toBe(0);
  });
});
