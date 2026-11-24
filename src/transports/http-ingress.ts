import type { IncomingMessage, ServerResponse } from 'node:http';

function configuredValues(value?: string): string[] {
  if (!value?.trim()) return [];
  return value.split(',').map((item) => item.trim());
}

// Host carries an authority (including a non-default port), never a URL or wildcard.
function configuredHost(value: string): string {
  if (
    !/^(?:[a-z0-9.-]+|\[[a-f0-9:.]+\])(?::\d+)?$/i.test(value) ||
    !URL.canParse(`http://${value}`)
  ) {
    throw new Error(
      'MCP_ALLOWED_HOSTS entries must be exact hostnames or IP addresses with an optional port',
    );
  }
  return value.toLowerCase();
}

function configuredOrigin(value: string): string {
  if (!URL.canParse(value)) throw new Error('MCP_ALLOWED_ORIGINS requires exact HTTP(S) origins');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== value ||
    url.hostname.includes('*')
  ) {
    throw new Error('MCP_ALLOWED_ORIGINS requires exact HTTP(S) origins');
  }
  return value;
}

function isListenerAuthority(authority: string, port: number | undefined): boolean {
  if (port === undefined) return false;
  return ['localhost', '127.0.0.1', '[::1]'].some(
    (name) => authority === `${name}:${port}` || (port === 80 && authority === name),
  );
}

/** Check the actual Host and browser Origin before routing, including for discovery and OPTIONS. */
export function createHttpIngressPolicy(resource?: string, env: NodeJS.ProcessEnv = process.env) {
  const hosts = new Set(configuredValues(env.MCP_ALLOWED_HOSTS).map(configuredHost));
  const origins = new Set(configuredValues(env.MCP_ALLOWED_ORIGINS).map(configuredOrigin));
  if (resource) {
    const url = new URL(resource);
    hosts.add(url.host);
    origins.add(url.origin);
  }

  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const host = req.headers.host?.toLowerCase();
    const origin = req.headers.origin;
    const port = req.socket.localPort;
    res.setHeader('Vary', 'Origin');
    const hostAllowed =
      host &&
      req.headersDistinct.host?.length === 1 &&
      (hosts.has(host) || isListenerAuthority(host, port));
    const originAllowed =
      origin === undefined ||
      (req.headersDistinct.origin?.length === 1 &&
        (origins.has(origin) ||
          (origin.startsWith('http://') && isListenerAuthority(origin.slice(7), port))));
    if (!hostAllowed || !originAllowed) {
      res.writeHead(403, { 'Cache-Control': 'no-store' });
      res.end();
      return false;
    }

    if (origin !== undefined) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, mcp-session-id, MCP-Protocol-Version, Last-Event-ID, Authorization',
      );
      res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, WWW-Authenticate');
    }
    return true;
  };
}
