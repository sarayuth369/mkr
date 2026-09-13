// Talks to the MKR backend's /api/mkr/admin/* endpoints. The backend base
// URL is read from localStorage (set once via the small prompt in app.js)
// so this static site can point at a local `wrangler dev` server or the
// deployed Worker without a rebuild.

const BASE_URL_KEY = 'mkr_admin_backend_url';
const TOKEN_KEY = 'mkr_admin_token';

export function getBackendUrl() {
  return localStorage.getItem(BASE_URL_KEY) || '';
}

export function setBackendUrl(url) {
  localStorage.setItem(BASE_URL_KEY, url.replace(/\/$/, ''));
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn() {
  return !!getToken();
}

async function request(path, options = {}) {
  const base = getBackendUrl();
  if (!base) throw new Error('Backend URL is not configured.');

  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${base}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Invalid response' } }));

  if (!response.ok || body.success === false) {
    const message = body?.error?.message || `Request failed (${response.status})`;
    const error = new Error(message);
    error.code = body?.error?.code;
    error.status = response.status;
    throw error;
  }
  return body.data;
}

export async function login(password) {
  const data = await request('/api/mkr/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
  setToken(data.token);
  return data;
}

export const api = {
  dashboard: () => request('/api/mkr/admin/dashboard'),
  providersGet: () => request('/api/mkr/admin/providers'),
  providersUpdate: (patch) => request('/api/mkr/admin/providers', { method: 'POST', body: JSON.stringify(patch) }),
  symbolsGet: () => request('/api/mkr/admin/symbols'),
  symbolsUpdate: (patch) => request('/api/mkr/admin/symbols', { method: 'POST', body: JSON.stringify(patch) }),
  cacheGet: () => request('/api/mkr/admin/cache'),
  cacheUpdate: (patch) => request('/api/mkr/admin/cache', { method: 'POST', body: JSON.stringify(patch) }),
  rateLimitsGet: () => request('/api/mkr/admin/rate-limits'),
  rateLimitsUpdate: (patch) => request('/api/mkr/admin/rate-limits', { method: 'POST', body: JSON.stringify(patch) }),
  featuresGet: () => request('/api/mkr/admin/features'),
  featuresUpdate: (patch) => request('/api/mkr/admin/features', { method: 'POST', body: JSON.stringify(patch) }),
  health: () => request('/api/mkr/admin/health'),
  logs: (limit = 100) => request(`/api/mkr/admin/logs?limit=${limit}`),
  settings: () => request('/api/mkr/admin/settings'),
};
