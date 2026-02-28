import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startHealthServer } from '../src/health.js';

describe('Health endpoint', () => {
  let server: Server;

  afterEach(() => {
    return new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  async function startAndFetch(path: string): Promise<Response> {
    server = startHealthServer(0); // port 0 = random available port
    await new Promise<void>((resolve) => server.once('listening', resolve));

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected address');
    const port = addr.port;

    return fetch(`http://localhost:${String(port)}${path}`);
  }

  it('returns 200 with correct JSON on /health', async () => {
    const res = await startAndFetch('/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');

    const body = (await res.json()) as { status: string; version: string; uptime_seconds: number };
    expect(body.status).toBe('ok');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof body.uptime_seconds).toBe('number');
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it('returns 404 for unknown paths', async () => {
    const res = await startAndFetch('/unknown');
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Not found');
  });

  it('returns 404 for root path', async () => {
    const res = await startAndFetch('/');
    expect(res.status).toBe(404);
  });
});
