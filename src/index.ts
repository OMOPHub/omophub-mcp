#!/usr/bin/env node

import { realpathSync } from 'node:fs';
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
    await startHttpTransport(createServer, defaultClient, port);
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

/** Normalizes any thrown/rejected value to a loggable string. Handles the
 *  cases `.stack`/`.message` can't: a non-Error throw (`throw 'boom'`) or,
 *  worse, `throw null`, where reading `.stack` would itself throw. */
export function formatError(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  return String(value);
}

let fatalScheduled = false;

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
 * The process stays alive ~1s before exiting: `logger` writes to `stderr`,
 * which is an async pipe under Docker, so an immediate `process.exit()` can
 * truncate the very diagnostic we're trying to emit. The timer is referenced
 * on purpose — it is what holds the loop open for that flush window.
 *
 * NOTE: this assumes the container runs under a restart policy that restarts
 * on a non-zero exit — Docker's `always` or `unless-stopped` both work; they
 * differ only in how they treat a manual `docker stop` across a daemon
 * restart, which is irrelevant here. Without any restart policy, a fatal
 * condition now stops the service instead of limping on.
 */
function fatalExit(message: string, value: unknown): void {
  logger.error(message, { error: formatError(value) });
  process.exitCode = 1;
  if (fatalScheduled) return; // a second signal shouldn't stack timers
  fatalScheduled = true;
  setTimeout(() => process.exit(1), 1000);
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
