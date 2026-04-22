"""
seed_master.py — Master data bersih.

Isi:
  1. Migration idempotent (ALTER TABLE untuk kolom v2.1+)
  2. Permissions (30 buah)
  3. Menu items (17 buah, 2 level)
  4. Roles (8 role) beserta permission & menu masing-masing
  5. Admin user: admin@knmp.id / Admin@123!
  6. Master Work Codes (70 kode dari 6 kategori)
  7. Master Facilities (29 tipe fasilitas KNMP)

Tidak ada data kontrak, perusahaan, PPK, laporan, atau apapun lain.

Jalankan:
    python seed_master.py
"""
import sys
from sqlalchemy import text
from app.core.database import SessionLocal, engine, Base
from app.core.security import get_password_hash
from app.models.models import (
    Role, Permission, RolePermission, MenuItem, RoleMenu, User,
    MasterWorkCode, WorkCategory, MasterFacility,
)


# ─────────────────────────────────────────────────────────────────────────────
# Migration SQL — idempotent, aman dijalankan berulang
# ─────────────────────────────────────────────────────────────────────────────
MIGRATION_SQL = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_provisioned BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP",
    "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS activated_by_id UUID",
    # Unlock mode (safety-valve edit langsung, di luar alur Addendum)
    "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMP",
    "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS unlock_until TIMESTAMP",
    "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS unlocked_by_id UUID",
    "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS unlock_reason TEXT",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_type VARCHAR(30) NOT NULL DEFAULT 'contractor'",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_user_id UUID",
    "ALTER TABLE ppk ADD COLUMN IF NOT EXISTS user_id UUID",
    "ALTER TABLE locations ADD COLUMN IF NOT EXISTS konsultan_id UUID",
    "ALTER TABLE facilities ADD COLUMN IF NOT EXISTS master_facility_id UUID",
    "ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS boq_revision_id UUID",
    "ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS source_item_id UUID",
    "ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS change_type VARCHAR(20)",
    """CREATE TABLE IF NOT EXISTS master_facilities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(40) UNIQUE NOT NULL,
        name VARCHAR(200) NOT NULL,
        facility_type VARCHAR(60) NOT NULL,
        typical_unit VARCHAR(20),
        description TEXT,
        display_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )""",
    """CREATE TABLE IF NOT EXISTS boq_revisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        addendum_id UUID,
        cco_number INTEGER NOT NULL,
        revision_code VARCHAR(20) NOT NULL,
        name VARCHAR(255),
        description TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        total_value NUMERIC(18,2) DEFAULT 0,
        item_count INTEGER DEFAULT 0,
        approved_at TIMESTAMP,
        approved_by_id UUID,
        created_by UUID,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_revision_cco_per_contract UNIQUE (contract_id, cco_number)
    )""",
    """CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_revision_per_contract
        ON boq_revisions (contract_id) WHERE is_active = TRUE""",
]


# ─────────────────────────────────────────────────────────────────────────────
# Permissions
# ─────────────────────────────────────────────────────────────────────────────
PERMISSIONS = [
    ("user",         "read",   "Lihat user"),
    ("user",         "create", "Tambah user"),
    ("user",         "update", "Ubah user"),
    ("user",         "delete", "Hapus user"),
    ("role",         "read",   "Lihat role"),
    ("role",         "create", "Tambah role"),
    ("role",         "update", "Ubah role"),
    ("role",         "delete", "Hapus role"),
    ("master",       "read",   "Lihat master data"),
    ("master",       "create", "Tambah master data"),
    ("master",       "update", "Ubah master data"),
    ("master",       "delete", "Hapus master data"),
    ("contract",     "read",   "Lihat kontrak"),
    ("contract",     "create", "Tambah kontrak"),
    ("contract",     "update", "Ubah kontrak"),
    ("contract",     "delete", "Hapus kontrak"),
    ("report",       "read",   "Lihat laporan"),
    ("report",       "create", "Buat laporan"),
    ("report",       "update", "Ubah laporan"),
    ("report",       "delete", "Hapus laporan"),
    ("payment",      "read",   "Lihat pembayaran"),
    ("payment",      "create", "Tambah termin"),
    ("payment",      "update", "Ubah termin"),
    ("payment",      "delete", "Hapus termin"),
    ("review",       "read",   "Lihat review lapangan"),
    ("review",       "create", "Buat review"),
    ("review",       "update", "Ubah review"),
    ("review",       "delete", "Hapus review"),
    ("notification", "read",   "Lihat notifikasi"),
    ("notification", "manage", "Kelola aturan notifikasi"),
]


# ─────────────────────────────────────────────────────────────────────────────
# Menu items  (code, label, icon, path, parent_code, order)
# ─────────────────────────────────────────────────────────────────────────────
MENUS = [
    ("dashboard",           "Dashboard",           "LayoutDashboard", "/",                    None,     1),
    ("contracts",           "Kontrak",             "FileText",        "/contracts",           None,     2),
    ("reports_daily",       "Laporan Harian",      "CalendarDays",    "/reports/daily",       None,     3),
    ("reports_weekly",      "Laporan Mingguan",    "CalendarRange",   "/reports/weekly",      None,     4),
    ("scurve",              "Kurva S",             "TrendingUp",      "/scurve",              None,     5),
    ("payments",            "Termin Pembayaran",   "Wallet",          "/payments",            None,     6),
    ("reviews",             "Review Lapangan",     "ClipboardCheck",  "/reviews",             None,     7),
    ("warnings",            "Early Warning",       "AlertTriangle",   "/warnings",            None,     8),
    ("master",              "Master Data",         "Database",        None,                   None,    90),
    ("master_companies",    "Perusahaan",          "Building2",       "/master/companies",    "master", 91),
    ("master_ppk",          "PPK",                 "UserCog",         "/master/ppk",          "master", 92),
    ("master_work_codes",   "Kode Pekerjaan",      "Tags",            "/master/work-codes",   "master", 93),
    ("master_facilities",   "Fasilitas",           "Layers",          "/master/facilities",   "master", 94),
    ("admin",               "Administrasi",        "Settings",        None,                   None,   100),
    ("admin_users",         "User",                "Users",           "/admin/users",         "admin", 101),
    ("admin_roles",         "Role & Permission",   "ShieldCheck",     "/admin/roles",         "admin", 102),
    ("admin_notifications", "Notifikasi",          "Bell",            "/admin/notifications", "admin", 103),
    ("admin_audit",         "Audit Log",           "History",         "/admin/audit",         "admin", 104),
]


# ─────────────────────────────────────────────────────────────────────────────
# Roles  (code, name, desc, is_system, perm_globs, menu_codes)
# ─────────────────────────────────────────────────────────────────────────────
ROLES = [
    ("superadmin",  "Super Administrator",
     "Akses penuh ke seluruh sistem", True,
     ["*"], ["*"]),

    ("admin_pusat", "Admin Pusat",
     "Mengelola semua kontrak, tanpa user management", False,
     ["master.*","contract.*","report.*","payment.*","review.*","notification.read"],
     ["dashboard","contracts","reports_daily","reports_weekly","scurve",
      "payments","reviews","warnings",
      "master","master_companies","master_ppk","master_work_codes","master_facilities"]),

    ("ppk",       "PPK (Pejabat Pembuat Komitmen)",
     "PPK yang membawahi kontrak tertentu", False,
     ["contract.read","contract.update","report.read",
      "payment.read","payment.update","review.read","review.update"],
     ["dashboard","contracts","reports_daily","reports_weekly",
      "scurve","payments","reviews","warnings"]),

    ("manager",   "Manajer / Koordinator",
     "Memantau beberapa kontrak di satuan kerjanya", False,
     ["contract.read","report.read","payment.read","review.read"],
     ["dashboard","contracts","reports_daily","reports_weekly",
      "scurve","payments","reviews","warnings"]),

    ("konsultan", "Konsultan Pengawas",
     "Input laporan harian & mingguan", False,
     ["contract.read","report.read","report.create","report.update","review.read"],
     ["dashboard","contracts","reports_daily","reports_weekly","scurve","warnings"]),

    ("kontraktor","Kontraktor",
     "Melihat data kontraknya saja", False,
     ["contract.read","report.read","payment.read"],
     ["dashboard","contracts","reports_daily","reports_weekly","scurve","payments"]),

    ("itjen",     "Inspektorat / Reviewer",
     "Inspeksi lapangan", False,
     ["contract.read","report.read","review.read","review.create","review.update"],
     ["dashboard","contracts","reports_daily","reports_weekly",
      "scurve","reviews","warnings"]),

    ("viewer",    "Viewer (Read-only)",
     "Hanya melihat, tidak bisa mengubah apapun", False,
     ["contract.read","report.read","payment.read","review.read"],
     ["dashboard","contracts","reports_daily","reports_weekly",
      "scurve","payments","reviews","warnings"]),
]


# ─────────────────────────────────────────────────────────────────────────────
# Master Work Codes (70 kode)
# ─────────────────────────────────────────────────────────────────────────────
WORK_CODES = [
    # PERSIAPAN
    ("PER-001", WorkCategory.PERSIAPAN,    "Mobilisasi",    "Mobilisasi & Demobilisasi Peralatan",             "ls"),
    ("PER-002", WorkCategory.PERSIAPAN,    "Persiapan",     "Direksi Keet & Gudang Sementara",                 "ls"),
    ("PER-003", WorkCategory.PERSIAPAN,    "Persiapan",     "Papan Nama Proyek",                               "bh"),
    ("PER-004", WorkCategory.PERSIAPAN,    "Persiapan",     "Pengukuran & Pemasangan Bouwplank / Uitzet",      "ls"),
    ("PER-005", WorkCategory.PERSIAPAN,    "Pembongkaran",  "Pembongkaran Bangunan Existing",                  "m²"),
    ("PER-006", WorkCategory.PERSIAPAN,    "Tanah",         "Galian Tanah Biasa",                              "m³"),
    ("PER-007", WorkCategory.PERSIAPAN,    "Tanah",         "Galian Tanah Keras / Batu",                       "m³"),
    ("PER-008", WorkCategory.PERSIAPAN,    "Tanah",         "Urugan Tanah Pilihan / Timbunan",                 "m³"),
    ("PER-009", WorkCategory.PERSIAPAN,    "Tanah",         "Pemadatan Tanah",                                 "m²"),
    ("PER-010", WorkCategory.PERSIAPAN,    "Tanah",         "Leveling / Perataan Tanah",                       "m²"),
    # STRUKTURAL
    ("STR-P01", WorkCategory.STRUKTURAL,   "Pondasi",       "Pondasi Batu Belah Kali",                         "m³"),
    ("STR-P02", WorkCategory.STRUKTURAL,   "Pondasi",       "Pondasi Telapak Beton Bertulang",                 "m³"),
    ("STR-P03", WorkCategory.STRUKTURAL,   "Pondasi",       "Pondasi Plat / Rakit Beton Bertulang",            "m³"),
    ("STR-P04", WorkCategory.STRUKTURAL,   "Pondasi",       "Tiang Pancang Beton Pracetak",                    "m"),
    ("STR-P05", WorkCategory.STRUKTURAL,   "Pondasi",       "Minipile 20x20 cm",                               "m"),
    ("STR-P06", WorkCategory.STRUKTURAL,   "Pondasi",       "Bore Pile Diameter 40 cm",                        "m"),
    ("STR-P07", WorkCategory.STRUKTURAL,   "Pondasi",       "Bore Pile Diameter 60 cm",                        "m"),
    ("STR-B01", WorkCategory.STRUKTURAL,   "Beton",         "Beton Lantai Kerja K-100",                        "m³"),
    ("STR-B02", WorkCategory.STRUKTURAL,   "Beton",         "Sloof Beton Bertulang K-250",                     "m³"),
    ("STR-B03", WorkCategory.STRUKTURAL,   "Beton",         "Kolom Beton Bertulang K-300",                     "m³"),
    ("STR-B04", WorkCategory.STRUKTURAL,   "Beton",         "Balok Beton Bertulang K-300",                     "m³"),
    ("STR-B05", WorkCategory.STRUKTURAL,   "Beton",         "Pelat Lantai Beton Bertulang K-300",              "m³"),
    ("STR-B06", WorkCategory.STRUKTURAL,   "Beton",         "Pelat Atap / Dak Beton Bertulang",                "m³"),
    ("STR-B07", WorkCategory.STRUKTURAL,   "Beton",         "Tangga Beton Bertulang",                          "m³"),
    ("STR-B08", WorkCategory.STRUKTURAL,   "Beton",         "Dinding Penahan Tanah Beton",                     "m³"),
    ("STR-B09", WorkCategory.STRUKTURAL,   "Beton",         "Revetmen Batu / Beton",                           "m³"),
    ("STR-B10", WorkCategory.STRUKTURAL,   "Beton",         "Turap Beton / Sheetpile",                         "m"),
    # ARSITEKTURAL
    ("ARS-D01", WorkCategory.ARSITEKTURAL, "Dinding",       "Pasangan Bata Merah 1:3",                         "m²"),
    ("ARS-D02", WorkCategory.ARSITEKTURAL, "Dinding",       "Pasangan Bata Ringan / Hebel",                    "m²"),
    ("ARS-D03", WorkCategory.ARSITEKTURAL, "Dinding",       "Plesteran 1:3 Tebal 15 mm",                       "m²"),
    ("ARS-D04", WorkCategory.ARSITEKTURAL, "Dinding",       "Acian Semen",                                     "m²"),
    ("ARS-D05", WorkCategory.ARSITEKTURAL, "Dinding",       "Dinding GRC / Panel Fasad",                       "m²"),
    ("ARS-L01", WorkCategory.ARSITEKTURAL, "Lantai",        "Urugan Pasir Bawah Lantai",                       "m³"),
    ("ARS-L02", WorkCategory.ARSITEKTURAL, "Lantai",        "Lantai Keramik 40x40 cm",                         "m²"),
    ("ARS-L03", WorkCategory.ARSITEKTURAL, "Lantai",        "Lantai Keramik 60x60 cm",                         "m²"),
    ("ARS-L04", WorkCategory.ARSITEKTURAL, "Lantai",        "Lantai Granit / Homogenous Tile",                 "m²"),
    ("ARS-L05", WorkCategory.ARSITEKTURAL, "Lantai",        "Lantai Beton Trowel Finish",                      "m²"),
    ("ARS-L06", WorkCategory.ARSITEKTURAL, "Lantai",        "Perkerasan Paving Block",                         "m²"),
    ("ARS-A01", WorkCategory.ARSITEKTURAL, "Atap",          "Rangka Atap Baja Ringan",                         "m²"),
    ("ARS-A02", WorkCategory.ARSITEKTURAL, "Atap",          "Rangka Atap Kayu Kelas II",                       "m²"),
    ("ARS-A03", WorkCategory.ARSITEKTURAL, "Atap",          "Penutup Atap Genteng Keramik",                    "m²"),
    ("ARS-A04", WorkCategory.ARSITEKTURAL, "Atap",          "Penutup Atap Metal Sheet Zincalume",              "m²"),
    ("ARS-A05", WorkCategory.ARSITEKTURAL, "Atap",          "Penutup Atap Spandek",                            "m²"),
    ("ARS-P01", WorkCategory.ARSITEKTURAL, "Plafond",       "Plafond Gypsum Board 9 mm",                       "m²"),
    ("ARS-P02", WorkCategory.ARSITEKTURAL, "Plafond",       "Plafond GRC Board 6 mm",                          "m²"),
    ("ARS-K01", WorkCategory.ARSITEKTURAL, "Bukaan",        "Kusen Aluminium Pintu",                           "unit"),
    ("ARS-K02", WorkCategory.ARSITEKTURAL, "Bukaan",        "Kusen Aluminium Jendela",                         "unit"),
    ("ARS-K03", WorkCategory.ARSITEKTURAL, "Bukaan",        "Pintu Baja / Panel Solid",                        "unit"),
    ("ARS-K04", WorkCategory.ARSITEKTURAL, "Bukaan",        "Rolling Door Baja",                               "unit"),
    ("ARS-F01", WorkCategory.ARSITEKTURAL, "Finishing",     "Pengecatan Dinding Interior",                     "m²"),
    ("ARS-F02", WorkCategory.ARSITEKTURAL, "Finishing",     "Pengecatan Dinding Eksterior / Weathershield",    "m²"),
    ("ARS-F03", WorkCategory.ARSITEKTURAL, "Finishing",     "Waterproofing / Anti Bocor",                      "m²"),
    # MEP
    ("MEP-E01", WorkCategory.MEP,          "Elektrikal",    "Instalasi Titik Lampu",                           "titik"),
    ("MEP-E02", WorkCategory.MEP,          "Elektrikal",    "Instalasi Stop Kontak",                           "titik"),
    ("MEP-E03", WorkCategory.MEP,          "Elektrikal",    "Panel Listrik / MCB Box",                         "unit"),
    ("MEP-E04", WorkCategory.MEP,          "Elektrikal",    "Penerangan Kawasan / Lampu Jalan",                "titik"),
    ("MEP-E05", WorkCategory.MEP,          "Elektrikal",    "Instalasi Genset",                                "ls"),
    ("MEP-P01", WorkCategory.MEP,          "Plumbing",      "Instalasi Pipa Air Bersih PVC",                   "ls"),
    ("MEP-P02", WorkCategory.MEP,          "Plumbing",      "Instalasi Pipa Air Kotor PVC",                    "ls"),
    ("MEP-P03", WorkCategory.MEP,          "Plumbing",      "Septictank & Resapan",                            "unit"),
    ("MEP-P04", WorkCategory.MEP,          "Plumbing",      "Tangki Air Fibreglass",                           "unit"),
    ("MEP-S01", WorkCategory.MEP,          "Sanitair",      "Kloset Duduk",                                    "unit"),
    ("MEP-S02", WorkCategory.MEP,          "Sanitair",      "Wastafel Stainless",                              "unit"),
    ("MEP-S03", WorkCategory.MEP,          "Sanitair",      "Urinoir",                                         "unit"),
    # SITE WORK
    ("SW-001",  WorkCategory.SITE_WORK,    "Drainase",      "Saluran Drainase Beton U-40",                     "m"),
    ("SW-002",  WorkCategory.SITE_WORK,    "Drainase",      "Saluran Drainase Beton U-60",                     "m"),
    ("SW-003",  WorkCategory.SITE_WORK,    "Jalan",         "Jalan Beton K-250 tebal 15 cm",                   "m²"),
    ("SW-004",  WorkCategory.SITE_WORK,    "Jalan",         "Jalan Aspal Hot Mix",                             "m²"),
    ("SW-005",  WorkCategory.SITE_WORK,    "Jalan",         "Perkerasan Paving Block",                         "m²"),
    ("SW-006",  WorkCategory.SITE_WORK,    "Pagar",         "Pagar BRC Kawat Las",                             "m"),
    ("SW-007",  WorkCategory.SITE_WORK,    "Pagar",         "Pagar Tembok Bata",                               "m"),
    ("SW-008",  WorkCategory.SITE_WORK,    "Pagar",         "Pagar Panel Beton Pracetak",                      "m"),
    ("SW-009",  WorkCategory.SITE_WORK,    "Lansekap",      "Penanaman Rumput & Tanaman",                      "m²"),
    ("SW-010",  WorkCategory.SITE_WORK,    "Lansekap",      "Tiang Bendera",                                   "unit"),
    # KHUSUS PERIKANAN
    ("KHS-001", WorkCategory.KHUSUS,       "Perikanan",     "Tambatan Perahu Kayu Kelas I",                    "m"),
    ("KHS-002", WorkCategory.KHUSUS,       "Perikanan",     "Tambatan Perahu Beton Bertulang",                 "m"),
    ("KHS-003", WorkCategory.KHUSUS,       "Perikanan",     "Tangga Pendaratan Ikan Beton",                    "unit"),
    ("KHS-004", WorkCategory.KHUSUS,       "Perikanan",     "Gudang Beku Portable 5 Ton",                      "unit"),
    ("KHS-005", WorkCategory.KHUSUS,       "Perikanan",     "Gudang Beku Portable 10 Ton",                     "unit"),
    ("KHS-006", WorkCategory.KHUSUS,       "Perikanan",     "Pabrik Es Balok 1 Ton/hari",                      "unit"),
    ("KHS-007", WorkCategory.KHUSUS,       "Perikanan",     "Pabrik Es Balok 2 Ton/hari",                      "unit"),
    ("KHS-008", WorkCategory.KHUSUS,       "Perikanan",     "Cool Box Kapasitas 200 Liter",                    "unit"),
    ("KHS-009", WorkCategory.KHUSUS,       "Perikanan",     "Cold Storage / Chiller Room",                     "unit"),
    ("KHS-010", WorkCategory.KHUSUS,       "Perikanan",     "Revetmen Batu Belah",                             "m³"),
    ("KHS-011", WorkCategory.KHUSUS,       "Perikanan",     "Revetmen Beton Bertulang",                        "m³"),
    ("KHS-012", WorkCategory.KHUSUS,       "Perikanan",     "Turap Kayu Ulin",                                 "m"),
    ("KHS-013", WorkCategory.KHUSUS,       "Perikanan",     "Turap Baja Sheet Pile",                           "m"),
    ("KHS-014", WorkCategory.KHUSUS,       "Perikanan",     "Docking Kapal Kayu",                              "unit"),
    ("KHS-015", WorkCategory.KHUSUS,       "Perikanan",     "Shelter Jaring / Garasi Nelayan",                 "unit"),
    ("KHS-016", WorkCategory.KHUSUS,       "Perikanan",     "IPAL (Instalasi Pengolahan Air Limbah)",          "unit"),
    ("KHS-017", WorkCategory.KHUSUS,       "Perikanan",     "Kios Jualan Ikan",                                "unit"),
    ("KHS-018", WorkCategory.KHUSUS,       "Perikanan",     "Pasar Ikan Modern",                               "unit"),
    ("KHS-019", WorkCategory.KHUSUS,       "Perikanan",     "Balai Pertemuan Nelayan",                         "unit"),
    ("KHS-020", WorkCategory.KHUSUS,       "Perikanan",     "Pos Jaga / Security Post",                        "unit"),
    ("KHS-021", WorkCategory.KHUSUS,       "Perikanan",     "Gapura Kawasan",                                  "unit"),
    ("KHS-022", WorkCategory.KHUSUS,       "Perikanan",     "Sentra Kuliner / Food Court",                     "unit"),
    ("KHS-023", WorkCategory.KHUSUS,       "Perikanan",     "Area Parkir Terstruktur",                         "m²"),
    ("KHS-024", WorkCategory.KHUSUS,       "Perikanan",     "TPS (Tempat Pembuangan Sampah)",                  "unit"),
    ("KHS-025", WorkCategory.KHUSUS,       "Perikanan",     "Dinding Penahan Tanah Kawasan",                   "m³"),
]


# ─────────────────────────────────────────────────────────────────────────────
# Master Facilities (29 tipe)
# ─────────────────────────────────────────────────────────────────────────────
FACILITIES = [
    ("PERSIAPAN",       "Pekerjaan Persiapan",          "umum",      "ls",    1),
    ("REVETMEN",        "Revetmen",                     "perikanan", "m³",    2),
    ("TAMBATAN_PERAHU", "Tambatan Perahu",               "perikanan", "m",     3),
    ("DPT",             "Dinding Penahan Tanah",         "struktur",  "m³",    4),
    ("PENDARATAN_IKAN", "Tangga Pendaratan Ikan",        "perikanan", "unit",  5),
    ("GUDANG_BEKU",     "Gudang Beku Portable",          "perikanan", "unit",  6),
    ("PABRIK_ES",       "Pabrik Es",                    "perikanan", "unit",  7),
    ("AREA_PARKIR",     "Area Parkir",                  "utilitas",  "m²",    8),
    ("COOL_BOX",        "Cool Box",                     "perikanan", "unit",  9),
    ("KIOS",            "Kios",                         "utilitas",  "unit", 10),
    ("BENGKEL",         "Bengkel",                      "utilitas",  "unit", 11),
    ("KANTOR",          "Kantor Pengelola",             "utilitas",  "unit", 12),
    ("TOILET",          "Toilet Umum",                  "sanitasi",  "unit", 13),
    ("TANGKI",          "Tangki Air",                   "utilitas",  "unit", 14),
    ("PENERANGAN",      "Penerangan Kawasan",           "utilitas",  "ls",   15),
    ("TPS",             "Tempat Pembuangan Sampah",     "sanitasi",  "unit", 16),
    ("GENSET",          "Genset / Rumah Genset",        "utilitas",  "unit", 17),
    ("SALURAN_JALAN",   "Saluran & Jalan Kawasan",      "sitework",  "ls",   18),
    ("GAPURA",          "Gapura",                       "sitework",  "unit", 19),
    ("POS_JAGA",        "Pos Jaga",                     "utilitas",  "unit", 20),
    ("LEVELLING",       "Leveling",                     "sitework",  "m²",   21),
    ("DOCKING",         "Docking Kapal",                "perikanan", "unit", 22),
    ("PAGAR",           "Pagar Kawasan",                "sitework",  "m",    23),
    ("SHELTER_JARING",  "Shelter Jaring",               "perikanan", "unit", 24),
    ("SENTRA_KULINER",  "Sentra Kuliner",               "utilitas",  "unit", 26),
    ("BALAI",           "Balai Pertemuan Nelayan",      "utilitas",  "unit", 27),
    ("PASAR_IKAN",      "Pasar Ikan",                   "perikanan", "unit", 28),
    ("IPAL",            "IPAL",                         "sanitasi",  "unit", 29),
    ("TURAP",           "Turap",                        "perikanan", "m",    30),
]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def _expand(globs, all_codes):
    out = set()
    for g in globs:
        if g == "*":
            return set(all_codes)
        if g.endswith(".*"):
            prefix = g[:-2]
            out.update(c for c in all_codes if c.startswith(prefix + "."))
        else:
            out.add(g)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
def run():
    db = SessionLocal()
    try:
        # Step 0 — Buat semua tabel dari model SQLAlchemy DULU,
        # baru jalankan ALTER TABLE untuk kolom tambahan v2.1+.
        # Urutan ini penting: CREATE TABLE tidak bisa dijalankan
        # setelah ALTER TABLE pada tabel yang belum ada.
        print("▸ Membuat tabel dari model (create_all)...")
        Base.metadata.create_all(bind=engine)
        print("  ✓ Tabel tersedia\n")

        # Step 0b — Migration: tambah kolom v2.1+ yang tidak ada di
        # model awal. IF NOT EXISTS membuat ini idempotent.
        print("▸ Migration kolom tambahan (idempotent)...")
        for sql in MIGRATION_SQL:
            try:
                db.execute(text(sql))
                db.commit()
            except Exception as e:
                db.rollback()
                print(f"  ⚠  {str(e)[:80]}")
        print("  ✓ Selesai\n")

        # Step 1 — Permissions
        print("▸ Permissions...")
        for module, action, desc in PERMISSIONS:
            code = f"{module}.{action}"
            if not db.query(Permission).filter(Permission.code == code).first():
                db.add(Permission(code=code, module=module, action=action, description=desc))
        db.flush()
        all_perm_codes = [p.code for p in db.query(Permission).all()]
        print(f"  ✓ {len(all_perm_codes)} permissions\n")

        # Step 2 — Menus
        print("▸ Menus...")
        parent_map = {}
        for code, label, icon, path, parent_code, order in [m for m in MENUS if m[4] is None]:
            m = db.query(MenuItem).filter(MenuItem.code == code).first()
            if not m:
                m = MenuItem(code=code, label=label, icon=icon, path=path,
                             order_index=order, is_active=True)
                db.add(m)
                db.flush()
            parent_map[code] = m.id
        for code, label, icon, path, parent_code, order in [m for m in MENUS if m[4] is not None]:
            m = db.query(MenuItem).filter(MenuItem.code == code).first()
            if not m:
                m = MenuItem(code=code, label=label, icon=icon, path=path,
                             parent_id=parent_map.get(parent_code),
                             order_index=order, is_active=True)
                db.add(m)
                db.flush()
            parent_map[code] = m.id
        db.flush()
        all_menu_codes = [m.code for m in db.query(MenuItem).all()]
        print(f"  ✓ {len(all_menu_codes)} menus\n")

        # Step 3 — Roles + permissions + menus (selalu refresh biar idempotent)
        print("▸ Roles...")
        role_map = {}
        for code, name, desc, is_sys, perm_globs, menu_codes in ROLES:
            role = db.query(Role).filter(Role.code == code).first()
            if not role:
                role = Role(code=code, name=name, description=desc, is_system=is_sys)
                db.add(role)
                db.flush()
            role_map[code] = role

            expanded = _expand(perm_globs, all_perm_codes)
            db.query(RolePermission).filter(RolePermission.role_id == role.id).delete()
            for pc in expanded:
                perm = db.query(Permission).filter(Permission.code == pc).first()
                if perm:
                    db.add(RolePermission(role_id=role.id, permission_id=perm.id))

            resolved = all_menu_codes if menu_codes == ["*"] else menu_codes
            db.query(RoleMenu).filter(RoleMenu.role_id == role.id).delete()
            for mc in resolved:
                menu = db.query(MenuItem).filter(MenuItem.code == mc).first()
                if menu:
                    db.add(RoleMenu(role_id=role.id, menu_id=menu.id))

        db.flush()
        print(f"  ✓ {len(ROLES)} roles (permissions & menus di-refresh)\n")

        # Step 4 — Admin user
        print("▸ Admin user...")
        if not db.query(User).filter(User.email == "admin@knmp.id").first():
            db.add(User(
                email="admin@knmp.id", username="admin",
                full_name="Super Administrator",
                hashed_password=get_password_hash("Admin@123!"),
                role_id=role_map["superadmin"].id,
                is_active=True, must_change_password=False, auto_provisioned=False,
            ))
            print("  ✓ Dibuat: admin@knmp.id / Admin@123!\n")
        else:
            print("  → Sudah ada\n")

        # Step 5 — Work codes
        print("▸ Master Work Codes...")
        n = 0
        for code, cat, sub, desc, unit in WORK_CODES:
            if not db.query(MasterWorkCode).filter(MasterWorkCode.code == code).first():
                db.add(MasterWorkCode(code=code, category=cat, sub_category=sub,
                                      description=desc, default_unit=unit))
                n += 1
        print(f"  ✓ +{n} kode (total: {len(WORK_CODES)})\n")

        # Step 6 — Master facilities
        print("▸ Master Facilities...")
        n = 0
        for code, name, ftype, unit, order in FACILITIES:
            if not db.query(MasterFacility).filter(MasterFacility.code == code).first():
                db.add(MasterFacility(code=code, name=name, facility_type=ftype,
                                      typical_unit=unit, display_order=order, is_active=True))
                n += 1
        print(f"  ✓ +{n} fasilitas (total: {len(FACILITIES)})\n")

        db.commit()
        print("=" * 55)
        print("✓ seed_master selesai — database bersih & siap pakai.")
        print("  Login: admin@knmp.id / Admin@123!")
        print("=" * 55)

    except Exception as e:
        db.rollback()
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run()
