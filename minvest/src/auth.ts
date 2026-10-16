// Owner authentication: single password -> HMAC-signed, HttpOnly, SameSite=Strict session cookie.
// No secret ever reaches browser JavaScript; the cookie value is opaque and unforgeable without the session secret.

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmacKey(secret: string, usage: Array<'sign' | 'verify'>) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

/** Constant-time string comparison: HMACs both sides with the session secret, then XOR-compares fixed-length digests. */
export async function safeEqual(a: string, b: string, secret: string): Promise<boolean> {
  const key = await hmacKey(secret, ['sign']);
  const [da, db] = await Promise.all([crypto.subtle.sign('HMAC', key, enc.encode(a)), crypto.subtle.sign('HMAC', key, enc.encode(b))]);
  const x = new Uint8Array(da), y = new Uint8Array(db);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ (y[i] ?? 0);
  return diff === 0;
}

export async function createSessionToken(secret: string, ttlSeconds: number, now = Date.now()): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + ttlSeconds, n: b64url(crypto.getRandomValues(new Uint8Array(12))) })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySessionToken(secret: string, token: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!token || token.length > 512) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || token.split('.').length !== 2) return false;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, ['verify']), fromB64url(sig), enc.encode(payload));
    if (!ok) return false;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { exp?: number };
    return typeof data.exp === 'number' && data.exp * 1000 > now;
  } catch { return false; }
}

export function cookieName(isHttps: boolean) { return isHttps ? '__Host-minvest_session' : 'minvest_session'; }

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(name: string, token: string, maxAge: number, isHttps: boolean) {
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps ? '; Secure' : ''}`;
}
