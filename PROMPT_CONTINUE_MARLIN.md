# PROMPT: Lanjutkan Pengembangan MARLIN v2

> File ini adalah **handoff brief untuk sesi AI berikutnya** yang akan melanjutkan pengembangan/perbaikan codebase MARLIN v2 yang sudah berjalan. **Bukan** untuk build dari nol — untuk itu pakai `PROMPT_BUILD_MARLIN.md`.

---

## 0. Tujuan File Ini

- Beri konteks codebase secepat mungkin tanpa harus baca seluruh repo.
- Hindari pengulangan kesalahan yang sudah pernah dibuat & diperbaiki.
- Jaga konvensi & pola implementasi yang sudah disepakati supaya tidak tambal sulam.

**Untuk pemahaman domain bisnis (BOQ, addendum, VO, PPN, dst.), baca `PROMPT_BUILD_MARLIN.md` di root repo.** Dokumen ini fokus ke aspek teknis & operasional repo.

---

## 1. Stack & Struktur Repo

**Backend** (`/backend`):
- Python + FastAPI + SQLAlchemy 2.0
- PostgreSQL (JSONB untuk fields fleksibel)
- openpyxl untuk Excel parse/generate
- pandas untuk data processing
- APScheduler untuk job harian
- Pillow untuk thumbnail foto
- Auth: JWT + bcrypt

**Frontend** (`/frontend`):
- React 18 + Vite
- AG-Grid untuk tabel besar (BOQ, progress, audit)
- TailwindCSS untuk styling
- Zustand untuk state management (lihat `frontend/src/store/`)
- Axios untuk API calls (`frontend/src/api/index.js`)

**Struktur folder backend:**
```
backend/app/
├── api/           # FastAPI routers (1 file per modul: contracts, boq, facilities, ...)
├── core/          # config, database, security
├── models/        # SQLAlchemy models (semua di models.py)
├── schemas/       # Pydantic schemas (semua di schemas.py)
├── services/      # Business logic (boq_revision_service, vo_service, dll.)
├── tasks/         # APScheduler jobs
└── utils/         # Helpers
```

**Struktur folder frontend:**
```
frontend/src/
├── api/           # API client (index.js)
├── components/    # Reusable: grids/, modals/, layouts/
├── pages/         # Route-level pages (ContractDetailPage, ContractsPage, ...)
├── store/         # Zustand stores
└── utils/         # format.js, dll.
```

---

## 2. Branch Strategy & Workflow

- **Main branch:** `main` — tracked, semua merged work landed di sini.
- **Feature branch:** `claude/<short-description>` (mis. `claude/dashboard-eksekutif`, `claude/boq-lifecycle-refactor`).
- **Merge style:** `git merge --no-ff` ke `main` (preserve branch context sebagai merge commit).
- **Commit message:** Bahasa Indonesia singkat, format konvensional:
  - `feat(modul): ...` untuk fitur baru
  - `fix(modul): ...` untuk bug
  - `docs: ...` untuk dokumentasi
  - `refactor(modul): ...` untuk restructure tanpa ubah behavior
- **Tidak ada CI yang block merge** — verifikasi manual (lihat Bagian 9).
- Setiap commit dari sesi Claude wajib include footer link:
  ```
  https://claude.ai/code/session_<id>
  ```

---

## 3. Konvensi Penting yang HARUS Dijaga

### 3.1 Backend
- **Audit log di setiap operasi tulis.** Helper: `app.services.audit_service.log_audit(db, user, action, entity_type, entity_id, changes={...}, request=request, commit=True)`.
- **Permission check** via dependency: `current_user = Depends(require_permission("module.action"))`.
- **Scope guard untuk lokasi-editable**: `app.api._guards.assert_scope_editable_by_location(db, location_id)` — sudah meng-handle scope-lock saat BOQ approved.
- **Self-FK BOQItem (parent_id):** sebelum hapus parent, **clear `parent_id` & `source_item_id` di child dulu** untuk hindari `CircularDependencyError`. Pattern: lihat `app/api/locations.py:delete_location` & `facilities.py:delete_facility`.
- **PPN convention**: BOQ items disimpan **PRE-PPN**, nilai kontrak **POST-PPN**. Validasi: `sum(BOQ leaf) × (1 + ppn/100) ≤ contract_value`, **toleransi Rp 1**.
- **`exclude_unset=True`** di Pydantic dump saat update — supaya field yang sengaja di-set ke `null` benar-benar ter-apply, bukan diabaikan.
- **`is_leaf` auto-derive** dari graph parent_id (filter `is_active=True` saat collect parent_ids). Jangan set manual.

### 3.2 Frontend
- **`scopeEditable` flag** di ContractDetailPage menggabungkan `contract.status === DRAFT` & `!boqLocked`. Pakai ini untuk semua tombol scope-editing (lokasi, fasilitas, BOQ).
- **Disable bukan hide** untuk aksi yang tidak boleh — supaya user tahu kenapa.
- **Tombol berbahaya** wajib konfirmasi modal (delete kontrak, sign addendum, approve revisi, godmode).
- **Format angka di input**: desimal pakai titik, tanpa pemisah ribuan saat user mengetik.
- **Format display**: `Rp 1.234.567` dengan pemisah ribuan (utility di `frontend/src/utils/format.js`).
- **Header PPN breakdown**: gunakan format eksplisit `BOQ Rp X + PPN Rp Y (Z%) = Rp Total`. **Hindari notasi ambigu** seperti `× (1+11%)` — user pernah complain ini ambigu.

---

## 4. File Kunci yang Sering Disentuh

### Backend
| File | Tanggung jawab |
|---|---|
| `backend/app/models/models.py` | **Semua** SQLAlchemy models. File panjang — pakai grep untuk lompat ke entity. |
| `backend/app/schemas/schemas.py` | **Semua** Pydantic schemas. |
| `backend/app/api/contracts.py` | Router kontrak + addendum (DRAFT→SIGNED flow, chain status, sign/delete). |
| `backend/app/api/boq.py` | Router BOQ (CRUD, revisi, approve, diff, import/export, rollup). |
| `backend/app/api/facilities.py` | Router fasilitas (cascade-safe delete). |
| `backend/app/api/locations.py` | Router lokasi (cascade-safe delete, koordinat wajib). |
| `backend/app/api/variation_orders.py` | Router VO (state machine, items CRUD). |
| `backend/app/api/field_observations.py` | Router MC-0 / MC-Interim. |
| `backend/app/services/boq_revision_service.py` | Clone revisi, approve, diff antar revisi (source_item_id chain). |
| `backend/app/services/vo_service.py` | Apply VO items ke revisi BOQ baru, state transitions. |
| `backend/app/services/vo_excel_service.py` | Export/import VO snapshot Excel (UUID matching primary, code fallback). |
| `backend/app/services/template_service.py` | Generate template Excel BOQ. |
| `backend/app/services/boq_import_service.py` | Parse Excel BOQ (Simple + multi-sheet KKP). |
| `backend/app/services/audit_service.py` | Log audit. |
| `backend/seed_demo.py` | Seed demo data (kontrak, lokasi, BOQ, VO multi-action). |
| `backend/seed_master.py` | Seed master data (role, permission, master facility, kode kerja). |
| `backend/main.py` | Entry point + auto-migration enum/column. |

### Frontend
| File | Tanggung jawab |
|---|---|
| `frontend/src/pages/ContractDetailPage.jsx` | **File terbesar**. Tab kontrak: lokasi, fasilitas, BOQ, addendum, VO, termin, timeline. Banyak modal di dalam. |
| `frontend/src/pages/ContractsPage.jsx` | List + form Kontrak Baru (PPN field, helper text). |
| `frontend/src/components/grids/BOQGrid.jsx` | AG-Grid BOQ dengan parent picker portal, header info leaf+parent. |
| `frontend/src/components/modals/BOQItemPickerModal.jsx` | Modal tambah/edit item BOQ dengan parent picker. |
| `frontend/src/api/index.js` | Semua API method (contractsAPI, boqAPI, voAPI, dll.). |
| `frontend/src/utils/format.js` | Format angka, mata uang Rp, persentase. |

---

## 5. Pitfalls yang Sudah Pernah Terjadi (JANGAN ULANGI)

Setiap kasus ini sudah ada commit fix-nya. Pelajari pattern-nya sebelum modifikasi area terkait.

| Kasus | Root Cause | Pattern Fix | Commit |
|---|---|---|---|
| **CircularDependencyError saat hapus lokasi/fasilitas** | Self-FK `BOQItem.parent_id` tanpa CASCADE DB-level | Clear parent_id & source_item_id child dulu sebelum delete | `162db25` |
| **NameError 'actual' di approve_revision** | Variable rename dari refactor PPN tidak konsisten | Search-replace tuntas saat rename | `162dadb` |
| **Tolerance 0.01 terlalu ketat untuk PPN** | Floating-point error akumulasi | Pakai **Rp 1** sebagai tolerance | `bd110ef` |
| **`is_leaf` tetap false setelah child dihapus** | Filter parent_ids tidak include `is_active=True` | Filter `is_active=True` di parent_ids collect | `77fa195` |
| **`parent_id=null` tidak ter-apply** | `exclude_none=True` di Pydantic dump menelan null | Pakai **`exclude_unset=True`** | `77fa195` |
| **Tombol Import BOQ aktif saat kontrak ACTIVE** | UI tidak guard `boqLocked` | Tambah `disabled={boqLocked}` | scope-lock commits |
| **Auto-sync overwrite Nilai Kontrak saat import** | Filter terlalu lebar | Filter `original_value <= 0` + factor PPN | `a7681b8` |
| **Konvensi PPN 3x berubah** (POST→PRE→POST final) | Interpretasi user beda dengan AI | **Konvensi final: BOQ pre-PPN, kontrak post-PPN.** Konfirmasi sebelum ubah. | `b76b741`, `e9eed7a` |
| **Notasi `× (1+11%)` ambigu** | Bisa diartikan 12% | Gunakan format eksplisit `BOQ + PPN (X%) = Total` | `e9eed7a` |
| **Header BOQ total mismatch dengan facility card** | Sum semua row termasuk parent | Filter `is_leaf=true` saat sum | `232cf6b` |
| **Scope masih editable saat addendum + approved** | Inkonsistensi `scopeEditable` | Gabung dengan `!boqLocked` | `4f22fd2` |
| **REMOVE_FACILITY pending tidak di Excel VO** | Helper hilang | Tambah `_pending_remove_facility` | vo_excel_service |
| **Semua row jadi ADD saat upload VO** | Code kosong di legacy data, matching pakai code | Tambah UUID hidden column sebagai primary matcher | vo_excel_service |
| **`parent_boq_item_id` hilang saat edit VO** | Form init mapping tidak include field | Tambah ke mapping | `c44a40e` |

**Lesson umum:** Saat fix bug, **cari root cause, jangan tambal sulam**. User secara eksplisit pernah complain: *"kamu melakukan perbaikan tidak pernah komprehensif, pasti buang token dan waktu."*

---

## 6. Status Saat Ini (Snapshot)

**Sudah merged ke `main`:**
- Auth + RBAC (8 role, dynamic permission, dynamic menu).
- Master data (perusahaan, PPK, master fasilitas, master kode kerja).
- Kontrak: CRUD, gate aktivasi (lokasi, fasilitas, BOQ approved, nilai BOQ ≤ kontrak).
- BOQ hirarki 4 level dengan parent_id self-FK + auto-derive `is_leaf`.
- Revisi BOQ V0/V1/... dengan `source_item_id` chain + `is_active` invariant DB-level.
- Variation Order state machine (DRAFT→UNDER_REVIEW→APPROVED→BUNDLED) + 6 action type (ADD, INCREASE, DECREASE, MODIFY_SPEC, REMOVE, REMOVE_FACILITY).
- Addendum DRAFT→SIGNED flow dengan auto-spawn revisi BOQ baru.
- Field Observation MC-0/MC-Interim.
- PPN per-kontrak (default 11%, configurable).
- Scope-lock konsisten dengan boqLocked.
- Laporan harian + mingguan dengan kalkulasi kurva-S, deviasi, SPI.
- Field Review Itjen + temuan severity.
- Termin pembayaran dengan anchor revisi BOQ.
- Notifikasi (rule + queue, scheduler harian).
- Dashboard Eksekutif (peta + galeri foto + kurva-S).
- VO Excel snapshot (export/import dengan UUID matching).
- Audit log lengkap dengan diff before/after + godmode tag.
- Auto-provisioning user dari Perusahaan/PPK.

**Belum dibangun (backlog yang sempat dibahas):**
- **BOQ Comparison & Export Engine** — user pernah request tapi belum diimplementasi:
  - Ekspor BOQ aktif ke Excel (formula) & PDF (Landscape).
  - Komparasi 2 revisi BOQ (V0 vs V1, V1 vs V2, dst.) dengan kolom Pekerjaan A/B, Tambah, Kurang, Ket.
  - PDF komparasi Landscape proporsional.
  - UI: 2 dropdown selector + AG-Grid preview + tombol "Unduh Excel/PDF".
  - Sempat ada plan: tambah `reportlab` ke `requirements.txt` + service `boq_export_service.py`.
- **Ekspor format e-Kontrak nasional** (Perpres 46/2025) — stub belum dibuat.
- **Berbagai PDF dokumen resmi** (BA MC, BA Addendum, BA Pembayaran, sertifikat penyelesaian) — disebut di prompt belum diimplementasi.

**Cek status terbaru sebelum mulai:**
```bash
git log --oneline -20      # commit terbaru
git status                 # uncommitted changes
git branch                 # active branches
```

---

## 7. Cara Mulai Kerja (Onboarding 5 Menit)

1. **Baca `PROMPT_BUILD_MARLIN.md` + file ini.** Total ~25 menit baca.
2. **Cek branch & status terkini:** `git log --oneline -20`, `git status`.
3. **Buat branch fitur** dari `main`: `git checkout -b claude/<short-desc>`.
4. **Pahami modul yang akan disentuh** — buka file di Bagian 4 + grep pattern.
5. **Cek pitfall di Bagian 5** apakah area kerja overlap dengan kasus yang pernah terjadi.
6. **Jika ada keraguan tentang aturan bisnis** → BERHENTI dan tanya user, jangan tebak.
7. **Implementasi end-to-end** (backend + frontend + audit), bukan per-layer.
8. **Test manual di browser** sebelum claim selesai (lihat Bagian 9).
9. **Commit kecil & deskriptif** (Bahasa Indonesia, format conventional commit).
10. **Push & merge** dengan `--no-ff` ke `main` setelah konfirmasi user.

---

## 8. Hal yang TIDAK Boleh Dilakukan

- ❌ **Auto-migration ad-hoc** di luar `backend/main.py:_ensure_columns` / `_ensure_enum_values` pattern.
- ❌ **Tambal sulam** — selalu cari root cause.
- ❌ **Ubah konvensi PPN** tanpa konfirmasi user.
- ❌ **Hard-delete** entitas penting (kontrak, lokasi, fasilitas, BOQ, VO, addendum).
- ❌ **Skip audit log** di operasi tulis.
- ❌ **Hide menu/button** untuk permission denial — gunakan disable agar user tahu.
- ❌ **Edit `source_item_id`/`parent_id`** langsung tanpa pakai service layer.
- ❌ **Push langsung ke `main`** tanpa branch fitur (kecuali docs trivial atas perintah user).
- ❌ **Force push / `--no-verify` / `--amend`** — selalu commit baru.
- ❌ **Bypass scope-lock guard** kecuali via god-mode (yang ter-tag audit).
- ❌ **Translate istilah domain** — PPK, KPA, BOQ, Addendum, Termin, MC, Itjen tetap dalam Bahasa Indonesia.
- ❌ **Buat dokumen markdown baru** kecuali user minta eksplisit.

---

## 9. Cara Verifikasi Sebelum Claim Selesai

**Backend:**
- Endpoint baru/berubah: test via `curl` atau Swagger UI (`/docs`).
- DB invariant: cek manual via query (mis. `SELECT count(*) FROM boq_revisions WHERE contract_id=X AND is_active=true` harus = 1).
- Audit log: cek baris baru tertulis dengan diff yang benar.
- Permission: test dengan akun role berbeda (mis. login sebagai konsultan, pastikan tidak bisa akses kontrak orang lain).

**Frontend:**
- Buka browser, login, navigate ke halaman terkait.
- Test golden path + minimal 1 edge case (kontrak DRAFT tanpa BOQ, revisi tanpa item, addendum nilai 0).
- Cek console browser untuk error/warning.
- Cek responsive layout (lebar lg: dan mobile sm:).

**Catat di commit message** apa yang sudah ditest, terutama edge case.

---

## 10. Sumber Referensi di Repo

- `PROMPT_BUILD_MARLIN.md` — spesifikasi domain bisnis lengkap.
- `PROMPT_CONTINUE_MARLIN.md` — file ini.
- `CHANGELOG.md` — riwayat fitur per release.
- `README.md` — quickstart developer.
- `backend/seed_demo.py` — contoh data realistis (kontrak, lokasi, BOQ multi-fasilitas, VO multi-action). Pakai sebagai referensi saat butuh contoh struktur data.

---

## 11. Cara Pakai File Ini di Sesi Baru

**Opsi 1 — `CLAUDE.md` di root repo (disarankan):**
```bash
cp PROMPT_CONTINUE_MARLIN.md CLAUDE.md
# atau gabung dua-duanya:
cat PROMPT_BUILD_MARLIN.md PROMPT_CONTINUE_MARLIN.md > CLAUDE.md
```

**Opsi 2 — Reference saat sesi mulai:**
> "Baca `PROMPT_CONTINUE_MARLIN.md` dan `PROMPT_BUILD_MARLIN.md` di root repo dulu sebelum mulai. Saya minta tolong: \<deskripsi tugas\>."

---

*Dokumen ini akan jadi usang seiring repo berkembang. Update saat ada konvensi baru atau pitfall baru ditemukan.*



