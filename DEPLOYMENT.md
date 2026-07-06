# Auto-deploy ขึ้น Google Apps Script

โปรเจกต์นี้ตั้ง **GitHub Actions** ให้ deploy โค้ดขึ้น Apps Script อัตโนมัติ
ทุกครั้งที่โค้ดเข้า default branch (`.github/workflows/deploy-appsscript.yml`)

> ทำตามขั้นตอนข้างล่าง **ครั้งเดียว** เพื่อใส่เครดิต หลังจากนั้นไม่ต้องทำมืออีกเลย —
> ทุก merge จะ `clasp push` ขึ้น Apps Script ให้เอง

---

## ตั้งค่าครั้งเดียว (ทำบนเครื่องคอมพิวเตอร์ของคุณ)

### 1. เปิดใช้ Apps Script API
เข้า https://script.google.com/home/usersettings → เปิด **Google Apps Script API** = **ON**

### 2. ติดตั้ง clasp แล้ว login
```bash
npm install -g @google/clasp@2.4.2
clasp login
```
- เลือกบัญชี Google ที่เป็น **เจ้าของโปรเจกต์ Apps Script**
- เสร็จแล้วจะได้ไฟล์เครดิตที่ `~/.clasprc.json`

### 3. หา Script ID
เปิดโปรเจกต์ Apps Script → ⚙️ **Project Settings** → คัดลอกค่า **Script ID**

### 4. (ถ้าต้องการให้ URL `/exec` เดิมไม่เปลี่ยน) หา Deployment ID
ในโปรเจกต์ Apps Script → **Deploy → Manage deployments** → คัดลอก **Deployment ID** ของ web app

### 5. ใส่ Secrets ใน GitHub
ไปที่ repo → **Settings → Secrets and variables → Actions → New repository secret**
แล้วเพิ่ม:

| ชื่อ Secret | ค่า | จำเป็น |
|-------------|-----|--------|
| `CLASPRC_JSON` | เนื้อหาทั้งหมดของไฟล์ `~/.clasprc.json` | ✅ ใช่ |
| `SCRIPT_ID` | Script ID จากข้อ 3 | ✅ ใช่ |
| `DEPLOYMENT_ID` | Deployment ID จากข้อ 4 | ⬜ ถ้าอยากให้ URL เดิมคงที่ |

วิธีก๊อปเนื้อหา `~/.clasprc.json`:
```bash
# mac / linux
cat ~/.clasprc.json
# windows (cmd)
type %USERPROFILE%\.clasprc.json
```
ก๊อปทั้งก้อน (รวม `{ ... }`) ไปวางเป็นค่าของ secret `CLASPRC_JSON`

---

## เสร็จแล้ว
- ทุกครั้งที่มีโค้ดเข้า default branch → ดู progress ได้ที่แท็บ **Actions**
- อยากสั่ง deploy เองตอนไหนก็ได้: **Actions → Deploy to Apps Script → Run workflow**

## แยกข้อมูลลับ (เงินเดือน / ต้นทุน P&L) ออกไปไฟล์ที่ไม่แชร์
ถ้าคุณจำเป็นต้องเปิด **แชร์ทุกคนที่มีลิงก์** ให้ Google Sheet หลัก (เพราะมีคนต้องเข้าไปดู/แก้
ข้อมูลในชีทตรงๆ หลายคน) ข้อมูลลับอย่างชีท `LaborEmployees` (ค่าแรงรายคน) และ `CostPLConfig`
(ต้นทุน P&L) จะถูกเปิดให้ทุกคนเห็นไปด้วย วิธีแก้:

1. สร้าง **Google Sheet ไฟล์ใหม่แยกต่างหาก** ตั้งเป็น **ส่วนตัว** (ไม่ต้องแชร์ให้ใคร — ให้เฉพาะ
   บัญชีเจ้าของที่ใช้ deploy Apps Script เข้าถึงได้พอ)
2. คัดลอก Spreadsheet ID ของไฟล์ใหม่ (ส่วนกลางของ URL) แล้วไปใส่ที่
   **Apps Script → Project Settings → Script Properties** เป็น key ชื่อ `SECURE_SPREADSHEET_ID`
3. ย้ายข้อมูลเดิม (ถ้ามี): เปิดไฟล์หลัก คัดลอกแท็บ `LaborEmployees` และ `CostPLConfig`
   ไปไว้ไฟล์ใหม่ แล้วลบสองแท็บนี้ออกจากไฟล์หลัก (ระบบจะสร้างแท็บใหม่ในไฟล์ลับให้อัตโนมัติ
   ถ้ายังไม่มี)

หลังตั้งค่าแล้ว แอปจะอ่าน/เขียนสองชีทนี้จากไฟล์ลับให้เองผ่าน Apps Script (ซึ่งรันด้วยสิทธิ์
บัญชีเจ้าของ) — คนที่เปิดไฟล์หลักตรงๆ จะไม่เห็นข้อมูลเงินเดือน/ต้นทุนอีกต่อไป ส่วนแอปทำงาน
ปกติทุกอย่าง หมายเหตุ: ถ้ายัง **ไม่ได้** ตั้ง `SECURE_SPREADSHEET_ID` ระบบจะเก็บสองชีทนี้ไว้
ในไฟล์หลักเหมือนเดิม (ไม่พัง แต่ยังไม่ได้แยกความลับ) — อยากเพิ่ม/ลดว่าชีทไหนถือเป็นความลับ
แก้ได้ที่ตัวแปร `SECURE_SHEETS` ใน `src/SheetHelper.gs`

## หมายเหตุ
- ถ้า **ไม่ใส่** `DEPLOYMENT_ID`: โค้ดจะถูก push ขึ้น HEAD เท่านั้น ถ้า URL `/exec`
  ของคุณตรึงไว้ที่เวอร์ชันใดเวอร์ชันหนึ่ง ต้องใส่ `DEPLOYMENT_ID` ด้วย URL ถึงจะอัปเดตตาม
- ถ้า token หมดอายุ/ถูกเพิกถอน ให้รัน `clasp login` ใหม่ แล้วอัปเดต secret `CLASPRC_JSON`
- workflow ใช้ `clasp@2.4.2` (ตรึงเวอร์ชันไว้กันพังจากการอัปเดต breaking changes)
