import { OmopHubApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { VERSION } from '../version.js';
import type { ApiResponse } from './types.js';

const MAX_RETRIES = 2;

/** Parse Retry-After header (seconds or HTTP-date), returning wait time in ms. */
function parseRetryAfter(header: string, fallbackMs: number): number {
  const seconds = parseInt(header, 10);
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const delayMs = date - Date.now();
    return delayMs > 0 ? delayMs : fallbackMs;
  }

  return fallbackMs;
}

export class OmopHubClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly analyticsOptout: boolean;

  constructor(apiKey: string | undefined, baseUrl?: string) {
    this.apiKey = apiKey ?? '';
    this.baseUrl = (
      baseUrl ||
      process.env.OMOPHUB_BASE_URL ||
      'https://api.omophub.com/v1'
    ).replace(/\/$/, '');
    this.analyticsOptout = process.env.OMOPHUB_ANALYTICS_OPTOUT === 'true';
  }

  async request<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    toolName?: string,
  ): Promise<ApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'User-Agent': `omophub-mcp/${VERSION}`,
      Accept: 'application/json',
    };

    if (!this.analyticsOptout) {
      headers['X-MCP-Client'] = 'true';
      if (toolName) {
        headers['X-MCP-Tool'] = toolName;
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const start = Date.now();

      try {
        const response = await fetch(url.toString(), {
          headers,
          signal: AbortSignal.timeout(30_000),
        });
        const duration = Date.now() - start;

        logger.debug('API request', {
          tool_name: toolName,
          api_path: path,
          duration_ms: duration,
          status: response.status,
        });

        if (response.status === 429 && attempt < MAX_RETRIES) {
          const retryAfter = response.headers.get('Retry-After');
          const fallbackMs = 1000 * (attempt + 1);
          const waitMs = retryAfter ? parseRetryAfter(retryAfter, fallbackMs) : fallbackMs;
          logger.warn(`Rate limited, retrying in ${waitMs}ms`, {
            tool_name: toolName,
            api_path: path,
          });
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        if (!response.ok) {
          const body = await response.text();
          let message: string;
          try {
            const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
            message = parsed.error?.message || parsed.message || body;
          } catch {
            message = body || response.statusText;
          }
          throw new OmopHubApiError(response.status, message, path);
        }

        return (await response.json()) as ApiResponse<T>;
      } catch (error) {
        if (error instanceof OmopHubApiError) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < MAX_RETRIES) {
          logger.warn(`Request failed, retrying (attempt ${attempt + 1})`, {
            tool_name: toolName,
            api_path: path,
          });
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  async post<T>(
    path: string,
    body: Record<string, unknown>,
    toolName?: string,
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'User-Agent': `omophub-mcp/${VERSION}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (!this.analyticsOptout) {
      headers['X-MCP-Client'] = 'true';
      if (toolName) {
        headers['X-MCP-Tool'] = toolName;
      }
    }

    const lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const start = Date.now();

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });

        logger.debug('API POST request', {
          tool_name: toolName,
          api_path: path,
          duration_ms: Date.now() - start,
          status: response.status,
        });

        if (response.status === 429 && attempt < MAX_RETRIES) {
          const retryAfter = response.headers.get('Retry-After');
          const fallbackMs = 1000 * (attempt + 1);
          const waitMs = retryAfter ? parseRetryAfter(retryAfter, fallbackMs) : fallbackMs;
          logger.warn(`Rate limited, retrying in ${waitMs}ms`, {
            tool_name: toolName,
            api_path: path,
          });
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        if (!response.ok) {
          const text = await response.text();
          let message: string;
          try {
            const parsed = JSON.parse(text) as {
              error?: { message?: string };
              message?: string;
            };
            message = parsed.error?.message || parsed.message || text;
          } catch {
            message = text || response.statusText;
          }
          throw new OmopHubApiError(response.status, message, path);
        }

        return (await response.json()) as ApiResponse<T>;
      } catch (error) {
        if (error instanceof OmopHubApiError) throw error;
        // Do not retry POST on network errors — could cause duplicate mutations
        throw error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError || new Error('POST request failed after retries');
  }
}
