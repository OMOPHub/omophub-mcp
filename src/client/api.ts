import { OmopHubApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { VERSION } from '../version.js';
import type { ApiResponse } from './types.js';

const MAX_RETRIES = 2;

const MAX_RETRY_WAIT_MS = 5_000;

export function hostedGrantHeaders(serviceToken: string, grant: string) {
  return { Authorization: `Bearer ${serviceToken}`, 'X-OMOPHub-App-Grant': grant };
}

export class OmopHubClient {
  readonly baseUrl: string;
  readonly #apiKey: string;
  private readonly analyticsOptout: boolean;
  private readonly userAgent: string;

  constructor(
    apiKey: string | undefined,
    baseUrl?: string,
    private readonly grant?: string,
  ) {
    this.#apiKey = apiKey ?? '';
    this.baseUrl = (
      baseUrl ||
      process.env.OMOPHUB_BASE_URL ||
      'https://api.omophub.com/v1'
    ).replace(/\/$/, '');
    this.analyticsOptout = process.env.OMOPHUB_ANALYTICS_OPTOUT === 'true';

    const userAgentSuffix = process.env.OMOPHUB_USER_AGENT_SUFFIX?.trim();
    if (userAgentSuffix && /[\r\n]/.test(userAgentSuffix)) {
      throw new Error('OMOPHUB_USER_AGENT_SUFFIX must not contain newlines');
    }
    this.userAgent = [`omophub-mcp/${VERSION}`, userAgentSuffix].filter(Boolean).join(' ');
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

    return this.send<T>(url.toString(), path, 'GET', toolName);
  }

  async post<T>(
    path: string,
    body: Record<string, unknown>,
    toolName?: string,
  ): Promise<ApiResponse<T>> {
    return this.send<T>(`${this.baseUrl}${path}`, path, 'POST', toolName, JSON.stringify(body));
  }

  private async send<T>(
    url: string,
    path: string,
    method: 'GET' | 'POST',
    toolName?: string,
    body?: string,
  ): Promise<ApiResponse<T>> {
    if (this.grant && new URL(url).origin !== new URL(this.baseUrl).origin)
      throw new Error('The hosted service credential is scoped to the configured API origin');
    const headers: Record<string, string> = {
      ...(this.grant
        ? hostedGrantHeaders(this.#apiKey, this.grant)
        : { Authorization: `Bearer ${this.#apiKey}` }),
      'User-Agent': this.userAgent,
      Accept: 'application/json',
    };
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    if (!this.analyticsOptout) {
      headers['X-MCP-Client'] = 'true';
      if (toolName) headers['X-MCP-Tool'] = toolName;
    }

    for (let attempt = 0; ; attempt++) {
      const start = Date.now();
      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          ...(this.grant && { redirect: 'error' as const }),
          signal: AbortSignal.timeout(30_000),
        });
        logger.debug('API request', {
          tool_name: toolName,
          method,
          duration_ms: Date.now() - start,
          status: response.status,
        });
        if (response.ok) return (await response.json()) as ApiResponse<T>;

        const error = await OmopHubApiError.fromResponse(response, path);
        if (
          error.status !== 429 ||
          error.info.code === 'monthly_limit_exceeded' ||
          error.info.retryable === false ||
          attempt >= MAX_RETRIES
        )
          throw error;
        const waitMs =
          error.info.retryAfterSeconds === undefined
            ? 1000 * (attempt + 1)
            : error.info.retryAfterSeconds * 1000;
        if (waitMs > MAX_RETRY_WAIT_MS) throw error;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      } catch (error) {
        if (error instanceof OmopHubApiError || method === 'POST' || attempt >= MAX_RETRIES)
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
}
