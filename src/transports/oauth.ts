import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  calculateJwkThumbprint,
  createRemoteJWKSet,
  errors,
  type JWK,
  type JWTPayload,
  jwtVerify,
} from 'jose';
import { hostedGrantHeaders, OmopHubClient } from '../client/api.js';

export class HttpOAuthError extends Error {
  constructor(readonly status: 401 | 403 | 503) {
    super('MCP request authorization failed');
  }
}

const scope = 'vocabulary:read';
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token';

// An OpenID Connect grant can target both MCP and the issuer's UserInfo endpoint.
export function acceptsMcpAudience(
  audience: JWTPayload['aud'],
  scopes: string[],
  resource: string,
  userInfo: string,
): boolean {
  return (
    audience === resource ||
    (scopes.includes('openid') &&
      Array.isArray(audience) &&
      audience.length === 2 &&
      audience.includes(resource) &&
      audience.includes(userInfo))
  );
}

// Called by the local rotation coordinator. Requests continue to use JOSE's normal cooldown.
export async function preloadSigningKey(
  keys: ReturnType<typeof createRemoteJWKSet>,
  expected: JWK,
) {
  const { kid, alg } = expected;
  if (!kid || !alg) throw new Error('The staged signing key needs a key ID and algorithm');
  await keys.reload();
  const loaded = await keys({ kid, alg });
  if ((await calculateJwkThumbprint(loaded)) !== (await calculateJwkThumbprint(expected))) {
    throw new Error('The loaded signing key differs from the staged key');
  }
}

function apiAuthorization(env: NodeJS.ProcessEnv, base: URL) {
  const serviceToken = env.OMOPHUB_MCP_SERVICE_TOKEN;
  const api = env.OMOPHUB_MCP_API_INTERNAL;
  const apiResource = env.OMOPHUB_OAUTH_API_RESOURCE;
  const clientId = env.OMOPHUB_OAUTH_CLIENT_ID;
  const secret = env.OMOPHUB_OAUTH_CLIENT_SECRET;
  if (serviceToken !== undefined || api !== undefined) {
    if (
      !api ||
      !serviceToken ||
      [apiResource, clientId, secret].some((value) => value !== undefined)
    )
      throw new Error(
        'Configure the hosted service credential and API URL together, separately from token exchange',
      );
    const apiBase = new URL(api);
    if (
      apiBase.username ||
      apiBase.password ||
      apiBase.search ||
      apiBase.hash ||
      !(
        apiBase.protocol === 'https:' ||
        (apiBase.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(apiBase.hostname))
      )
    )
      throw new Error('The hosted vocabulary API requires HTTPS or HTTP loopback');
    const check = new URL('/internal/mcp/grant', apiBase);
    return async (_token: string, grant: string, claims: JWTPayload) => {
      const [owner, generation, ...rest] = grant.split('/');
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (
        claims.business_user_id !== owner ||
        !uuid.test(owner) ||
        !uuid.test(generation ?? '') ||
        rest.length
      )
        throw new HttpOAuthError(401);
      const response = await fetch(check, {
        headers: hostedGrantHeaders(serviceToken, grant),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      // This control request does not consume the user's vocabulary quota. The
      // API rechecks current grant and tier when it actually serves each read.
      if (response.status !== 204) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          throw new HttpOAuthError(response.status);
        throw new HttpOAuthError(503);
      }
      return { hostedClient: new OmopHubClient(serviceToken, apiBase.href, grant) };
    };
  }
  if (!apiResource || !clientId || !secret)
    throw new Error('Incomplete OMOPHub HTTP OAuth configuration');
  const tokenUrl = new URL('oauth2/token', base);
  return async (token: string) => {
    // The issuer checks current consent at exchange, even for an unexpired JWT.
    // Each dispatch gets its own API credential, including after a client refresh.
    const response = await fetch(tokenUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: token,
        subject_token_type: accessTokenType,
        resource: apiResource,
        scope,
      }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      // The pilot issuer reports an inactive subject (including a deleted
      // account) as invalid_request before applying its personal grant policy.
      const invalidSubject =
        body.error === 'invalid_request' &&
        (body.error_description === 'subject_token is invalid' ||
          body.error_description === 'subject_token does not represent a user');
      if (response.status === 400 && (body.error === 'invalid_grant' || invalidSubject))
        throw new HttpOAuthError(401);
      if (response.status === 400 && body.error === 'invalid_scope') throw new HttpOAuthError(403);
      throw new HttpOAuthError(503);
    }
    if (
      body.issued_token_type !== accessTokenType ||
      typeof body.token_type !== 'string' ||
      body.token_type.toLowerCase() !== 'bearer' ||
      typeof body.access_token !== 'string' ||
      !body.access_token
    )
      throw new HttpOAuthError(503);
    return { upstreamAccessToken: body.access_token };
  };
}

export function httpOAuthFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const issuer = env.OMOPHUB_OAUTH_ISSUER;
  const resource = env.OMOPHUB_OAUTH_MCP_RESOURCE;
  const internal = env.OMOPHUB_OAUTH_ISSUER_INTERNAL;
  const configured = [
    issuer,
    resource,
    internal,
    env.OMOPHUB_OAUTH_API_RESOURCE,
    env.OMOPHUB_OAUTH_CLIENT_ID,
    env.OMOPHUB_OAUTH_CLIENT_SECRET,
    env.OMOPHUB_MCP_API_INTERNAL,
    env.OMOPHUB_MCP_SERVICE_TOKEN,
  ];
  if (configured.every((value) => value === undefined)) return undefined;
  if (!issuer || !resource) throw new Error('Incomplete OMOPHub HTTP OAuth configuration');

  const base = new URL(`${(internal || issuer).replace(/\/$/, '')}/`);
  const authorizeUpstream = apiAuthorization(env, base);
  const keys = createRemoteJWKSet(new URL('jwks', base), { timeoutDuration: 5000 });
  const userInfoAudience = `${issuer.replace(/\/$/, '')}/oauth2/userinfo`;
  const metadataPath = '/.well-known/oauth-protected-resource/mcp';
  const challenge = `Bearer resource_metadata="${new URL(metadataPath, resource).href}"`;
  return {
    metadataPath,
    metadata: { resource, authorization_servers: [issuer], scopes_supported: [scope] },
    challenge,
    preloadSigningKey: (expected: JWK) => preloadSigningKey(keys, expected),
    async authorize(token: string, sessionGrant?: string) {
      let claims: JWTPayload;
      try {
        ({ payload: claims } = await jwtVerify(token, keys, {
          issuer,
          audience: resource,
          typ: 'at+jwt',
          requiredClaims: ['exp', 'iat', 'sub', 'client_id', 'scope', 'app_grant'],
        }));
      } catch (error) {
        if (
          error instanceof errors.JWKSNoMatchingKey ||
          error instanceof errors.JWSInvalid ||
          error instanceof errors.JWTInvalid ||
          error instanceof errors.JWTClaimValidationFailed ||
          error instanceof errors.JWSSignatureVerificationFailed ||
          error instanceof errors.JOSEAlgNotAllowed ||
          error instanceof errors.JOSENotSupported ||
          error instanceof errors.JWTExpired
        )
          throw new HttpOAuthError(401);
        throw error;
      }
      const grant = claims.app_grant;
      const scopes = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
      if (
        !acceptsMcpAudience(claims.aud, scopes, resource, userInfoAudience) ||
        typeof claims.client_id !== 'string' ||
        typeof grant !== 'string' ||
        !grant ||
        (sessionGrant !== undefined && grant !== sessionGrant)
      )
        throw new HttpOAuthError(401);
      if (!scopes.includes(scope)) throw new HttpOAuthError(403);

      const auth: AuthInfo = {
        token,
        clientId: claims.client_id,
        scopes: [scope],
        extra: await authorizeUpstream(token, grant, claims),
      };
      return { grant, auth };
    },
  };
}

export type HttpOAuth = NonNullable<ReturnType<typeof httpOAuthFromEnv>>;
