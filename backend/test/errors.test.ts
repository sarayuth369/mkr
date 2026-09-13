import { describe, expect, it } from 'vitest';
import { ApiError, errorResponse, jsonResponse } from '../src/errors';

describe('ApiError / errorResponse', () => {
  it('maps each error code to a sensible HTTP status', async () => {
    expect(new ApiError('INVALID_SYMBOL', 'x').httpStatus).toBe(400);
    expect(new ApiError('PROVIDER_TIMEOUT', 'x').httpStatus).toBe(504);
    expect(new ApiError('PROVIDER_RATE_LIMIT', 'x').httpStatus).toBe(429);
    expect(new ApiError('AUTH_REQUIRED', 'x').httpStatus).toBe(401);
    expect(new ApiError('ADMIN_FORBIDDEN', 'x').httpStatus).toBe(403);
    expect(new ApiError('NOT_FOUND', 'x').httpStatus).toBe(404);
    expect(new ApiError('INTERNAL_ERROR', 'x').httpStatus).toBe(500);
  });

  it('produces a JSON body with the error code and message, nothing else', async () => {
    const response = errorResponse(new ApiError('INVALID_SYMBOL', 'bad symbol'));
    const body = await response.json();
    expect(body).toEqual({ success: false, error: { code: 'INVALID_SYMBOL', message: 'bad symbol' } });
    expect(response.status).toBe(400);
  });
});

describe('jsonResponse', () => {
  it('wraps data in a success envelope', async () => {
    const response = jsonResponse({ foo: 'bar' });
    const body = await response.json();
    expect(body).toEqual({ success: true, data: { foo: 'bar' } });
  });
});
