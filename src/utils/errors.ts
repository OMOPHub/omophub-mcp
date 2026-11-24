import { z } from 'zod';

const errorBody = z.object({
  message: z.string().optional(),
  error: z
    .object({
      message: z.string().optional(),
      code: z.string().optional(),
      details: z.unknown().optional(),
    })
    .optional(),
  usage: z.unknown().optional(),
});
const quotaDetails = z.object({
  resets_at: z.string().datetime().optional(),
  retryable: z.boolean().optional(),
});
const usageCounts = z.object({
  current: z.number().nonnegative(),
  limit: z.number().nonnegative(),
});

interface ErrorInfo {
  code?: string;
  retryable?: boolean;
  resetsAt?: string;
  invalidCodeCharacters?: boolean;
  retryAfterSeconds?: number;
  usage?: z.infer<typeof usageCounts>;
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  if (/^\d+$/.test(header)) {
    const seconds = Number(header);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  // HTTP dates contain a weekday and a timezone; avoid Date.parse treating a signed integer as a date.
  if (!header.includes('GMT')) return undefined;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

export class OmopHubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly path: string,
    public readonly info: ErrorInfo = {},
  ) {
    super(message);
    this.name = 'OmopHubApiError';
  }

  static async fromResponse(response: Response, path: string): Promise<OmopHubApiError> {
    const text = await response.text();
    let body: z.infer<typeof errorBody> | undefined;
    try {
      body = errorBody.safeParse(JSON.parse(text)).data;
    } catch {
      // Older servers and proxies can return a plain text failure.
    }
    const details = quotaDetails.safeParse(body?.error?.details).data;
    return new OmopHubApiError(
      response.status,
      body?.error?.message || body?.message || text || response.statusText,
      path,
      {
        code: body?.error?.code,
        invalidCodeCharacters:
          response.status === 400 &&
          body?.error?.code === 'validation_error' &&
          Array.isArray(body.error.details) &&
          body.error.details.some(
            (detail) =>
              detail?.field === 'code' &&
              detail?.message === 'code contains unsupported characters',
          ),
        retryable: details?.retryable,
        resetsAt: details?.resets_at,
        usage: usageCounts.safeParse(body?.usage).data,
        retryAfterSeconds:
          response.status === 429
            ? retryAfterSeconds(response.headers.get('Retry-After'))
            : undefined,
      },
    );
  }
}

const API_KEYS_URL = 'https://dashboard.omophub.com/api-keys';

export function formatErrorForMcp(
  error: unknown,
  toolName: string,
): { text: string; json: string } {
  if (error instanceof OmopHubApiError) {
    switch (error.status) {
      case 400: {
        const invalidCode = toolName === 'fhir_resolve' && error.info.invalidCodeCharacters;
        const message = invalidCode
          ? 'Invalid FHIR Coding (HTTP 400). The code contains unsupported characters. Provide the literal terminology code in the code field and the system URI separately.'
          : `Invalid input for ${toolName} (HTTP 400). Please check the supplied request fields.`;
        return {
          text: message,
          json: JSON.stringify({
            error_code: 'INVALID_INPUT',
            status: 400,
            ...(invalidCode && { field: 'code', reason: 'unsupported_characters' }),
          }),
        };
      }
      case 401:
        return {
          text:
            `Authentication failed for ${toolName}. ` +
            'Check that your OMOPHUB_API_KEY is valid. ' +
            `Get a new key at: ${API_KEYS_URL}`,
          json: JSON.stringify({ error_code: 'AUTH_FAILED' }),
        };
      case 403:
        return {
          text: `Access denied for ${toolName}. This account does not have access to the requested data.`,
          json: JSON.stringify({ error_code: 'ACCESS_DENIED' }),
        };
      case 404: {
        const conceptIdMatch = error.path.match(/\/concepts\/(\d+)/);
        const conceptId = conceptIdMatch ? parseInt(conceptIdMatch[1], 10) : undefined;
        return {
          text: `Not found: ${error.message}. Try using search_concepts to find the correct concept_id, or get_concept_by_code if you have a vocabulary-specific code.`,
          json: JSON.stringify({
            error_code: 'NOT_FOUND',
            path: error.path,
            ...(conceptId !== undefined && { concept_id: conceptId }),
          }),
        };
      }
      case 429: {
        const { code, resetsAt, usage, retryAfterSeconds, retryable } = error.info;
        if (code === 'monthly_limit_exceeded') {
          return {
            text: `Monthly API call limit reached.${resetsAt ? ` The allowance resets at ${resetsAt}.` : ''}`,
            json: JSON.stringify({
              error_code: 'MONTHLY_LIMIT_EXCEEDED',
              retryable: false,
              resets_at: resetsAt,
              usage,
            }),
          };
        }
        return {
          text: `Rate limit exceeded for ${toolName}.${retryAfterSeconds !== undefined ? ` Retry after ${retryAfterSeconds} seconds.` : ''}`,
          json: JSON.stringify({
            error_code: 'RATE_LIMIT_EXCEEDED',
            retryable: retryable ?? true,
            retry_after_seconds: retryAfterSeconds,
          }),
        };
      }
      case 500:
      case 502:
      case 503:
        return {
          text: `OMOPHub API is temporarily unavailable (${error.status}). Please try again in a moment.`,
          json: JSON.stringify({ error_code: 'SERVER_ERROR' }),
        };
      default:
        return {
          text: `API error (${error.status}). Please try again or contact support if this persists.`,
          json: JSON.stringify({
            error_code: 'UNKNOWN_ERROR',
            status: error.status,
          }),
        };
    }
  }

  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.message.includes('timed out')) {
      return {
        text: `OMOPHub API request timed out for ${toolName}. The server may be slow — please try again.`,
        json: JSON.stringify({ error_code: 'TIMEOUT_ERROR' }),
      };
    }
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
      return {
        text: `Cannot connect to OMOPHub API. Check your internet connection and that OMOPHUB_BASE_URL is correct.`,
        json: JSON.stringify({ error_code: 'CONNECTION_ERROR' }),
      };
    }
    return {
      text: `${toolName} failed unexpectedly. Please try again.`,
      json: JSON.stringify({ error_code: 'UNKNOWN_ERROR' }),
    };
  }

  return {
    text: `${toolName} failed with an unexpected error.`,
    json: JSON.stringify({ error_code: 'UNKNOWN_ERROR' }),
  };
}
