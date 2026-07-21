#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import type { Server } from 'node:http';
import url from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OmopHubClient } from './client/api.js';
import { startHealthServer } from './health.js';
import { createServer } from './server.js';
import { startHttpTransport } from './transports/http.js';
import { resolveApiKey } from './utils/auth.js';
import { logger } from './utils/logger.js';

export type TransportType = 'stdio' | 'http';

const DEFAULT_HTTP_PORT = 3100;

export function parseArgs(argv: string[]): {
  apiKey?: string;
  baseUrl?: string;
  healthPort?: number;
  transport?: TransportType;
  port?: number;
} {
  const result: {
    apiKey?: string;
    baseUrl?: string;
    healthPort?: number;
    transport?: TransportType;
    port?: number;
  } = {};

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--api-key=')) {
      result.apiKey = arg.slice('--api-key='.length);
    } else if (arg.startsWith('--base-url=')) {
      result.baseUrl = arg.slice('--base-url='.length);
    } else if (arg.startsWith('--health-port=')) {
      const port = parseInt(arg.slice('--health-port='.length), 10);
      if (!Number.isNaN(port) && port > 0 && port < 65536) {
        result.healthPort = port;
      }
    } else if (arg.startsWith('--transport=')) {
      const value = arg.slice('--transport='.length);
      if (value === 'stdio' || value === 'http') {
        result.transport = value;
      }
    } else if (arg.startsWith('--port=')) {
      const port = parseInt(arg.slice('--port='.length), 10);
      if (!Number.isNaN(port) && port > 0 && port < 65536) {
        result.port = port;
      }
    }
  }

  return result;
}

export function resolveHealthPort(cliPort?: number): number | undefined {
  if (cliPort !== undefined) return cliPort;

  const envPort = process.env.HEALTH_PORT;
  if (envPort) {
    const port = parseInt(envPort, 10);
    if (!Number.isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
  }

  return undefined;
}

export function resolveTransport(cliTransport?: TransportType): TransportType {
  if (cliTransport) return cliTransport;

  const envTransport = process.env.MCP_TRANSPORT;
  if (envTransport === 'http' || envTransport === 'stdio') {
    return envTransport;
  }

  return 'stdio';
}

export function resolvePort(cliPort?: number): number {
  if (cliPort !== undefined) return cliPort;

  const envPort = process.env.MCP_PORT;
  if (envPort) {
    const port = parseInt(envPort, 10);
    if (!Number.isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
  }

  return DEFAULT_HTTP_PORT;
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const apiKey = resolveApiKey(args.apiKey);
  const transportType = resolveTransport(args.transport);

  if (!apiKey && transportType === 'stdio') {
    logger.error(
      'OMOPHub API key required for stdio mode. Set OMOPHUB_API_KEY or pass --api-key=KEY.\n' +
        'Get your free API key at: https://dashboard.omophub.com/api-keys',
    );
    process.exit(1);
  }

  if (!apiKey) {
    logger.info(
      'No default API key — hosted mode: all requests must include Authorization: Bearer header',
    );
  }

  const defaultClient = new OmopHubClient(apiKey, args.baseUrl);

  if (transportType === 'http') {
    const port = resolvePort(args.port);
    logger.info('Starting OMOPHub MCP server (http transport)');
    // Kept so the fatal path can stop accepting new work before exiting.
    runningServer = await startHttpTransport(createServer, defaultClient, port);
  } else {
    const server = createServer(defaultClient);
    const transport = new StdioServerTransport();
    logger.info('Starting OMOPHub MCP server (stdio transport)');
    await server.connect(transport);

    const healthPort = resolveHealthPort(args.healthPort);
    if (healthPort !== undefined) {
      startHealthServer(healthPort);
    }
  }
}

function isRunDirectly(): boolean {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === url.pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

const isDirectRun = isRunDirectly();

/** Normalizes any thrown/rejected value to a loggable string, without ever
 *  throwing itself — this runs on the fatal shutdown path, so a value that
 *  can't be coerced (a null-prototype object, or one whose `toString` /
 *  `Symbol.toPrimitive` throws) must not take out the diagnostic. Also handles
 *  a non-Error throw (`throw 'boom'`) and `throw null` (where `.stack` would
 *  throw). */
export function formatError(value: unknown): string {
  try {
    if (value instanceof Error) return value.stack ?? value.message;
    return String(value);
  } catch {
    return '[unrepresentable error value]';
  }
}

let shuttingDown = false;
let pendingFatalWrites = 0;
let exited = false;
let runningServer: Server | undefined;

function exitNow(): void {
  if (exited) return;
  exited = true;
  process.exit(1);
}

/** Exit once shutdown has started AND every queued fatal write has flushed, so
 *  a diagnostic from a second simultaneous fatal event isn't truncated by the
 *  first write's completion triggering the exit. */
function exitWhenDrained(): void {
  if (shuttingDown && pendingFatalWrites === 0) exitNow();
}

/** Writes one fatal diagnostic line to stderr (an async pipe under Docker),
 *  matching the logger's format, and tracks it as pending so the process
 *  doesn't exit before it drains to the OS. */
function writeFatalLine(message: string, value: unknown): void {
  const line = `[${new Date().toISOString()}] ERROR ${message} ${JSON.stringify({
    error: formatError(value),
  })}\n`;
  pendingFatalWrites++;
  const done = (): void => {
    pendingFatalWrites--;
    exitWhenDrained();
  };
  try {
    process.stderr.write(line, done);
  } catch {
    done();
  }
}

/**
 * Logs a fatal condition and terminates for a clean, supervised restart.
 *
 * We do NOT resume. Once an exception or rejection reaches the process top,
 * we know nothing about what state was left behind — half-applied work, an
 * un-released handle, a transport mid-write — so continuing is undefined
 * behaviour (and Node's own default for both signals is to crash). Aborted
 * client requests, the one routine case, are already caught at their boundary
 * in the HTTP transport and never reach here, so anything that does is a
 * genuine unknown.
 *
 * Shutdown (once, on the first fatal event): stop the HTTP server accepting
 * new connections AND drop existing ones — otherwise a client on a kept-alive
 * connection could still be served in a state we've declared unsafe. Then emit
 * the diagnostic; the process exits once every fatal write has flushed to
 * stderr (so simultaneous fatal events aren't lost), or after a 1s fallback if
 * a write callback never fires.
 *
 * NOTE: this assumes the container runs under a restart policy that restarts
 * on a non-zero exit — Docker's `always` or `unless-stopped` both work; they
 * differ only in how they treat a manual `docker stop` across a daemon
 * restart, which is irrelevant here. Without any restart policy, a fatal
 * condition now stops the service instead of limping on.
 */
function fatalExit(message: string, value: unknown): void {
  process.exitCode = 1;
  const first = !shuttingDown;
  shuttingDown = true;

  if (first) {
    try {
      runningServer?.close(); // refuse new connections
      runningServer?.closeAllConnections(); // and drop in-flight/kept-alive ones
    } catch {
      // already closed / never started — nothing to do
    }
    setTimeout(exitNow, 1000); // hard fallback if a write never drains
  }

  // Always record the diagnostic — including a second simultaneous fatal
  // event; the exit waits until all such writes have flushed.
  writeFatalLine(message, value);
}

export function installProcessSafetyNets(): void {
  process.on('unhandledRejection', (reason: unknown) => {
    fatalExit('Unhandled promise rejection — exiting for a clean restart', reason);
  });

  process.on('uncaughtException', (error: unknown) => {
    fatalExit('Uncaught exception — exiting for a clean restart', error);
  });
}

if (isDirectRun) {
  installProcessSafetyNets();
  main().catch((error: unknown) => {
    fatalExit('Fatal error during startup', error);
  });
}
