import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { handleHealthRequest } from '../health.js';
import { logger } from '../utils/logger.js';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id',
  'Access-Control-Expose-Headers': 'mcp-session-id',
};

function setCorsHeaders(res: ServerResponse): void {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

/**
 * Starts an HTTP server with Streamable HTTP MCP transport on /mcp
 * and a health endpoint on /health.
 */
export async function startHttpTransport(mcpServer: McpServer, port: number): Promise<Server> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await mcpServer.connect(transport);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    setCorsHeaders(res);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health endpoint
    if (handleHealthRequest(req, res)) return;

    // MCP endpoint
    if (req.url === '/mcp') {
      try {
        await transport.handleRequest(req, res);
      } catch (error) {
        logger.error('MCP transport error', { error: String(error) });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
      return;
    }

    // Not found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.on('error', (err) => {
    logger.error('HTTP server error', { error: String(err), port });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      logger.info(`OMOPHub MCP server listening on http://localhost:${String(port)}/mcp`);
      logger.info(`Health endpoint at http://localhost:${String(port)}/health`);
      resolve();
    });
  });

  return httpServer;
}
