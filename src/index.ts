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

if (isDirectRun) {
  main().catch((error: unknown) => {
    logger.error('Fatal error', { error: String(error) });
    process.exit(1);
  });
}
