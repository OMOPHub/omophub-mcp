import { createServer as createHttpServer, type Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OmopHubClient } from '../../src/client/api.js';
import { createServer } from '../../src/server.js';
import { startHttpTransport } from '../../src/transports/http.js';
import { type HttpOAuth, HttpOAuthError } from '../../src/transports/oauth.js';
import concept from '../fixtures/concept-response.json';
import vocabularies from '../fixtures/vocabularies-response.json';

function baseUrl(server: Server) {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a loopback port');
  return new URL(`http://127.0.0.1:${address.port}/`);
}

describe('HTTP request credentials', () => {
  let upstream: Server;
  let mcp: Server;
  let client: Client;
  let credential: string | undefined;
  let callbackStatuses: number[];
  let callerKeyActive: boolean;
  let receipts: { bearer: string | undefined; grant: string | string[] | undefined }[];

  beforeEach(async () => {
    receipts = [];
    callerKeyActive = true;
    callbackStatuses = [];
    credential = undefined;
    upstream = createHttpServer((req, res) => {
      if (req.headers.authorization === 'Bearer oh_caller_fixture' && !callerKeyActive) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Inactive test API key' } }));
        return;
      }
      receipts.push({
        bearer: req.headers.authorization,
        grant: req.headers['x-omophub-app-grant'],
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.url?.startsWith('/vocabularies') ? vocabularies : concept));
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    client = new Client({ name: 'local-test', version: '1' });
  });

  afterEach(async () => {
    await client.close();
    for (const server of [mcp, upstream]) {
      if (!server?.listening) continue;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function connect(path: string, oauth?: HttpOAuth) {
    const operator = new OmopHubClient('oh_operator_fixture', baseUrl(upstream).href);
    mcp = await startHttpTransport((api) => createServer(api, 'http'), operator, 0, { oauth });
    const transport = new StreamableHTTPClientTransport(new URL(path, baseUrl(mcp)), {
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        if (credential) headers.set('Authorization', credential);
        const response = await fetch(url, { ...init, headers });
        callbackStatuses.push(response.status);
        return response;
      },
    });
    await client.connect(transport);
  }

  it.each(['/', '/mcp'])('bills tool and resource reads only to the caller on %s', async (path) => {
    credential = 'Bearer oh_caller_fixture';
    await connect(path);
    const lookup = () =>
      client.callTool({ name: 'get_concept', arguments: { concept_id: 201826 } });
    const resource = () => client.readResource({ uri: 'omophub://vocabularies' });
    expect((await lookup()).isError).not.toBe(true);
    await resource();
    expect(receipts).toEqual(Array(2).fill({ bearer: credential, grant: undefined }));
    for (const invalid of [undefined, 'Basic fixture', 'Bearer oh_other_fixture']) {
      credential = invalid;
      await expect(lookup()).rejects.toThrow();
      expect(callbackStatuses.at(-1)).toBe(401);
      await expect(resource()).rejects.toThrow();
      expect(callbackStatuses.at(-1)).toBe(401);
      expect(receipts).toHaveLength(2);
    }
    credential = 'Bearer oh_caller_fixture';
    callerKeyActive = false;
    expect((await lookup()).isError).toBe(true);
    await expect(resource()).rejects.toThrow();
    expect(receipts).toHaveLength(2);
  });

  it('rechecks the OAuth grant before reading through an open SDK session', async () => {
    let connected = true;
    const oauth: HttpOAuth = {
      challenge: 'Bearer',
      metadataPath: '/.well-known/oauth-protected-resource/mcp',
      metadata: {
        resource: 'https://mcp.test/mcp',
        authorization_servers: ['https://issuer.test'],
        scopes_supported: ['vocabulary:read'],
      },
      preloadSigningKey: vi.fn(),
      authorize: async (token, expectedGrant) => {
        if (
          !connected ||
          token !== 'oauth-fixture' ||
          (expectedGrant && expectedGrant !== 'grant-fixture')
        )
          throw new HttpOAuthError(401);
        return {
          grant: 'grant-fixture',
          auth: {
            token,
            clientId: 'client-fixture',
            scopes: ['vocabulary:read'],
            extra: {
              hostedClient: new OmopHubClient(
                'service-fixture',
                baseUrl(upstream).href,
                'grant-fixture',
              ),
            },
          },
        };
      },
    };
    credential = 'Bearer oauth-fixture';
    await connect('/mcp', oauth);
    await client.readResource({ uri: 'omophub://vocabularies' });
    expect(receipts).toEqual([{ bearer: 'Bearer service-fixture', grant: 'grant-fixture' }]);
    connected = false;
    await expect(client.readResource({ uri: 'omophub://vocabularies' })).rejects.toThrow();
    expect(callbackStatuses.at(-1)).toBe(401);
    expect(receipts).toHaveLength(1);
  });
});
