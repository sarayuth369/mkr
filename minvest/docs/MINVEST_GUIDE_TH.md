# minvest — คู่มือ Deploy และใช้งาน (ภาษาไทย)

minvest คือเว็บแอปบันทึกและวิเคราะห์ผลการลงทุนส่วนตัว (Dime / StashAway / Webull) เป็นโปรเจกต์ย่อยของ MKR
ข้อมูลทั้งหมดเก็บใน **Google Sheets ของคุณ** — ไม่มีฐานข้อมูลอื่น

## 1. ภาพรวมระบบ

```
เบราว์เซอร์ (HTML/CSS/JS + Chart.js)
      │  คุกกี้เซสชัน HttpOnly (ไม่มีรหัส/โทเคนใน JavaScript)
      ▼
Cloudflare Worker "minvest"   ← ตรวจสิทธิ์ · ตรวจ Origin(CSRF) · rate limit · validate ข้อมูล
      │  POST + shared secret (เก็บเป็น Worker secret เท่านั้น)
      ▼
Google Apps Script (Web App)  ← ตรวจ secret อีกชั้น · LockService · เขียน/อ่านชีต
      ▼
Google Sheets "minvestment"
```

- Worker ชื่อ `minvest` **แยกจาก** `mkr-backend`, `mkr-admin` และระบบอื่นทั้งหมด (ไม่แตะ DNS/route/secret ของ MKR เดิม)
- โค้ดอยู่ที่ `D:\FlutterProjects\mkr\minvest` — ห้ามเก็บข้อมูลการเงิน (Excel / `data/`) ลง Git (ถูก `.gitignore` ไว้แล้ว)

## 2. สิ่งที่คุณต้องทำเอง (Pending owner action)

ผมไม่มีสิทธิ์เข้าบัญชี Google ของคุณ และ `wrangler` บนเครื่องนี้ล็อกอินอยู่คนละบัญชีกับที่ MKR ใช้ จึงต้องทำ 3 ส่วนนี้เอง:

| # | งาน | ผลที่ได้ |
|---|---|---|
| A | เตรียม Google Sheet + Apps Script | URL `/exec` + Spreadsheet ID |
| B | ตั้ง secret และ deploy Worker บัญชี Cloudflare ของ MKR | URL ของเว็บ |
| C | นำเข้า Excel (`value infox.xlsx`) | ข้อมูลย้อนหลังใน 3 ชีต |

> ห้ามส่งรหัสผ่าน / secret มาในแชต — ตั้งค่าด้วยตัวเองตามขั้นตอนด้านล่าง

## 3. ขั้นตอน A — Google Sheets + Apps Script

1. เปิดบัญชี `sarayuth939@gmail.com` → เปิดสเปรดชีต **minvestment** → คัดลอก **Spreadsheet ID** จาก URL
   (`https://docs.google.com/spreadsheets/d/<ID>/edit`)
2. ในสเปรดชีตเลือก **ส่วนขยาย → Apps Script** (ได้สคริปต์ที่ผูกกับชีตนี้)
3. วางไฟล์:
   - ลบโค้ดเดิมใน `Code.gs` แล้ววางเนื้อหาจาก `minvest/apps-script/Code.gs`
   - **การตั้งค่าโปรเจกต์ → ติ๊ก “แสดงไฟล์ manifest appsscript.json”** แล้ววางเนื้อหาจาก `minvest/apps-script/appsscript.json`
4. **การตั้งค่าโปรเจกต์ → คุณสมบัติของสคริปต์ (Script properties)** เพิ่ม 2 ค่า:
   - `SPREADSHEET_ID` = ID จากข้อ 1
   - `MINVEST_SCRIPT_SECRET` = สตริงสุ่มยาว ๆ สร้างด้วยคำสั่ง
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
     ```
     (เก็บค่านี้ไว้ — ต้องใช้ตั้งใน Cloudflare ด้วย **ค่าเดียวกัน**)
5. **ทำให้ใช้งานได้ → การทำให้ใช้งานได้รายการใหม่ → ประเภท “เว็บแอป”**
   - ดำเนินการในฐานะ: **ฉัน (เจ้าของ)** · ผู้มีสิทธิ์เข้าถึง: **ทุกคน**
   - อนุญาตสิทธิ์ Google Sheets เมื่อระบบถาม
   - คัดลอก **URL เว็บแอป** (ลงท้าย `/exec`)

   > “ทุกคน” ไม่ได้แปลว่าเปิดสาธารณะจริง: ทุกคำขอต้องมี `MINVEST_SCRIPT_SECRET` ที่ถูกต้อง มิฉะนั้นสคริปต์ปฏิเสธและไม่เปิดเผยข้อมูล
   > (เปิด URL ด้วยเบราว์เซอร์จะเห็นแค่ `{"ok":true,"service":"minvest"}`)
6. ระบบสร้างชีตและหัวคอลัมน์ให้อัตโนมัติ (idempotent) ตอนรันขั้นตอน C ด้วย `--push` — สร้าง `Daily_Income`, `Historical_Dime`, `Historical_StashAway`,
   `Historical_Webull`, `Cashflows`, `Cashflow_Review`, `Import_Review`, `Dashboard_Data`, `Settings` และตั้งเขตเวลาเป็น **Asia/Bangkok**
   โดย **ไม่ลบ/ไม่เขียนทับ** ข้อมูลหรือหัวคอลัมน์ที่มีอยู่ (ตัวนำเข้าจะตรวจก่อนว่าสเปรดชีตที่เชื่อมอยู่ชื่อ `minvestment` ไม่ใช่ก็หยุด)

คอลัมน์ `Daily_Income` (A–D ตามที่กำหนด): **A** วันที่บันทึก (`dd/MM/yyyy H:mm` อัตโนมัติ) · **B** Dime THB · **C** StashAway THB · **D** Webull USD
ตามด้วยคอลัมน์ข้อมูลกำกับ E–L (หมายเหตุ, entry_id, ชนิดข้อมูล, updated_at, request_id, status, revision, วันที่ของรายการ)

## 4. ขั้นตอน B — Cloudflare (บัญชีเดียวกับ MKR)

1. ตรวจว่าล็อกอิน **บัญชีของ MKR** (ที่โฮสต์ `mkr-backend`; workers.dev subdomain คือ `biz2success`):
   ```bash
   cd D:\FlutterProjects\mkr\minvest
   npx wrangler whoami
   ```
   ถ้าไม่ใช่บัญชี MKR ให้ `npx wrangler login` ด้วยบัญชีที่ถูกต้องก่อน
   (ตอนทดลอง wrangler ล็อกอินอยู่บัญชี `bkknex369` ซึ่งไม่ใช่ของ MKR — ผมจึงลบ Worker ทดลองออกแล้ว ไม่ได้ทิ้งไว้)
2. ตั้ง secret 4 ตัว (พิมพ์ค่าเมื่อระบบถาม — ไม่ใส่ในไฟล์/Git):
   ```bash
   npx wrangler secret put MINVEST_PASSWORD         # รหัสผ่านที่คุณจะใช้เข้าเว็บ (ยาว/เดายาก)
   npx wrangler secret put MINVEST_SESSION_SECRET   # สตริงสุ่มยาว (สร้างด้วยคำสั่ง node ข้างบน)
   npx wrangler secret put MINVEST_SCRIPT_URL       # URL /exec จากขั้นตอน A ข้อ 5
   npx wrangler secret put MINVEST_SCRIPT_SECRET    # ค่าเดียวกับ Script property MINVEST_SCRIPT_SECRET
   ```
3. Build + Deploy:
   ```bash
   npm install
   npm run build        # คัดลอก Chart.js + typecheck
   npm test             # ควรผ่านทั้งหมด
   npm run deploy
   ```
4. URL ที่ได้ควรเป็น `https://minvest.biz2success.workers.dev` (ถ้า subdomain ต่างจากนี้ แปลว่าอยู่คนละบัญชี — ตรวจข้อ 1)
5. ตรวจ: เปิดเว็บ → ต้องเห็นหน้าเข้าสู่ระบบ → ใส่รหัสผ่าน → ดู Dashboard
   ถ้าเห็นข้อความ “ระบบยังไม่ได้ตั้งค่า” แปลว่า secret ยังไม่ครบ 4 ตัว

โดเมนที่ใช้งานจริงตอนนี้คือ `workers.dev` (ไม่มีโซน Cloudflare/โดเมนที่ผมยืนยันได้) — หากต้องการ `minvest.<โดเมนของคุณ>` ให้เพิ่ม
Custom Domain ใน Cloudflare Dashboard (Workers → minvest → Settings → Domains) โดยไม่ต้องแก้โค้ด

### 4b. ตรวจสอบหลัง deploy (รันเองในเทอร์มินัล — รหัสผ่านไม่ถูกแสดง/เก็บ)

`wrangler.toml` ปักหมุด `account_id` ของ MKR ไว้แล้ว (ไม่ใช่ความลับ) — ถ้า wrangler ล็อกอินบัญชีอื่น จะ error แทนการ deploy ผิดบัญชี

```bash
cd D:FlutterProjectsmkrminvest
node tools/live-smoke.mjs https://minvest.biz2success.workers.dev
```

สคริปต์จะถามรหัสผ่านแบบซ่อน แล้วทดสอบ: health, header ความปลอดภัย, login ผิด/ถูก, การปฏิเสธผู้ไม่มีสิทธิ์, Apps Script ตอบและ secret ตรงกัน,
ชื่อสเปรดชีต = `minvestment`, setup, อ่าน Dashboard, เขียนรายการทดสอบ 1 แถว (0.01, หมายเหตุ `[minvest-smoke-test …]`) → ส่งซ้ำไม่ซ้ำแถว → แก้ไข →
revision เก่าถูกปฏิเสธ → **void** (แถวยังอยู่ในชีตเป็น `void` ไม่นับใน KPI — ลบทิ้งเองได้) ไม่เขียนมูลค่าพอร์ต/เงินฝาก (เพราะย้อนไม่ได้)

**ห้ามนำเข้า Excel จนกว่าสรุปจะเป็น “ผ่านทั้งหมด”**

## 5. ขั้นตอน C — นำเข้า Excel ย้อนหลัง

ไฟล์: `C:\Users\lsara\Desktop\value infox.xlsx` (ชีต `Dime24`, `StashAway`, `WeBull`)

```bash
cd D:\FlutterProjects\mkr\minvest
# 1) ทดลองก่อน (ไม่ส่งข้อมูลไปไหน) - ได้รายงานสรุปแถว/การตรวจสอบ
node tools/import-excel.mjs --file "C:\Users\lsara\Desktop\value infox.xlsx"

# 2) นำเข้าจริง (รหัสผ่านอ่านจาก environment ไม่ถูกเก็บ/พิมพ์)
$env:MINVEST_URL = "https://minvest.biz2success.workers.dev"
$env:MINVEST_PASSWORD = "<รหัสผ่านที่ตั้งไว้>"
node tools/import-excel.mjs --file "C:\Users\lsara\Desktop\value infox.xlsx" --push
```

- รันซ้ำได้ปลอดภัย: รอบสอง `inserted` เป็น 0 (กันซ้ำด้วย `import_key`)
- ผลที่ตรวจแล้วกับไฟล์จริง: Dime 606 แถววันที่ · StashAway 366 · Webull 297 (รวม 1,269) + หัวเดือน 60 แถวเก็บไว้ใน `Import_Review`
- ทุกแถวถูกเก็บ **ค่าต้นฉบับ (raw)** ไว้เสมอ ไม่มีการปัดเศษ/แก้ตัวเลขเอง

### สิ่งที่พบในข้อมูล Excel (ต้องรู้)

1. **ตัวเลขใน Excel คือ “มูลค่าพอร์ต” ไม่ใช่รายได้/กำไร** และมีเงินฝาก/ถอน/ซื้อขายปนอยู่ในหมายเหตุ
   → ระบบไม่คำนวณกำไรจากส่วนต่างมูลค่า (กำไรมาจากสิ่งที่คุณบันทึกเอง หรือผลตอบแทนปรับเงินฝากเมื่อยืนยันเงินฝากแล้ว)
2. **ตัวเลขผิดรูปแบบ 2 แถวใน Dime**: แถววันที่ 9/3/2026 (รูปแบบ `xxxxxx..xx`) และ 21/5/2026 (รูปแบบ `xxx.xxx.xx`) — เก็บค่าดิบไว้, ติดธง `value_unparsed`,
   **ไม่ใช้ในกราฟ** และเสนอค่าที่น่าจะเป็นใน `Import_Review` ให้คุณแก้เองในชีต
3. **แถวถอนเงินวันที่ 4/7/2024**: ค่าในแถวนั้นคือจำนวนที่ถอน ไม่ใช่มูลค่า → ติดธง `event_amount` ไม่เข้ากราฟ
4. **วันที่ซ้ำ 3 วัน** ใน Dime: ใช้แถวสุดท้ายของวันเป็นมูลค่าปิด แถวก่อนหน้าเป็น `superseded` (ยังเก็บไว้)
5. **คอลัมน์ ราคา(USD) ของ Dime** เป็นจำนวนธุรกรรม ไม่ใช่มูลค่าพอร์ต → ไม่นำไปใช้
6. **ทศนิยมเกิน 2 ตำแหน่ง 5 ค่า** (เช่น ค่าที่มีทศนิยม 3 ตำแหน่ง) — เก็บเท่าเดิม ติดธงเพื่อตรวจ
7. **ข้อความฝาก/ถอน/ปันผลในหมายเหตุ** ถูกดึงไปไว้ชีต `Cashflow_Review` (26 รายการ) เป็น “ข้อเสนอ” สถานะ `pending_owner_confirmation`
   — ไม่ถูกนับเป็นเงินฝากจริงจนกว่าคุณจะบันทึกในฟอร์ม “เงินฝาก/ถอน/ปันผล”

## 6. การใช้งานประจำวัน

| ปุ่ม | ใช้ทำอะไร |
|---|---|
| **+ บันทึกข้อมูลวันนี้** | กรอกกำไร/ขาดทุน หรือเงินสดรับจริง ของแต่ละบัญชี (**ต้องเลือกประเภทก่อน**; เว้นว่าง ≠ 0; ใส่ − สำหรับขาดทุน) → หน้าสรุป → ยืนยัน |
| **อัปเดตมูลค่าพอร์ต** | บันทึกยอดรวมพอร์ตล่าสุด (แยกจากรายได้ — เขียนต่อท้ายชีต Historical_*) |
| **เงินฝาก/ถอน/ปันผล** | บันทึกเงินที่เติม/ถอนจริง (ใช้คำนวณผลตอบแทนปรับเงินฝาก) |
| **ตั้งค่า** | เป้าหมายพอร์ต, อัตรา USD/THB (ถ้าอยากเห็นยอดรวมเป็นบาท — ระบบไม่เดาให้), “ยืนยันเงินฝากครบถึงวันที่”, จำนวนวันย้อนหลังสำหรับแนวโน้ม |

- ใช้ปุ่มซ้ำ/เน็ตสะดุดได้: ทุกฟอร์มมี `requestId` ป้องกันการบันทึกซ้ำ (กดยืนยันหลายครั้ง = 1 รายการ)
- แก้ไข/ยกเลิกรายการ: ตาราง “บันทึกรายวัน” มีปุ่ม แก้ไข / ยกเลิก (ยกเลิก = ทำเครื่องหมาย void เก็บประวัติ ไม่ลบแถว)
  ถ้ามีคนแก้พร้อมกัน ระบบจะแจ้ง “ถูกแก้ไขจากที่อื่นแล้ว” แทนการเขียนทับ
- **กราฟมูลค่าพอร์ต** รวมเงินฝาก/ถอนอยู่ด้วย จึงไม่ใช่กำไร; THB และ USD แยกกราฟเสมอ
- **ผลตอบแทนปรับเงินฝาก** (Modified Dietz) จะแสดงก็ต่อเมื่อคุณตั้ง “ยืนยันเงินฝากครบถึงวันที่” และเงินฝากอยู่สกุลเดียวกับพอร์ต
- **การคาดการณ์** เป็นค่าประมาณทางสถิติ แสดงสมมติฐานและช่วงความไม่แน่นอนเสมอ และจะบอก “ข้อมูลยังไม่เพียงพอ” แทนการสร้างตัวเลข

## 7. ความปลอดภัย

- เข้าถึงได้ด้วยรหัสผ่านเดียวของคุณ → คุกกี้ HttpOnly + SameSite=Strict (+ Secure บน HTTPS) อายุ 12 ชม.
- ทุก endpoint ตรวจสิทธิ์; เขียนข้อมูลต้องมี Origin ตรงกับเว็บ (กัน CSRF); จำกัดอัตรา (login 5 ครั้ง/นาที, API 120 ครั้ง/นาที)
- ตรวจข้อมูลทั้งที่ Worker และ Apps Script; ป้องกัน formula injection (`=`, `+`, `-`, `@` นำหน้าข้อความ)
- ไม่มี secret ใน JavaScript/Git/log; ข้อความผิดพลาดจากฝั่ง Google ไม่ถูกส่งกลับเบราว์เซอร์
- ไม่มี public cache ของข้อมูลการเงิน (`Cache-Control: private, no-store`) และมี CSP เข้มงวด
- หมุนรหัส: ตั้ง `MINVEST_PASSWORD`/`MINVEST_SESSION_SECRET` ใหม่ด้วย `wrangler secret put` (เซสชันเก่าใช้ไม่ได้ทันทีเมื่อเปลี่ยน session secret)

## 8. แก้ปัญหาเบื้องต้น

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| “ระบบยังไม่ได้ตั้งค่า” | ตั้ง secret ไม่ครบ 4 ตัว (ข้อ 4.2) |
| 502 `UPSTREAM_AUTH` | `MINVEST_SCRIPT_SECRET` ใน Cloudflare ไม่ตรงกับ Script property |
| 503 `NOT_CONFIGURED` + “URL ไม่ถูกต้อง” | `MINVEST_SCRIPT_URL` ต้องเป็น `https://script.google.com/macros/s/…/exec` |
| 504 | Apps Script ช้า/ล่ม — ลองใหม่ (การบันทึกซ้ำปลอดภัย) |
| “ระบบกำลังบันทึกข้อมูลอื่นอยู่” | มีการเขียนพร้อมกัน — รอสักครู่แล้วลองใหม่ |
| หลังแก้ `Code.gs` ไม่เห็นผล | ต้อง “จัดการการทำให้ใช้งานได้ → แก้ไข → เวอร์ชันใหม่” (URL เดิมใช้ต่อได้) |

## 9. การทดสอบ (สำหรับนักพัฒนา)

```bash
cd minvest
npm test            # normalize / Apps Script (mock) / Worker / analytics / ข้อมูล Excel จริง (ถ้ามีไฟล์)
npm run typecheck
npm run mock        # Apps Script จำลองในเครื่อง (ไม่ใช่ Google Sheets จริง)
npm run dev         # wrangler dev ที่ http://127.0.0.1:8788 (ต้องมี .dev.vars ในเครื่อง — ไม่ถูก commit)
```

`.dev.vars` สำหรับทดสอบในเครื่องเท่านั้น (ค่าตัวอย่าง + `MINVEST_ALLOW_LOCAL_SCRIPT=1` ที่อนุญาต URL loopback ของ mock)
**ห้ามตั้งตัวแปรนี้บน Worker จริง**
