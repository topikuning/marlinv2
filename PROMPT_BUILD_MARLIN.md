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

Visual ringkasan multi-kontrak untuk pejabat (eksekutif, PPK, Itjen). Tampilan harus mengutamakan **kemudahan eksplorasi** — pejabat harus bisa zoom dari level nasional → lokasi → kontrak → fasilitas dalam beberapa klik.

#### 8.5.1 Peta Interaktif Lokasi Proyek
- **Peta utama** menampilkan seluruh lokasi proyek dengan marker berdasarkan koordinat (lat/long).
- **Warna marker** mencerminkan status proyek: hijau (NORMAL/FAST), kuning (WARNING), merah (CRITICAL), abu-abu (DRAFT/COMPLETED).
- **Cluster marker** otomatis saat zoom out (jika banyak titik berdekatan), pecah saat zoom in.
- **Hover marker** → tooltip ringkas: nama lokasi, kontrak, % progres, status deviasi.
- **Klik marker** → buka panel/popup detail dengan:
  - Header: nomor kontrak, nama, PPK, kontraktor, periode, nilai kontrak, % progres aktual.
  - Daftar fasilitas di lokasi tersebut beserta % progres masing-masing.
  - **Kurva-S mini** (planned vs actual) langsung di popup.
  - Tombol "Buka detail kontrak" → navigasi ke halaman kontrak penuh.
  - Tombol "Lihat galeri foto lokasi" → buka galeri foto (lihat 8.5.3).
- **Layer toggle**: bisa hidup-matikan layer per status (mis. tampilkan hanya CRITICAL), per tahun anggaran, atau per provinsi.
- **Pencarian peta**: kotak search untuk lompat ke kontrak/lokasi tertentu.
- **Heatmap mode** (opsional): density warning per region.
- **Legenda peta** selalu terlihat di pojok dengan keterangan warna marker.
- **Basemap** standar (mis. street + satellite toggle).

#### 8.5.2 Kurva-S Interaktif
- Per kontrak: chart line dengan dua kurva (planned vs actual).
- **Marker addendum** ditampilkan sebagai vertical line di titik tanggal sign, dengan label `V1`, `V2`, dst.
- **Hover titik kurva** → tooltip: minggu ke-N, % planned, % actual, deviasi, SPI.
- **Zoom & pan** (terutama untuk kontrak dengan durasi panjang).
- **Multi-kontrak overlay** (opsional): pilih beberapa kontrak untuk dibandingkan kurvanya dalam satu chart.
- **Ekspor**: tombol unduh chart sebagai PNG dan data sebagai Excel.
- **Tabel deviasi mingguan** di bawah chart, klik baris → highlight titik di kurva.

#### 8.5.3 Galeri Foto Interaktif
Tarikan foto dari laporan harian & mingguan. Kontrol harus mudah di tangan user.

- **Filter atas galeri:**
  - **Tanggal** — date range picker; preset shortcut (hari ini, 7 hari terakhir, bulan ini, custom range).
  - **Kontrak** — dropdown filterable.
  - **Lokasi** — dropdown filterable, multi-select.
  - **Fasilitas** — dropdown filterable, multi-select (mengikuti lokasi terpilih).
  - **Tipe laporan** — toggle: Harian / Mingguan / Semua.
  - **Pencarian teks** — caption / catatan foto.
- **Layout galeri:**
  - **Grid responsif** (2–6 kolom tergantung lebar layar) dengan thumbnail.
  - **Group by** (toggle): per tanggal, per fasilitas, atau per lokasi.
  - **Infinite scroll** atau pagination — pilih sesuai jumlah data.
  - **Lazy-load** thumbnail (tidak load semua sekaligus).
- **Klik thumbnail** → buka **lightbox fullscreen** dengan kontrol:
  - **Navigasi keyboard**: panah kiri/kanan untuk foto sebelumnya/berikutnya, Esc untuk tutup, Spasi untuk play slideshow.
  - **Tombol navigasi swipe** untuk mobile.
  - **Zoom in/out** + pan saat zoom.
  - **Rotate** (90° kiri/kanan).
  - **Caption panel** di sisi/bawah: tanggal foto, fasilitas, lokasi, kontrak, sumber laporan (link ke laporan asli), nama pengupload, catatan.
  - **Tombol unduh** foto asli.
  - **Tombol "Buka konteks"** → loncat ke laporan asal foto tsb.
  - **Slideshow auto-play** dengan kontrol kecepatan & pause.
  - **Counter** "X dari Y" supaya user tahu posisi.
- **Bulk action di galeri**: pilih foto (checkbox) → unduh ZIP, ekspor ke PDF album, atau lampirkan ke laporan eksekutif.
- **Performance**: galeri besar (ribuan foto) wajib menggunakan virtualisasi grid + thumbnail server-generated, foto asli on-demand.

#### 8.5.4 KPI & Tabel Ringkas
- **KPI cards** di atas: total kontrak aktif, total nilai kontrak, % progres tertimbang nasional, jumlah warning aktif, jumlah temuan Itjen open.
- **Tabel deviasi & SPI lintas kontrak**: sortir/filter per kolom; klik baris → buka detail kontrak.
- **Status pembayaran termin**: ringkasan termin yang ELIGIBLE / SUBMITTED / VERIFIED / PAID per kontrak.
- **Heatmap warning** per provinsi (opsional, jika data cukup).

#### 8.5.5 Aturan Umum Dashboard
- **Auto-refresh** data setiap N menit (konfigurable, default 5 menit) tanpa reload halaman.
- **Ekspor seluruh dashboard** sebagai PDF laporan eksekutif (snapshot).
- **Mode presentasi** (fullscreen, sembunyikan menu) untuk tampil di rapat.
- **Permission-aware**: data yang ditampilkan otomatis difilter sesuai scope user (mis. PPK hanya melihat kontraknya).

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

### 13.1 Aturan Umum
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

### 13.2 Karakteristik Data — Latar Belakang
- BOQ adalah **dataset SANGAT BESAR**. Satu kontrak mudah memiliki ratusan hingga ribuan baris item leaf (4 level hirarki) tersebar di banyak fasilitas dan lokasi.
- Konsultan & admin akan menghabiskan banyak waktu di tampilan tabel ini, sering kali untuk **input/edit massal**.
- Karena itu **UI/UX harus luwes seperti Excel**. Detail prinsipnya di sub-bagian berikut.

### 13.3 Tampilan Tabel sebagai Tempat Kerja Utama
- Editing dilakukan **LANGSUNG di sel tabel (inline editing)**. Hindari pola "buka modal untuk edit satu baris" pada workflow massal.
- Dukung **navigasi keyboard penuh**: panah, Tab/Shift+Tab, Enter pindah ke bawah, Escape batal edit.
- Dukung **copy-paste blok sel dari/ke Excel** (multi-baris, multi-kolom).
- Dukung **fill-down / drag-to-fill** pada kolom numerik & teks.
- Dukung **undo/redo lokal** pada sesi edit sebelum simpan.
- Sediakan **auto-save berkala** atau indikator "perubahan belum disimpan" yang sangat jelas.

### 13.4 Performa untuk Data Besar
- Tabel **WAJIB mendukung virtualisasi baris/kolom** — render hanya yang terlihat. Tidak boleh nge-lag saat memuat 5.000+ baris.
- **Sortir, filter, dan pencarian harus tetap responsif** pada data besar.
- Sediakan **freeze/pin** untuk kolom kunci (kode, deskripsi) dan freeze untuk baris header grup hirarki.

### 13.5 Hirarki & Pengelompokan
- Tabel BOQ menampilkan hirarki 4 level dengan baris yang bisa di-**expand/collapse** (tree grid). Sediakan tombol "Expand semua / Collapse semua" dan **persist state per pengguna**.
- **Subtotal per level** (grup, fasilitas, lokasi, kontrak) tampil otomatis dan ikut menyesuaikan saat data berubah.

### 13.6 Filter, Sortir, Pencarian
- Setiap kolom punya filter (text contains, number range, date range, multi-select untuk enum) dan sortir.
- Sediakan **kotak pencarian global** (cari di semua kolom).
- Filter aktif terlihat sebagai **chip/badge** yang bisa dilepas satu per satu.
- Status filter & sort dapat **disimpan sebagai "view" (preset)** per pengguna.

### 13.7 Dropdown Wajib Filterable — DI MANA SAJA
- **SEMUA dropdown di seluruh aplikasi harus searchable/typeable**. Tidak boleh ada dropdown panjang tanpa pencarian.
- **Dropdown DI DALAM SEL GRID** juga harus filterable: ketik untuk mempersempit opsi, panah untuk navigasi, Enter untuk pilih.
- Dropdown dengan banyak data (master fasilitas, kode pekerjaan, perusahaan, PPK, user) harus mendukung **pencarian server-side dengan debounce dan paging** — bukan memuat semua opsi sekaligus.
- Tampilkan ikon "loading" saat fetching, dan pesan "tidak ada hasil" saat kosong.

### 13.8 Validasi Inline
- Sel yang invalid ditandai jelas (warna + tooltip alasan).
- Cegah menyimpan jika ada error; tunjukkan ringkasan kesalahan dengan tombol **"loncat ke sel pertama yang error"**.
- Validasi **cross-row** (mis. total bobot harus 100%, total nilai BOQ ≤ nilai kontrak) ditampilkan di **footer/summary tabel realtime**.

### 13.9 Bulk Operation
- Pilih banyak baris via checkbox + Shift-click range.
- Aksi massal: hapus, ubah satu kolom, ekspor pilihan saja.
- **Konfirmasi eksplisit** sebelum aksi destruktif.

### 13.10 Konsistensi
- Pola grid Excel-like ini dipakai **DI SEMUA tempat data tabular berskala** (BOQ, progress mingguan, daftar termin, daftar VO, daftar temuan, audit log). Bukan hanya BOQ.

---


## 14. Standar Output Dokumen (Excel & PDF) — Mature & Robust

Sistem ini sering dipakai untuk menghasilkan **laporan & surat resmi**. Kualitas output dokumen adalah **fitur produk, bukan tempelan**.

### 14.1 Prinsip Umum
- Setiap dokumen yang di-generate **WAJIB DETERMINISTIK**: input sama → output sama (penomoran, urutan, format).
- Setiap dokumen **WAJIB punya identitas terlacak**: nomor dokumen, tanggal cetak, dicetak oleh siapa, versi BOQ/revisi yang dipakai.
- Header & footer resmi (kop instansi, nomor surat, halaman X dari Y) konsisten di seluruh dokumen.
- **Bahasa Indonesia penuh**:
  - Format tanggal: `26 April 2026`.
  - Pemisah ribuan titik, desimal koma.
  - Mata uang: `Rp 1.250.000.000,00`.
  - **Terbilang dalam Bahasa Indonesia** untuk dokumen pembayaran (mis. "satu miliar dua ratus lima puluh juta rupiah").

### 14.2 Excel Export (Mature)
Bukan sekadar dump CSV. Wajib:
- **Multi-sheet** bila dokumen punya beberapa bagian (mis. ringkasan + detail per fasilitas).
- **Header berformat** (bold, warna, border), kolom **auto-width** yang rapi, **freeze panes** pada baris header.
- **Format angka, mata uang, persentase, dan tanggal** yang benar (bukan teks).
- **Formula sederhana** untuk subtotal/total bila relevan, agar pengguna bisa edit dan total ikut menyesuaikan.
- **Logo & info kontrak** di bagian atas sheet pertama.
- **Round-trip**: file yang di-ekspor sebagai template dapat di-import kembali tanpa kerusakan format (untuk template progress mingguan & template BOQ).
- Sheet/tabel besar harus tetap di-generate **efisien (streaming)** — jangan menahan seluruh data di memori sekaligus.

### 14.3 PDF Generation (Robust)
Kualitas seperti **dokumen kantor resmi**, BUKAN screenshot HTML kasar.

Layout konsisten: margin, font, spasi, ukuran kertas (A4 default, pilihan F4/Letter).

Mendukung:
- **Header & footer berulang** di setiap halaman (kop, nomor surat, halaman X dari Y, watermark "DRAFT" jika dokumen belum final).
- **Tabel yang dapat memecah halaman dengan benar** — header tabel diulang di tiap halaman, baris tidak terpotong di tengah.
- **Tanda tangan**: blok signature dengan nama, jabatan, NIP, tanggal, dan ruang TTD; **opsi sisipkan QR code verifikasi**.
- **Lampiran foto** (galeri laporan harian/mingguan & temuan) dengan caption & timestamp, tata letak rapi (grid 2-4 kolom).
- **Embed font** agar tampilan konsisten lintas perangkat.

**Penomoran dokumen otomatis** dengan format konfigurable (mis. `001/KNMP/PPK/IV/2026`), tidak boleh tabrakan/duplikat.

### 14.4 Daftar Dokumen yang Harus Didukung (Minimal)

**Excel:**
- Template & ekspor BOQ per kontrak / per fasilitas / per lokasi.
- Template & ekspor progress mingguan (round-trip import).
- Rekap laporan mingguan (multi-sheet: ringkasan, progress per fasilitas, kurva-S, deviasi).
- Rekap pembayaran termin per kontrak.
- Rekap audit log dengan filter aktif.
- **Komparasi BOQ** antar dua revisi — kolom: `Jenis Pekerjaan | Harga Satuan | Pekerjaan A (Vol & Jumlah) | Pekerjaan B (Vol & Jumlah) | Tambah (Vol & Jumlah) | Kurang (Vol & Jumlah) | Ket`. Excel dengan **formula dinamis** untuk Jumlah Harga & Selisih.

**PDF (Landscape untuk tabel lebar):**
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

### 14.5 Aturan Tambahan
- Semua aksi generate dokumen masuk **audit log** (siapa, kapan, dokumen apa, untuk entitas mana).
- File hasil generate **disimpan/di-cache** agar bisa diunduh ulang tanpa regenerate; pengguna juga bisa "regenerate" eksplisit.
- Sediakan **tombol "Pratinjau"** sebelum cetak/unduh agar tidak boros waktu pada dokumen besar.
- Untuk dokumen pembayaran, snapshot data BOQ yang dipakai **diankor ke revisi BOQ aktif** saat dokumen di-generate, sesuai aturan bisnis termin (lihat Bagian 9 & 10).

---

## 15. Skala & Performa

- Kontrak total ~50, lokasi ~300, fasilitas ~3.000, BOQ items ~50.000, laporan mingguan ~1.500/tahun, foto ~30.000/tahun.
- **Pilih database yang mendukung JSONB untuk fields fleksibel** (audit changes, notification threshold, assigned_contract_ids).
- **Index** wajib pada: `(contract_id, is_active)`, `(boq_revision_id)`, `(facility_id, is_active)`, `(parent_id)`, `(source_item_id)`, `(contract_id, week_number)`, `(contract_id, term_number)`.
- **Pagination** wajib untuk list endpoint (audit log, laporan mingguan multi-tahun, foto).
- **N+1 query**: hindari di endpoint flat (BOQ by contract, weekly report grid).

---

## 16. Definisi Selesai (Definition of Done)

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

## 17. Yang HARUS Ditanyakan Sebelum Implementasi

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

## 18. Cara Pakai Dokumen Ini

**Untuk sesi AI baru:** salin seluruh isi file ini sebagai pesan pertama, atau letakkan di root repo kosong dengan nama `CLAUDE.md` agar Claude Code otomatis memuatnya.

**Sebelum memulai koding:** minta AI buatkan dulu **rencana arsitektur tertulis** (struktur folder, daftar tabel/collection, daftar endpoint, daftar halaman UI) dan **review bersama**. Baru implementasi setelah disetujui.

**Saat implementasi:** kerjakan **per modul end-to-end** (mis. Kontrak penuh → Lokasi/Fasilitas penuh → BOQ penuh → … ), bukan per layer (semua model dulu, semua API dulu). Modul end-to-end memberi feedback lebih cepat dan lebih mudah di-review.

**Jangan lakukan:** auto-migration ad-hoc, fallback diam-diam, tambal sulam saat ketemu error. Cari root cause, perbaiki strukturnya.

---

*Dokumen ini adalah brief fungsional murni. AI bebas memilih stack apa pun selama bisa memenuhi seluruh aturan bisnis di Bagian 9 dan invariant DB di Bagian 5–6.*

