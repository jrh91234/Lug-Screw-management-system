# H1 Lug&Screw Production Management System

ระบบจัดการการผลิตสำหรับไลน์ H1 Lug&Screw

**Frontend**: GitHub Pages (สวย ไม่มีแถบแจ้งเตือน)
**Backend API**: Google Apps Script
**Database**: Google Sheets

---

## Features

| ระบบ | รายละเอียด |
|------|-----------|
| กรอกยอดผลิต | เลือกเครื่อง > เลือกสินค้า > กรอกจำนวน (default 1,300) |
| แจ้งซ่อมเครื่องจักร | เลือกเครื่อง > ประเภทปัญหา > ระดับเร่งด่วน |
| Authorization | Login ด้วยรหัส + PIN, 4 roles |
| Dashboard | กราฟ, KPI, แนวโน้ม, Export CSV |
| Sorting | คลิกหัวตารางเพื่อเรียงข้อมูล |
| สถิติ Alarm (ORC) | บันทึก Alarm จาก HMI > สถิติ Pareto, ตามเครื่อง/กะ, Downtime, แนวโน้มรายวัน |
| สถานะเครื่องจักร | Real-time, auto-refresh 60 วินาที |
| Admin Panel | จัดการพนักงาน/เครื่องจักร/สินค้า |

## Roles

| Role | สิทธิ์ |
|------|-------|
| viewer | ดู Dashboard เท่านั้น |
| operator | กรอกยอด, แจ้งซ่อม, ดูสถานะเครื่อง |
| maintenance | + อัพเดทสถานะซ่อม |
| supervisor | + Dashboard, Export CSV |
| admin | + จัดการพนักงาน/เครื่องจักร/สินค้า |

## Products (BOM)

| Level | Part Number | Description | Supplier |
|-------|------------|-------------|----------|
| **FG** | **51207611A(BOI)-S** | **Terminal Lug&Screw 25A Assy (BOI)** | |
| L1 | GHC11115A-BOI | TERMINAL LUG 25A | SSVF (JMT Kelin) and SINO Thailand |
| L1 | GHC11118A | Therminal screw 25A | Thai Union |
| **FG** | **51207611A(NON)-S** | **Terminal Lug&Screw 25A Assy (NON)** | |
| L1 | GHC11115A | TERMINAL LUG 25A | SINO Thailand and Patterer |
| L1 | GHC11118A | Therminal screw 25A | Thai Union |

## Machines

Lug & Screw 4, 5, 6, 7, 8, 9, 10, 11 (8 เครื่อง)

---

## Setup Guide (ทำครั้งเดียว)

### ขั้นที่ 1: สร้าง Google Spreadsheet

1. เปิด Google Sheets สร้าง Spreadsheet ใหม่
2. คัดลอก **Spreadsheet ID** จาก URL

### ขั้นที่ 2: สร้าง Google Apps Script (Backend API)

1. เปิด https://script.google.com > **New Project**
2. คัดลอกไฟล์ `.gs` จากโฟลเดอร์ `src/` เข้าไป:

| ไฟล์ | สร้างใน Apps Script |
|------|-------------------|
| `src/Code.gs` | ใช้ไฟล์ `Code.gs` ที่มีอยู่ |
| `src/Auth.gs` | กด + > Script > ตั้งชื่อ `Auth` |
| `src/SheetHelper.gs` | กด + > Script > ตั้งชื่อ `SheetHelper` |
| `src/Utils.gs` | กด + > Script > ตั้งชื่อ `Utils` |
| `src/ProductionService.gs` | กด + > Script > ตั้งชื่อ `ProductionService` |
| `src/MaintenanceService.gs` | กด + > Script > ตั้งชื่อ `MaintenanceService` |
| `src/MachineService.gs` | กด + > Script > ตั้งชื่อ `MachineService` |
| `src/ProductService.gs` | กด + > Script > ตั้งชื่อ `ProductService` |
| `src/DashboardService.gs` | กด + > Script > ตั้งชื่อ `DashboardService` |

3. ตั้งค่า Script Properties:
   - ไปที่ **Project Settings** (เกียร์) > **Script Properties**
   - เพิ่ม `SPREADSHEET_ID` = ID จากขั้นที่ 1

4. รัน `initializeSystem()` ครั้งเดียว (สร้าง sheets + seed data)

5. Deploy:
   - กด **Deploy** > **New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - คัดลอก **URL** ที่ได้

### ขั้นที่ 3: เปิดใช้ GitHub Pages (Frontend)

1. ไปที่ Settings ของ repo บน GitHub
2. เลือก **Pages** > Source: **Deploy from a branch**
3. Branch: เลือก branch นี้ > Folder: `/docs`
4. กด **Save**
5. รอ 1-2 นาที จะได้ URL: `https://<username>.github.io/Lug-Screw-management-system/`

### ขั้นที่ 4: เริ่มใช้งาน

1. เปิด GitHub Pages URL จากมือถือ
2. **ครั้งแรก**: วาง Apps Script URL ที่ได้จากขั้นที่ 2
3. **ก่อนใช้งานครั้งแรก** ตั้งค่า Script Properties:
   - `INITIAL_ADMIN_EMPLOYEE_ID`
   - `INITIAL_ADMIN_PIN`
4. Login ด้วยรหัส Admin ที่ตั้งไว้
5. เพิ่มพนักงานในหน้า Admin
6. แจก URL ให้พนักงาน!

> หมายเหตุสำหรับระบบเก่า: หากชีท `Users` ยังไม่มีคอลัมน์ `Permissions` ระบบจะเพิ่มคอลัมน์นี้ให้อัตโนมัติเมื่อมีการใช้งานเมนูผู้ใช้
>
> สำหรับวัตถุดิบที่มีหลายรหัสบนฉลาก (เช่น Numeric Code vs Supplier Code) ให้จัดการที่ชีท `MaterialAlias` โดยใส่ `AliasCode` → `CanonicalCode` ระบบจะใช้ mapping นี้ตอนตรวจ BOM อัตโนมัติ

---

## Architecture

```
GitHub Pages (Frontend)          Google Apps Script (Backend)
┌──────────────────────┐        ┌────────────────────────┐
│  index.html (Login)  │        │  Code.gs (API Router)  │
│  pages/              │  HTTP  │  Auth.gs               │
│    production.html   │◄──────►│  ProductionService.gs  │
│    maintenance.html  │  JSON  │  MaintenanceService.gs │
│    machines.html     │        │  MachineService.gs     │
│    dashboard.html    │        │  ProductService.gs     │
│    admin.html        │        │  DashboardService.gs   │
│  css/style.css       │        │  SheetHelper.gs        │
│  js/api.js           │        │  Utils.gs              │
│  js/auth.js          │        └─────────┬──────────────┘
│  js/ui.js            │                  │
└──────────────────────┘                  ▼
                                ┌────────────────────┐
                                │   Google Sheets    │
                                │  (Database)        │
                                └────────────────────┘
```

## File Structure

```
├── docs/                    ← GitHub Pages Frontend
│   ├── index.html           # Login + API URL config
│   ├── css/style.css        # All styles
│   ├── js/
│   │   ├── api.js           # API communication layer
│   │   ├── auth.js          # Session management
│   │   └── ui.js            # Toast, Loading, Navigation
│   └── pages/
│       ├── production.html  # กรอกยอดผลิต
│       ├── maintenance.html # แจ้งซ่อม
│       ├── machines.html    # สถานะเครื่องจักร
│       ├── dashboard.html   # Dashboard + Charts
│       └── admin.html       # Admin Panel
│
├── src/                     ← Google Apps Script Backend
│   ├── Code.gs              # API Router (doGet/doPost)
│   ├── Auth.gs              # Authentication
│   ├── SheetHelper.gs       # Database layer
│   ├── Utils.gs             # Utilities
│   ├── ProductionService.gs # Production CRUD
│   ├── MaintenanceService.gs# Maintenance tickets
│   ├── MachineService.gs    # Machine management
│   ├── ProductService.gs    # Product & BOM
│   └── DashboardService.gs  # Analytics
│
└── appsscript.json          # Apps Script manifest
```
