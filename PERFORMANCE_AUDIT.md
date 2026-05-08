# Performance Audit — MARLIN v2

> Audit performa backend (FastAPI + SQLAlchemy + PostgreSQL) & frontend (React + Vite + AG-Grid). Disusun sebagai backlog optimasi konkret dengan estimasi dampak + lokasi file:line.
>
> **Skala target:** Kontrak ~50, lokasi ~300, fasilitas ~3.000, BOQ items ~50.000, laporan mingguan ~1.500/tahun, foto ~30.000/tahun.

**Last update:** Snapshot dari `main` per April 2026.

---

## Ringkasan Estimasi Dampak

| Area | Sebelum | Sesudah | Improvement |
|---|---|---|---|
| Dashboard load | 2–3 s | 200–300 ms | **~85%** |
| Contract detail load | 500 ms | 100–150 ms | **~70%** |
| BOQ grid scroll (50k items) | 20 fps | 55 fps | **2.7×** |
| Memory export Excel | 100 MB | 10–15 MB | **~85%** |
| Bandwidth (cache) | baseline | −40–50% | repeat views |

**Strategi:** kerjakan Top 10 Quick Wins (1–2 minggu) sebelum Architectural Investments.

---

## Severity Legend

- 🔴 **CRITICAL** — blocker untuk skala target (>10× slowdown atau memory blow-up).
- 🟠 **HIGH** — perf hit terasa user (>200ms tambahan, atau jelek di mobile).
- 🟡 **MEDIUM** — pengoptimalan layak tapi tidak urgent.
- 🟢 **LOW** — tweak kecil.

---

## 1. Backend — Query Patterns & N+1

### 🔴 1.1 N+1 Query di Dashboard Analytics
**Lokasi:** `backend/app/api/analytics.py:53-93`
**Pattern:** Loop setiap kontrak untuk fetch `WeeklyReport` terbaru per item, ditambah loop kedua untuk missing daily.
```python
for c in contracts:                 # 50 iterasi
    latest = db.query(WeeklyReport)...first()   # +50 query
```
**Dampak:** Dashboard load 2–3 s. Sequential 100+ query DB.
**Fix:**
```python
latest_per_contract = (
    db.query(WeeklyReport.contract_id, func.max(WeeklyReport.week_number))
      .filter(WeeklyReport.is_deleted.is_(False))
      .group_by(WeeklyReport.contract_id).all()
)
# join hasil ke contracts di Python (1 dict lookup)
```
**Effort:** M

---

### 🔴 1.2 N+1 di List Contracts (Company & PPK)
**Lokasi:** `backend/app/api/contracts.py:312-329`
**Pattern:** Per kontrak loop query `Company` + `PPK` terpisah → 100 query untuk 50 kontrak.
**Dampak:** List kontrak 800 ms – 1.5 s.
**Fix:** Pakai `selectinload` (sudah dipakai di `get_contract` line 340 — terapkan ke `list_contracts` juga):
```python
db.query(Contract).options(
    selectinload(Contract.company),
    selectinload(Contract.ppk),
).all()
```
**Effort:** S

---

### 🟠 1.3 N+1 di Weekly Report Detail
**Lokasi:** `backend/app/api/weekly_reports.py:62-74` (`_report_to_dict(detail=True)`)
**Pattern:** Lazy access `r.progress_items` dalam loop. Bila report punya 1.000 progress items → 1.000+ query.
**Dampak:** Detail report 2–5 s vs 100 ms.
**Fix:** Eager load di `get_report`:
```python
r = db.query(WeeklyReport).options(
    selectinload(WeeklyReport.progress_items),
    selectinload(WeeklyReport.photos),
).filter(...).first()
```
**Effort:** S

---

### 🟠 1.4 Missing Composite Indexes
**Lokasi:** `backend/app/models/models.py` (cek `__table_args__` per model)

Index yang sudah ada mostly single-column. Filter umum tidak ter-cover:

| Tabel | Filter umum | Index belum ada |
|---|---|---|
| `boq_revisions` | `(contract_id, is_active, status)` | ⚠️ |
| `weekly_reports` | `(contract_id, is_deleted, week_number)` | ⚠️ |
| `variation_orders` | `(contract_id, status)` | ⚠️ |
| `payment_terms` | `(contract_id, status)` | ⚠️ |

**Dampak:** Sequential scan 50–100 ms per request, bertumpuk seiring data tumbuh.
**Fix:**
```python
__table_args__ = (
    Index("idx_boq_rev_active_status", "contract_id", "is_active", "status"),
    Index("idx_weekly_report_lookup", "contract_id", "is_deleted", "week_number"),
)
```
+ Alembic migration / `_ensure_indexes` helper di `main.py`.
**Effort:** S (per index)

---

### 🟡 1.5 Aggregation di Python, Bukan SQL
**Lokasi:** `backend/app/api/analytics.py:49-76`
**Pattern:** `sum(float(c.current_value) for c in contracts)` setelah `.all()`.
**Dampak:** Memory & CPU loop di app, padahal DB jauh lebih cepat.
**Fix:**
```python
total_value = db.query(func.coalesce(func.sum(Contract.current_value), 0)) \
    .filter(...).scalar()
```
**Effort:** S

---

## 2. Backend — Memory & Streaming

### 🟠 2.1 Excel Export Full-load ke Memory
**Lokasi:** `backend/app/services/vo_excel_service.py:155-180`, `template_service.py`, BOQ export future endpoint.
**Pattern:** Seluruh workbook openpyxl di-build di RAM sebelum return bytes.
**Dampak:** Snapshot 50.000 BOQ items × ~20 kolom → 50–100 MB per request. Concurrent 5 request = 250–500 MB. **OOM risk** di server 2–4 GB.
**Fix:**
```python
with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
    wb.save(tmp.name)
return FileResponse(tmp.name, media_type="application/vnd.openxmlformats-...")
```
Atau pakai `WriteOnlyWorkbook(write_only=True)` openpyxl untuk row-streaming append-only (memory rendah).
**Effort:** M

---

### 🟡 2.2 Photo Resize Buffering
**Lokasi:** `backend/app/services/file_service.py` (cek implementasi Pillow resize)
**Pattern:** File upload di-load full ke memory sebelum Pillow resize.
**Dampak:** 5 MB foto × 20 concurrent upload = 100 MB peak.
**Fix:** Stream chunked read → Pillow `Image.open(stream)` → save ke disk; atau pindahkan ke background job (APScheduler / queue) supaya request return cepat.
**Effort:** M

---

### 🟡 2.3 Audit Log Diff — Full Row Dump
**Lokasi:** `backend/app/services/audit_service.py:log_audit`
**Pattern:** Bila changes={...} di-pass dengan seluruh field (bukan hanya delta), JSONB membengkak.
**Dampak:** Untuk 50.000 BOQ item update, audit log menumpuk cepat.
**Fix:** Helper `diff_dict(old, new)` untuk hanya simpan delta + assert maksimum size per row.
**Effort:** S

---

## 3. Backend — Concurrency & Race Conditions

### 🟠 3.1 Race: BOQ Revision `is_active` Flip
**Lokasi:** `backend/app/services/boq_revision_service.py:approve_revision`
**Pattern:** Set lama `is_active=False` → set baru `is_active=True` dalam dua statement. Concurrent approve dua revisi → kedua bisa lewat sebelum DB partial unique index trigger.
**Dampak:** Saat ini DB partial unique index `uq_one_active_revision_per_contract` SUDAH ada (baris 537–541 di `models.py`) — jadi DB akan reject. Tetapi error muncul sebagai 500 IntegrityError, bukan 409 Conflict.
**Fix:** Wrap di transaksi `BEGIN ... SELECT ... FOR UPDATE` di row revisi lama, atau catch `IntegrityError` → return 409 dengan pesan informatif.
**Effort:** M

---

### 🟠 3.2 Race: `term_number` Autoincrement
**Lokasi:** `backend/app/api/payments.py:108-112`
**Pattern:** Check-then-act:
```python
if db.query(PaymentTerm).filter(...term_number == data.term_number).first():
    raise HTTPException(400, "sudah ada")
db.add(PaymentTerm(...))
db.commit()
```
Concurrent dua POST term_number=3 bisa lolos check, salah satu fail di unique constraint.
**Dampak:** Sporadic 500 error.
**Fix:**
```python
try:
    db.add(t); db.commit()
except IntegrityError:
    db.rollback()
    raise HTTPException(409, "Termin sudah ada")
```
Tambah `UniqueConstraint("contract_id", "term_number")` di model bila belum ada.
**Effort:** S

---

## 4. Frontend — Render & Bundle

### 🔴 4.1 ContractDetailPage Component Bloat (4.539 baris)
**Lokasi:** `frontend/src/pages/ContractDetailPage.jsx` (seluruhnya)
**Pattern:**
- 16+ `useState` di top-level + lebih banyak di sub-panel.
- Modal & sub-panel didefinisi inline (AddLocationModal, AddFacilityModal, BOQImportWizard, EditContractModal, dst.) → **re-mount setiap render** karena reference function berubah.
- Sub-komponen tidak `React.memo`.

**Dampak:**
- Toggle tab "Lokasi" → re-render seluruh 4.539 baris + semua panel.
- First paint 800 ms – 1.5 s (Lighthouse).
- Input delay > 1 s saat edit form (jank).

**Fix (bertahap):**
1. Pindahkan modal/panel definisi keluar component (file terpisah) → tidak re-create.
2. Wrap sub-panel dengan `React.memo`.
3. Extract state cluster ke custom hook (`useContractDetailState`) atau Zustand slice.
4. Pecah ke ~5 sub-komponen: LocationsPanel, FacilitiesPanel, BOQRevisionsPanel, VOPanel, AddendumPanel.

**Effort:** L

---

### 🟠 4.2 BOQGrid Cell Rendering
**Lokasi:** `frontend/src/components/grids/BOQGrid.jsx`
**Pattern:**
- `cellRenderer` dibuat inline → reference baru tiap render → AG-Grid re-render seluruh sel.
- `rowData` array reference berubah unnecessarily.
- Tidak ada `getRowId` stable → row re-mount pada update.

**Dampak:** 50.000-row BOQ grid → DOM thrashing. Scroll 60 fps → 20 fps. Edit cell 1–2 s jank.

**Fix:**
```jsx
const RibbonCell = useMemo(() => memo(({ value }) => <span>{value}</span>), []);
const rowData = useMemo(() => items, [items]);

<AgGridReact
  rowData={rowData}
  getRowId={(params) => params.data.id}
  components={{ ribbonCell: RibbonCell }}
  rowHeight={28}
  suppressRowClickSelection
/>
```

**Effort:** M

---

### 🟡 4.3 No Code-Splitting Routes
**Lokasi:** `frontend/src/App.jsx:1-65`
**Pattern:** Semua page di-import statik. ContractDetailPage 4.539 baris ikut bundle utama.
**Dampak:** Initial bundle ~500 KB – 1 MB. First load 3–5 s desktop, 8–10 s mobile 3G.
**Fix:**
```jsx
const ContractDetailPage = lazy(() => import("@/pages/ContractDetailPage"));
// wrap <Routes> dengan <Suspense fallback={<PageLoader />}>
```
**Effort:** M

---

### 🟡 4.4 Zustand Store Subscribe Whole State
**Lokasi:** `frontend/src/store/auth.js:4-47` (dan store lain)
**Pattern:** Komponen pakai `const { user, menus, loading } = useAuthStore()`. Setiap update slice manapun → re-render semua subscriber.
**Dampak:** Tab switch → 20+ komponen re-render unnecessary.
**Fix:** Selector pattern:
```js
const user = useAuthStore(s => s.user);
const menus = useAuthStore(s => s.menus);
```
Atau pakai `shallow` dari zustand untuk multi-field.
**Effort:** S

---

### 🟡 4.5 Tidak Ada Request Caching/Dedup
**Lokasi:** `frontend/src/api/index.js`
**Pattern:** Axios polos. Tab switch BOQ A → B → A → 3× fetch endpoint sama.
**Dampak:** Bandwidth & latency redundant. ~40–50% wasted untuk repeat views.
**Fix:** Adopsi React Query / TanStack Query:
```js
const { data } = useQuery({
  queryKey: ["boq", facilityId],
  queryFn: () => boqAPI.listByFacility(facilityId),
  staleTime: 5 * 60 * 1000,
});
```
**Effort:** M (integrasi bertahap per page)

---

## 5. Top 10 Quick Wins (Effort S/M, Dampak Tinggi)

| # | Item | Lokasi | Fix | Impact | Effort |
|---|---|---|---|---|---|
| 1 | N+1 Dashboard Analytics | `analytics.py:53` | Batch fetch reports + group_by | 2–3 s → 200 ms | S |
| 2 | N+1 List Contracts | `contracts.py:312` | `selectinload(Company, PPK)` | 800 ms → 100 ms | S |
| 3 | Composite Index `boq_revisions` | `models.py` | `(contract_id, is_active, status)` | 50–100 ms → 1 ms | S |
| 4 | `term_number` Race | `payments.py:108` | Catch `IntegrityError` → 409 | Sporadic 500 → reliable | S |
| 5 | Zustand Selector | `store/auth.js` | `s => s.user` | Tab switch jank → smooth | S |
| 6 | Weekly Report Eager Load | `weekly_reports.py:62` | `selectinload(progress_items)` | 2–5 s → 100 ms | S |
| 7 | Aggregate di SQL | `analytics.py:49` | `func.sum()` di DB | Memory & CPU ↓ | S |
| 8 | Code Split Routes | `App.jsx` | `lazy()` + `<Suspense>` | 1 MB → 300 KB initial | M |
| 9 | BOQGrid Memo | `BOQGrid.jsx` | Memo cell + rowData + getRowId | Scroll 20 → 55 fps | M |
| 10 | Excel Export Streaming | `vo_excel_service.py` | `WriteOnlyWorkbook` / FileResponse | 100 MB → 10 MB | M |

---

## 6. Top 5 Architectural Investments (Effort L, ROI Besar)

| # | Inisiatif | Files | Benefit | Timeline |
|---|---|---|---|---|
| 1 | Refactor ContractDetailPage | `ContractDetailPage.jsx` | 4.500 → ~500 LOC, 60% faster, maintainable | 1–2 sprint |
| 2 | React Query / API Cache | `api/index.js` + pages | Dedup, offline-first, −40% bandwidth | 2–3 sprint |
| 3 | Backend Batch Pattern | `analytics.py`, `contracts.py`, `boq.py` | Eliminasi 90% N+1 | 2–3 sprint |
| 4 | DB Migration Indexes | `models.py` + Alembic | +15 strategic indexes, latency ↓ | 1 sprint |
| 5 | Excel/File Streaming Service | `template_service.py`, `vo_excel_service.py`, future `boq_export_service.py` | 50k items streaming, OOM-safe | 1–2 sprint |

---

## 7. Cara Pakai Dokumen Ini

1. Ambil item dari **Top 10 Quick Wins** (mulai dari yang Effort S).
2. Buat branch `claude/perf-<short-desc>`.
3. Implementasi + ukur sebelum/sesudah dengan log timing atau test bench (siapkan endpoint `/health/perf` untuk benchmark).
4. Update tabel di file ini saat item selesai (centang ✅ + commit hash).
5. Setelah Quick Wins habis, baru menyentuh Architectural Investments.

**Prinsip:** ukur dulu sebelum optimize — kalau dampak nyata < 50% perkiraan, evaluasi ulang prioritas.

---

*Audit ini akan jadi usang seiring repo berkembang. Refresh setiap 3 bulan atau setelah migrasi besar.*

