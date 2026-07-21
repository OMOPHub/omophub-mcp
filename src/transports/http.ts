import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { OmopHubClient } from '../client/api.js';
import { handleHealthRequest } from '../health.js';
import { logger } from '../utils/logger.js';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, Authorization',
  'Access-Control-Expose-Headers': 'mcp-session-id',
};

function setCorsHeaders(res: ServerResponse): void {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

interface Session {
  transport: StreamableHTTPServerTransport;
  lastSeenAt: number;
  // Count of currently-open long-lived responses (the GET SSE stream, or a
  // POST that streams). A session with an open stream is actively connected
  // even if it hasn't sent a new request in a while, so it must not be reaped.
  openStreams: number;
}

// Active sessions — each client gets its own transport + server.
//
// Cleanup is driven by idle timeout, not by socket lifecycle. The SDK only
// fires transport.onclose from close(), which it calls solely from the DELETE
// handler, so any client that vanishes without a clean shutdown (network drop,
// sleep, crash) would otherwise leak its transport AND its McpServer forever.
//
// A session is reaped only when it has NO open stream AND has not been seen
// for the idle timeout. We deliberately do NOT close sessions the moment a
// socket drops: Streamable HTTP clients legitimately disconnect and reconnect
// their SSE stream, and a client can hold an SSE stream open for hours while
// only receiving server pushes, so socket- or last-request-based reaping alone
// would disconnect working clients.
const sessions = new Map<string, Session>();

// Inits that passed the admission cap but haven't been inserted into `sessions`
// yet (initialization is async). Counted against the cap so a burst of
// concurrent initializes can't all pass the pre-check and overshoot it.
let pendingAdmissions = 0;

const MAX_BODY_SIZE = 1_048_576; // 1 MB
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min without a request
const SESSION_SWEEP_INTERVAL_MS = 60 * 1000;

// Backstops, overridable via env for ops tuning (and tests). Read lazily so a
// value can change without reloading the module.
const DEFAULT_MAX_SESSIONS = 1000; // hard cap on concurrent sessions
const DEFAULT_REQUEST_BODY_TIMEOUT_MS = 30_000; // max time to receive a POST body

const warnedInvalidEnv = new Set<string>();

/** Reads a positive-integer tuning value from the environment. Uses `Number`
 *  (not `parseInt`) so a malformed value like "100abc" or "1e3x" is rejected
 *  whole rather than silently coerced to a partial number; on rejection it
 *  warns once and uses the documented fallback. Exported for testing. */
export function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isSafeInteger(n) && n > 0) return n;
  if (!warnedInvalidEnv.has(name)) {
    warnedInvalidEnv.add(name);
    logger.warn(`Ignoring invalid ${name}="${raw}"; using default ${fallback}`);
  }
  return fallback;
}
const getMaxSessions = (): number => envPositiveInt('OMOPHUB_MAX_SESSIONS', DEFAULT_MAX_SESSIONS);
const getRequestBodyTimeoutMs = (): number =>
  envPositiveInt('OMOPHUB_REQUEST_BODY_TIMEOUT_MS', DEFAULT_REQUEST_BODY_TIMEOUT_MS);

function touchSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) session.lastSeenAt = Date.now();
}

/** Marks a long-lived response (GET SSE stream, or streaming POST) as open for
 *  the session and refreshes the idle clock when it closes. While open, the
 *  session is exempt from the idle sweep even if no new requests arrive. */
export function trackStream(session: Session, res: ServerResponse): void {
  // If the response already finished (e.g. the client aborted before we got
  // here), its 'close' event has already fired and will never fire again —
  // attaching a listener would leave openStreams stuck at 1 and pin the
  // session (and its McpServer) forever, since the idle sweep skips it.
  if (res.destroyed || res.writableEnded) return;
  session.openStreams++;
  res.once('close', () => {
    session.openStreams = Math.max(0, session.openStreams - 1);
    // Reset the idle clock on disconnect so a reconnect window is preserved.
    session.lastSeenAt = Date.now();
  });
}

/** Closes sessions idle past the timeout. transport.close() fires onclose,
 *  which removes the map entry and shuts down the attached McpServer.
 *  Sessions with an open stream are actively connected and never reaped. */
export function sweepIdleSessions(now: number = Date.now()): number {
  let closed = 0;
  for (const [sessionId, session] of sessions) {
    if (session.openStreams > 0) continue;
    if (now - session.lastSeenAt <= SESSION_IDLE_TIMEOUT_MS) continue;
    logger.info('Closing idle MCP session', { sessionId });
    void Promise.resolve(session.transport.close()).catch((error: unknown) => {
      logger.error('Failed to close idle session', { error: String(error), sessionId });
      sessions.delete(sessionId); // never let a failed close pin the entry
    });
    closed++;
  }
  return closed;
}

/**
 * Picks the least-recently-seen session that has NO open stream — the same
 * "an open stream means actively connected" rule the idle sweep uses, so the
 * capacity backstop never disconnects a working SSE/streaming client. Returns
 * undefined when every session is streaming. Exported for unit testing.
 */
export function pickEvictableSessionId(
  entries: Iterable<[string, { lastSeenAt: number; openStreams: number }]>,
): string | undefined {
  let oldestId: string | undefined;
  let oldestSeenAt = Number.POSITIVE_INFINITY;
  for (const [sessionId, session] of entries) {
    if (session.openStreams > 0) continue;
    if (session.lastSeenAt < oldestSeenAt) {
      oldestSeenAt = session.lastSeenAt;
      oldestId = sessionId;
    }
  }
  return oldestId;
}

/** Tries to free a slot by evicting the oldest non-streaming session. Never
 *  closes a session with a live stream. If none can be evicted (all streaming)
 *  the map size is unchanged and the caller rejects the new session, keeping
 *  the cap hard so held-open streams can't drive unbounded admission. */
function evictOldestSession(): void {
  const oldestId = pickEvictableSessionId(sessions);
  if (!oldestId) {
    // Every session is streaming — nothing safe to evict. The caller enforces
    // the hard cap by rejecting the new session; we just report the state.
    logger.warn('Session limit reached and all sessions are streaming; cannot evict', {
      maxSessions: getMaxSessions(),
    });
    return;
  }
  const session = sessions.get(oldestId);
  logger.warn('Session limit reached, evicting oldest idle session', {
    sessionId: oldestId,
    maxSessions: getMaxSessions(),
  });
  void Promise.resolve(session?.transport.close()).catch(() => {
    sessions.delete(oldestId);
  });
}

const JSON_RPC_INTERNAL_ERROR = JSON.stringify({
  jsonrpc: '2.0',
  error: { code: -32603, message: 'Internal server error' },
  id: null,
});

/**
 * Starts an HTTP server with per-session MCP transports on /
 * and a health endpoint on /health.
 */
export async function startHttpTransport(
  serverFactory: (client: OmopHubClient) => McpServer,
  defaultClient: OmopHubClient,
  port: number,
): Promise<Server> {
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    // The handler is async; an unhandled rejection here (e.g. the request
    // stream aborting mid-body with ECONNRESET) would terminate the process.
    void handleRequest(req, res).catch((error: unknown) => {
      // A client that aborted mid-request is routine, not an error worth alarming on.
      const aborted =
        (error as { code?: string } | null)?.code === 'ECONNRESET' ||
        req.destroyed ||
        res.destroyed;
      if (aborted) {
        logger.debug('Client aborted request', { error: String(error) });
      } else {
        logger.error('Unhandled request error', { error: String(error) });
      }
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON_RPC_INTERNAL_ERROR);
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (handleHealthRequest(req, res)) return;

    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/' || pathname === '/mcp') {
      const rawSessionId = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

      // GET (SSE stream) and DELETE (session close) carry no body — route directly
      if (req.method === 'GET' || req.method === 'DELETE') {
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId);
          if (!session) return;
          touchSession(sessionId);
          // A GET opens the long-lived SSE stream; track it so the idle sweep
          // won't reap a client that's connected but quietly receiving pushes.
          if (req.method === 'GET') trackStream(session, res);
          try {
            await session.transport.handleRequest(req, res);
          } catch (error) {
            logger.error('MCP transport error', { error: String(error), sessionId });
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON_RPC_INTERNAL_ERROR);
            }
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
              id: null,
            }),
          );
        }
        return;
      }

      // POST. If it targets a known session, mark it active BEFORE reading the
      // (possibly slow or trickled) body — otherwise a concurrent sweep could
      // reap the session mid-upload. trackStream keeps it alive for the whole
      // request/response and refreshes the idle clock when the response closes.
      const postSession = sessionId ? sessions.get(sessionId) : undefined;
      if (postSession && sessionId) {
        touchSession(sessionId);
        trackStream(postSession, res);
      }

      // POST — read body with a size limit AND a total-time limit. The time
      // limit bounds trickled/stalled uploads: without it a client could hold
      // a session slot (and up to MAX_BODY_SIZE of buffer) open indefinitely.
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let aborted = false;
      let bodyTimedOut = false;
      const bodyTimer = setTimeout(() => {
        bodyTimedOut = true;
        // req and res share a socket, so destroying req first would reset the
        // connection and the client would never see the 408. Write the response
        // and tear down the request only AFTER it has flushed. Destroying req is
        // what makes the for-await below throw (caught as a timeout, not an error).
        if (!res.headersSent) {
          res.writeHead(408, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Request body timeout' },
              id: null,
            }),
            () => req.destroy(),
          );
        } else {
          req.destroy();
        }
      }, getRequestBodyTimeoutMs());
      try {
        for await (const chunk of req) {
          const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
          totalBytes += buf.length;
          if (totalBytes > MAX_BODY_SIZE) {
            // Same socket-sharing concern as the timeout path: req and res share
            // a socket, so destroying req before the response flushes would reset
            // the connection and the client would never see the 413. Write the
            // response, then tear down the request from the flush callback.
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Payload too large' },
                id: null,
              }),
              () => req.destroy(),
            );
            aborted = true;
            break;
          }
          chunks.push(buf);
        }
      } catch (error) {
        // A genuine mid-body abort (ECONNRESET) is not ours to handle here —
        // let it propagate to the request wrapper. A timeout-induced destroy is.
        if (!bodyTimedOut) throw error;
      } finally {
        clearTimeout(bodyTimer);
      }
      if (bodyTimedOut) return; // the 408 was already written in the timeout callback
      if (aborted) return;
      const body = Buffer.concat(chunks).toString();
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null,
          }),
        );
        return;
      }

      // Existing session — marked active before the body was read. Re-validate:
      // the session may have been closed (DELETE, or its transport erroring)
      // while we awaited the body, in which case dispatching to it is wrong.
      if (postSession) {
        if (!sessionId || sessions.get(sessionId) !== postSession) {
          if (!res.headersSent) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32001, message: 'Session no longer exists' },
                id: null,
              }),
            );
          }
          return;
        }
        try {
          await postSession.transport.handleRequest(req, res, parsedBody);
        } catch (error) {
          logger.error('MCP transport error', { error: String(error), sessionId });
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON_RPC_INTERNAL_ERROR);
          }
        }
        return;
      }

      // New session (initialize request)
      if (!sessionId && isInitializeRequest(parsedBody)) {
        // Hard admission cap. The effective count includes in-flight inits
        // (pendingAdmissions) that haven't been inserted yet, so concurrent
        // initializes can't all pass this pre-check and overshoot the cap. Try
        // to free a slot; if still full (every session is streaming and none
        // can be safely evicted), reject rather than admit — otherwise a client
        // holding many long-lived streams could drive unbounded growth.
        if (sessions.size + pendingAdmissions >= getMaxSessions()) {
          evictOldestSession();
          if (sessions.size + pendingAdmissions >= getMaxSessions()) {
            logger.warn('Rejecting new session — server at capacity', {
              activeSessions: sessions.size,
              pendingAdmissions,
              maxSessions: getMaxSessions(),
            });
            res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '5' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Server at capacity, retry later' },
                id: null,
              }),
            );
            return;
          }
        }

        // Reserve a slot for the async init. Incremented synchronously here,
        // before the first await, so a concurrent init sees it in its own
        // pre-check above. The reservation is released the moment the session
        // is inserted into `sessions` (it now counts toward `sessions.size`);
        // otherwise it would be double-counted for the whole lifetime of a
        // streaming init, whose `handleRequest` doesn't return until the stream
        // closes. If the init never inserts a session (failure), the `finally`
        // releases it instead.
        pendingAdmissions++;
        let admitted = false;
        try {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              const session: Session = { transport, lastSeenAt: Date.now(), openStreams: 0 };
              sessions.set(id, session);
              if (!admitted) {
                admitted = true;
                pendingAdmissions--; // reservation fulfilled — now counted in sessions.size
              }
              // Track the initialize response (this `res`) so a slow or streaming
              // init can't be reaped while it's still in flight.
              trackStream(session, res);
              logger.info('MCP session created', { sessionId: id, activeSessions: sessions.size });
            },
          });

          // Assigned before connect() — the SDK chains rather than replaces this,
          // so both this cleanup and the McpServer shutdown run on close.
          transport.onclose = () => {
            if (transport.sessionId) {
              sessions.delete(transport.sessionId);
              logger.info('MCP session closed', {
                sessionId: transport.sessionId,
                activeSessions: sessions.size,
              });
            }
          };

          const server = serverFactory(defaultClient);
          await server.connect(transport);
          await transport.handleRequest(req, res, parsedBody);
        } catch (error) {
          logger.error('MCP transport error (init)', { error: String(error) });
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON_RPC_INTERNAL_ERROR);
          }
        } finally {
          // Only release here if the init never inserted a session (it failed
          // before onsessioninitialized fired); otherwise it was already
          // released at insertion.
          if (!admitted) pendingAdmissions--;
        }
        return;
      }

      // Invalid request — no session and not an initialize
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  httpServer.on('error', (err) => {
    logger.error('HTTP server error', { error: String(err), port });
  });

  // unref'd so the sweep timer never keeps the process alive on its own
  const sweepTimer = setInterval(() => {
    sweepIdleSessions();
  }, SESSION_SWEEP_INTERVAL_MS);
  sweepTimer.unref();
  httpServer.on('close', () => {
    clearInterval(sweepTimer);
    // Close active sessions on shutdown so their transports and McpServer
    // instances don't leak if the server is closed without a process exit
    // (e.g. a graceful restart within the same process, or tests). Snapshot
    // first — transport.close() fires onclose, which deletes from `sessions`.
    for (const session of [...sessions.values()]) {
      void Promise.resolve(session.transport.close()).catch(() => {
        // best-effort cleanup during shutdown
      });
    }
    sessions.clear();
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      logger.info(`OMOPHub MCP server listening on http://localhost:${String(port)}`);
      logger.info(`Health endpoint at http://localhost:${String(port)}/health`);
      resolve();
    });
  });

  return httpServer;
}
