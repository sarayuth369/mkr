// Web UI for the guarded historical import. Uses the already-logged-in session (HttpOnly cookie), so no password is typed anywhere else.
// The chosen normalized.json is read locally in the browser; it is only sent to this site's own /api/admin/import.
import { api } from './api.js';
import { runImport, validateNormalized } from './importer.js';

const $ = (id) => document.getElementById(id);
let data = null, running = false, onDone = () => {};

function line(name, ok, detail) {
  const li = document.createElement('li');
  li.className = ok ? 'pass' : 'fail';
  li.textContent = `${name}${detail ? ` — ${detail}` : ''}`; // textContent only
  $('im-log').append(li);
  li.scrollIntoView({ block: 'nearest' });
  return ok;
}

export function initImportUi(done) {
  onDone = done;
  $('btn-import').addEventListener('click', () => {
    data = null; running = false;
    $('im-file').value = ''; $('im-log').replaceChildren(); $('im-run').disabled = true; $('im-run').textContent = 'ตรวจสอบและนำเข้า';
    for (const id of ['im-summary', 'im-error', 'im-status']) { $(id).hidden = true; $(id).className = id === 'im-status' ? 'im-status' : $(id).className; }
    $('import-dialog').showModal();
  });
  $('im-close').addEventListener('click', () => { if (!running) $('import-dialog').close(); });
  $('import-dialog').addEventListener('cancel', (ev) => { if (running) ev.preventDefault(); });

  $('im-file').addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0]; data = null; $('im-run').disabled = true; $('im-error').hidden = true; $('im-summary').hidden = true;
    if (!f) return;
    try {
      if (f.size > 8 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกินไป');
      const parsed = JSON.parse(await f.text());
      const bad = validateNormalized(parsed);
      if (bad) throw new Error(bad);
      data = parsed;
      const rows = parsed.sheets.map((s) => `${s.key} ${s.rows.length}`).join(' · ');
      $('im-summary').textContent = `พร้อมนำเข้า: ${rows} แถว · review ${parsed.sheets.reduce((n, s) => n + s.review.length, 0)} · cashflow hints ${parsed.sheets.reduce((n, s) => n + s.cashflowReview.length, 0)}`;
      $('im-summary').hidden = false; $('im-run').disabled = false;
    } catch (e) { $('im-error').textContent = e.message || 'อ่านไฟล์ไม่ได้'; $('im-error').hidden = false; }
  });

  $('im-run').addEventListener('click', async () => {
    if (!data || running) return;
    if (!window.confirm('เริ่มนำเข้าจริงเข้า Google Sheets?\n\nระบบจะตรวจปลายทางก่อน ทดลอง 3 แถว (canary) แล้วจึงนำเข้าเต็ม และหยุดทันทีหากพบสิ่งผิดปกติ — รันซ้ำได้ปลอดภัย (ไม่เพิ่มแถวซ้ำ)')) return;
    running = true; $('im-run').disabled = true; $('im-run').textContent = 'กำลังทำงาน…'; $('im-log').replaceChildren(); $('im-status').hidden = true;
    let failed = 0;
    const check = (name, ok, detail = '') => { if (!ok) failed++; return line(name, ok, detail); };
    const fetchPage = async () => { const r = await fetch('/', { cache: 'no-store' }); return { status: r.status, csp: r.headers.get('content-security-policy') ?? '' }; };
    let out;
    try { out = await runImport({ sheets: data.sheets, api, check, fetchPage }); } catch (e) { out = { stoppedAt: 'error' }; check(`ข้อผิดพลาด: ${String(e.message).slice(0, 120)}`, false); }
    const status = out.stoppedAt ? 'BLOCKED' : failed === 0 ? 'PASS' : 'PARTIAL';
    const st = $('im-status'); st.hidden = false;
    st.className = `im-status ${status === 'PASS' ? 'is-pass' : 'is-fail'}`;
    st.textContent = status === 'PASS' ? 'สรุป: PASS — นำเข้าและตรวจสอบครบทุกขั้น (ปิดหน้าต่างนี้แล้ว Dashboard จะรีเฟรช)' : `สรุป: ${status}${out.stoppedAt ? ` — หยุดที่: ${out.stoppedAt}` : ''} (ล้มเหลว ${failed}) — ยังไม่ถือว่านำเข้าสำเร็จ`;
    running = false; $('im-run').textContent = 'รันอีกครั้ง (ปลอดภัย ไม่ซ้ำ)'; $('im-run').disabled = false;
    await onDone?.();
  });
}
