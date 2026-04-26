# PROMPT: Membangun Sistem MARLIN dari Nol

> Salin seluruh isi file ini sebagai pesan pertama di sesi AI baru. Atau letakkan sebagai `CLAUDE.md` di root repo kosong agar otomatis termuat oleh Claude Code.

---

## 0. Cara Kerja yang Diharapkan dari AI

Sebelum menulis kode satu baris pun:

1. **Pahami dulu seluruh dokumen ini end-to-end.** Jangan mulai dari satu bagian tanpa membaca yang lain — banyak invariant lintas-modul.
2. **Rencanakan arsitektur secara utuh** sebelum implementasi. Saya bebas memilih bahasa, framework, database, dan stack — pilih yang paling cocok untuk skala data di Bagian 14, dan konsisten sampai akhir.
3. **Tidak ada tambal sulam.** Kalau ada keraguan tentang aturan bisnis, **tanya dulu** — jangan menebak. Kalau ada konflik antara dua bagian dokumen ini, juga tanya.
4. **Definisi selesai = fitur bekerja end-to-end** (input → simpan → tampil → ekspor/notifikasi). Bukan sekadar lulus type-check.
5. **Aturan bisnis (Bagian 9) wajib dienforce di backend**, bukan hanya di UI. UI hanya "hint"; sumber kebenaran ada di server.
6. **Setiap perubahan data sensitif harus tercatat di audit log** (Bagian 12). Tidak ada operasi diam-diam.
7. **Bahasa domain adalah Bahasa Indonesia** — istilah seperti PPK, KPA, BOQ, Addendum, Termin, MC, Itjen, Konsultan MK harus dipertahankan. Jangan diterjemahkan.

---

## 1. Konteks Bisnis

**Domain:** Sistem monitoring pelaksanaan kontrak konstruksi infrastruktur — khususnya proyek Kampung Nelayan Merah Putih (KNMP) di bawah Kementerian Kelautan & Perikanan. Compliance terhadap Perpres 16/2018 ps. 54 (perubahan kontrak via Addendum/CCO).

**Tujuan utama:**

- Melacak progres fisik pekerjaan di banyak lokasi terdistribusi secara real-time.
- Mengelola siklus perubahan kontrak (Variation Order → Addendum → Revisi BOQ) dengan jejak audit lengkap.
- Mengontrol pencairan termin pembayaran berbasis progres aktual.
- Memberi peringatan dini deviasi jadwal & nilai (SPI, deviasi %, laporan telat).
- Menyediakan dashboard visual untuk pejabat (eksekutif, PPK, Itjen) dan input lapangan untuk konsultan.

**Skala referensi:** Kontrak ~20–50, Lokasi ~3–10/kontrak, Fasilitas ~5–20/lokasi, BOQ items ~100–500/fasilitas, Laporan Mingguan ~12–24/kontrak, VO ~2–10/kontrak, Termin ~3–6/kontrak.

---

## 2. Pengguna & Peran (RBAC)

| Peran | Deskripsi singkat | Hak utama |
|---|---|---|
| **Superadmin** | God-mode sistem | Semua, termasuk konfigurasi role & menu |
| **Admin Pusat** | Operator pusat | Kelola kontrak, master data, laporan, termin (tanpa user/role mgmt) |
| **PPK** (Pejabat Pembuat Komitmen) | Pemilik kontrak | Approve VO/Addendum/Termin; tanda tangan |
| **Manager / Koordinator** | Monitor multi-kontrak | Read-only luas |
| **Konsultan MK** (Manajemen Konstruksi) | Pengawas lapangan | Input laporan harian/mingguan, review teknis VO |
| **Kontraktor** | Pelaksana fisik | Read-only kontrak miliknya, view status termin |
| **Itjen** (Inspektorat Jenderal) | Inspektur internal | Buat field review + temuan, lihat semua kontrak |
| **Viewer** | Pengamat pasif | Read-only |

**Prinsip RBAC:**

- Permission granular bentuk `module.action` (`contract.update`, `report.create`, `payment.read`, dll.).
- Role-permission relasi **dynamic** (bisa diubah Superadmin), **bukan hardcoded** di kode.
- Menu navigasi juga dinamis per role (relasi role↔menu di DB).
- **Scope assignment per kontrak**: User punya daftar `assigned_contract_ids`. Konsultan & Kontraktor hanya melihat kontrak yang ditugaskan; PPK/Manager/Itjen/Admin melihat semua (null = all).
- **Konsultan filter per-lokasi**: `location.konsultan_id` menentukan konsultan mana yang berhak input laporan untuk lokasi tersebut (bukan per-kontrak).

---

## 3. Entitas Domain

Berikut object bisnis utama. Relasi dijelaskan dalam bahasa fungsional, bukan skema DB.

### 3.1 Master Data
- **Company** — perusahaan (kontraktor / konsultan / supplier). Punya NPWP, alamat, kontak. Saat dibuat, otomatis di-provision satu user default (login pertama wajib ganti password).
- **PPK** — pejabat fisik dengan NIP, jabatan, satker, nomor WhatsApp (untuk notifikasi). Terikat ke satu user.
- **Master Facility** — katalog standar tipe fasilitas (Gudang Beku, Pabrik Es, Cool Box, dll. ~20 item).
- **Master Work Code** — katalog kode pekerjaan standar dengan kategori (persiapan, struktural, MEP, finishing, dll.).

### 3.2 Kontrak & Lingkupnya
- **Kontrak** — perjanjian kerja. Punya nomor unik, nama, PPK pemilik, perusahaan kontraktor, tahun anggaran, nilai original (post-PPN), nilai current (post-PPN), tanggal mulai/selesai, durasi, persentase PPN, dokumen kontrak (file).
- **Lokasi** — area geografis di bawah satu kontrak. Punya kode, nama desa/kecamatan/kota/provinsi, koordinat (lat/long wajib), dan satu konsultan MK pengawas.
- **Fasilitas** — bangunan/struktur di dalam satu lokasi. Punya kode unik per lokasi, tipe (referensi master), nama, urutan tampil.

### 3.3 BOQ (Bill of Quantity)
- **Revisi BOQ** — versi BOQ terikat ke kontrak. Versi pertama (V0) adalah baseline kontrak. Versi berikutnya (V1, V2, …) lahir dari Addendum yang menyentuh BOQ. Status: DRAFT, APPROVED, SUPERSEDED. Tepat **satu** revisi per kontrak boleh `is_active=true`.
- **Item BOQ** — baris pekerjaan di dalam satu revisi, milik satu fasilitas. Hirarkis (level 0–3, parent-child via self-FK). Atribut: kode, deskripsi, satuan, volume, harga satuan (pre-PPN), total harga, bobot %, planned start/duration, link ke item pendahulu (`source_item_id`) untuk diff antar revisi, flag `is_leaf`.

### 3.4 Perubahan Kontrak
- **Variation Order (VO)** — usulan perubahan teknis pra-Addendum. State machine: DRAFT → UNDER_REVIEW → APPROVED → BUNDLED (atau REJECTED terminal). Berisi banyak **VO Item** yang masing-masing punya action: ADD, INCREASE, DECREASE, MODIFY_SPEC, REMOVE, REMOVE_FACILITY.
- **Addendum** — dokumen legal perubahan kontrak. Tipe: CCO (perubahan lingkup), EXTENSION (durasi), VALUE_CHANGE (nilai), COMBINED. Bundle ≥1 VO APPROVED. Flow DRAFT → SIGNED. Saat SIGNED, otomatis spawn revisi BOQ baru dan dampak finansial/durasi diterapkan ke kontrak.
- **Field Observation (Berita Acara MC)** — pengukuran lapangan informal sebelum VO formal. Tipe MC-0 (unik per kontrak, baseline pengukuran awal) dan MC-INTERIM (banyak boleh). Bukan dokumen legal, hanya input justifikasi VO.

### 3.5 Pelaporan Progres
- **Laporan Harian** — narasi aktivitas per lokasi per hari: cuaca, manpower, equipment, kendala, foto per fasilitas. **Tanpa angka progres**.
- **Laporan Mingguan** — progres fisik per item BOQ (leaf only) per minggu. Volume kumulatif aktual, foto, catatan. Sistem otomatis hitung deviasi vs rencana, SPI, kontribusi bobot.
- **Field Review (Itjen)** — inspeksi formal Inspektorat. Berisi temuan dengan severity (info/minor/major/critical), due date perbaikan, foto, status (open/in-progress/closed).

### 3.6 Pembayaran
- **Termin Pembayaran** — milestone keuangan. State machine: PLANNED → ELIGIBLE → SUBMITTED → VERIFIED → PAID (atau REJECTED). Punya nomor termin unik per kontrak, persentase bayar, persentase progres syarat, tanggal rencana, retensi %, dan **anchor ke revisi BOQ** saat di-SUBMIT (untuk audit jika BOQ berubah setelahnya).

### 3.7 Sistem Pendukung
- **User** — login. Punya role, daftar kontrak yang ditugaskan, flag `must_change_password`, flag `auto_provisioned`.
- **Notification Rule** — aturan pemicu notifikasi (laporan telat, deviasi kritis, termin jatuh tempo, dll.) dengan template pesan dan channel (WhatsApp / Email / In-App).
- **Notification Queue** — antrian notifikasi keluar (pending/sent/failed/skipped).
- **Audit Log** — catatan semua perubahan CRUD dengan diff before/after.

---

## 4. Siklus Hidup Kontrak

```
                        +-----------+
                        |   DRAFT   |  ← state awal
                        +-----------+
                              |
                  (memenuhi gate aktivasi)
                              |
                              v
                        +-----------+
                        |  ACTIVE   |  ← pelaksanaan berjalan
                        +-----------+
                          |        |
              (sign Addendum)   (BAST final)
                          |        |
                          v        v
                     +---------+  +-----------+
                     | (tetap) |  | COMPLETED |
                     +---------+  +-----------+

  ON_HOLD: pause sementara (jarang)
  TERMINATED: dibatalkan (terminal)
```

**Gate Aktivasi (DRAFT → ACTIVE) — semua wajib terpenuhi:**

1. Kontrak punya minimal 1 lokasi dengan koordinat (lat/long).
2. Setiap lokasi punya minimal 1 fasilitas.
3. Ada revisi BOQ V0 dengan status APPROVED dan `is_active=true`.
4. Total nilai item BOQ leaf × (1 + PPN%) ≤ nilai kontrak (post-PPN), dengan toleransi Rp 1.

**Aturan transisi:**

- Setelah ACTIVE, BOQ V0 menjadi **immutable** untuk perubahan langsung. Perubahan hanya melalui Addendum.
- COMPLETED dan TERMINATED bersifat **terminal append-only** — tidak bisa dibalikkan kecuali via god-mode (lihat Bagian 9).

---

## 5. BOQ & Hirarki

### 5.1 Struktur Hirarkis

Item BOQ berhirarki dalam 4 level:

| Level | Peran | Contoh kode | Leaf? |
|---|---|---|---|
| 0 | Root / Judul pekerjaan besar | `4` | tidak (parent) |
| 1 | Sub-grup | `A`, `B` | tidak (parent) |
| 2 | Item pekerjaan | `1`, `2` | bisa leaf, bisa parent |
| 3 | Sub-item | `a`, `b` | leaf |

- **Hanya leaf yang masuk perhitungan progres dan termin** (`is_leaf=true`).
- Parent murni agregator: total = sum total leaf di bawahnya. Tidak boleh punya volume/harga sendiri.
- Setiap item punya `parent_id` (self-FK). `is_leaf` di-derive otomatis dari graph (item tanpa anak aktif = leaf).
- `full_code` = path bertitik dari root, mis. `4.A.1.a`.
- `weight_pct` = total_price item ÷ sum(total_price seluruh leaf di kontrak), dihitung otomatis.

### 5.2 Versioning (V0, V1, …)

- **V0** — baseline kontrak, dibuat saat kontrak baru. Tidak terikat ke addendum.
- **V1, V2, …** — lahir dari Addendum yang menyentuh BOQ.
- Saat revisi baru di-approve & di-aktifkan: revisi sebelumnya otomatis flip ke status SUPERSEDED dan `is_active=false`.
- **Invariant DB-level**: hanya boleh ada satu revisi `is_active=true` per kontrak (di-enforce via unique partial index).

### 5.3 Cloning & Diff

- Saat revisi baru dibuat dari addendum, semua item disalin. Setiap item baru menyimpan `source_item_id` → menunjuk ke item pendahulu di revisi sebelumnya.
- Atribut `change_type` per item: UNCHANGED, MODIFIED, ADDED, REMOVED.
- Diff antar dua revisi dihitung dengan menelusuri rantai `source_item_id`. Item B tanpa pendahulu = ADDED. Item A tanpa penerus di B = REMOVED.

### 5.4 Migrasi Progres Saat Revisi Aktif

Saat revisi N+1 menggantikan revisi N: data progres mingguan yang sudah ada di item N dipindah otomatis ke item N+1 untuk yang `change_type IN (UNCHANGED, MODIFIED)`. Ini supaya history tidak hilang dan S-curve tetap kontinu.

---

## 6. Variation Order & Addendum

### 6.1 VO State Machine

```
   DRAFT  --submit-->  UNDER_REVIEW  --approve-->  APPROVED  --bundle (sign)-->  BUNDLED
     |                       |                         |
     |                       +----reject------+        |
     +-------reject-----------------------+    |       |
                                          v    v       v
                                       REJECTED       (terminal)
```

- DRAFT: editable bebas.
- UNDER_REVIEW: konsultan/PPK review; tidak editable.
- APPROVED: tidak editable; menunggu bundling ke Addendum.
- BUNDLED & REJECTED: terminal append-only.

### 6.2 VO Items (Aksi Perubahan)

| Action | Deskripsi | Wajib | Efek saat di-apply ke BOQ revisi baru |
|---|---|---|---|
| **ADD** | Item baru | facility, parent_boq_item_id (opsional) | Buat BOQItem baru |
| **INCREASE** | Tambah volume item existing | source BOQItem, volume_delta > 0 | volume bertambah |
| **DECREASE** | Kurangi volume | source BOQItem, volume_delta < 0 | volume berkurang (tidak boleh < 0) |
| **MODIFY_SPEC** | Ubah deskripsi/satuan | source BOQItem | snapshot old_description & old_unit untuk audit |
| **REMOVE** | Hapus item | source BOQItem | tombstone (`change_type=REMOVED`), tidak hard-delete |
| **REMOVE_FACILITY** | Hapus seluruh fasilitas + item-itemnya | facility | cascade tombstone semua item di fasilitas tsb. |

### 6.3 Addendum

- **Tipe:** CCO (lingkup), EXTENSION (durasi), VALUE_CHANGE (nilai), COMBINED (campuran).
- **Flow:** DRAFT (boleh bundle/unbundle VO) → SIGNED (legal, tidak bisa diubah).
- **Saat SIGNED**:
  1. Semua VO yang di-bundle berubah status APPROVED → BUNDLED.
  2. Sistem clone revisi BOQ aktif menjadi revisi baru DRAFT.
  3. VO items diterapkan ke revisi baru sesuai action-nya.
  4. Revisi baru di-approve dan di-aktifkan; revisi lama jadi SUPERSEDED.
  5. Field kontrak ter-update: `current_value`, `end_date`, `duration_days` (sesuai tipe addendum).
- **Threshold KPA:** Bila perubahan nilai > 10% dari nilai original, addendum butuh persetujuan KPA (Kuasa Pengguna Anggaran) — field `kpa_approval` dengan tanda tangan & timestamp wajib sebelum boleh SIGNED.

### 6.4 Hubungan VO ↔ Addendum

- Satu Addendum bundle 0–N VO. (0 berarti addendum non-BOQ, mis. extension murni.)
- Satu VO hanya bisa di-bundle ke maksimal satu Addendum (BUNDLED terminal).
- VO yang APPROVED tapi belum di-bundle tetap muncul di "antrian usulan", bisa dipilih saat menyusun Addendum baru.

---

## 7. PPN (Pajak Pertambahan Nilai)

**Konvensi yang harus dipahami persis** (sumber kebingungan paling sering):

- BOQ items disimpan **PRE-PPN** — angka volume × harga satuan = total per baris, semuanya tanpa PPN.
- **Nilai Kontrak = POST-PPN.** Yaitu: `nilai_kontrak = sum(BOQ leaf items) + (sum(BOQ leaf items) × ppn_pct%)`.
- PPN per kontrak (default 11%, bisa diubah per kontrak).
- **Validasi gate aktivasi:** `sum(BOQ leaf) × (1 + ppn/100) ≤ nilai_kontrak`, dengan toleransi Rp 1 untuk absorb floating-point.
- **UI display:** harga BOQ ditampilkan PRE-PPN. Header kontrak harus menampilkan breakdown eksplisit:
  > `BOQ Rp X + PPN Rp Y (11%) = Nilai Kontrak Rp Z`
  
  Hindari notasi ambigu seperti `BOQ × (1+11%)` — pengguna pernah complain ini ambigu.

---

## 8. Pelaporan & Progres

### 8.1 Laporan Harian
- 1 laporan = 1 lokasi + 1 tanggal.
- Konten: cuaca, jumlah pekerja, alat berat, kendala lapangan, narasi aktivitas, foto-foto bertag fasilitas.
- **Tidak ada angka progres**. Murni dokumentasi naratif & visual.
- Input: Konsultan MK lokasi tersebut.

### 8.2 Laporan Mingguan
- 1 laporan = 1 kontrak + 1 minggu (unik via `(contract_id, week_number)`).
- Editor grid: list seluruh BOQ leaf item, kolom volume kumulatif aktual minggu ini.
- Sistem otomatis hitung:
  - **% per item** = volume kumulatif aktual ÷ volume planned (clamped 0–100%).
  - **Bobot % kontribusi** = % per item × weight_pct.
  - **Aktual kumulatif kontrak** = sum bobot kontribusi semua item.
  - **Planned kumulatif** = dari kurva-S rencana berdasarkan `planned_start_week` + `planned_duration_weeks` per item.
  - **Deviasi** = aktual − planned.
  - **SPI** (Schedule Performance Index) = aktual ÷ planned.
- **Status deviasi:**
  | Deviasi | Status |
  |---|---|
  | > +5% | FAST (lebih cepat) |
  | −5% s.d. +5% | NORMAL |
  | −10% s.d. −5% | WARNING |
  | < −10% | CRITICAL |
- Laporan bisa di-**lock** (`is_locked=true`) → progress tidak boleh diubah, foto masih boleh ditambah.
- **Invariant:** volume kumulatif tidak boleh turun antar minggu (monotonic non-decreasing).

### 8.3 Field Observation (Berita Acara MC)
- Tipe: **MC-0** (unik per kontrak — pengukuran awal sebelum kerja dimulai) atau **MC-INTERIM** (boleh banyak).
- Berisi temuan lapangan, lokasi, foto, catatan.
- Bukan dokumen legal. Sumber justifikasi VO.

### 8.4 Field Review (Itjen)
- 1 review = 1 kunjungan inspeksi.
- Berisi N temuan. Tiap temuan: severity (info/minor/major/critical), deskripsi, foto, due date perbaikan, status (open/in-progress/closed).
- Konsumsi: dashboard eksekutif (notif kritis), notifikasi PPK.

### 8.5 Dashboard Eksekutif
- Visual ringkasan multi-kontrak untuk pejabat.
- Konten:
  - Peta lokasi (lat/long) dengan marker progres.
  - Galeri foto per fasilitas (tarikan dari laporan harian/mingguan).
  - Kurva-S per kontrak (planned vs actual, dengan marker addendum).
  - Tabel deviasi & SPI lintas kontrak.
  - Lightbox foto fullscreen + search.

---

## 9. Aturan Bisnis Kritis (Invariants)

Wajib dienforce di backend. UI hanya hint.

1. **Exactly-one active revision per contract.** Enforce via DB partial unique index `(contract_id) WHERE is_active=true`.
2. **Scope-lock saat BOQ approved aktif.** Item BOQ, fasilitas, lokasi tidak boleh diedit langsung jika revisi aktif berstatus APPROVED. Perubahan harus via Addendum baru.
3. **BOQ V0 immutable setelah kontrak ACTIVE.** Edit hanya boleh saat kontrak masih DRAFT.
4. **Validasi nilai:** `sum(BOQ leaf) × (1 + ppn/100) ≤ nilai_kontrak`, toleransi Rp 1.
5. **Hanya leaf masuk progres.** Parent tidak punya volume/harga sendiri; total = sum leaf.
6. **VO state machine tidak boleh diloncati.** Transisi legal: DRAFT→{UNDER_REVIEW, REJECTED}; UNDER_REVIEW→{APPROVED, REJECTED, DRAFT}; APPROVED→{BUNDLED, REJECTED}. REJECTED & BUNDLED terminal.
7. **Threshold KPA 10%.** Addendum dengan perubahan nilai > 10% dari nilai original wajib `kpa_approval` sebelum SIGNED.
8. **MC-0 unik per kontrak** (`UNIQUE(contract_id, type) WHERE type='MC-0'`).
9. **Termin di-anchor ke revisi BOQ saat SUBMIT.** Jika BOQ berubah setelahnya (via addendum), termin tetap mengacu ke revisi lama untuk audit BPK.
10. **Progres mingguan monotonic non-decreasing** per item.
11. **Termin auto-trigger ELIGIBLE** saat aktual kumulatif terbaru ≥ `required_progress_pct`.
12. **Soft-delete kontrak** (`deleted_at` nullable). Query default filter `deleted_at IS NULL`.
13. **Self-FK BOQItem (parent_id) tanpa cascade DB-level.** Saat hapus parent, child harus di-clear `parent_id` dulu di app layer untuk hindari CircularDependencyError.
14. **God-Mode (Unlock Mode):** Superadmin bisa set `unlock_until` window pada kontrak untuk bypass semua validasi state. Setiap operasi dalam window otomatis tag audit `godmode_bypass=true` + `unlock_reason`.
15. **User auto-provisioning:** Saat Company atau PPK dibuat, otomatis spawn satu user default (`auto_provisioned=true`, `must_change_password=true`).
16. **Konsultan filter per-lokasi**, bukan per-kontrak. Konsultan A di kontrak X lokasi 1 tidak bisa lihat lokasi 2 di kontrak yang sama bila ditugaskan konsultan B.
17. **Permission `contract.create`** dimiliki PPK (selain Admin/Superadmin) — PPK boleh buat kontrak sendiri.

---

## 10. Pembayaran (Termin)

### 10.1 State Machine

```
PLANNED  --[progres ≥ syarat]-->  ELIGIBLE  --submit-->  SUBMITTED  --verify-->  VERIFIED  --pay-->  PAID
   |                                  |                       |                       |
   +------reject (manual)-------------+-----------------------+-----------------------+----> REJECTED (terminal append-only)
```

### 10.2 Atribut Kunci
- **term_number** unik per kontrak (1, 2, 3, …).
- **payment_pct** — persentase dari nilai kontrak yang dibayar di termin ini.
- **required_progress_pct** — syarat progres aktual untuk eligible.
- **retention_pct** — % yang ditahan (cadangan jaminan, dilepas saat final/BAST).
- **planned_date** — tanggal rencana cair.
- **eligible_date** — diisi otomatis saat status flip ke ELIGIBLE.
- **invoice_number** — nomor tagihan kontraktor (saat SUBMITTED).
- **boq_revision_id** — anchor revisi BOQ saat di-SUBMIT (untuk audit).
- **amount** = `nilai_kontrak × payment_pct × (1 - retention_pct)`.

### 10.3 Aturan
- Termin boleh diedit hingga status PAID (kecuali fields anchor seperti `boq_revision_id`).
- Sum total `payment_pct` lintas termin boleh melebihi 100% (untuk mengakomodasi addendum value-up). Tapi peringatkan jika > 100% tanpa justifikasi.
- Termin **REJECTED bersifat append-only** — buat termin baru jika perlu re-ajukan.

---

## 11. Import / Export

### 11.1 Import BOQ

**Format A — Simple Template (single sheet, untuk batch entry).** Kolom:

```
facility_code, facility_name, code, parent_code, description, unit,
volume, unit_price, total_price, planned_start_week, planned_duration_weeks
```

- Satu sheet, multi-fasilitas (dikelompokkan per `facility_code`).
- Hirarki ditentukan via `parent_code` (chain dari root). Tanpa kolom `level` — level di-derive otomatis dari kedalaman parent.
- Tombol "Download Template" wajib tersedia di UI.

**Format B — Engineer Multi-sheet (KKP).**

- Sheet pertama: REKAP/Sub-Resume (daftar fasilitas).
- Sheet berikutnya: per-fasilitas (mis. `6.Gudang Beku`, `7.Pabrik Es`). Pattern matching berbasis kata kunci.
- Header per sheet: `No. | Jenis Pekerjaan | Vol | Satuan | Harga Satuan | Jumlah`.
- Sistem auto-detect format dan parse hirarki dari pola kode (A/1/a regex) atau indentasi.
- Jika nama sheet tidak match fasilitas existing, sistem minta UI mapping manual sebelum import.

**Validasi:**
- `facility_code`, `description`, `volume` wajib (volume boleh 0 untuk lumpsum).
- Harga non-negatif.
- Kode unik per fasilitas dalam revisi yang sama.
- Parent harus ada sebelum child di-insert.
- **Import tidak boleh overwrite Nilai Kontrak** — hanya isi BOQ revisi DRAFT.

### 11.2 Export BOQ

- **BOQ Aktif → Excel & PDF.** Excel dengan formula dinamis (Jumlah = Volume × Harga Satuan, Total = SUM). PDF Landscape, header informasi kontrak (nomor, nama, PPK, kontraktor, periode).
- **Komparasi BOQ → Excel & PDF.** Pilih dua revisi (mis. V0 vs V1). Kolom: `Jenis Pekerjaan | Harga Satuan | Pekerjaan A (Vol & Jumlah) | Pekerjaan B (Vol & Jumlah) | Tambah (Vol & Jumlah) | Kurang (Vol & Jumlah) | Ket`. Kalkulasi otomatis Tambah/Kurang berdasarkan selisih volume; harga satuan tetap. Excel dengan formula. PDF Landscape.
- **Format angka:** desimal pakai titik, tanpa pemisah ribuan untuk angka mentah; mata uang `Rp` dengan pemisah ribuan untuk display laporan akhir.
- UI komparasi: dua dropdown pemilih revisi + tabel preview (grid responsif) + tombol "Unduh Excel" dan "Unduh PDF".

### 11.3 Export VO (Excel snapshot)

- VO bisa di-bulk-edit lewat Excel: export snapshot → edit di Excel → upload kembali.
- Excel snapshot harus include kolom UUID hidden untuk matching primary, kode sebagai fallback.
- Item REMOVE_FACILITY pending wajib visible di snapshot supaya editor lihat status.

### 11.4 File Upload
- Dokumen kontrak & addendum: PDF/image, simpan path di field document.
- Foto laporan: jpg/jpeg/png/gif. Auto-generate thumbnail (max ~300px width). Filename di-sanitize (UUID + ext).

---

## 12. Notifikasi, Early Warning & Audit

### 12.1 Notification Rule
- Tipe pemicu (contoh): laporan harian telat, laporan mingguan telat, deviasi WARNING/CRITICAL, SPI < 0.9, termin jatuh tempo, addendum menunggu sign.
- Threshold konfigurable (mis. `{"deviation_pct": -0.05, "grace_hours": 24}`).
- Template pesan dengan placeholder: `{{contract_number}}`, `{{deviation}}`, `{{warning}}`, dll.
- Channel: WhatsApp, Email, In-App.

### 12.2 Notification Queue
- Pending → Sent / Failed / Skipped.
- Job scheduler harian (jam konfigurable, default 08:00) cek deviasi, laporan telat, termin jatuh tempo → push ke queue.

### 12.3 Audit Log
- Catat **semua** perubahan CRUD dengan: user_id, action (create/update/delete/login/approve/sign/godmode_bypass), entity_type, entity_id, changes (diff before/after), ip_address, user_agent, timestamp.
- God-mode operasi tag khusus dengan `unlock_reason`.
- Endpoint admin untuk browse audit log.

---

## 13. UX & Antarmuka — Catatan Wajib

- **Bahasa UI:** Bahasa Indonesia. Istilah domain tidak diterjemahkan.
- **Format angka di input:** desimal pakai titik, tanpa pemisah ribuan saat user mengetik.
- **Format angka di laporan/display:** mata uang `Rp` dengan pemisah ribuan (mis. `Rp 1.234.567`).
- **Header kontrak responsif:** tampilkan breakdown PPN eksplisit di layar lebar (`BOQ Rp X + PPN Rp Y (Z%) = Rp Total`); ringkas di mobile.
- **BOQ grid:** parent rows visually berbeda (mis. strikethrough total), header info "X leaf + Y parent". Warning kuning bila parent punya total > 0 (tidak konsisten).
- **Parent picker** di modal/grid wajib auto-scroll ke pilihan aktif saat dibuka.
- **Tombol berbahaya** (delete kontrak, sign addendum, approve revisi, godmode) harus konfirmasi modal.
- **Disable bukan hide** untuk aksi yang tidak boleh saat scope-locked (supaya user tahu kenapa).
- **Visualisasi VO:** before/after side-by-side untuk action INCREASE/DECREASE/MODIFY.
- **Timeline kontrak (chain status):** tampilkan kronologis V0 → Addendum 1 (V1) → Addendum 2 (V2) dengan status & tanggal.

---

## 14. Skala & Performa

- Kontrak total ~50, lokasi ~300, fasilitas ~3.000, BOQ items ~50.000, laporan mingguan ~1.500/tahun, foto ~30.000/tahun.
- **Pilih database yang mendukung JSONB untuk fields fleksibel** (audit changes, notification threshold, assigned_contract_ids).
- **Index** wajib pada: `(contract_id, is_active)`, `(boq_revision_id)`, `(facility_id, is_active)`, `(parent_id)`, `(source_item_id)`, `(contract_id, week_number)`, `(contract_id, term_number)`.
- **Pagination** wajib untuk list endpoint (audit log, laporan mingguan multi-tahun, foto).
- **N+1 query**: hindari di endpoint flat (BOQ by contract, weekly report grid).

---

## 15. Definisi Selesai (Definition of Done)

Sebuah fitur dianggap selesai jika:

1. ✅ Backend: validasi sesuai aturan bisnis, audit log tertulis, response konsisten.
2. ✅ Frontend: UI bisa input → simpan → tampil → ekspor (jika applicable).
3. ✅ State machine diuji ke setiap transisi legal & ditolak untuk yang ilegal.
4. ✅ Permission check di endpoint (bukan hanya hide menu).
5. ✅ Toleransi floating-point (Rp 1) di setiap kalkulasi PPN/BOQ.
6. ✅ Edge case: kontrak DRAFT tanpa BOQ, revisi tanpa item, lokasi tanpa fasilitas, addendum nilai 0, dst. — tidak crash.
7. ✅ Soft-delete dihormati di semua query.
8. ✅ Notifikasi tertulis ke queue saat trigger memenuhi syarat.

---

## 16. Yang HARUS Ditanyakan Sebelum Implementasi

Jika ada hal di bawah ini yang belum jelas dari dokumen, **tanya dulu** — jangan asumsikan:

- Stack pilihan (bahasa backend, framework, DB, frontend).
- Strategi deployment (docker, k8s, bare metal).
- Strategi storage file (lokal, S3-compatible).
- Provider WhatsApp & Email (kalau perlu).
- Sumber data lat/long (input manual atau geocoding).
- Format laporan ekspor selain Excel/PDF (kalau perlu).
- Multi-tenancy (apakah satu instance untuk multi-Kementerian, atau hanya KMP).
- Bahasa UI tambahan selain Indonesia.

---

## 17. Cara Pakai Dokumen Ini

**Untuk sesi AI baru:** salin seluruh isi file ini sebagai pesan pertama, atau letakkan di root repo kosong dengan nama `CLAUDE.md` agar Claude Code otomatis memuatnya.

**Sebelum memulai koding:** minta AI buatkan dulu **rencana arsitektur tertulis** (struktur folder, daftar tabel/collection, daftar endpoint, daftar halaman UI) dan **review bersama**. Baru implementasi setelah disetujui.

**Saat implementasi:** kerjakan **per modul end-to-end** (mis. Kontrak penuh → Lokasi/Fasilitas penuh → BOQ penuh → … ), bukan per layer (semua model dulu, semua API dulu). Modul end-to-end memberi feedback lebih cepat dan lebih mudah di-review.

**Jangan lakukan:** auto-migration ad-hoc, fallback diam-diam, tambal sulam saat ketemu error. Cari root cause, perbaiki strukturnya.

---

*Dokumen ini adalah brief fungsional murni. AI bebas memilih stack apa pun selama bisa memenuhi seluruh aturan bisnis di Bagian 9 dan invariant DB di Bagian 5–6.*

