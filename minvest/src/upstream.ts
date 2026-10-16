// Worker -> Google Apps Script web app. The script URL and shared secret live ONLY in Worker secrets.
import { HttpError, type Env } from './types';

const STATUS: Record<string, number> = { VALIDATION: 400, CONFLICT: 409, NOT_FOUND: 404, BUSY: 503 };

export function isConfigured(env: Env): boolean {
  return Boolean(env.MINVEST_PASSWORD && env.MINVEST_SESSION_SECRET && env.MINVEST_SCRIPT_URL && env.MINVEST_SCRIPT_SECRET);
}

export async function callScript<T = unknown>(env: Env, action: string, payload: unknown = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const url = env.MINVEST_SCRIPT_URL;
  if (!url || !env.MINVEST_SCRIPT_SECRET) throw new HttpError(503, 'NOT_CONFIGURED', 'ระบบยังไม่ได้ตั้งค่าการเชื่อมต่อ Google Sheets');
  // Guard against a mistyped/abused URL secret turning this into a generic proxy (SSRF).
  // The loopback exception exists ONLY for local UI testing against tools/mock-upstream.mjs and requires a flag
  // that lives in the git-ignored .dev.vars file - it is never set on the deployed Worker.
  const googleOk = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url);
  const localOk = env.MINVEST_ALLOW_LOCAL_SCRIPT === '1' && /^http:\/\/127\.0\.0\.1:\d{2,5}\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url);
  if (!googleOk && !localOk) throw new HttpError(503, 'NOT_CONFIGURED', 'MINVEST_SCRIPT_URL ไม่ถูกต้อง');
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(25000),
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: env.MINVEST_SCRIPT_SECRET, action, payload }),
    });
  } catch {
    throw new HttpError(504, 'UPSTREAM_TIMEOUT', 'เชื่อมต่อ Google Sheets ไม่สำเร็จหรือใช้เวลานานเกินไป');
  }
  let json: { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null = null;
  try { json = await res.json(); } catch { /* handled below */ }
  if (!res.ok || !json || typeof json !== 'object') throw new HttpError(502, 'UPSTREAM_BAD_RESPONSE', 'Google Sheets ตอบกลับผิดรูปแบบ');
  if (json.ok === true) return json.data as T;
  const code = json.error?.code ?? 'INTERNAL';
  const status = STATUS[code];
  if (status) throw new HttpError(status, code, String(json.error?.message ?? 'error'));
  // Upstream internals (incl. UNAUTHORIZED) are never echoed to the browser.
  throw new HttpError(502, code === 'UNAUTHORIZED' ? 'UPSTREAM_AUTH' : 'UPSTREAM_ERROR', 'บริการ Google Sheets ขัดข้อง');
}
