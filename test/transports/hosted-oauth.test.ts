import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, expect, it, vi } from 'vitest';
import { OmopHubClient } from '../../src/client/api.js';
import { registerConceptTools } from '../../src/tools/concepts.js';
import { httpOAuthFromEnv } from '../../src/transports/oauth.js';
import conceptResponse from '../fixtures/concept-response.json';
import { createMockServer } from '../helpers/mock-server.js';

const issuer = 'https://issuer.example.test';
const resource = 'https://mcp.example.test/mcp';
const account = '8d49546d-842e-44a1-89e1-8445eebb30e5';
const grant = `${account}/933bbc47-d492-4491-a9eb-4df67fe1889e`;
const serviceEnv = {
  OMOPHUB_MCP_API_INTERNAL: 'https://api.internal.test/v1',
  OMOPHUB_MCP_SERVICE_TOKEN: 'fixture-service',
};
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token';

async function signedFixture(env: NodeJS.ProcessEnv) {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), alg: 'ES256', kid: 'fixture' };
  const oauth = httpOAuthFromEnv({
    OMOPHUB_OAUTH_ISSUER: issuer,
    OMOPHUB_OAUTH_MCP_RESOURCE: resource,
    ...env,
  });
  if (!oauth) throw new Error('Expected the test issuer to be configured');
  const sign = (claims: Record<string, string> = {}) =>
    new SignJWT({
      scope: 'vocabulary:read',
      client_id: 'test-app',
      business_user_id: account,
      app_grant: grant,
      ...claims,
    })
      .setProtectedHeader({ alg: 'ES256', kid: jwk.kid, typ: 'at+jwt' })
      .setIssuer(issuer)
      .setAudience(resource)
      .setSubject('fixture-user')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  const upstream = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(input) === `${issuer}/jwks`) return Promise.resolve(Response.json({ keys: [jwk] }));
    return upstream(input, init);
  });
  return { oauth, sign, upstream };
}

afterEach(() => vi.unstubAllGlobals());

it('authorizes a signed grant for one vocabulary read and rechecks that grant after disconnect', async () => {
  const { oauth, sign, upstream } = await signedFixture(serviceEnv);
  let active = true;
  let reads = 0;
  const check = 'https://api.internal.test/internal/mcp/grant';
  upstream.mockImplementation(async (input, init) => {
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer fixture-service');
    expect(headers.get('X-OMOPHub-App-Grant')).toBe(grant);
    if (String(input) === check) return new Response(null, { status: active ? 204 : 401 });
    expect(String(input)).toBe('https://api.internal.test/v1/concepts/201826');
    reads++;
    return Response.json(conceptResponse);
  });
  const token = await sign();
  const server = createMockServer();
  registerConceptTools(
    server as never,
    new OmopHubClient(undefined, 'https://unused.test/v1'),
    null,
  );
  const lookup = async () => {
    const { auth } = await oauth.authorize(token, grant);
    const tool = server.tools.get('get_concept')!;
    return tool({ concept_id: 201826 }, { authInfo: auth });
  };
  expect((await lookup()).structuredContent.concept_id).toBe(201826);
  expect(reads).toBe(1);
  active = false;
  await expect(lookup()).rejects.toMatchObject({ status: 401 });
  expect(upstream).toHaveBeenCalledTimes(3);
  expect(reads).toBe(1);
});

it('checks grant ownership, session binding and scopes before contacting the vocabulary API', async () => {
  const { oauth, sign, upstream } = await signedFixture(serviceEnv);
  await expect(
    oauth.authorize(await sign({ business_user_id: 'different-account' })),
  ).rejects.toMatchObject({ status: 401 });
  await expect(oauth.authorize(await sign(), 'different-grant')).rejects.toMatchObject({
    status: 401,
  });
  await expect(oauth.authorize(await sign({ scope: 'openid' }))).rejects.toMatchObject({
    status: 403,
  });
  expect(upstream).not.toHaveBeenCalled();
});

it('exchanges a signed token only in exchange mode and propagates a revoked grant', async () => {
  const apiResource = 'https://api.example.test/v1';
  const { oauth, sign, upstream } = await signedFixture({
    OMOPHUB_OAUTH_API_RESOURCE: apiResource,
    OMOPHUB_OAUTH_CLIENT_ID: 'test-mcp',
    OMOPHUB_OAUTH_CLIENT_SECRET: 'fixture-secret',
  });
  const token = await sign();
  upstream.mockResolvedValueOnce(
    Response.json({
      issued_token_type: accessTokenType,
      token_type: 'Bearer',
      access_token: 'exchanged-fixture',
    }),
  );
  const accepted = await oauth.authorize(token);
  expect(accepted.auth.extra?.upstreamAccessToken).toBe('exchanged-fixture');
  const [url, init] = upstream.mock.calls[0]!;
  expect(String(url)).toBe(`${issuer}/oauth2/token`);
  expect(init?.method).toBe('POST');
  expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toMatchObject({
    resource: apiResource,
    subject_token: token,
    scope: 'vocabulary:read',
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  });
  upstream.mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }));
  await expect(oauth.authorize(token, grant)).rejects.toMatchObject({ status: 401 });
});
