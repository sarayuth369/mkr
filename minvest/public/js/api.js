// Thin same-origin API client. Credentials travel only in the HttpOnly session cookie - no tokens in JS.
export class ApiError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 'NETWORK', 0);
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (res.ok && json?.ok) return json.data;
  const code = json?.error?.code ?? 'HTTP';
  // Upstream (Apps Script) messages are English; show Thai for the cases a user can actually hit.
  const thai = { CONFLICT: 'รายการนี้ถูกแก้ไขหรือยกเลิกจากที่อื่นแล้ว — โหลดข้อมูลใหม่ให้แล้ว กรุณาตรวจสอบและลองอีกครั้ง', NOT_FOUND: 'ไม่พบรายการนี้ (อาจถูกลบในชีต) — โหลดข้อมูลใหม่แล้ว', BUSY: 'ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองอีกครั้งในไม่กี่วินาที' };
  const err = new ApiError(thai[code] ?? json?.error?.message ?? `เกิดข้อผิดพลาด (HTTP ${res.status})`, code, res.status);
  if (res.status === 401 && path !== '/api/login') window.dispatchEvent(new CustomEvent('minvest:unauthenticated'));
  throw err;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
