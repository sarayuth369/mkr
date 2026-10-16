// Writes the two tiny bundled pages (loading + offline error) for the configured target URL. They contain no data and no secrets.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.env.CAP_TEST_URL || 'https://minvest.biz2success.workers.dev/';
const logo = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M262 372 L408 652 L494 548" stroke="#fff" stroke-width="86"/><path d="M408 652 L560 468 L640 548 L778 372" stroke="#52e0b0" stroke-width="62"/><path d="M690 366 L790 360 L784 462" stroke="#52e0b0" stroke-width="54"/></g></svg>`).toString('base64');

const shell = (title, body, script) => `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<style>
html,body{margin:0;height:100%;background:#0a3a2c;color:#e4ece7;font-family:system-ui,-apple-system,"Noto Sans Thai",sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center}
img{width:96px;height:96px}h1{font-size:1.25rem;margin:4px 0 0}p{margin:0;color:#b7c9bf;max-width:30ch;line-height:1.5}
button{margin-top:8px;border:0;border-radius:12px;background:#4fb399;color:#0c1612;font-size:1rem;font-weight:700;padding:12px 28px;min-height:46px}
.spin{width:28px;height:28px;border:3px solid #2b5a4a;border-top-color:#52e0b0;border-radius:50%;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
</style></head><body><main>${body}</main><script>${script}</script></body></html>
`;

mkdirSync(join(root, 'www'), { recursive: true });
// index.html: only shown for a split second if the app ever falls back to the bundled assets; it forwards to production.
writeFileSync(join(root, 'www', 'index.html'), shell('MInvest', `<img src="${logo}" alt=""><h1>MInvest</h1><div class="spin" role="progressbar" aria-label="กำลังเปิด"></div><p>กำลังเปิดระบบลงทุนของคุณ…</p>`, `location.replace(${JSON.stringify(target)});`));
writeFileSync(join(root, 'www', 'error.html'), shell('เชื่อมต่อไม่ได้', `<img src="${logo}" alt=""><h1>เชื่อมต่อ MInvest ไม่ได้</h1><p>ตรวจสอบอินเทอร์เน็ตของคุณ แล้วลองใหม่อีกครั้ง ข้อมูลของคุณไม่ได้ถูกแก้ไข</p><button type="button" id="retry">ลองใหม่</button>`, `document.getElementById('retry').addEventListener('click',function(){location.href=${JSON.stringify(target)};});window.addEventListener('online',function(){location.href=${JSON.stringify(target)};});`));
console.log('www prepared for', target);
