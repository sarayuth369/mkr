# MInvest — แอป Android (Capacitor WebView)

แอปเปิดเว็บ MINVEST เดิม `https://minvest.biz2success.workers.dev/` แบบเต็มหน้าจอในแอป (ไม่เปิด Chrome)
ไม่มี Backend/ฐานข้อมูล/รหัสผ่านใหม่ — Login, Session, Google Sheets ทำงานผ่านเว็บเดิมทั้งหมด

| รายการ | ค่า |
|---|---|
| ชื่อแอป | MInvest |
| Package ID | `com.biz2success.minvest` |
| เวอร์ชัน | 1.0.0 (versionCode 1) |
| Android ขั้นต่ำ | 7.0 (API 24) · target 34 |
| ไฟล์ | `release\MInvest-1.0.0.apk` (ไม่ถูกเก็บใน Git) |

## ติดตั้งบนมือถือ
1. คัดลอก `MInvest-1.0.0.apk` ไปที่โทรศัพท์ (USB / Drive / LINE Keep ฯลฯ)
2. เปิดไฟล์ → ถ้า Android ถาม ให้อนุญาต “ติดตั้งแอปจากแหล่งที่ไม่รู้จัก” สำหรับแอปที่ใช้เปิดไฟล์ (ตั้งค่า → แอป → สิทธิ์พิเศษ → ติดตั้งแอปที่ไม่รู้จัก)
3. กด “ติดตั้ง” แล้วเปิดไอคอน MInvest → ล็อกอินด้วยรหัสผ่านเดิมของเว็บ

## อัปเดต
- ส่วนเว็บ (หน้าจอ/ฟังก์ชัน) อัปเดตเองทันทีเมื่อ deploy Worker — ไม่ต้องติดตั้งแอปใหม่
- เมื่อแก้ตัวแอป: เพิ่ม `versionCode`/`versionName` ใน `android/app/build.gradle` แล้ว build ใหม่ และติดตั้งทับ (ต้องเซ็นด้วยกุญแจเดียวกับของเดิม ไม่เช่นนั้นต้องถอนการติดตั้งก่อน)

## ตรวจ Version / Package
```
adb shell dumpsys package com.biz2success.minvest | findstr versionName
```
หรือ ตั้งค่า → แอป → MInvest → ข้อมูลแอป

## ข้อจำกัด
- ต้องมีอินเทอร์เน็ต (WebView เชื่อมเว็บออนไลน์) — ออฟไลน์จะแสดงหน้า “เชื่อมต่อ MInvest ไม่ได้” พร้อมปุ่มลองใหม่ ไม่มีข้อมูลจำลอง
- ลิงก์ไปเว็บอื่นถูกบล็อกในแอป (ไม่เปิดเบราว์เซอร์)
- ส่งออก CSV: บันทึกลงโฟลเดอร์ Downloads (Android 10+) หรือโฟลเดอร์ของแอป (Android 7–9)
- APK ที่ให้มาเซ็นด้วยกุญแจ debug ของเครื่องที่ build เหมาะกับติดตั้งใช้เอง/ทดสอบ — ถ้าจะแจกจ่ายจริงหรือขึ้น Play Store ให้สร้าง release keystore ของคุณเอง (เก็บรหัสนอก Git)

## สร้าง APK ใหม่ (Windows, JDK 17, Android SDK)
```
cd minvest-android
npm install
node tools/make-icons.mjs        # (ถ้าแก้ไอคอน)
node tools/prepare-www.mjs
npx cap sync android
cd android
gradlew.bat assembleRelease      # ใช้ JAVA_HOME เป็น JDK 17 และสร้าง android\local.properties (sdk.dir=...)
```
จากนั้น `zipalign` + `apksigner sign` ไฟล์ `app\build\outputs\apk\release\app-release-unsigned.apk` ด้วย keystore ของคุณ
(เพื่อทดสอบเท่านั้น: `~\.android\debug.keystore`)

ทดสอบกับเซิร์ฟเวอร์ในเครื่อง: ตั้ง `CAP_TEST_URL=http://10.0.2.2:8788/` ก่อน `prepare-www`/`cap sync` แล้ว build แบบ **debug** (อนุญาต cleartext เฉพาะ debug) — ห้ามใช้กับ APK ที่แจก
