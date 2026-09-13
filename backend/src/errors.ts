export type ErrorCode =
  | 'INVALID_SYMBOL'
  | 'INVALID_INTERVAL'
  | 'INVALID_PARAMETER'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMIT'
  | 'MARKET_DATA_STALE'
  | 'MARKET_CLOSED'
  | 'AUTH_REQUIRED'
  | 'ADMIN_FORBIDDEN'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_SYMBOL: 400,
  INVALID_INTERVAL: 400,
  INVALID_PARAMETER: 400,
  PROVIDER_UNAVAILABLE: 502,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_RATE_LIMIT: 429,
  MARKET_DATA_STALE: 200, // not an error - a status the caller can act on
  MARKET_CLOSED: 200,
  AUTH_REQUIRED: 401,
  ADMIN_FORBIDDEN: 403,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get httpStatus(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export interface ErrorBody {
  success: false;
  error: { code: ErrorCode; message: string };
}

/**
 * Normalized MKR API error envelope. Never forwards a raw provider error
 * message verbatim - callers pass an already-sanitized `message`, and
 * nothing here ever includes provider response bodies, headers, or secrets.
 */
export function errorResponse(err: ApiError, headers: HeadersInit = {}): Response {
  const body: ErrorBody = { success: false, error: { code: err.code, message: err.message } };
  return new Response(JSON.stringify(body), {
    status: err.httpStatus,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function jsonResponse<T>(data: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}
