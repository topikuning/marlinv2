# Peta Modul & Fungsi MARLIN v2

> Inventaris lengkap modul backend & frontend yang sudah ada di codebase, status pengembangannya, dan backlog yang masih akan dikerjakan.
>
> Dipakai berbarengan dengan `PROMPT_BUILD_MARLIN.md` (spec domain) dan `PROMPT_CONTINUE_MARLIN.md` (handoff teknis).

**Last update:** Snapshot dari `main` per April 2026.

---

## Cara Baca

- **Status modul:**
  - ✅ **Lengkap** — Backend + Frontend + Audit + Permission tervalidasi end-to-end.
  - ⚠️ **Parsial** — Ada backbone, tapi UI minim atau ada gap polish/edge-case.
  - ❌ **Belum ada** — Disebut di spec tapi belum diimplementasi.
- **Sumber kebenaran:** struktur folder `backend/app/api/`, `backend/app/services/`, dan `frontend/src/pages/` + `frontend/src/components/`.

---

## 1. Modul yang Sudah Ada

### 1.1 Auth & Sesi  ✅
**Backend** (`app/api/auth.py`)
- `POST /auth/login` — login, return JWT + profile
- `POST /auth/refresh` — refresh token
- `GET /auth/me` — current user + permissions
- `POST /auth/change-password` — ubah password sendiri (auditor)

**Services:** `app/core/security.py`

**Frontend:** `LoginPage.jsx`

---

### 1.2 Users & RBAC  ✅
**Backend** (`app/api/users.py`, `app/api/rbac.py`)
- Users: GET/POST/PUT/DELETE `/users`, `/users/{id}/reset-password`
- RBAC: GET `/rbac/permissions`, `/rbac/menus`, `/rbac/my-menus`, `/rbac/roles`, `/rbac/roles/{id}`
- Roles CRUD: POST/PUT/DELETE `/rbac/roles[/...]`

**Services:** `audit_service.py`, `user_provisioning_service.py`

**Frontend:** `UsersPage.jsx`, `RolesPage.jsx`, `AuditLogPage.jsx`

---

### 1.3 Master Data  ✅
**Backend** (`app/api/master.py`)
- Companies: CRUD + auto-provision user kontraktor/konsultan
- PPK: CRUD + auto-provision user role "ppk"
- Work Codes: CRUD + template Excel + bulk import
- Master Facilities: CRUD katalog standar (29 jenis KKP)

**Services:** `user_provisioning_service.py`

**Frontend:** `MasterPages.jsx` (tabbed), wizard import Excel

---

### 1.4 Kontrak & Lifecycle  ✅
**Backend** (`app/api/contracts.py`)
- List & detail: `GET /contracts`, `GET /contracts/{id}`
- CRUD: POST/PUT/DELETE `/contracts[/{id}]`
- Lifecycle: `GET /contracts/{id}/readiness`, `POST /activate`, `POST /complete`
- Chain status: `GET /contracts/{id}/chain-status` (timeline V0 → Adendum → Vn)
- Sync status: `GET /contracts/{id}/sync-status` (validasi BOQ vs nilai kontrak)
- Unlock Mode: POST `/unlock`, `/lock` (superadmin)
- BAST: `GET /contracts/{id}/bast` (rekap akhir)
- Addendum: CRUD + `/sign` (DRAFT → SIGNED, auto-spawn revisi BOQ)

**Services:** `contract_lifecycle_service.py`, `boq_revision_service.py`, `vo_service.py`

**Frontend:** `ContractsPage.jsx`, `ContractDetailPage.jsx` (tabs: Overview, BOQ, VO, Adendum, MC, Laporan, Termin, Itjen), `ContractActivationPanel.jsx`

---

### 1.5 Lokasi  ✅
**Backend** (`app/api/locations.py`)
- `GET/POST/PUT/DELETE /locations[...]` per kontrak
- `POST /bulk` — bulk create
- `POST /import-excel` — import Excel
- Cascade-safe delete (clear `parent_id` BOQItem dulu)

**Frontend:** Embedded di `ContractDetailPage.jsx` (modal/drawer)

---

### 1.6 Fasilitas  ✅
**Backend** (`app/api/facilities.py`)
- `GET /facilities/by-location/{id}` — list per lokasi
- `POST/PUT/DELETE /facilities[/{id}]` — CRUD
- `POST /bulk` — bulk create
- `POST /by-location/{id}/import-excel` — import
- Pick dari master facility catalog (resolve by id/code/name)

**Frontend:** Embedded di `ContractDetailPage.jsx` (tree expandable per lokasi)

---

### 1.7 BOQ — Items, Hirarki, Revisi  ✅
**Backend** (`app/api/boq.py`)
- Items: GET/POST/PUT/DELETE `/boq/...` + by-facility/by-contract/flat
- Revisi: `GET /revisions/by-contract/{id}`, `POST /revisions/{id}/approve`, `GET /revisions/{id}/diff`
- Import: `POST /preview-excel`, `POST /import-excel/{location_id}`
- Template: `GET /template/download`
- Rollup: `GET /by-location/{id}/rollup`

**Services:** `boq_import_service.py`, `boq_revision_service.py`, `template_service.py`

**Frontend:** Tab "BOQ" di `ContractDetailPage.jsx`, `BOQGrid.jsx` (tree + parent picker), `BOQItemPickerModal.jsx`

---

### 1.8 Variation Order (VO)  ⚠️
**Backend** (`app/api/variation_orders.py`)
- CRUD: GET/POST/PUT/DELETE `/variation-orders[...]`
- State machine: POST `/submit`, `/review`, `/approve`, `/reject`
- Excel: `POST /export-excel`, parser snapshot

**Services:** `vo_service.py`, `vo_excel_service.py`

**Frontend:** Tab "VO" di `ContractDetailPage.jsx`, modal dengan grid item action (ADD, INCREASE, DECREASE, MODIFY_SPEC, REMOVE, REMOVE_FACILITY)

**Gap:** UI grid item actions perlu polish; visual before/after side-by-side belum sempurna

---

### 1.9 Field Observation (MC-0 / Interim)  ⚠️
**Backend** (`app/api/field_observations.py`)
- CRUD `/field-observations[...]`
- MC-0 unik per kontrak (constraint)

**Frontend:** Tab "MC" di `ContractDetailPage.jsx` — form + timeline

**Gap:** Toggle MC-0 vs interim UI perlu polish; integrasi visual ke chain-status timeline belum lengkap

---

### 1.10 Laporan Mingguan  ⚠️
**Backend** (`app/api/weekly_reports.py`)
- CRUD `/weekly-reports[...]`
- Progress items grid: `PUT /progress-items` (bulk volume cumulative)
- Foto: POST/DELETE `/photos[...]`
- Template: `GET /template/{contract_id}` (pre-fill BOQ)
- Excel: `GET /export-excel`, `POST /import-excel`

**Services:** `progress_service.py` (weight calc, kurva-S)

**Frontend:** `WeeklyReportsPage.jsx`, `WeeklyReportDetailPage.jsx`

**Gap:** Validasi import Excel terhadap BOQ; rendering kurva-S bisa dioptimalkan untuk durasi panjang

---

### 1.11 Laporan Harian  ✅
**Backend** (`app/api/daily_reports.py`)
- CRUD `/daily-reports[...]`
- Foto: POST/DELETE `/photos[...]` (tagged ke fasilitas)

**Frontend:** `DailyReportsPage.jsx`, modal entry + foto preview

---

### 1.12 Field Review (Itjen)  ⚠️
**Backend** (`app/api/reviews.py`)
- Review: CRUD `/field-reviews[...]`
- Findings: CRUD `/field-reviews/{id}/findings[...]`
- Foto temuan: POST/DELETE `/findings/{id}/photos[...]`

**Frontend:** `ReviewsPage.jsx`, modal review + findings editor

**Gap:** Severity workflow & due-date escalation belum tertest end-to-end; integrasi notifikasi ke PPK belum dipoles

---

### 1.13 Termin Pembayaran  ⚠️
**Backend** (`app/api/payments.py`)
- CRUD: GET/POST/PUT/DELETE `/payments[...]`
- State machine: `POST /mark-eligible`, `/mark-paid`
- Documents: POST/DELETE `/documents[...]`
- Anchor revisi BOQ saat SUBMIT

**Services:** `payment_eligibility_service.py`

**Frontend:** `PaymentsPage.jsx`, modal edit + doc upload

**Gap:** Eligibility logic prerequisite check (auto-trigger ELIGIBLE saat progres ≥ syarat) belum lengkap; ekspor BA termin (PDF) belum ada

---

### 1.14 Notifikasi & Early Warning  ✅
**Backend** (`app/api/notifications.py`)
- Rules: CRUD `/notifications/rules[...]`
- Queue: GET `/queue`, POST `/process`
- Scheduler: POST `/run-checks`, `/test-send`
- Warnings: GET `/warnings`, `POST /resolve`

**Services:** `notification_service.py`

**Frontend:** `NotificationsPage.jsx`, `WarningsPage.jsx`, bell icon di AppShell

---

### 1.15 Analytics & Dashboard  ⚠️
**Backend** (`app/api/analytics.py`)
- KPI: `GET /dashboard`
- Kontrak summary: `GET /contracts-summary`
- Kurva-S: `GET /scurve/{contract_id}`
- Peta: `GET /map-locations` (GeoJSON markers)
- Foto fasilitas: `GET /facility-photos/{id}`
- Progress fasilitas: `GET /facility-progress/{id}`

**Services:** `analytics_service.py` (jika ada), `progress_service.py`

**Frontend:** `DashboardPage.jsx`, `ExecutiveDashboardPage.jsx`, `ScurvePage.jsx`, MapComponent + PhotoGallery

**Gap:** Galeri foto interaktif (filter, lightbox keyboard nav, slideshow) belum lengkap sesuai spec; layer toggle peta + heatmap; mode presentasi fullscreen; ekspor PDF dashboard snapshot

---

## 2. Matriks Status Pengembangan

| # | Modul | Status | Catatan utama |
|---|---|---|---|
| 1 | Auth & Sesi | ✅ | Stable |
| 2 | Users & RBAC | ✅ | Permission matrix + dynamic menu OK |
| 3 | Master Data | ✅ | Excel import OK |
| 4 | Kontrak & Lifecycle | ✅ | Activation + Unlock Mode + Chain status OK |
| 5 | Lokasi | ✅ | Cascade-safe delete |
| 6 | Fasilitas | ✅ | Master catalog OK |
| 7 | BOQ | ✅ | Hirarki + revisi + diff + import OK |
| 8 | Variation Order | ⚠️ | UI grid item actions perlu polish |
| 9 | Field Observation | ⚠️ | Toggle MC-0 vs interim UI |
| 10 | Laporan Mingguan | ⚠️ | Validasi import; kurva-S optimization |
| 11 | Laporan Harian | ✅ | Stable |
| 12 | Field Review (Itjen) | ⚠️ | Escalation workflow belum tertest |
| 13 | Termin Pembayaran | ⚠️ | Auto-trigger ELIGIBLE; ekspor BA PDF |
| 14 | Notifikasi | ✅ | WhatsApp/Email/In-App + scheduler OK |
| 15 | Analytics / Dashboard | ⚠️ | Galeri interaktif + peta layer + presentasi mode |

**Ringkasan:** 9 modul ✅, 6 modul ⚠️ (perlu polish/lengkap), 0 ❌ (belum ada sama sekali). **Backbone semua modul sudah terbangun.**

---

## 3. Yang Akan Dikembangkan (Backlog)

Disarikan dari `PROMPT_BUILD_MARLIN.md` Bagian 14 (Standar Output Dokumen) + diskusi sesi sebelumnya.

### 3.1 BOQ Comparison & Export Engine  ❌
Pernah dibahas mendalam tapi belum diimplementasi.

- **Ekspor BOQ aktif** ke Excel (multi-sheet, formula, freeze panes, header info kontrak) & PDF (Landscape, header resmi).
- **Komparasi 2 revisi BOQ** (V0 vs V1, V1 vs V2, …) dengan kolom `Jenis Pekerjaan | Harga Satuan | Pekerjaan A (Vol & Jumlah) | Pekerjaan B (Vol & Jumlah) | Tambah | Kurang | Ket`.
- **Excel komparasi** dengan formula dinamis (Jumlah = Vol × Harga, Selisih auto).
- **PDF komparasi Landscape** proporsional.
- **UI**: 2 dropdown selector revisi + AG-Grid preview + tombol "Unduh Excel/PDF".
- **Endpoint plan:** `GET /boq/comparison?rev_a=&rev_b=`, `/comparison/export/xlsx`, `/comparison/export/pdf`.
- **Service plan:** `boq_export_service.py` + dependency `reportlab`.

### 3.2 Ekspor Format e-Kontrak Nasional  ❌
Disebut di `PROMPT_BUILD_MARLIN.md` 11.5 (Perpres 46/2025).

- Ekspor Excel terstruktur sesuai standar e-Kontrak LKPP (identitas kontrak, para pihak, lingkup, jadwal pembayaran, BOQ ringkas, addenda).
- Stub endpoint `/api/contracts/{id}/export/e-kontrak` dengan format definitif yang ditanyakan ke user saat implementasi.

### 3.3 Generator Dokumen PDF Resmi  ❌
Daftar dokumen yang harus didukung tapi belum diimplementasi (`PROMPT_BUILD_MARLIN.md` 14.4):

| Dokumen | Keterangan |
|---|---|
| Laporan Harian PDF | Narasi + tabel manpower + galeri foto |
| Laporan Mingguan PDF | Ringkasan + tabel progress + kurva-S + foto |
| Berita Acara MC-0 / MC-Interim | Format BA standar |
| Justifikasi Teknis VO | Lampiran addendum |
| Berita Acara Addendum | Ringkasan perubahan BOQ + tabel komparasi |
| Surat & BA Pembayaran Termin | Nominal + terbilang + lampiran progress |
| Laporan Field Review Itjen | Temuan + severity + tanggapan + foto bukti |
| Sertifikat Penyelesaian Kontrak | BAST final |
| Ekspor Dashboard Eksekutif PDF | Snapshot KPI + kurva-S + peta + galeri |

**Aturan umum** (sudah didefinisikan di spec): header/footer berulang, page-break tabel benar, signature block + opsi QR verifikasi, embed font, watermark "DRAFT", penomoran dokumen otomatis konfigurable.

### 3.4 Polish Modul ⚠️ (Naikkan ke ✅)

| Modul | Apa yang perlu |
|---|---|
| **VO** | UI grid actions polish, before/after visualization side-by-side, drag-drop bundling ke addendum |
| **Field Observation** | UI toggle MC-0 vs interim, integrasi visual ke chain-status timeline |
| **Laporan Mingguan** | Validasi import Excel (vol kumulatif vs BOQ), optimasi rendering kurva-S durasi panjang, lock-state UX |
| **Field Review (Itjen)** | Escalation workflow OPEN→RESPONDED→ACCEPTED→CLOSED end-to-end, due-date notification, integrasi ke dashboard |
| **Termin Pembayaran** | Auto-trigger ELIGIBLE saat progres ≥ syarat, ekspor BA PDF, surat permohonan termin |
| **Dashboard Eksekutif** | Galeri foto lightbox interaktif lengkap (keyboard nav, slideshow, zoom, rotate, bulk download), peta layer toggle + heatmap + cluster, mode presentasi fullscreen, ekspor PDF snapshot |

### 3.5 UX Excel-like Konsisten  ⚠️
`PROMPT_BUILD_MARLIN.md` Bagian 13 menetapkan standar grid Excel-like di semua tabel berskala. Saat ini belum konsisten:

- ✅ BOQ Grid pakai AG-Grid (sebagian fitur).
- ⚠️ Laporan Mingguan grid editor — perlu copy-paste, fill-down, undo/redo, virtualisasi 5000+ row.
- ⚠️ Audit Log table — belum virtualisasi, filter chip, view preset.
- ⚠️ Daftar VO/Termin/Temuan — masih tabel polos, belum filter inline.
- ❌ Dropdown filterable di mana saja (server-side paging untuk master catalog besar) — belum konsisten.

### 3.6 Peningkatan Audit & Compliance
- **Field `justification_category`, `justification_narrative`, `price_fairness_basis`, `supporting_documents`** pada Addendum (Perpres 46/2025) — schema ada di prompt, **field DB & UI belum ditambah**.
- **`contract_type`** enum konstruksi (LUMP_SUM, HARGA_SATUAN, GABUNGAN, TURNKEY, MODIFIED_TURNKEY) — belum jadi field aktif.
- **`warning_threshold_pct`** konfigurable per kontrak untuk perubahan nilai — belum ada.

---

## 4. Saran Prioritas Pengerjaan

Urut berdasarkan **value × kesiapan** (sudah ada backbone, tinggal polish):

1. **Polish VO + Addendum integration** (1.8 + Compliance 3.6) — ini gateway ke alur perubahan kontrak yang real-world.
2. **Termin Pembayaran end-to-end** (1.13) — auto-trigger ELIGIBLE + ekspor BA PDF. Compliance BPK paling sensitif.
3. **BOQ Comparison & Export Engine** (3.1) — sudah dirancang detail, value tinggi untuk audit.
4. **Generator PDF Dokumen Resmi** (3.3) — bertahap, mulai dari yang paling sering dipakai (BA MC, BA Termin, Laporan Mingguan).
5. **Dashboard Eksekutif polish** (1.15 + 3.4) — galeri foto interaktif & peta layer.
6. **UX Excel-like konsisten** (3.5) — bertahap di setiap halaman tabel.
7. **e-Kontrak ekspor** (3.2) — tunggu spec format definitif dari user.

---

## 5. Catatan untuk Sesi Berikutnya

- **Backbone modul sudah terbangun semua.** Tidak ada modul yang harus dimulai dari nol.
- **Prioritas saat ini = polish + compliance + dokumen resmi.** Bukan menambah modul baru.
- **Selalu pelajari `PROMPT_CONTINUE_MARLIN.md` Bagian 5 (Pitfalls)** sebelum modifikasi area terkait — ada 13 kasus yang sudah pernah salah.
- **`MODULE_MAP.md` (file ini) wajib di-update saat:**
  - Modul ⚠️ naik ke ✅.
  - Item backlog selesai.
  - Modul/endpoint baru ditambahkan.
- **Cek manual akurasi dengan `grep "@router\." backend/app/api/*.py`** sebelum claim modul "sudah ada" — file ini berasal dari survey otomatis dan bisa drift seiring waktu.

---

*Diturunkan dari survey codebase via subagent. Update saat ada perubahan signifikan.*


