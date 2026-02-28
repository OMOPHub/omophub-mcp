export class OmopHubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = 'OmopHubApiError';
  }
}

const UPGRADE_URL = 'https://omophub.com/dashboard/billing';
const API_KEYS_URL = 'https://omophub.com/dashboard/api-keys';

export function formatErrorForMcp(
  error: unknown,
  toolName: string,
): { text: string; json: string } {
  if (error instanceof OmopHubApiError) {
    switch (error.status) {
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
          text:
            `Access denied for ${toolName}. ` +
            'Your API key may not have permission for this endpoint. ' +
            `Check your plan at: ${UPGRADE_URL}`,
          json: JSON.stringify({
            error_code: 'ACCESS_DENIED',
            upgrade_url: UPGRADE_URL,
          }),
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
      case 429:
        return {
          text:
            `Rate limit exceeded for ${toolName}. ` +
            `Wait a moment and try again, or upgrade your plan at: ${UPGRADE_URL}`,
          json: JSON.stringify({
            error_code: 'RATE_LIMIT_EXCEEDED',
            retry_after_seconds: 3600,
            upgrade_url: UPGRADE_URL,
          }),
        };
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
