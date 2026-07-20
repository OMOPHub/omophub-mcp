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
}

// Active sessions — each client gets its own transport + server.
//
// Cleanup is driven by idle timeout, not by socket lifecycle. The SDK only
// fires transport.onclose from close(), which it calls solely from the DELETE
// handler, so any client that vanishes without a clean shutdown (network drop,
// sleep, crash) would otherwise leak its transport AND its McpServer forever.
// We deliberately do NOT close sessions when a socket drops: Streamable HTTP
// clients legitimately disconnect and reconnect their SSE stream, so that
// would break working clients.
const sessions = new Map<string, Session>();

const MAX_BODY_SIZE = 1_048_576; // 1 MB
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min without a request
const SESSION_SWEEP_INTERVAL_MS = 60 * 1000;
const MAX_SESSIONS = 1000; // backstop against a burst of initialize requests

function touchSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) session.lastSeenAt = Date.now();
}

/** Closes sessions idle past the timeout. transport.close() fires onclose,
 *  which removes the map entry and shuts down the attached McpServer. */
export function sweepIdleSessions(now: number = Date.now()): number {
  let closed = 0;
  for (const [sessionId, session] of sessions) {
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

/** Evicts the least-recently-seen session. Backstop only. */
function evictOldestSession(): void {
  let oldestId: string | undefined;
  let oldestSeenAt = Number.POSITIVE_INFINITY;
  for (const [sessionId, session] of sessions) {
    if (session.lastSeenAt < oldestSeenAt) {
      oldestSeenAt = session.lastSeenAt;
      oldestId = sessionId;
    }
  }
  if (!oldestId) return;
  const session = sessions.get(oldestId);
  logger.warn('Session limit reached, evicting oldest session', {
    sessionId: oldestId,
    maxSessions: MAX_SESSIONS,
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

      // POST — read body with size limit
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let aborted = false;
      for await (const chunk of req) {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        totalBytes += buf.length;
        if (totalBytes > MAX_BODY_SIZE) {
          req.destroy();
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Payload too large' },
              id: null,
            }),
          );
          aborted = true;
          break;
        }
        chunks.push(buf);
      }
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

      // Existing session
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        if (!session) return;
        touchSession(sessionId);
        try {
          await session.transport.handleRequest(req, res, parsedBody);
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
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            if (sessions.size >= MAX_SESSIONS) evictOldestSession();
            sessions.set(id, { transport, lastSeenAt: Date.now() });
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

        try {
          await transport.handleRequest(req, res, parsedBody);
        } catch (error) {
          logger.error('MCP transport error (init)', { error: String(error) });
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON_RPC_INTERNAL_ERROR);
          }
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
