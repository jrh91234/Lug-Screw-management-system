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

## หมายเหตุ
- ถ้า **ไม่ใส่** `DEPLOYMENT_ID`: โค้ดจะถูก push ขึ้น HEAD เท่านั้น ถ้า URL `/exec`
  ของคุณตรึงไว้ที่เวอร์ชันใดเวอร์ชันหนึ่ง ต้องใส่ `DEPLOYMENT_ID` ด้วย URL ถึงจะอัปเดตตาม
- ถ้า token หมดอายุ/ถูกเพิกถอน ให้รัน `clasp login` ใหม่ แล้วอัปเดต secret `CLASPRC_JSON`
- workflow ใช้ `clasp@2.4.2` (ตรึงเวอร์ชันไว้กันพังจากการอัปเดต breaking changes)
