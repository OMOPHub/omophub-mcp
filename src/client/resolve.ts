/**
 * Per-request client resolution for hosted MCP deployments.
 *
 * In self-hosted mode (stdio or HTTP with OMOPHUB_API_KEY env var),
 * the default client is used for all requests.
 *
 * In hosted mode, each client sends their own API key via
 * Authorization: Bearer header, and we create/cache a client per key.
 */

import { OmopHubClient } from './api.js';

/** Minimal type for the `extra` parameter passed to MCP tool handlers. */
interface ToolExtra {
  requestInfo?: {
    headers?: Record<string, string | string[] | undefined>;
  };
}

// LRU-style cache of clients keyed by API key (max 100 entries)
const clientCache = new Map<string, { client: OmopHubClient; lastUsed: number }>();
const MAX_CACHED_CLIENTS = 100;

function pruneClientCache(): void {
  if (clientCache.size <= MAX_CACHED_CLIENTS) return;
  const entries = [...clientCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [key] of entries.slice(0, entries.length - MAX_CACHED_CLIENTS)) {
    clientCache.delete(key);
  }
}

/**
 * Resolve the OmopHubClient for a request.
 *
 * Priority:
 * 1. Authorization: Bearer header from the HTTP request (hosted mode)
 * 2. Default client created at startup (self-hosted mode / stdio)
 */
export function resolveClient(extra: ToolExtra, defaultClient: OmopHubClient): OmopHubClient {
  const headers = extra?.requestInfo?.headers;
  const rawHeader = headers?.['authorization'] ?? headers?.['Authorization'];

  if (!rawHeader) return defaultClient;

  const authHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!authHeader) return defaultClient;

  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return defaultClient;

  const apiKey = match[1].trim();
  if (!apiKey) return defaultClient;

  // Check cache
  const cached = clientCache.get(apiKey);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.client;
  }

  // Create new client for this key
  const client = new OmopHubClient(apiKey);
  clientCache.set(apiKey, { client, lastUsed: Date.now() });
  pruneClientCache();

  return client;
}
