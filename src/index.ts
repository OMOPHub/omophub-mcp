#!/usr/bin/env node

import url from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startHealthServer } from './health.js';
import { createServer } from './server.js';
import { resolveApiKey } from './utils/auth.js';
import { logger } from './utils/logger.js';

export function parseArgs(argv: string[]): {
  apiKey?: string;
  baseUrl?: string;
  healthPort?: number;
} {
  const result: { apiKey?: string; baseUrl?: string; healthPort?: number } = {};

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

export async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  let apiKey: string;
  try {
    apiKey = resolveApiKey(args.apiKey);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const server = createServer(apiKey, args.baseUrl);
  const transport = new StdioServerTransport();

  logger.info('Starting OMOPHub MCP server (stdio transport)');

  await server.connect(transport);

  const healthPort = resolveHealthPort(args.healthPort);
  if (healthPort !== undefined) {
    startHealthServer(healthPort);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error: unknown) => {
    logger.error('Fatal error', { error: String(error) });
    process.exit(1);
  });
}
