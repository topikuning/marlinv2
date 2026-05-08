# Manual Deployment MARLIN v2 ke Railway

> Panduan terperinci deploy stack MARLIN v2 (FastAPI + PostgreSQL + React/Vite) ke Railway. Verifikasi info: Railway docs & pricing per **April–Mei 2026**.
>
> **Output akhir:** 1 backend service + 1 frontend service + 1 PostgreSQL service di satu Railway project, dengan persistent volume untuk foto upload, custom domain HTTPS, dan auto-deploy dari GitHub `main`.

**Estimasi biaya:** Hobby Plan **\$5/bulan** (mencakup \$5 usage credit). Untuk skala produksi 50 kontrak / 30k foto / tahun, biasanya cukup di Hobby. Pro Plan **\$20/bulan** kalau perlu volume > 5 GB atau replikasi.

---

## Prasyarat

- Akun **Railway** ([railway.com](https://railway.com)) — daftar via GitHub.
- Repo MARLIN v2 sudah ada di GitHub (push `main` ke `topikuning/marlinv2`).
- **Railway CLI** (opsional tapi sangat membantu):
  ```bash
  npm install -g @railway/cli
  railway login
  ```
- Domain (opsional, untuk custom URL).
- Akun **Fonnte** (kalau pakai notifikasi WhatsApp).

---

## Arsitektur Deploy

```
┌────────────────────────────────────────────────┐
│            Railway Project: marlin             │
│                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────┐ │
│  │  Backend     │  │  Frontend    │  │  DB  │ │
│  │  FastAPI     │──▶  React/Vite  │  │ PG16 │ │
│  │  (uvicorn)   │  │  (Caddy)     │  └──────┘ │
│  │  + Volume    │  └──────────────┘           │
│  │  /app/uploads│                             │
│  └──────────────┘                             │
│         ▲                                      │
│         │  Public domain HTTPS                 │
└────────────────────────────────────────────────┘
```

3 service terpisah:
1. **Backend** — FastAPI (port 8000, expose ke public, mount volume).
2. **Frontend** — React/Vite (build static, Caddy serve).
3. **PostgreSQL** — managed Railway plugin.

---

## Langkah 1: Buat Project & Provision PostgreSQL

### 1.1 Buat project baru
1. Login [railway.com/dashboard](https://railway.com/dashboard) → **New Project**.
2. Pilih **Deploy from GitHub repo** → pilih `topikuning/marlinv2`.
3. Beri nama project: `marlin` (atau bebas).

### 1.2 Tambah PostgreSQL service
1. Di project canvas, klik **+ New** → **Database** → **Add PostgreSQL**.
2. Tunggu sampai status `running`. Railway otomatis generate:
   - `DATABASE_URL` — connection string lengkap.
   - `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.
3. **Tidak perlu expose ke public** — biarkan default (private network).

### 1.3 (Opsional) Akses DB dari laptop
Untuk seed atau debug, klik service Postgres → tab **Settings** → toggle **TCP Proxy** (kasih port public sementara). Ingat matikan setelah selesai.

---

## Langkah 2: Deploy Backend (FastAPI)

### 2.1 Tambah service backend
1. Di project, **+ New** → **GitHub Repo** → pilih `marlinv2` → set **Root Directory** ke `/backend`.
2. Railway auto-detect Dockerfile yang sudah ada di `backend/Dockerfile` → pakai builder **Dockerfile** (lebih cepat dan reproducible vs RAILPACK auto-detect).

### 2.2 Set environment variables
Buka service backend → **Variables** → tambah satu per satu (atau pakai RAW Editor untuk paste sekaligus):

```bash
# Database — referensi ke Postgres service via Railway variable references
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Auth — generate string acak 32+ karakter
SECRET_KEY=ganti-dengan-string-acak-min-32-karakter-misal-openssl-rand-hex-32
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480

# Mode produksi
DEBUG=false

# CORS — isi dengan domain frontend setelah Langkah 3 selesai
CORS_ORIGINS=https://marlin-frontend.up.railway.app,https://marlin.example.com

# Upload — mount volume di sini (lihat Langkah 2.3)
UPLOAD_DIR=/app/uploads
MAX_UPLOAD_SIZE_MB=20

# Scheduler harian (early warning)
SCHEDULER_ENABLED=true
DAILY_CHECK_HOUR=8

# WhatsApp Fonnte (opsional)
WA_ENABLED=false
WA_API_TOKEN=

# Volume permission fix (kalau Docker non-root)
RAILWAY_RUN_UID=0
```

> **Tip:** `${{Postgres.DATABASE_URL}}` adalah Railway variable reference — auto-update kalau credential Postgres rotasi. Jangan hard-code.
>
> Generate `SECRET_KEY`:
> ```bash
> openssl rand -hex 32
> ```

### 2.3 Mount Volume untuk Uploads
Folder `/app/uploads` (foto laporan harian/mingguan/review/termin) **wajib persistent** — kalau tidak, foto hilang setiap deploy.

1. Service backend → tab **Volumes** → **Create Volume**.
2. Mount path: `/app/uploads`.
3. Size awal: 5 GB (bisa diperbesar nanti, max 1 TB di Pro plan).

Setelah dibuat, Railway otomatis set env:
- `RAILWAY_VOLUME_NAME`
- `RAILWAY_VOLUME_MOUNT_PATH=/app/uploads`

### 2.4 Health check & start command
Dockerfile existing sudah pakai:
```
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Override port** supaya pakai `$PORT` Railway:
1. Service backend → **Settings** → **Deploy** → **Custom Start Command**:
   ```
   uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
   ```
2. **Health Check Path**: `/api/health` (kalau endpoint ini ada — kalau belum, set ke `/`).
3. **Restart Policy**: `On Failure` (default).

### 2.5 Expose ke public
1. Service backend → **Settings** → **Networking** → **Generate Domain**.
2. Hasil: `https://marlin-backend-production-xxxx.up.railway.app`.
3. Catat URL ini — dipakai di Langkah 3.2 sebagai `VITE_API_URL`.

### 2.6 Trigger pertama deploy
- Otomatis terjadi setelah Variables disimpan.
- Cek **Deployments** tab → log build & runtime.
- Bila berhasil, akses `https://<backend-domain>/docs` → Swagger UI tampil.

---

## Langkah 3: Deploy Frontend (React/Vite)

### 3.1 Tambah service frontend
1. **+ New** → **GitHub Repo** → pilih `marlinv2` lagi → set **Root Directory** ke `/frontend`.
2. Railway auto-detect Vite project.
3. Pilih builder: **RAILPACK** (rekomendasi — auto-handle Caddy serve).

   Atau kalau pakai Dockerfile existing (yang pakai Nginx):
   - Builder: **Dockerfile**
   - Pastikan `frontend/Dockerfile` tetap ada
   - Dockerfile sudah COPY hasil build ke `/usr/share/nginx/html`

### 3.2 Set environment variables
```bash
# URL backend dari Langkah 2.5
VITE_API_URL=https://marlin-backend-production-xxxx.up.railway.app

# Atau pakai Railway reference (lebih clean):
VITE_API_URL=https://${{Backend.RAILWAY_PUBLIC_DOMAIN}}
```

> ⚠️ **Penting Vite:** semua env yang dipakai di kode **wajib prefix `VITE_`**. Selain itu, env Vite **diembed saat build** — kalau ubah, harus rebuild (Railway auto-rebuild kalau push baru).

### 3.3 Build & Start command (kalau bukan Dockerfile)
Untuk RAILPACK builder:
- **Build Command**: `npm ci && npm run build` (default)
- **Start Command**: kosongkan — Railway template Vite/React otomatis pakai Caddy serve `dist/`.

### 3.4 Expose ke public
1. Service frontend → **Settings** → **Networking** → **Generate Domain**.
2. Hasil: `https://marlin-frontend-production-xxxx.up.railway.app`.

### 3.5 Update CORS di backend
Kembali ke service Backend → **Variables** → update:
```bash
CORS_ORIGINS=https://marlin-frontend-production-xxxx.up.railway.app
```
Backend akan auto-redeploy.

---

## Langkah 4: Inisialisasi Database (Seed)

Pertama kali deploy, DB Postgres masih kosong. Pilih salah satu:

### Opsi A: One-shot via Railway CLI (rekomendasi)
```bash
railway login
railway link    # pilih project marlin
railway service backend
railway run python seed_master.py    # role, permission, master facility, kode kerja
railway run python seed_demo.py      # data demo (opsional)
```

`railway run` mengeksekusi command lokal **dengan env Railway** (DATABASE_URL terisi otomatis).

### Opsi B: Via Service Shell di Dashboard
1. Service backend → tab **...** → **Open Shell** (kalau plan support).
2. Jalankan:
   ```bash
   python seed_master.py
   python seed_demo.py
   ```

### Opsi C: One-time Job Service
1. **+ New** → **Empty Service** → connect ke repo `/backend`.
2. **Custom Start Command**: `python seed_master.py && python seed_demo.py`.
3. **Restart Policy**: `Never`.
4. Set env: `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
5. Deploy → akan run sekali → mati. Hapus service setelah selesai.

> Auto-migration enum/column di `backend/main.py:_ensure_enum_values` & `_ensure_columns` jalan otomatis saat startup — tidak perlu manual.

---

## Langkah 5: Custom Domain & HTTPS

### 5.1 Domain frontend (utama)
1. Service frontend → **Settings** → **Networking** → **Custom Domain** → masukkan `marlin.example.com`.
2. Railway tampilkan record DNS yang harus dibuat:
   - **Type:** `CNAME`
   - **Name:** `marlin` (atau `@` untuk apex)
   - **Target:** `xxxx.up.railway.app` (Railway kasih spesifik).
3. Set di DNS provider (Cloudflare, GoDaddy, dll.). **Disable proxy Cloudflare** dulu (gray cloud), atau ikuti panduan SSL passthrough.
4. Tunggu 1–10 menit. Railway auto-issue SSL via Let's Encrypt.

### 5.2 Domain backend
- **Opsi 1 — subdomain terpisah:** `api.marlin.example.com` → mirip Langkah 5.1 tapi service backend.
- **Opsi 2 — path-based via reverse proxy:** Set frontend Caddy/Nginx untuk proxy `/api/*` ke backend internal URL. Lebih kompleks, tidak perlu kalau pakai opsi 1.

Update env frontend setelah domain backend siap:
```bash
VITE_API_URL=https://api.marlin.example.com
```

### 5.3 Update CORS
Backend env:
```bash
CORS_ORIGINS=https://marlin.example.com,https://www.marlin.example.com
```

---

## Langkah 6: Auto-Deploy dari GitHub

Default sudah aktif: setiap push ke `main` → Railway auto-build & deploy semua service yang link ke repo itu.

### 6.1 Atur branch
- Service → **Settings** → **Source** → **Branch** → pilih `main` (atau staging branch khusus).

### 6.2 Path Filter (untuk monorepo)
Supaya backend tidak rebuild saat hanya frontend yang berubah (dan sebaliknya):
- Service backend → **Settings** → **Source** → **Watch Paths** → `backend/**`.
- Service frontend → **Settings** → **Source** → **Watch Paths** → `frontend/**`.

### 6.3 PR Preview (opsional)
- **Settings** → **Environments** → **Enable PR environments**.
- Setiap PR otomatis spawn isolated environment dengan data terpisah.
- Hanya untuk Pro Plan ke atas.

---

## Langkah 7: Monitoring & Logs

### 7.1 Logs realtime
- Service → **Deployments** → klik deploy aktif → **View Logs** (live tail).
- Atau via CLI: `railway logs --service backend`.

### 7.2 Metrics
- Service → **Metrics** tab → CPU, Memory, Network, Disk per menit.
- Set **Limit/Alert** kalau memory mendekati batas.

### 7.3 External monitoring (rekomendasi)
- **Sentry** untuk error tracking — tambah `SENTRY_DSN` di env.
- **BetterStack/UptimeRobot** untuk uptime check ke `https://api.marlin.example.com/health`.

### 7.4 Backup PostgreSQL
1. Service Postgres → **Settings** → **Backups** → enable **Daily Backups** (Pro Plan).
2. Manual snapshot:
   ```bash
   railway run pg_dump -Fc > backup-$(date +%Y%m%d).dump
   ```
3. Upload ke S3/Backblaze atau commit ke private gist.

> **WAJIB** untuk produksi: backup harian + minimal 7 hari retention. Compliance BPK butuh audit trail tidak hilang.

---

## Langkah 8: Estimasi Biaya

Asumsi skala produksi (50 kontrak, 30k foto/tahun, traffic moderat):

| Komponen | Spec | Estimasi |
|---|---|---|
| Backend service | ~512 MB RAM, ~10% CPU avg | $3–5/bln |
| Frontend service | ~128 MB RAM, static serve | $1–2/bln |
| PostgreSQL | ~256 MB RAM, ~1 GB storage | $1–2/bln |
| Volume uploads | 5 GB | $0.25/GB = $1.25/bln |
| Egress bandwidth | ~5 GB/bln | gratis (100 GB free) |
| **Total estimasi** | | **$6–10/bln** |

**Plan rekomendasi:**
- **Hobby ($5/bln)** — cukup untuk MVP & internal use. $5 usage credit termasuk → biasanya tidak overage.
- **Pro ($20/bln)** — kalau perlu PR preview environments, daily backup auto, volume > 5 GB, atau prioritas support.

> Cek **Project → Usage** harian untuk track real cost.

---

## Langkah 9: Konfigurasi `railway.json` (Opsional, Lebih Rapi)

Daripada setting via dashboard, commit `railway.json` per service. Buat di root masing-masing folder:

### `backend/railway.json`
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

### `frontend/railway.json`
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "RAILPACK"
  },
  "deploy": {
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

> **Catatan:** Railway sekarang menggunakan **RAILPACK** sebagai pengganti **NIXPACKS** (Nixpacks deprecated per akhir 2025). Tetap pakai DOCKERFILE bila Dockerfile sudah ada — lebih cepat & deterministik.

---

## Langkah 10: Hardening Produksi

### 10.1 Security
- Rotasi `SECRET_KEY` saat go-live (jangan pakai default).
- **Environment Variables → Sealed Variables** untuk secrets sensitif (Postgres password, WA token, dll.). Sealed = tidak bisa dibaca lagi setelah save.
- Enable **2FA** di akun Railway.
- Buat **Service Account Token** terpisah untuk CI/CD, jangan pakai user token pribadi.

### 10.2 Database
- Set `DATABASE_URL` ke private network (default Railway). **Tidak perlu** TCP Proxy public di produksi.
- Enable **PgBouncer** atau connection pooling kalau concurrent user > 50.
- Set `pool_size` di SQLAlchemy:
  ```python
  # backend/app/core/database.py
  engine = create_engine(
      settings.DATABASE_URL,
      pool_size=10,
      max_overflow=20,
      pool_pre_ping=True,  # auto-reconnect setelah idle
  )
  ```

### 10.3 Static Files Scale-up
Saat foto > 10 GB atau traffic tinggi, pindah ke object storage:

1. **Backblaze B2** atau **Cloudflare R2** (gratis 10 GB + egress murah).
2. Update `app/services/file_service.py` → upload ke S3-compatible API.
3. Foto URL → CDN (Cloudflare) supaya origin Railway tidak terbebani.

Volume Railway tetap dipakai untuk thumbnail cache atau temporary upload.

### 10.4 Rate Limiting
Tambah middleware FastAPI (mis. `slowapi`):
```bash
pip install slowapi
```
Penting untuk endpoint public seperti `/auth/login` (cegah brute force).

### 10.5 Logging
Set struktur log JSON supaya mudah di-grep di Railway logs:
```python
# backend/app/core/logging.py
import logging, json
class JSONFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({
            "level": record.levelname,
            "msg": record.getMessage(),
            "time": self.formatTime(record),
        })
```

---

## Langkah 11: Troubleshooting

### 🔴 Backend gagal start: `database connection refused`
- Cek `DATABASE_URL` pakai `${{Postgres.DATABASE_URL}}` (bukan hard-coded).
- Postgres service masih `pending` — tunggu sampai `running`.
- Test dari CLI: `railway run python -c "from app.core.database import engine; engine.connect()"`.

### 🔴 Frontend tampil blank, `VITE_API_URL undefined`
- Vite env **diembed saat build** — variable harus di-set **sebelum** build.
- Cek build log: harus ada baris `Setting VITE_API_URL=https://...`.
- **Solusi:** Variables → simpan → service akan **auto-rebuild**.

### 🔴 CORS error di browser console
- Backend `CORS_ORIGINS` belum include domain frontend produksi.
- Update env backend → tunggu redeploy.
- Cek `app/main.py` di backend pakai `allow_origins=settings.CORS_ORIGINS.split(",")` — split koma penting.

### 🔴 Volume permission denied saat upload foto
- Set env backend: `RAILWAY_RUN_UID=0` (root).
- Atau adjust Dockerfile: `RUN chown -R 1000:1000 /app/uploads` + `USER 1000`.

### 🔴 Out of Memory (backend killed)
- Default Hobby Plan ~512 MB. Excel export besar bisa OOM.
- **Quick fix:** lihat `PERFORMANCE_AUDIT.md` 2.1 — ganti ke `WriteOnlyWorkbook` streaming.
- **Slow fix:** upgrade ke Pro plan.

### 🔴 Foto hilang setelah deploy
- Volume tidak ter-mount — cek `/app/uploads` ada di **Volumes** tab.
- Periksa `UPLOAD_DIR=/app/uploads` di env backend.
- **Volume tidak bisa di-share** antar service — backend & frontend punya volume terpisah; foto harus diakses via backend URL, bukan static frontend.

### 🔴 Build timeout (>15 menit)
- Cek dependencies — kalau pasang banyak Python C extensions, pakai `python:3.11-slim` + `apt-get install build-essential libpq-dev` (sudah ada di Dockerfile).
- Frontend: `node_modules` cache — Railway auto-cache antar build.

### 🔴 Auto-redeploy loop
- Health check fail → restart → fail → loop.
- Cek **Deploy Logs** untuk error spesifik.
- Sementara nonaktif health check di **Settings** untuk debug.

### 🔴 SSL certificate pending lama
- DNS belum propagasi — cek `dig marlin.example.com` dari laptop.
- Cloudflare proxy menyala (orange cloud) → matikan dulu sampai SSL issued, baru aktifkan.

---

## Langkah 12: Checklist Go-Live

Cetak dan centang sebelum announce ke user:

**Backend:**
- [ ] `SECRET_KEY` sudah di-rotasi (bukan default).
- [ ] `DEBUG=false`.
- [ ] `CORS_ORIGINS` hanya domain produksi (bukan `*`).
- [ ] Health check endpoint ada & green.
- [ ] Volume `/app/uploads` mounted & writable.
- [ ] `SCHEDULER_ENABLED=true` (kalau notifikasi dipakai).
- [ ] `WA_API_TOKEN` sudah di-set kalau `WA_ENABLED=true`.

**Frontend:**
- [ ] `VITE_API_URL` ke domain backend produksi.
- [ ] Custom domain HTTPS aktif.
- [ ] Build size < 1 MB initial (lihat `PERFORMANCE_AUDIT.md` 4.3).
- [ ] Tombol login bisa hit backend.

**Database:**
- [ ] Backup harian aktif (Pro Plan).
- [ ] `seed_master.py` sudah run (role, permission, master facility).
- [ ] Akun superadmin awal sudah dibuat & password sudah di-rotasi.
- [ ] Connection string privat (tidak public TCP proxy).

**Security:**
- [ ] 2FA Railway aktif untuk semua admin.
- [ ] Sealed variables untuk secrets.
- [ ] Rate limit di endpoint auth.
- [ ] Audit log sudah berjalan (cek tabel `audit_logs`).

**Monitoring:**
- [ ] Sentry/BetterStack terhubung (opsional tapi disarankan).
- [ ] Uptime check ke `/health` setiap 5 menit.
- [ ] Alert notification ke admin email/WA.

---

## Lampiran A: Daftar Lengkap Environment Variables Backend

| Variable | Wajib | Default | Deskripsi |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | `${{Postgres.DATABASE_URL}}` |
| `SECRET_KEY` | ✅ | — | JWT signing, min 32 char |
| `JWT_ALGORITHM` | ❌ | `HS256` | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | ❌ | `480` | 8 jam default |
| `DEBUG` | ❌ | `false` | Production = false |
| `CORS_ORIGINS` | ✅ | — | Comma-separated domain frontend |
| `UPLOAD_DIR` | ❌ | `./uploads` | Set ke `/app/uploads` di Railway |
| `MAX_UPLOAD_SIZE_MB` | ❌ | `20` | |
| `SCHEDULER_ENABLED` | ❌ | `true` | Job harian early warning |
| `DAILY_CHECK_HOUR` | ❌ | `8` | Jam scheduler (24h) |
| `WA_ENABLED` | ❌ | `false` | Aktifkan Fonnte WA |
| `WA_API_TOKEN` | ❌ | — | Token Fonnte |
| `RAILWAY_RUN_UID` | ❌ | — | Set `0` kalau permission issue volume |
| `SENTRY_DSN` | ❌ | — | Error tracking |

## Lampiran B: Daftar Environment Variables Frontend

| Variable | Wajib | Deskripsi |
|---|---|---|
| `VITE_API_URL` | ✅ | URL backend produksi (HTTPS) |

> Vite env **diembed saat build** — kalau diubah, harus rebuild service.

---

## Lampiran C: CLI Cheatsheet

```bash
# Setup awal
npm install -g @railway/cli
railway login
railway link                          # link ke project existing
railway environment production         # switch environment

# Deploy
railway up                             # deploy folder current
railway redeploy                       # redeploy tanpa code change

# Logs & debug
railway logs                           # log service current
railway logs --service backend         # log spesifik service
railway run <command>                  # run command lokal dengan env Railway

# Variables
railway variables                      # list env current service
railway variables set KEY=VALUE        # set var
railway variables delete KEY

# Database
railway connect Postgres               # buka psql langsung ke DB

# Volume
railway volume list
railway volume add /app/uploads
```

---

## Sumber Referensi

- [Railway Docs — FastAPI Guide](https://docs.railway.com/guides/fastapi)
- [Railway Docs — React Guide](https://docs.railway.com/guides/react)
- [Railway Docs — Monorepo Deployment](https://docs.railway.com/guides/deploying-a-monorepo)
- [Railway Docs — Volumes](https://docs.railway.com/volumes)
- [Railway Docs — Variables Reference](https://docs.railway.com/reference/variables)
- [Railway Docs — PostgreSQL](https://docs.railway.com/databases/postgresql)
- [Railway Pricing](https://railway.com/pricing)
- [Railway Blog — Deployment Methods Comparison](https://blog.railway.com/p/comparing-deployment-methods-in-railway)

---

*Manual ini akurat per April–Mei 2026. Refresh setiap 6 bulan atau saat Railway umumkan perubahan plan/builder major.*



