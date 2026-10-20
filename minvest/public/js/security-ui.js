// Settings -> ความปลอดภัย / เปลี่ยนรหัสผ่าน. Passwords live only in these <input>s and the HTTPS request body;
// they are never stored, logged, or put in a URL. The server is the authority on policy and verification.
import { post, ApiError } from './api.js';
import { checkPassword } from './password-policy.js';

const $ = (id) => document.getElementById(id);
let busy = false;
let session = { passwordSource: 'env', passwordChangeAvailable: false };

function showError(msg) { const e = $('sec-error'); e.textContent = msg ?? ''; e.hidden = !msg; }

function renderStrength() {
  const pw = $('sec-new').value, r = checkPassword(pw), ul = $('sec-strength-text');
  while (ul.firstChild) ul.removeChild(ul.firstChild);
  const bar = $('sec-bar');
  bar.style.width = pw ? `${Math.max(1, r.score) * 25}%` : '0%';
  bar.dataset.level = r.ok ? (r.score >= 4 ? 'strong' : 'good') : 'weak';
  if (!pw) return;
  if (r.ok) { const li = document.createElement('li'); li.className = 'ok'; li.textContent = r.score >= 4 ? 'รหัสผ่านแข็งแรง' : 'ผ่านเกณฑ์ขั้นต่ำ'; ul.append(li); }
  else for (const reason of r.reasons) { const li = document.createElement('li'); li.textContent = reason; ul.append(li); }
}

function resetForm() {
  for (const id of ['sec-current', 'sec-new', 'sec-confirm']) { const i = $(id); i.value = ''; i.type = 'password'; }
  for (const b of document.querySelectorAll('.pw-toggle')) { b.textContent = 'แสดง'; b.setAttribute('aria-pressed', 'false'); }
  renderStrength(); showError(null);
}

export function openSecurity(sess, toast) {
  session = sess ?? session;
  resetForm();
  $('sec-source').textContent = !session.passwordChangeAvailable
    ? 'ยังไม่ได้เปิดใช้ที่เก็บรหัสผ่านถาวร (Durable Object) บน Worker — เปลี่ยนรหัสผ่านจากหน้าเว็บไม่ได้ในตอนนี้'
    : session.passwordSource === 'stored'
      ? 'รหัสผ่านปัจจุบันเก็บแบบแฮชถาวรไว้แล้ว (ไม่ต้องแก้ Cloudflare secret อีก)'
      : 'ตอนนี้ยังใช้รหัสผ่านจาก Cloudflare secret เดิม — เมื่อเปลี่ยนครั้งแรก ระบบจะย้ายมาเก็บแบบแฮชถาวรให้อัตโนมัติ';
  $('sec-submit').disabled = !session.passwordChangeAvailable;
  $('security-dialog').showModal();
  setTimeout(() => $('sec-current').focus(), 30);
  openSecurity.toast = toast;
}

export function initSecurityUi({ onChanged }) {
  $('sec-close').addEventListener('click', () => $('security-dialog').close());
  $('security-dialog').addEventListener('close', resetForm); // Esc / ✕ / success: password fields never linger in the DOM
  $('sec-new').addEventListener('input', renderStrength);
  for (const b of document.querySelectorAll('.pw-toggle')) {
    b.addEventListener('click', () => {
      const input = $(b.dataset.target), show = input.type === 'password';
      input.type = show ? 'text' : 'password'; b.textContent = show ? 'ซ่อน' : 'แสดง'; b.setAttribute('aria-pressed', String(show));
    });
  }
  $('sec-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return; // no double submit
    const current = $('sec-current').value, next = $('sec-new').value, confirm = $('sec-confirm').value;
    if (!current) return showError('กรุณากรอกรหัสผ่านปัจจุบัน');
    const policy = checkPassword(next);
    if (!policy.ok) return showError(`รหัสผ่านใหม่ยังไม่ปลอดภัยพอ: ${policy.reasons.join(' / ')}`);
    if (next !== confirm) return showError('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
    if (next === current) return showError('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
    busy = true; $('sec-submit').disabled = true; showError(null);
    try {
      await post('/api/password/change', { current, next, confirm });
      resetForm(); $('security-dialog').close();
      openSecurity.toast?.('เปลี่ยนรหัสผ่านสำเร็จ — อุปกรณ์อื่นถูกออกจากระบบแล้ว');
      onChanged?.();
    } catch (e) {
      const a = e instanceof ApiError ? e.details?.attempts : null;
      showError(e instanceof ApiError ? e.message + (a && e.code === 'INVALID_CURRENT' ? ` — ผิดแล้ว ${a.used}/${a.max} ครั้ง` : '') : 'เปลี่ยนรหัสผ่านไม่สำเร็จ'); // generic: never echoes input
    } finally { busy = false; $('sec-submit').disabled = !session.passwordChangeAvailable; }
  });
}
