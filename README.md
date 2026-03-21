# H1 Lug&Screw Production Management System

ระบบจัดการการผลิตสำหรับไลน์ H1 Lug&Screw บน Google Apps Script + Google Sheets

## Features

### 1. ระบบกรอกยอดผลิต (Production Entry)
- กรอกยอดผลิตผ่านมือถือ
- เลือกเครื่องจักร (Lug & Screw 4-11)
- เลือกผลิตภัณฑ์ (ผูกกับเครื่องจักร)
- จำนวน Default 1,300 pcs
- ระบุยอด NG และหมายเหตุ
- ดูรายการวันนี้

### 2. ระบบแจ้งซ่อมเครื่องจักร (Maintenance Report)
- แจ้งปัญหาเครื่องจักร
- ระบุประเภท: เครื่องเสีย / บำรุงรักษา / คุณภาพ / อื่นๆ
- ระดับความเร่งด่วน: ต่ำ / กลาง / สูง / วิกฤต
- ติดตามสถานะใบแจ้งซ่อม

### 3. ระบบ Authorize (Authentication)
- Login ด้วยรหัสพนักงาน + PIN 4 หลัก
- Role-based access: operator / maintenance / supervisor / admin
- Session management 12 ชั่วโมง

### 4. ระบบ Dashboard (Data Analysis)
- KPI Cards: ยอดผลิต, %เป้า, %NG, แจ้งซ่อม
- กราฟยอดผลิตแยกเครื่องจักร
- กราฟสัดส่วนผลิตภัณฑ์ (BOI vs NON)
- กราฟกะการทำงาน (Day/Night)
- แนวโน้มการผลิตรายวัน
- สรุปการซ่อมบำรุง
- Export CSV

### 5. ระบบ Sorting
- เรียงข้อมูลตามคอลัมน์ (คลิกหัวตาราง)
- เรียงได้ทั้ง ascending/descending
- รองรับทั้ง server-side และ client-side sorting

### 6. ระบบสถานะเครื่องจักร (Machine Status)
- ดูสถานะเครื่องจักรแบบ real-time
- สรุปยอดผลิตรายเครื่อง
- Auto-refresh ทุก 60 วินาที

### 7. ระบบจัดการ (Admin Panel)
- จัดการพนักงาน (เพิ่ม/ระงับ/เปลี่ยน role)
- จัดการเครื่องจักร (เปลี่ยนสถานะ)
- ดูข้อมูลผลิตภัณฑ์และ BOM

## Products (BOM)

| Level | Part Number | Description | Qty | Supplier |
|-------|------------|-------------|-----|----------|
| **FG** | **51207611A(BOI)-S** | **Terminal Lug&Screw 25A Assy (BOI)** | | |
| L1 | GHC11115A-BOI | TERMINAL LUG 25A | 1 | SSVF (JMT Kelin) and SINO Thailand |
| L1 | GHC11118A | Therminal screw 25A | 1 | Thai Union |
| **FG** | **51207611A(NON)-S** | **Terminal Lug&Screw 25A Assy (NON)** | | |
| L1 | GHC11115A | TERMINAL LUG 25A | 1 | SINO Thailand and Patterer |
| L1 | GHC11118A | Therminal screw 25A | 1 | Thai Union |

## Machines

| ID | Name | Line |
|----|------|------|
| LS-04 | Lug & Screw 4 | H1 |
| LS-05 | Lug & Screw 5 | H1 |
| LS-06 | Lug & Screw 6 | H1 |
| LS-07 | Lug & Screw 7 | H1 |
| LS-08 | Lug & Screw 8 | H1 |
| LS-09 | Lug & Screw 9 | H1 |
| LS-10 | Lug & Screw 10 | H1 |
| LS-11 | Lug & Screw 11 | H1 |

## Setup

### Prerequisites
- Google Account
- Node.js (for clasp CLI)

### Installation

1. **Install clasp**
   ```bash
   npm install -g @google/clasp
   clasp login
   ```

2. **Create Google Spreadsheet**
   - สร้าง Google Spreadsheet ใหม่
   - คัดลอก Spreadsheet ID จาก URL

3. **Create Apps Script Project**
   ```bash
   clasp create --type webapp --title "H1 Lug&Screw Production"
   ```

4. **Update Configuration**
   - แก้ไข `.clasp.json` ใส่ Script ID ที่ได้
   - ใน Apps Script Editor: File > Project Properties > Script Properties
   - เพิ่ม `SPREADSHEET_ID` = ID ของ Google Spreadsheet

5. **Deploy**
   ```bash
   clasp push
   ```

6. **Initialize Data**
   - เปิด Apps Script Editor
   - เรียกใช้ฟังก์ชัน `initializeSystem()` เพื่อสร้าง sheets และข้อมูลเริ่มต้น

7. **Deploy as Web App**
   ```bash
   clasp deploy --description "v1.0"
   ```

8. **Default Admin Account**
   - Employee ID: `ADMIN`
   - PIN: `1234`

## Tech Stack

- **Backend**: Google Apps Script (V8 runtime)
- **Frontend**: HTML5 + Bootstrap 5 + Chart.js
- **Database**: Google Sheets
- **Deployment**: clasp CLI
- **Mobile**: Responsive design, touch-optimized

## File Structure

```
src/
├── Code.gs                    # Main entry point, routing
├── Auth.gs                    # Authentication & session
├── SheetHelper.gs             # Database abstraction layer
├── Utils.gs                   # Utility functions
├── ProductionService.gs       # Production CRUD
├── MaintenanceService.gs      # Maintenance tickets
├── MachineService.gs          # Machine management
├── ProductService.gs          # Product & BOM
├── DashboardService.gs        # Analytics & reporting
└── pages/
    ├── Layout.html            # Shared template (navbar, styles, JS utils)
    ├── Login.html             # Login page with PIN pad
    ├── ProductionEntry.html   # Production entry form
    ├── MaintenanceReport.html # Maintenance report form
    ├── MachineStatus.html     # Machine status overview
    ├── Dashboard.html         # Charts & data analysis
    └── AdminPanel.html        # System administration
```
