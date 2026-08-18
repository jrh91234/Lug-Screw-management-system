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
npm install -g @google/clasp@3
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

## สิทธิ์เข้าถึง web app — "ทุกคนที่มีลิงก์"

แอปนี้ต้องเปิดให้ **ทุกคนที่มีลิงก์** เข้าได้ เพราะเครื่องหน้างานไม่ได้ล็อกอิน Google
และหน้าเว็บเรียก `/exec` แบบ `credentials: 'omit'` ถ้าตั้งเป็นอย่างอื่น ทุก request
จะโดนเด้งไปหน้า login ของ Google ซึ่งเบราว์เซอร์รายงานกลับมาเป็น CORS error —
อาการที่เห็นคือแอปพัง ไม่ใช่แอปถูกล็อก

ค่านี้อยู่ใน `appsscript.json` และถูก push ขึ้นไปทุกครั้งที่ deploy:

```json
"webapp": {
  "access": "ANYONE_ANONYMOUS",
  "executeAs": "USER_DEPLOYING"
}
```

| ค่า | ความหมายในหน้า Apps Script | ใช้ได้ไหม |
|-----|---------------------------|-----------|
| `ANYONE_ANONYMOUS` | **Anyone** — ไม่ต้องล็อกอิน = ทุกคนที่มีลิงก์ | ✅ ค่าที่ต้องใช้ |
| `ANYONE` | Anyone with a Google account — ต้องล็อกอินก่อน | ❌ แอปจะพัง |
| `DOMAIN` / `MYSELF` | เฉพาะในองค์กร / เฉพาะเจ้าของ | ❌ แอปจะพัง |

`executeAs: USER_DEPLOYING` ต้องคู่กันเสมอ — สคริปต์รันด้วยสิทธิ์บัญชีเจ้าของ
คนที่เปิดแอปแบบไม่ล็อกอินจึงเข้าถึง Google Sheet ได้ผ่านสคริปต์

workflow มีขั้นตอน **Verify web app stays public** ตรวจสองค่านี้ก่อน push ถ้าใครแก้เป็น
ค่าอื่น deploy จะล้มพร้อมข้อความบอกสาเหตุ แทนที่จะเงียบ ๆ ปล่อยแอปที่เข้าไม่ได้ขึ้น production

### ถ้า deployment เดิมยังไม่เปิดเป็น "ทุกคนที่มีลิงก์"
`clasp deploy --deploymentId` อัปเดต **โค้ด** ของ deployment เดิม แต่ไม่ย้อนกลับไปแก้สิทธิ์
ที่ตั้งไว้ตอนสร้าง deployment นั้นครั้งแรก ถ้าเปิด `/exec` แล้วยังเจอหน้า login ของ Google
ต้องแก้ **ครั้งเดียว** ด้วยมือ:

1. เปิดโปรเจกต์ Apps Script → **Deploy → Manage deployments**
2. กดดินสอ ✏️ ที่ deployment ของ web app
3. **Who has access** → เลือก **Anyone**
4. **Deploy**

URL `/exec` ไม่เปลี่ยน และหลังจากนี้ทุก merge จะอัปเดตโค้ดให้เองตามเดิม

---

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
- workflow ตรึง `clasp@3` ไว้ (เอาแค่ major กันพังจากการอัปเดตข้ามเวอร์ชันใหญ่)
  ตอน `clasp login` บนเครื่องตัวเองต้องใช้ major เดียวกันด้วย เพราะ clasp คนละ major
  เขียน `~/.clasprc.json` คนละรูปแบบ — ถ้าใช้คนละเวอร์ชัน CI จะขึ้น
  `Error retrieving access token`
