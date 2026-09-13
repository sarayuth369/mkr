/** Public market-data API: consumed by the Flutter app, not a browser origin to restrict. */
export function publicCorsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/**
 * Admin API/Web: restricted to the configured Admin Web origin (or same-
 * origin if unset) - never `*`, since these endpoints are authenticated and
 * mutate configuration.
 */
export function adminCorsHeaders(origin: string | null, allowedOrigin: string): HeadersInit {
  const headers: HeadersInit = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
  if (origin && (origin === allowedOrigin || allowedOrigin === '*')) {
    (headers as Record<string, string>)['Access-Control-Allow-Origin'] = origin;
    (headers as Record<string, string>)['Vary'] = 'Origin';
  }
  return headers;
}
