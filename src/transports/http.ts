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

// Active sessions — each client gets its own transport + server
const sessions = new Map<string, StreamableHTTPServerTransport>();

const MAX_BODY_SIZE = 1_048_576; // 1 MB

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
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
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
          const transport = sessions.get(sessionId);
          if (!transport) return;
          try {
            await transport.handleRequest(req, res);
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
        const transport = sessions.get(sessionId);
        if (!transport) return;
        try {
          await transport.handleRequest(req, res, parsedBody);
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
            sessions.set(id, transport);
            logger.info('MCP session created', { sessionId: id });
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
            logger.info('MCP session closed', { sessionId: transport.sessionId });
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
  });

  httpServer.on('error', (err) => {
    logger.error('HTTP server error', { error: String(err), port });
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
