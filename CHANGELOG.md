# KNMP Monitor v2.1 — Changelog

Rewrite fase lanjutan yang menutup 10 catatan kritis dari review system
architect. Fokus pada **Alur Inti**: User → Kontrak → BOQ → Laporan →
Kurva S → Adendum/CCO → Kontrak Selesai.

Scope out: Notifikasi WA, Termin, Review Itjen (foundation masih ada,
tidak diubah).

---

## Tahap 1 — Skema & Data Model

### CCO Versioning (catatan #1)
- **Tabel baru `boq_revisions`** (CCO-0, CCO-1, ...) dengan DB-level
  partial unique index: exactly one active revision per contract,
  dijamin di Postgres (`uq_one_active_revision_per_contract`).
- **`BOQItem` direwire**: kolom baru `boq_revision_id`, `source_item_id`
  (pointer ke item CCO sebelumnya untuk diff), `change_type`
  (`unchanged|modified|added|removed`).
- Kolom `version` & `is_addendum_item` di-mark DEPRECATED (tidak
  dihapus — backward compat).

### Entitas → User (catatan #2)
- `Company.default_user_id` (1:1 ke users), `Company.company_type`
  (contractor/consultant/supplier).
- `PPK.user_id` (unique, 1:1).
- `User.must_change_password`, `User.auto_provisioned`.

### Master Data Fasilitas (catatan #3a)
- Tabel baru `master_facilities` dengan 29 entri pre-seeded dari BOQ
  asli Ampean / Nisombalia / Tanete.
- `Facility.master_facility_id` FK (nullable untuk backward compat).

### Konsultan per Lokasi (catatan #3b)
- `Location.konsultan_id` FK baru ke companies.
- `Contract.konsultan_id` dipertahankan sebagai fallback, diberi
  komentar DEPRECATED.

### Activation Flow (baru, ditanyakan)
- `Contract.activated_at`, `Contract.activated_by_id`.

### Enum baru
- `RevisionStatus` (draft, approved, superseded)
- `BOQChangeType` (unchanged, modified, added, removed)

---

## Tahap 2 — Backend Service & API

### Service Layer (3 service baru)
- **`user_provisioning_service.py`** — idempotent auto-create user untuk
  PPK/Company. Slug username, fallback email `@knmp.local`, password
  default `Ganti@123!`, `must_change_password=True`. Supplier skip.
- **`boq_revision_service.py`** — `ensure_cco_zero` (idempotent auto-migrate
  orphan BOQItems), `clone_revision_for_addendum` (deep-clone + rewire
  parent_id dalam two-pass), `approve_revision` (atomic flip + migrate
  WeeklyProgressItem lewat source_item_id mapping), `diff_revisions`
  (row-by-row comparison).
- **`contract_lifecycle_service.py`** — `check_readiness` (4 gate) +
  `activate_contract` + `ActivationError` exception.

### API Endpoints baru
```
GET    /api/contracts/{id}/readiness            # preview activation checks
POST   /api/contracts/{id}/activate             # DRAFT → ACTIVE
POST   /api/contracts/{id}/complete             # ACTIVE → COMPLETED

GET    /api/boq/revisions/by-contract/{id}      # list CCO-0, CCO-1, ...
POST   /api/boq/revisions/{id}/approve          # flip + migrate progress
GET    /api/boq/revisions/{id}/diff             # row diff vs predecessor
GET    /api/boq/by-location/{id}/rollup         # consolidated view (catatan #9c)

GET    /api/master/facilities                   # MasterFacility catalog
POST   /api/master/facilities                   #   CRUD — full
PUT    /api/master/facilities/{id}
DELETE /api/master/facilities/{id}
```

### Bug fixes
- **Pagination (catatan #4)**: `page_size` di `/api/contracts` dinaikkan
  dari 200 → 1000 (fix 422 error saat frontend request 500).
- **Visibility (catatan #6)**: `/api/contracts` returns all statuses
  termasuk DRAFT by default; added flags `include_draft` &
  `reportable_only`. Weekly/daily create tetap tolak
  `completed`/`terminated` tapi DRAFT bisa input laporan.
- **Edit matrix (catatan #8, backend)**: `PUT /api/contracts/{id}`
  sekarang respect status:
  - DRAFT → all fields editable
  - ACTIVE/ADDENDUM → only name, description, document, report config
  - COMPLETED/TERMINATED → 400
  Changes to financial/date fields require Addendum.

### Smart contract create
- `POST /api/contracts` otomatis bootstrap CCO-0 revision (DRAFT state).
- `POST /api/contracts/{id}/addenda` dengan tipe CCO/value_change/combined
  otomatis `clone_revision_for_addendum` → return `new_revision_id`.

### Write guard
- `_resolve_writable_revision_for_facility` di boq.py:
  - DRAFT revision → allowed
  - APPROVED active revision → 400 dengan hint "Buat Addendum dulu"
  - Client-supplied `boq_revision_id` di-ignore (resolver yang menentukan)

### Seed komprehensif (catatan #7)
- 29 MasterFacility dari BOQ Ampean / Nisombalia / Tanete (Gudang Beku,
  Pabrik Es, Cool Box, Tambatan Perahu, DPT, IPAL, dll).
- Data migration: setiap Contract existing dipastikan punya CCO-0
  revision via `ensure_cco_zero`; auto-approve kalau status sudah
  ACTIVE/ADDENDUM/COMPLETED.

---

## Tahap 3 — Frontend

### API Client
Endpoint baru untuk Tahap 2 di `src/api/index.js`:
- `contractsAPI.readiness`, `.activate`, `.complete`
- `boqAPI.listRevisions`, `.approveRevision`, `.diffRevision`,
  `.locationRollup`
- `masterAPI.facilities`, `.createFacility`, `.updateFacility`,
  `.deleteFacility`

### AG Grid BOQ (catatan #9a, #9b)
`components/grids/BOQGrid.jsx` ditulis ulang dengan 2 fix:
- **Auto-calc Total real-time**: kolom Total sekarang read-only derived
  value via `valueGetter: () => volume × unit_price`. Escape hatch
  `_manualTotal` dihilangkan — kalau engineer perlu ubah total, harus
  ubah volume atau unit_price (honest input).
- **Delete bug**: root cause adalah grid jalan dengan
  `suppressRowClickSelection=true` **tanpa kolom checkbox**, jadi tidak
  ada UI untuk select row. Ditambahkan:
  - Checkbox column di kiri (pinned), plus header checkbox untuk "select all"
  - `deleteSelected` baca dari `getSelectedNodes()` (stabil mid-edit)
  - Button di-disable saat 0 selected, counter di label
  - Error message jelas mengarah ke kolom checkbox

### Contract Detail Page
- **Tombol "Edit"** di header kontrak → `EditContractModal`.
- **`EditContractModal`** (baru) dengan UI matrix mirror backend:
  - DRAFT: semua field enabled
  - ACTIVE: locked fields gray-out dengan banner kuning penjelasan
  - COMPLETED/TERMINATED: save button disabled, banner merah
- **`ContractActivationPanel`** (baru) di header:
  - DRAFT: 4-item readiness checklist + "Aktifkan Kontrak" button
    (disabled sampai semua hijau), polling `/readiness`
  - ACTIVE/ADDENDUM: "Tandai Selesai" button
  - COMPLETED/TERMINATED: nothing
- **Tab baru "Rekap BOQ Lokasi"** — konsumsi `locationRollup`, tampilkan
  semua fasilitas dalam 1 lokasi dengan grand total.
- **Tab baru "CCO Revisions"** — list semua revisi, badge status
  (Draft/Approved/Aktif/Superseded), tombol Approve untuk DRAFT,
  tombol Compare (open `RevisionDiffModal` dengan delta color-coded).

### Users Page — dropdown Role fix (catatan #10a)
`UserModal` di-refactor:
- Fallback load roles sendiri kalau parent-passed array kosong
- `useEffect` untuk default role_id ke `roles[0].id` saat roles arrive
- Tidak bergantung pada timing parent's Promise.all

### Roles Page — RBAC matrix fix (catatan #10b)
Root cause: `useState(...)` cuma jalan sekali. Buka role kedua setelah
simpan role pertama → state basi. Fix:
- `useEffect` re-sync `form` dari `initial` prop setiap kali berubah
- Helper `normalizeInitial()` consolidate server→form shape mapping
  (`permissions[]`/`menus[]` → `permission_ids[]`/`menu_ids[]`)
- Swap `includes()` ke `useMemo`-backed `Set.has()` untuk O(1) lookup

### Master Pages — Auto-provisioned User disclosure (bonus)
- `ProvisionedUserModal` baru — tampil **sekali** setelah
  create Company/PPK, menampilkan username, email, `Ganti@123!` default
  password dengan copy-to-clipboard per field + warning "password ini
  tidak akan ditampilkan lagi".
- `useCrudPage` hook terima optional `onProvisioned` callback yang
  di-trigger ketika backend mengembalikan `auto_provisioned_user` di
  response payload.

---

## Testing manual

```bash
# 1) Build & seed
docker compose up -d --build
docker compose exec backend python seed.py

# 2) Login admin@knmp.id / Admin@123!

# 3) Alur inti yang bisa dites end-to-end:
#    a) Master Data → Perusahaan → Create (type=contractor)
#       → modal tampil user credentials auto-generated
#    b) Master Data → PPK → Create → modal tampil user credentials
#    c) Kontrak → Baru → isi form + ≥1 lokasi → Simpan
#       → otomatis status DRAFT, CCO-0 revision dibuat
#    d) Detail kontrak → Tab Lokasi → Add fasilitas (pick dari dropdown
#       Master Facility) → Upload BOQ Excel (format Ampean asli OK)
#    e) BOQ tab → cek auto-calc Total real-time, cek delete via checkbox
#    f) Tab CCO Revisions → Approve CCO-0 (DRAFT → APPROVED + Aktif)
#    g) Header kontrak → readiness checklist semua hijau →
#       "Aktifkan Kontrak" → status = ACTIVE
#    h) Tab Rekap BOQ Lokasi → lihat consolidated view semua fasilitas
#    i) Coba edit nomor kontrak di status ACTIVE → ditolak dengan hint
#    j) Buat Addendum type=CCO → CCO-1 otomatis dibuat dalam DRAFT
#    k) Edit BOQ di CCO-1 → Tab Revisions → Compare CCO-1 vs CCO-0
#    l) Approve CCO-1 → progress existing termigrate via source_item_id
#    m) Tandai Selesai → status = COMPLETED, semua edit ditolak
```

---

## Stats

- **Backend**: 41 files Python, 0 syntax errors
- **Frontend**: 26 files JS/JSX, 0 brace imbalance
- **API endpoints**: 11 baru ditambah di Tahap 2 (38 total di
  contracts/boq/master)
- **Service modules baru**: 3 (`user_provisioning`, `boq_revision`,
  `contract_lifecycle`)
- **Model baru**: `BOQRevision`, `MasterFacility`, 2 enum
  (`RevisionStatus`, `BOQChangeType`)
