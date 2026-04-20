# KNMP Monitor v2

Sistem monitoring konstruksi **Kampung Nelayan Merah Putih** — rewrite total untuk Kementerian Kelautan dan Perikanan.

## 📋 Requirement Checklist (Semua ✅ Tercover)

| # | Fitur                                                   | Lokasi |
|---|---------------------------------------------------------|--------|
| 1 | Full CRUD + RBAC (dynamic menu per role)                | `app/api/rbac.py`, `App.jsx` |
| 2 | Laporan Harian (hanya narasi + foto, **tanpa %**)       | `app/api/daily_reports.py` |
| 3 | Laporan Mingguan (progress per-item + foto, editable)   | `app/api/weekly_reports.py`, `WeeklyReportDetailPage.jsx` |
| 4 | Auto Kurva S (plan vs actual + addendum markers)        | `app/services/progress_service.py` |
| 5 | Termin Pembayaran dengan workflow status                | `app/api/payments.py` |
| 6 | Review Lapangan (Itjen) + temuan + foto                 | `app/api/reviews.py` |
| 7 | Early Warning otomatis (deviasi, SPI, laporan telat)    | `progress_service.py`, `scheduler.py` |
| 8 | WhatsApp alert (Fonnte + scheduler + template)          | `notification_service.py` |
| 9 | Multi-location di Create Contract (bukan single field)  | `ContractsPage.jsx` → `CreateContractModal` |
| 10 | Bulk add facility + Excel import                       | `ContractDetailPage.jsx` → `AddFacilityModal` |
| 11 | BOQ hirarkis per-lokasi per-fasilitas                  | `app/models/models.py` → `BOQItem` |
| 12 | Import BOQ format **asli KKP** (multi-sheet Ampean)    | `boq_import_service.py` + `BOQImportWizard.jsx` |
| 13 | Excel template untuk semua entity                      | `template_service.py` |
| 14 | Grid editor BOQ & Progress (AG Grid, ExtJS-style)      | `BOQGrid.jsx`, `WeeklyReportDetailPage.jsx` |
| 15 | User & Role management dengan permission matrix        | `UsersPage.jsx`, `RolesPage.jsx` |
| 16 | Audit log semua perubahan                              | `audit_service.py` |

## 🏗️ Tech Stack

**Backend:** FastAPI · SQLAlchemy 2 · PostgreSQL 16 · APScheduler · Pydantic v2 · openpyxl · Pillow

**Frontend:** React 18 · Vite 5 · Tailwind CSS · AG Grid 32 · Recharts · Zustand · React Router 6

**Infra:** Docker Compose · Nginx reverse proxy

## 🚀 Quick Start (Docker)

```bash
# 1. Copy env dan edit password
cp backend/.env.example backend/.env
# edit DATABASE_URL, SECRET_KEY, WA_API_TOKEN bila ingin WhatsApp aktif

# 2. Build & run
docker compose up -d --build

# 3. Init database (sekali saja)
docker compose exec backend python seed.py

# 4. Akses
# Frontend: http://localhost
# API docs: http://localhost:8000/docs
# Login:    admin@knmp.id / Admin@123!
```

## 🛠️ Development Mode

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Pastikan PostgreSQL running
createdb knmp_monitor
cp .env.example .env  # edit DATABASE_URL

python seed.py
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# http://localhost:5173
```

Vite dev proxy sudah disetel untuk forward `/api` dan `/uploads` ke `localhost:8000`.

## 📊 Data Model (Key Entities)

```
Contract
 ├─ Locations (≥ 1, multi-location)
 │   └─ Facilities (Gudang Beku, Pabrik Es, ...)
 │       └─ BOQItems (hirarkis, level 0-3)
 │           ├─ parent_id (tree structure)
 │           ├─ is_leaf (hanya leaf yg punya bobot % & progress)
 │           └─ weight_pct (auto-computed)
 ├─ Addenda
 ├─ WeeklyReports
 │   └─ WeeklyProgressItems (per boq_item_id)
 ├─ DailyReports (tanpa %)
 ├─ PaymentTerms
 ├─ FieldReviews
 │   └─ Findings
 └─ EarlyWarnings
```

## 🧾 Format BOQ yang Didukung

Import wizard di **Kontrak → Lokasi → Upload BOQ** mendukung 2 format:

1. **Template Simple** (1 sheet). Download dari tombol "Download Template" di modal. Kolom minimum: `facility_code, facility_name, level, code, description, unit, volume, unit_price`
2. **Format Asli KKP** (multi-sheet, seperti `BOQ_AMPEAN_KOTA_MATARAM_FIX.xlsx`). Sistem auto-detect sheet per fasilitas (`6.Gudang Beku`, `7.Pabrik Es`, dll) berdasarkan pattern nama sheet, parse hirarki dari kolom kode (A/1/a), dan minta mapping ke fasilitas existing jika ada.

## 🔔 WhatsApp Notifications

Default nonaktif. Aktifkan dengan set env:

```bash
WA_ENABLED=true
WA_API_TOKEN=xxx  # dari fonnte.com
```

Scheduler berjalan tiap hari jam `DAILY_CHECK_HOUR` (default 8 pagi) untuk:
- Cek laporan harian/mingguan yang belum masuk
- Hitung deviasi & SPI semua kontrak aktif
- Antrikan notifikasi ke user sesuai role (lihat menu `Admin → Notifikasi`)

Template pesan bisa diedit per-rule dengan placeholder `{{contract_number}}`, `{{warning}}`, dll.

## 🛡️ Role Default

| Role          | Akses                                                       |
|---------------|-------------------------------------------------------------|
| `superadmin`  | Semua (wildcard `*`)                                        |
| `admin_pusat` | Full kecuali user/role mgmt                                 |
| `ppk`         | Kontrak di-assign saja + approve termin                     |
| `manager`     | Read-only semua kontrak yang di-assign                      |
| `konsultan`   | Input laporan harian & mingguan                             |
| `kontraktor`  | View data kontraknya                                        |
| `itjen`       | Buat review + temuan lapangan                               |
| `viewer`      | Read-only                                                   |

## 🧪 Test Data

Setelah `seed.py`, tambah data manual via UI:

1. Login sebagai admin
2. Master Data → Perusahaan → Buat 2 (kontraktor + konsultan)
3. Master Data → PPK → Buat 1
4. Kontrak → Kontrak Baru → Isi **dengan multi-location**
5. Buka detail kontrak → Tambah fasilitas bulk / import BOQ Excel
6. Laporan Mingguan → Buat Minggu 1 → Edit progress per-item di AG Grid

## 📁 Struktur Folder

```
knmp-v2/
├── backend/
│   ├── app/
│   │   ├── api/           # 15 router FastAPI
│   │   ├── core/          # config, db, security (JWT)
│   │   ├── models/        # SQLAlchemy models
│   │   ├── schemas/       # Pydantic schemas
│   │   ├── services/      # business logic
│   │   └── tasks/         # APScheduler jobs
│   ├── main.py
│   ├── seed.py
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/           # axios client with auto-refresh
│   │   ├── components/    # UI primitives, AG Grid, modals
│   │   ├── pages/         # 14 routed pages
│   │   ├── store/         # Zustand auth
│   │   └── utils/         # formatters
│   ├── Dockerfile
│   └── nginx.conf
└── docker-compose.yml
```

## 🔑 Audit Log

Semua perubahan CRUD tercatat di tabel `audit_logs` dengan:
- user_id, action (create/update/delete)
- entity_type + entity_id
- changes (JSONB diff)
- ip_address, user_agent, timestamp

Akses via endpoint `/api/users/audit-logs` (future UI di `/admin/audit`).

## 📝 Lisensi

© 2025 Kementerian Kelautan dan Perikanan Republik Indonesia.
