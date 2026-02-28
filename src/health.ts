import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { logger } from './utils/logger.js';
import { VERSION } from './version.js';

const startTime = Date.now();

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && req.url === '/health') {
    const body = JSON.stringify({
      status: 'ok',
      version: VERSION,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    });

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

export function startHealthServer(port: number): ReturnType<typeof createServer> {
  const server = createServer(handleRequest);

  server.on('error', (err) => {
    logger.error('Health server error', { error: String(err), port });
  });

  server.listen(port, () => {
    logger.info(`Health endpoint listening on http://localhost:${String(port)}/health`);
  });

  return server;
}
