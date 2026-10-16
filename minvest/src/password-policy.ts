// Password policy for changing the owner's password. Mirrored (kept identical, parity-tested) in public/js/password-policy.js
// so the UI can show strength live; the SERVER is the authority and always re-checks.
export interface PolicyResult { ok: boolean; reasons: string[]; score: number }

const BANNED = ['password', 'passw0rd', 'minvest', 'qwerty', '123456', 'abcdef', 'letmein', 'admin', 'welcome', 'iloveyou'];

export function checkPassword(pw: string): PolicyResult {
  const reasons: string[] = [];
  const s = typeof pw === 'string' ? pw : '';
  if (s.length < 12) reasons.push('ต้องยาวอย่างน้อย 12 ตัวอักษร');
  if (s.length > 128) reasons.push('ยาวเกิน 128 ตัวอักษร');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(s)).length;
  if (classes < 3 && s.length < 20) reasons.push('ใช้อักษรให้หลากหลาย (ตัวพิมพ์เล็ก/ใหญ่/ตัวเลข/สัญลักษณ์ อย่างน้อย 3 กลุ่ม) หรือใช้วลียาว ≥ 20 ตัว');
  const lower = s.toLowerCase();
  if (BANNED.some((w) => lower.includes(w))) reasons.push('มีคำที่เดาง่าย (เช่น password, minvest, qwerty, 123456)');
  if (/^(.)\1+$/.test(s) || /^(.{1,3})\1{3,}$/.test(s)) reasons.push('เป็นรูปแบบซ้ำ ๆ');
  let score = 0;
  if (s.length >= 12) score++;
  if (s.length >= 16) score++;
  if (classes >= 3) score++;
  if (s.length >= 20 || classes === 4) score++;
  if (reasons.length) score = Math.min(score, 1);
  return { ok: reasons.length === 0, reasons, score };
}
