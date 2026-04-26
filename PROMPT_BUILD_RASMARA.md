# PROMPT: BUILD SISTEM RASMARA DARI NOL

> Salin seluruh isi file ini sebagai pesan pertama di sesi AI baru. Atau letakkan sebagai `CLAUDE.md` di root repo kosong agar otomatis termuat oleh Claude Code.

---

## 1. Konteks & Tujuan

Saya ingin membangun sistem manajemen & pemantauan proyek konstruksi infrastruktur untuk pemerintah dengan nama **RASMARA** — *Real-time Analytics System for Monitoring, Allocation, Reporting & Accountability*.

Sistem ini harus **AUDIT-SAFE & COMPLIANCE-READY** untuk pemeriksaan **BPK (Badan Pemeriksa Keuangan)**. Semua perubahan data penting wajib bisa ditelusuri (siapa, kapan, apa berubah, dari nilai apa ke nilai apa).

**Domain spesifik:** monitoring kontrak konstruksi infrastruktur Kampung Nelayan Merah Putih (KNMP) di bawah Kementerian Kelautan & Perikanan, dengan compliance Perpres 16/2018 ps. 54 (perubahan kontrak via Addendum/CCO).

**Skala referensi:** Kontrak ~20–50, Lokasi ~3–10/kontrak, Fasilitas ~5–20/lokasi, BOQ items ~100–500/fasilitas, Laporan Mingguan ~12–24/kontrak/tahun, VO ~2–10/kontrak, Termin ~3–6/kontrak. Total foto ~30.000/tahun.

---

## 2. Prinsip Pengerjaan (WAJIB DIPATUHI)

- **Tanyakan dulu** jika ada ambiguitas sebelum menulis kode.
- **Sebelum mulai, sajikan rencana arsitektur tinggi & ekspektasi stack** — tunggu persetujuan saya. Jangan asumsi.
- Bangun sistem secara **modular dan KONSISTEN**. Tidak boleh tambal sulam: satu konsep = satu sumber kebenaran, satu pola implementasi.
- **Jangan tambahkan fitur, abstraksi, atau komentar yang tidak diminta.**
- Setiap fitur harus didampingi **validasi data, kontrol akses, dan audit log**.
- Jika menemukan **kontradiksi** dalam spesifikasi ini, hentikan dan tanyakan.
- Bekerja **bertahap (modul demi modul)** dan minta verifikasi sebelum lanjut.
- **Bahasa domain Bahasa Indonesia** — istilah seperti PPK, KPA, BOQ, Addendum, Termin, MC, Itjen, Konsultan MK, Kontraktor wajib dipertahankan. Jangan diterjemahkan.

---

## 3. Aktor (Role) & Hak Akses

Sistem mendukung **8 role**. Hak akses dipisahkan menjadi **"unscoped"** (lihat semua kontrak) dan **"scoped"** (hanya kontrak yang ditugaskan).

| Role | Cakupan | Hak Utama |
|---|---|---|
| **superadmin** | unscoped | Akses penuh, termasuk manajemen user/role/menu |
| **admin_pusat** | unscoped | Akses penuh kecuali manajemen user/role |
| **ppk** (Pejabat Pembuat Komitmen) | scoped | Read kontrak yang ditugaskan, kelola termin, approve VO/Addendum, sign |
| **manager** | scoped | Read-only kontrak yang ditugaskan |
| **konsultan** (MK lapangan) | scoped per-lokasi | Input laporan harian/mingguan, ajukan VO |
| **kontraktor** | scoped | Read kontrak, laporan, dan termin terkait |
| **itjen** (Inspektorat Jenderal) | unscoped, terbatas review | Buat field review & temuan untuk kontrak manapun |
| **viewer** | unscoped | Read-only seluruh sistem |

**Aturan RBAC:**

- Permission granular bentuk `module.action` (`contract.update`, `report.create`, `payment.read`, dst.).
- Relasi role↔permission **dinamis di DB**, bisa diubah Superadmin. **Tidak hardcoded** di kode.
- **Menu sidebar dinamis** sesuai role (relasi role↔menu di DB).
- **Scope assignment per kontrak**: User punya `assigned_contract_ids`. `null` = semua kontrak.
- **Konsultan filter per-LOKASI**, bukan per-kontrak. Konsultan A di lokasi 1 tidak melihat lokasi 2 di kontrak yang sama jika ditugaskan ke konsultan B.
- **Semua otorisasi WAJIB di backend.** UI hanya hint — jangan andalkan hide menu.
- Permission `contract.create` dimiliki **PPK** (selain Admin/Superadmin) — PPK boleh buat kontrak sendiri.

---

## 4. Entitas Utama yang Dikelola

### 4.1 Master Data
- **Perusahaan** (kontraktor / konsultan / supplier) — punya NPWP, alamat, kontak. Saat dibuat, otomatis di-provision satu user default.
- **PPK** — pejabat fisik dengan NIP, jabatan, satker, nomor WhatsApp.
- **Master Fasilitas** — katalog standar (Gudang Beku, Pabrik Es, Cool Box, dll. ~29 jenis).
- **Master Kode Pekerjaan** — kategori: PERSIAPAN, STRUKTURAL, ARSITEKTURAL, MEP, SITE_WORK, KHUSUS.

### 4.2 Kontrak & Lingkupnya
- **Kontrak** — status: `DRAFT → ACTIVE → COMPLETED/TERMINATED`, dengan penanda `ADDENDUM` saat ada perubahan. Field utama: nomor unik, nama, PPK pemilik, kontraktor, tahun anggaran, nilai original (post-PPN), nilai current (post-PPN), tanggal mulai/selesai, durasi, persentase PPN.
- **Lokasi** — ≥1 per kontrak, dengan **koordinat (lat/long wajib)** & wilayah administratif (desa, kecamatan, kota, provinsi). Satu lokasi punya **satu konsultan MK**.
- **Fasilitas** — ≥1 per lokasi, dipilih dari katalog master fasilitas.

### 4.3 BOQ
- **BOQ** berhirarki **4 level**: facility (root) → grup → item → sub-item. **Hanya item leaf** yang punya volume, harga, bobot, & progress.
- **Revisi BOQ** — V0 baseline, V1, V2, ... per addendum. Punya `is_active` boolean. Status: DRAFT, APPROVED, SUPERSEDED.
- **Item BOQ** — tiap item punya `parent_id` (self-FK), `source_item_id` (link ke item pendahulu di revisi sebelumnya), `change_type` (UNCHANGED/MODIFIED/ADDED/REMOVED), `is_leaf` (auto-derived), `weight_pct` (auto-calculated).

### 4.4 Pelaporan
- **Laporan Mingguan** — progres per item BOQ leaf per minggu, unik via `(contract_id, week_number)`.
- **Laporan Harian** — narasi per lokasi per hari, **tanpa angka progres**.
- **Foto laporan** terikat pada fasilitas (untuk galeri eksekutif).

### 4.5 Perubahan & Pembayaran
- **Termin Pembayaran** — milestone keuangan, di-anchor ke revisi BOQ saat SUBMIT.
- **Variation Order (VO)** — usulan perubahan formal dengan state machine.
- **Addendum Kontrak** — dokumen legal bundle VO. Tipe: CCO / EXTENSION / VALUE_CHANGE / COMBINED.
- **Field Observation (MC)** — MC-0 (unik per kontrak) & MC-Interim (boleh banyak).

### 4.6 Inspeksi & Pemantauan
- **Field Review & Temuan (Itjen)** — temuan dengan severity, due date, status workflow.
- **Early Warning otomatis** — daftar peringatan terkomputasi.
- **Aturan Notifikasi** — WhatsApp / Email / In-App dengan template & threshold.
- **Audit Log** — lengkap, dengan diff before/after, IP, user agent.

---

## 5. Alur Bisnis End-to-End

### 5.1 Setup Kontrak (DRAFT)
Admin/PPK buat kontrak → tambah ≥1 lokasi (dengan koordinat) → tambah fasilitas per lokasi dari katalog → assign PPK & konsultan. Sistem otomatis menyiapkan **revisi BOQ V0 dalam keadaan DRAFT**.

### 5.2 Isi BOQ
Admin/konsultan input BOQ via:
- **Import Excel** — dua format:
  - **Format Simple** (single sheet, kolom `facility_code, facility_name, code, parent_code, description, unit, volume, unit_price, total_price, planned_start_week, planned_duration_weeks`).
  - **Format Multi-sheet KKP** asli, auto-deteksi sheet per fasilitas berdasarkan kata kunci.
- **Input manual** lewat grid editor (lihat Bagian 8a).

Bobot setiap item leaf dihitung otomatis terhadap nilai kontrak (`weight_pct = total_leaf / sum(all leaf)`).

### 5.3 Approve BOQ V0 & Aktivasi Kontrak
Sebelum kontrak boleh diaktifkan, sistem **wajib lulus 4 gerbang readiness**:

1. Minimal 1 lokasi punya minimal 1 fasilitas.
2. BOQ lengkap di seluruh fasilitas (tidak ada fasilitas kosong).
3. Revisi V0 berstatus **APPROVED**.
4. Total nilai BOQ leaf × (1 + PPN%) ≤ nilai kontrak (post-PPN), **toleransi Rp 1**.

Setelah approve V0 dan aktivasi, kontrak menjadi **ACTIVE**. V0 tidak boleh diubah lagi (kecuali via mekanisme **unlock superadmin** yang tetap teraudit).

### 5.4 Progress Mingguan
Setiap minggu, konsultan input laporan mingguan:
- Progress per item leaf BOQ (volume minggu ini & **kumulatif monotonic non-decreasing**).
- Tenaga kerja, cuaca, hari hujan, kendala, solusi, ringkasan eksekutif.
- Foto-foto bertag fasilitas.

Sistem otomatis menghitung % progress berbobot di setiap level: item → fasilitas → lokasi → kontrak.

### 5.5 Laporan Harian
Konsultan opsional input laporan harian: narasi aktivitas, tenaga kerja, peralatan, material, cuaca, kendala, foto. **Laporan harian TIDAK MENGUBAH PROGRESS** — hanya narasi & dokumentasi visual.

### 5.6 Kurva-S & Analisis Deviasi
Sistem hitung:
- **Kurva-S terencana** dari `planned_start_week` & `duration` per item.
- **Kurva-S aktual** dari laporan mingguan.
- **Deviasi mingguan** = aktual − planned.
- **SPI** (Schedule Performance Index) = aktual ÷ planned.

**Status deviasi:**

| Deviasi | Status |
|---|---|
| > +5% | FAST |
| −5% s.d. +5% | NORMAL |
| −10% s.d. −5% | WARNING |
| < −10% | CRITICAL |

### 5.7 Early Warning & Notifikasi
**Scheduler harian** mengecek:
- Laporan harian/mingguan terlambat (grace period konfigurable).
- Deviasi melewati ambang (WARNING / CRITICAL).
- SPI < 0.9.
- Termin lewat jatuh tempo.
- Temuan Itjen lewat tenggat.
- Progress macet (tidak naik beberapa minggu berturut).

Hasil masuk ke daftar **Early Warning** dan dikirim sesuai aturan notifikasi:
- **WhatsApp** via Fonnte (opsional, bisa dimatikan via konfigurasi).
- **Email** opsional.
- **In-App** wajib.

### 5.8 Perubahan Lapangan (MC → VO → Addendum)

**Field Observation (Mutual Check):**
- **MC-0** — pengukuran awal (unik per kontrak), non-legal, identifikasi selisih lapangan vs BOQ.
- **MC-Interim** — pengecekan berjalan, boleh berkali-kali.

**VO (Variation Order):** usulan perubahan resmi dengan justifikasi teknis.

State machine:
```
DRAFT → UNDER_REVIEW → APPROVED → BUNDLED
                ↓             ↓
             REJECTED      REJECTED   (terminal append-only)
```

VO Items bertipe:

| Action | Deskripsi |
|---|---|
| **ADD** | Item baru di fasilitas (opsional di bawah parent BOQ tertentu) |
| **INCREASE** | Tambah volume item existing (delta > 0) |
| **DECREASE** | Kurangi volume (delta < 0; volume akhir tidak boleh negatif) |
| **MODIFY_SPEC** | Ubah deskripsi/satuan (snapshot old values) |
| **REMOVE** | Hapus item (tombstone, bukan hard-delete) |
| **REMOVE_FACILITY** | Hapus seluruh fasilitas + cascade itemnya |

**Addendum:** bundle ≥0 VO yang sudah APPROVED. Tipe: CCO / EXTENSION / VALUE_CHANGE / COMBINED. Saat dibuat, sistem otomatis membuat revisi BOQ baru (V1, V2, …) sebagai DRAFT, menerapkan perubahan dari VO.

Setelah revisi di-approve dan addendum **ditandatangani (SIGNED)**:
- Progress lama dimigrasikan ke item baru via penanda `source_item_id` (silsilah lintas revisi) untuk item `change_type IN (UNCHANGED, MODIFIED)`.
- Revisi lama menjadi **SUPERSEDED**, revisi baru menjadi **aktif**.
- VO yang di-bundle berubah status APPROVED → BUNDLED.
- Field kontrak ter-update: `current_value`, `end_date`, `duration_days` sesuai tipe addendum.
- Jika perubahan nilai > 10% dari nilai original, **wajib ada catatan persetujuan KPA** (Kuasa Pengguna Anggaran) — field `kpa_approval` dengan signature & timestamp.

### 5.9 Pembayaran Termin
PPK menyiapkan termin: nomor, syarat % progress, % pembayaran, nominal, retensi.

State machine per termin:
```
PLANNED → ELIGIBLE → SUBMITTED → VERIFIED → PAID
                                                ↓
                                           REJECTED   (alternatif, append-only)
```

`amount = nilai_kontrak × payment_pct × (1 - retention_pct)`.

**ATURAN KRITIS untuk audit BPK:** Pada saat termin di-SUBMIT, sistem **mengunci (mengankor) termin tersebut ke revisi BOQ yang aktif saat itu** (`boq_revision_id` set di SUBMIT). Jika kemudian BOQ berubah karena addendum, termin yang sudah submit/verified/paid **TETAP terikat ke versi BOQ lama**. Wajib untuk audit BPK.

### 5.10 Inspeksi Itjen
Itjen membuat **Field Review** (tanggal, peninjau, ringkasan) lalu mencatat **temuan**:
- Judul, deskripsi, severity (LOW / MEDIUM / HIGH / CRITICAL), rekomendasi, tenggat.
- Foto bukti per temuan.

State machine temuan:
```
OPEN → RESPONDED → ACCEPTED/REJECTED → CLOSED
```

### 5.11 Penyelesaian
Setelah seluruh pekerjaan selesai dan progress 100%, kontrak di-mark **COMPLETED**. Semua data terkunci. Audit trail tetap utuh.

---

## 6. Aturan Bisnis Kritis (Tidak Boleh Dilanggar)

Wajib di-enforce di **backend** (UI hanya hint).

1. **Exactly-one active revision per contract.** Enforce via DB partial unique index `(contract_id) WHERE is_active=true`.
2. **BOQ V0 immutable setelah APPROVED.** Perubahan hanya melalui addendum yang menghasilkan revisi baru.
3. **Item BOQ pada revisi baru wajib menyimpan `source_item_id`** ke item asalnya, dengan `change_type` (unchanged / modified / added / removed).
4. **Edit matrix per status kontrak:**
   - DRAFT: bebas edit.
   - ACTIVE: hanya field tertentu (laporan, termin, VO, dst.).
   - COMPLETED / TERMINATED: kunci total.
5. **Mekanisme "unlock" superadmin** sementara dengan batas waktu (`unlock_until`); setiap perubahan dalam window otomatis ter-tag `godmode_bypass=true` + `unlock_reason` di audit log.
6. **Soft-delete** untuk entitas penting (kontrak, lokasi, fasilitas, BOQ, VO, addendum); **hard-delete dilarang**. Query default filter `deleted_at IS NULL`.
7. **Setiap operasi tulis WAJIB audit log** (siapa, kapan, IP, user-agent, diff before/after).
8. **Konsultan & kontraktor tidak boleh melihat kontrak yang tidak di-assign** — kontrol di backend, jangan andalkan UI.
9. **Penomoran termin / VO / addendum unik & berurut** per kontrak.
10. **Hanya leaf masuk progres.** Parent murni agregator (total = sum total leaf di bawahnya). Parent tidak punya volume/harga sendiri.
11. **Validasi nilai kontrak:** `sum(BOQ leaf) × (1 + ppn/100) ≤ nilai_kontrak`, **toleransi Rp 1** (untuk absorb floating-point).
12. **Konvensi PPN:**
    - BOQ items disimpan **PRE-PPN**.
    - Nilai kontrak = **POST-PPN**.
    - PPN default 11% (UU HPP 2021), bisa diubah per kontrak.
    - UI display breakdown eksplisit: `BOQ Rp X + PPN Rp Y (Z%) = Nilai Kontrak Rp Total`. **Hindari notasi ambigu** seperti `BOQ × (1+11%)`.
13. **VO state machine tidak boleh diloncati.** Transisi legal: DRAFT→{UNDER_REVIEW, REJECTED}; UNDER_REVIEW→{APPROVED, REJECTED, DRAFT}; APPROVED→{BUNDLED, REJECTED}. REJECTED & BUNDLED terminal.
14. **Threshold KPA 10%.** Addendum dengan perubahan nilai > 10% dari nilai original wajib `kpa_approval` sebelum SIGNED.
15. **MC-0 unik per kontrak** (`UNIQUE(contract_id, type) WHERE type='MC-0'`).
16. **Termin di-anchor ke revisi BOQ saat SUBMIT** — tidak boleh berubah anchor setelahnya.
17. **Progress mingguan monotonic non-decreasing** per item.
18. **Termin auto-trigger ELIGIBLE** saat aktual kumulatif terbaru ≥ `required_progress_pct`.
19. **Self-FK BOQItem (parent_id) tanpa cascade DB-level.** Saat hapus parent, child harus di-clear `parent_id` dulu di app layer untuk hindari CircularDependencyError.
20. **User auto-provisioning:** Saat Perusahaan atau PPK dibuat, otomatis spawn satu user default (`auto_provisioned=true`, `must_change_password=true`).

---

## 7. Modul / Halaman Frontend yang Dibutuhkan

- **Login & ganti password** (paksa ganti password jika akun auto-provisioned).
- **Dashboard utama** — ringkasan, daftar early warning, aktivitas terkini.
- **Dashboard eksekutif** — galeri foto fasilitas (multi-kontrak), KPI, status pembayaran, heatmap warning, peta lokasi (lat/long markers), kurva-S multi-kontrak.
- **Daftar & detail kontrak** — tab: lokasi, fasilitas, BOQ, laporan mingguan, addendum, termin, review.
- **Laporan mingguan** — list + editor grid progress per item BOQ + upload foto + import/export Excel.
- **Laporan harian** — list + editor + galeri foto.
- **Halaman Kurva-S** — chart, tabel deviasi, SPI, ekspor.
- **Halaman pembayaran termin** — workflow status, upload dokumen, ekspor surat.
- **Halaman field review & temuan** — kelola temuan Itjen.
- **Halaman early warning** — daftar peringatan aktif + history.
- **Halaman komparasi BOQ** — pilih dua revisi (V0 vs V1 / V1 vs V2 / dst.), tampilkan tabel selisih + ekspor Excel/PDF.
- **Master data** — perusahaan, PPK, master fasilitas, master kode pekerjaan.
- **Admin** — user, role & permission + menu visibility, aturan notifikasi, audit log.

---

## 8. Integrasi Eksternal yang Diperlukan

- **Penyimpanan file** — foto laporan, dokumen termin, lampiran review. Wajib ada **thumbnail untuk foto** (max ~300px width). Filename di-sanitize (UUID + ext).
- **Parser & generator Excel** untuk:
  - Impor BOQ (format Simple & format multi-sheet asli KKP).
  - Template progress mingguan + ekspor progress (round-trip).
  - Ekspor BOQ aktif & komparasi BOQ.
- **WhatsApp gateway (Fonnte)** sebagai opsi notifikasi — bisa dimatikan via konfigurasi. Sertakan **retry & log pengiriman**.
- **Scheduler harian** untuk pengecekan otomatis early warning (jam konfigurable, default 08:00).

---

## 8a. Standar UX (Wajib)

### Karakteristik Data
- BOQ adalah **dataset SANGAT BESAR**. Satu kontrak mudah memiliki ratusan hingga ribuan baris item leaf (4 level hirarki: facility → grup → item → sub-item) tersebar di banyak fasilitas dan lokasi.
- Konsultan & admin akan menghabiskan banyak waktu di tampilan tabel ini, sering kali untuk **input/edit massal**.

### Karena itu UI/UX HARUS LUWES SEPERTI EXCEL:

**1) Tampilan Tabel Sebagai Tempat Kerja Utama**
- Editing dilakukan **LANGSUNG di sel tabel (inline editing)**. Hindari pola "buka modal untuk edit satu baris" pada workflow massal.
- Dukung **navigasi keyboard penuh**: panah, Tab/Shift+Tab, Enter pindah ke bawah, Escape batal edit.
- Dukung **copy-paste blok sel dari/ke Excel** (multi-baris, multi-kolom).
- Dukung **fill-down / drag-to-fill** pada kolom numerik & teks.
- Dukung **undo/redo lokal** pada sesi edit sebelum simpan.
- Sediakan **auto-save berkala** atau indikator "perubahan belum disimpan" yang sangat jelas.

**2) Performa untuk Data Besar**
- Tabel **WAJIB mendukung virtualisasi baris/kolom** — render hanya yang terlihat. Tidak boleh nge-lag saat memuat 5.000+ baris.
- **Sortir, filter, dan pencarian harus tetap responsif** pada data besar.
- Sediakan **freeze/pin** untuk kolom kunci (kode, deskripsi) dan freeze untuk baris header grup hirarki.

**3) Hirarki & Pengelompokan**
- Tabel BOQ menampilkan hirarki 4 level dengan baris yang bisa di-**expand/collapse** (tree grid). Sediakan tombol "Expand semua / Collapse semua" dan **persist state per pengguna**.
- **Subtotal per level** (grup, fasilitas, lokasi, kontrak) tampil otomatis dan ikut menyesuaikan saat data berubah.

**4) Filter, Sortir, Pencarian**
- Setiap kolom punya filter (text contains, number range, date range, multi-select untuk enum) dan sortir.
- Sediakan **kotak pencarian global** (cari di semua kolom).
- Filter aktif terlihat sebagai **chip/badge** yang bisa dilepas satu per satu.
- Status filter & sort dapat **disimpan sebagai "view" (preset)** per pengguna.

**5) Dropdown Wajib Filterable — DI MANA SAJA**
- **SEMUA dropdown di seluruh aplikasi harus searchable/typeable**. Tidak boleh ada dropdown panjang tanpa pencarian.
- **Dropdown DI DALAM SEL GRID** juga harus filterable: ketik untuk mempersempit opsi, panah untuk navigasi, Enter untuk pilih.
- Dropdown dengan banyak data (master fasilitas, kode pekerjaan, perusahaan, PPK, user) harus mendukung **pencarian server-side dengan debounce dan paging** — bukan memuat semua opsi sekaligus.
- Tampilkan ikon "loading" saat fetching, dan pesan "tidak ada hasil" saat kosong.

**6) Validasi Inline**
- Sel yang invalid ditandai jelas (warna + tooltip alasan).
- Cegah menyimpan jika ada error; tunjukkan ringkasan kesalahan dengan tombol **"loncat ke sel pertama yang error"**.
- Validasi **cross-row** (mis. total bobot harus 100%, total nilai BOQ ≤ nilai kontrak) ditampilkan di **footer/summary tabel realtime**.

**7) Bulk Operation**
- Pilih banyak baris via checkbox + Shift-click range.
- Aksi massal: hapus, ubah satu kolom, ekspor pilihan saja.
- **Konfirmasi eksplisit** sebelum aksi destruktif.

**8) Konsistensi**
- Pola grid Excel-like ini dipakai **DI SEMUA tempat data tabular berskala** (BOQ, progress mingguan, daftar termin, daftar VO, daftar temuan, audit log). Bukan hanya BOQ.

---

## 8b. Standar Output Dokumen (Excel & PDF) — Mature & Robust

Sistem ini sering dipakai untuk menghasilkan **laporan & surat resmi**. Kualitas output dokumen adalah **fitur produk, bukan tempelan**.

### Prinsip Umum
- Setiap dokumen yang di-generate **WAJIB DETERMINISTIK**: input sama → output sama (penomoran, urutan, format).
- Setiap dokumen **WAJIB punya identitas terlacak**: nomor dokumen, tanggal cetak, dicetak oleh siapa, versi BOQ/revisi yang dipakai.
- Header & footer resmi (kop KKP, nomor surat, halaman X dari Y) konsisten di seluruh dokumen.
- Mendukung **Bahasa Indonesia penuh**:
  - Format tanggal: `26 April 2026`.
  - Pemisah ribuan titik, desimal koma.
  - Mata uang: `Rp 1.250.000.000,00`.
  - **Terbilang dalam Bahasa Indonesia** untuk dokumen pembayaran (mis. "satu miliar dua ratus lima puluh juta rupiah").

### Excel Export (mature)
Bukan sekadar dump CSV. Wajib:
- **Multi-sheet** bila dokumen punya beberapa bagian (mis. ringkasan + detail per fasilitas).
- **Header berformat** (bold, warna, border), kolom **auto-width** yang rapi, **freeze panes** pada baris header.
- **Format angka, mata uang, persentase, dan tanggal** yang benar (bukan teks).
- **Formula sederhana** untuk subtotal/total bila relevan, agar pengguna bisa edit dan total ikut menyesuaikan.
- **Logo & info kontrak** di bagian atas sheet pertama.
- **Round-trip**: file yang di-ekspor sebagai template dapat di-import kembali tanpa kerusakan format (untuk template progress mingguan & template BOQ).
- Sheet/tabel besar harus tetap di-generate **efisien (streaming)** — jangan menahan seluruh data di memori sekaligus.

### PDF Generation (robust)
Kualitas seperti **dokumen kantor resmi**, BUKAN screenshot HTML kasar.

Layout konsisten: margin, font, spasi, ukuran kertas (A4 default, pilihan F4/Letter).

Mendukung:
- **Header & footer berulang** di setiap halaman (kop, nomor surat, halaman X dari Y, watermark "DRAFT" jika dokumen belum final).
- **Tabel yang dapat memecah halaman dengan benar** — header tabel diulang di tiap halaman, baris tidak terpotong di tengah.
- **Tanda tangan**: blok signature dengan nama, jabatan, NIP, tanggal, dan ruang TTD; **opsi sisipkan QR code verifikasi**.
- **Lampiran foto** (galeri foto laporan harian/mingguan & temuan) dengan caption & timestamp, tata letak rapi (grid 2-4 kolom).
- **Embed font** agar tampilan konsisten lintas perangkat.

**Penomoran dokumen otomatis** dengan format konfigurable (mis. `001/KNMP/PPK/IV/2026`), tidak boleh tabrakan/duplikat.

### Daftar Dokumen yang Harus Didukung (minimal)

**Excel:**
- Template & ekspor BOQ per kontrak / per fasilitas / per lokasi.
- Template & ekspor progress mingguan (round-trip import).
- Rekap laporan mingguan (multi-sheet: ringkasan, progress per fasilitas, kurva-S, deviasi).
- Rekap pembayaran termin per kontrak.
- Rekap audit log dengan filter aktif.
- **Komparasi BOQ** antar dua revisi (kolom: Jenis Pekerjaan, Harga Satuan, Pekerjaan A vol/jumlah, Pekerjaan B vol/jumlah, Tambah vol/jumlah, Kurang vol/jumlah, Ket) dengan formula dinamis.

**PDF:**
- Laporan harian (narasi + tabel manpower + galeri foto).
- Laporan mingguan (ringkasan + tabel progress + kurva-S + foto).
- Berita Acara MC-0 / MC-Interim.
- Justifikasi Teknis Variation Order.
- Berita Acara Addendum (dengan ringkasan perubahan BOQ).
- Surat permohonan & Berita Acara pembayaran termin (dengan nominal, terbilang, lampiran progress sebagai dasar penagihan).
- Laporan Field Review Itjen (temuan, severity, tanggapan, foto bukti).
- Sertifikat penyelesaian kontrak.
- **Ekspor BOQ aktif** (Landscape, header info kontrak).
- **Ekspor komparasi BOQ** (Landscape, proporsional).

### Aturan Tambahan
- Semua aksi generate dokumen masuk **audit log** (siapa, kapan, dokumen apa, untuk entitas mana).
- File hasil generate **disimpan/di-cache** agar bisa diunduh ulang tanpa regenerate, tetapi pengguna juga bisa "regenerate" eksplisit.
- Sediakan **tombol "Pratinjau"** sebelum cetak/unduh agar tidak boros waktu pada dokumen besar.
- Untuk dokumen pembayaran, snapshot data BOQ yang dipakai **diankor ke revisi BOQ aktif** saat dokumen di-generate, sesuai aturan bisnis termin (lihat Bagian 6).

---

## 9. Master Data Awal yang Harus Tersedia (Seed)

- **8 role** beserta matriks permission default.
- **Katalog master fasilitas standar KKP** (sekitar **29 jenis**: gudang beku, pabrik es, tambatan perahu, toilet, dll. — daftar lengkap akan dikirim saat seeding).
- **Daftar kategori master kode pekerjaan**: PERSIAPAN, STRUKTURAL, ARSITEKTURAL, MEP, SITE_WORK, KHUSUS.
- **Akun superadmin awal**.
- **Auto-provision akun** saat membuat data Perusahaan/PPK, dengan flag **"wajib ganti password saat login pertama"** (`must_change_password=true`).

---

## 10. Definition of Done per Fitur

Sebuah fitur baru dianggap **selesai** bila:

1. ✅ **Validasi input lengkap di backend** (jangan andalkan frontend).
2. ✅ **Otorisasi diuji** untuk semua role yang relevan.
3. ✅ **Audit log tercatat** untuk semua aksi tulis.
4. ✅ UI dapat diakses oleh role yang seharusnya, dan tersembunyi bagi yang tidak berhak.
5. ✅ Tidak ada **path duplikat / dead code / komentar TODO menggantung**.
6. ✅ Saya bisa **memverifikasi alur dari ujung ke ujung di browser** (input → simpan → tampil → ekspor/notifikasi).
7. ✅ State machine diuji ke setiap transisi legal & ditolak untuk yang ilegal.
8. ✅ Soft-delete dihormati di semua query.
9. ✅ Toleransi floating-point (Rp 1) di setiap kalkulasi PPN/BOQ.
10. ✅ Edge case: kontrak DRAFT tanpa BOQ, revisi tanpa item, lokasi tanpa fasilitas, addendum nilai 0 — tidak crash.

---

## 11. Yang Saya Harapkan Dari Kamu Sekarang

1. **Baca seluruh prompt ini dan buat ringkasan pemahamanmu** (1 halaman).
2. **Ajukan daftar pertanyaan klarifikasi** (jika ada) sebelum coding.
3. **Usulkan rencana modul & urutan pengerjaan** (mis. fondasi auth/role dulu → master data → kontrak → BOQ → laporan → analitik → addendum/VO → pembayaran → review → notifikasi).
4. Untuk pilihan teknologi (bahasa, framework, database, dsb.), berikan **rekomendasi singkat dengan alasan**, lalu **tunggu persetujuan saya**. **Jangan langsung memulai implementasi.**

**Tujuan akhir:** sistem yang **BERSIH, KONSISTEN, MUDAH DIAUDIT, dan SIAP UNTUK PEMERIKSAAN BPK** — bukan kumpulan tambalan.

---

## 12. Cara Pakai Dokumen Ini

**Untuk sesi AI baru — 3 opsi:**

### Opsi 1 — `CLAUDE.md` di root repo (paling mulus)
```bash
cp PROMPT_BUILD_RASMARA.md CLAUDE.md
```
Claude Code otomatis memuat `CLAUDE.md` setiap sesi di repo itu. Tidak perlu salin-tempel apa-apa.

### Opsi 2 — Salin sebagai pesan pertama
Buka sesi baru, salin seluruh isi file ini sebagai pesan pertama. Tambahkan satu kalimat tujuan ringkas.

### Opsi 3 — Reference file
Letakkan file di repo, lalu di sesi baru cukup bilang: "Baca `PROMPT_BUILD_RASMARA.md` dulu sebelum mulai." AI akan baca dan tanya klarifikasi yang relevan.

---

## 13. Yang HARUS Ditanyakan Sebelum Implementasi

Jika hal di bawah belum jelas dari dokumen, **tanya dulu** — jangan asumsikan:

- Stack pilihan (bahasa backend, framework, DB, frontend).
- Strategi deployment (docker, k8s, bare metal).
- Strategi storage file (lokal, S3-compatible, lain).
- Provider WhatsApp & Email konkret.
- Sumber data lat/long (input manual atau geocoding).
- Format laporan ekspor selain Excel/PDF.
- Multi-tenancy (apakah satu instance untuk multi-Kementerian, atau hanya KKP).
- Bahasa UI tambahan selain Indonesia.

---

*Dokumen ini adalah brief fungsional murni. AI bebas memilih stack apa pun selama bisa memenuhi seluruh aturan bisnis di Bagian 6 dan invariant di Bagian 5.*






