import { OmopHubClient } from './api.js';

/** HTTP credentials are supplied by the transport on each SDK dispatch. */
interface ToolExtra {
  authInfo?: { extra?: Record<string, unknown> };
  requestInfo?: { headers?: Record<string, string | string[] | undefined> };
}

export function resolveClient(extra: ToolExtra, defaultClient: OmopHubClient): OmopHubClient {
  if (extra?.authInfo) {
    const hosted = extra.authInfo.extra?.hostedClient;
    if (hosted instanceof OmopHubClient) return hosted;
    const token = extra.authInfo.extra?.upstreamAccessToken;
    if (typeof token !== 'string' || !token) throw new Error('Missing upstream API credential');
    return new OmopHubClient(token, defaultClient.baseUrl);
  }
  if (extra?.requestInfo) throw new Error('Missing HTTP request credential');
  return defaultClient; // stdio has no HTTP request context.
}
