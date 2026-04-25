"""
seed_demo.py — Data demo profesional untuk presentasi MARLIN.

Jalankan seed_master.py DULU, lalu baru file ini:
    python seed_master.py
    python seed_demo.py

Isi demo:
  15 kontrak tersebar di 8 provinsi, 65 lokasi total:
    K1  — Makassar, Sulsel         (6 lokasi, ACTIVE  w10/16, warning)
    K2  — Mataram, NTB             (5 lokasi, ACTIVE  w7/20,  normal)
    K3  — Kendari, Sultra          (4 lokasi, ACTIVE  w4/12,  fast)
    K4  — Pare-Pare, Sulsel        (3 lokasi, ACTIVE  w12/16, critical)
    K5  — Banjarmasin, Kalsel      (2 lokasi, DRAFT   siap aktivasi)
    K6  — Surabaya, Jatim          (1 lokasi, DRAFT   baru)
    K7  — Mamuju, Sulbar           (9 lokasi, ACTIVE  w8/20,  normal)
    K8  — Bone, Sulsel             (5 lokasi, ACTIVE  w5/18,  +VO draft/review)
    K9  — Bima, NTB                (4 lokasi, ADDENDUM w9/14, +VO approved pending)
    K10 — Baubau/Buton, Sultra     (3 lokasi, ACTIVE  w6/12,  fast)
    K11 — Takalar, Sulsel          (4 lokasi, ACTIVE  w9/16,  critical +VO rejected)
    K12 — Polewali, Sulbar         (4 lokasi, COMPLETED)
    K13 — Lombok Tengah, NTB       (5 lokasi, ACTIVE  w11/22, +VO bundled)
    K14 — Larantuka, NTT           (5 lokasi, ADDENDUM w13/18, +VO approved/draft)
    K15 — Donggala, Sulteng        (5 lokasi, COMPLETED)

  Setiap lokasi aktif punya:
    - 2–5 fasilitas (revetmen, tambatan, gudang beku, kantor, dll)
    - BOQ per fasilitas dengan leaf items + bobot %
    - BOQ V0 (baseline kontrak) — APPROVED untuk aktif, DRAFT untuk draft
    - Weekly reports (sesuai minggu berjalan)
    - Progress items per BOQ dengan volume_cumulative auto-compute
    - Daily reports 7 hari terakhir (khusus kontrak aktif)
    - MC-0 (Mutual Check awal) untuk kontrak non-DRAFT
    - Payment terms (UM 20%, Termin-1 40%, Termin-2 40%, retensi 5%)
      dengan boq_revision_id anchor saat status SUBMITTED/PAID

  Beberapa kontrak dilengkapi Variation Orders dengan status mix:
    K8 / K14  — VO DRAFT + UNDER_REVIEW (usulan baru)
    K9 / K13  — VO APPROVED / BUNDLED (pipeline addendum)
    K11       — VO REJECTED (ditolak dengan alasan)

  Demo users (password: Demo@123!):
    konsultan.demo@marlin.id
    ppk.demo@marlin.id
    kontraktor.demo@marlin.id
    manager.demo@marlin.id
    kpa.demo@marlin.id          (KPA — tt-tangan addendum > 10%)
    itjen.demo@marlin.id        (Inspektorat — audit read-only)
"""
import sys
import random
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import text
from app.core.database import SessionLocal, engine
from app.core.security import get_password_hash
from app.models.models import (
    Role, User, Company, PPK, Contract, ContractStatus,
    Location, Facility, BOQRevision, BOQItem, RevisionStatus,
    WeeklyReport, WeeklyProgressItem, DailyReport, DeviationStatus,
)

random.seed(2025)


# ─────────────────────────────────────────────────────────────────────────────
# Data Master Lokasi Nyata (nama kampung nelayan asli / fiktif realistis)
# ─────────────────────────────────────────────────────────────────────────────

# Setiap entry: (location_code, name, village, district, city, province, lat, lon)
LOCATIONS_K1 = [  # 6 lokasi — Makassar
    ("K1-LOK01", "Kel. Tallo",          "Tallo",          "Tallo",        "Makassar",  "Sulawesi Selatan",  -5.1108, 119.4175),
    ("K1-LOK02", "Kel. Cambaya",        "Cambaya",        "Ujung Tanah",  "Makassar",  "Sulawesi Selatan",  -5.1023, 119.4021),
    ("K1-LOK03", "Kel. Tamparang Keke", "Tamparang Keke", "Mariso",       "Makassar",  "Sulawesi Selatan",  -5.1334, 119.4087),
    ("K1-LOK04", "Kel. Balang Baru",    "Balang Baru",    "Tamalate",     "Makassar",  "Sulawesi Selatan",  -5.1872, 119.4023),
    ("K1-LOK05", "Kel. Lette",          "Lette",          "Mariso",       "Makassar",  "Sulawesi Selatan",  -5.1412, 119.4102),
    ("K1-LOK06", "Kel. Pattingalloang", "Pattingalloang", "Ujung Tanah",  "Makassar",  "Sulawesi Selatan",  -5.0934, 119.3987),
]
LOCATIONS_K2 = [  # 5 lokasi — NTB
    ("K2-LOK01", "Kel. Bintaro",        "Bintaro",        "Ampenan",      "Mataram",   "Nusa Tenggara Barat", -8.5800, 116.0634),
    ("K2-LOK02", "Kel. Ampenan Tengah", "Ampenan Tengah", "Ampenan",      "Mataram",   "Nusa Tenggara Barat", -8.5878, 116.0598),
    ("K2-LOK03", "Kel. Tanjung Karang", "Tanjung Karang", "Sekarbela",    "Mataram",   "Nusa Tenggara Barat", -8.5712, 116.0521),
    ("K2-LOK04", "Kel. Mapak",          "Mapak",          "Sekarbela",    "Mataram",   "Nusa Tenggara Barat", -8.5645, 116.0478),
    ("K2-LOK05", "Kel. Meninting",      "Meninting",      "Batulayar",    "Lombok Barat","Nusa Tenggara Barat",-8.4932, 116.0312),
]
LOCATIONS_K3 = [  # 4 lokasi — Sultra
    ("K3-LOK01", "Kel. Purirano",       "Purirano",       "Kendari",      "Kendari",   "Sulawesi Tenggara",  -3.9453, 122.5128),
    ("K3-LOK02", "Kel. Kampung Salo",   "Kampung Salo",   "Kendari Barat","Kendari",   "Sulawesi Tenggara",  -3.9612, 122.4923),
    ("K3-LOK03", "Kel. Gunung Jati",    "Gunung Jati",    "Abeli",        "Kendari",   "Sulawesi Tenggara",  -4.0234, 122.5567),
    ("K3-LOK04", "Kel. Anggalomalaka",  "Anggalomalaka",  "Mandonga",     "Kendari",   "Sulawesi Tenggara",  -3.9781, 122.5312),
]
LOCATIONS_K4 = [  # 3 lokasi — Pare-Pare
    ("K4-LOK01", "Kel. Cappa Galung",   "Cappa Galung",   "Bacukiki Barat","Pare-Pare","Sulawesi Selatan",   -4.0123, 119.6234),
    ("K4-LOK02", "Kel. Sumpang Minangae","Sumpang Minangae","Bacukiki",    "Pare-Pare", "Sulawesi Selatan",   -4.0345, 119.6198),
    ("K4-LOK03", "Kel. Lakessi",        "Lakessi",        "Soreang",      "Pare-Pare", "Sulawesi Selatan",   -4.0567, 119.6321),
]
LOCATIONS_K5 = [  # 2 lokasi — Banjarmasin
    ("K5-LOK01", "Kel. Alalak Utara",   "Alalak Utara",   "Banjarmasin Utara","Banjarmasin","Kalimantan Selatan",-3.3054,114.5812),
    ("K5-LOK02", "Kel. Kuin Utara",     "Kuin Utara",     "Banjarmasin Utara","Banjarmasin","Kalimantan Selatan",-3.2987,114.5734),
]
LOCATIONS_K6 = [  # 1 lokasi — Surabaya
    ("K6-LOK01", "Kel. Wonokusumo",     "Wonokusumo",     "Semampir",     "Surabaya",  "Jawa Timur",         -7.2287, 112.7488),
]
# Kontrak ke-7: 9 lokasi untuk genapi 30 total
LOCATIONS_K7 = [  # 9 lokasi — Sulawesi Barat
    ("K7-LOK01", "Kel. Bambu",          "Bambu",          "Mamuju",       "Mamuju",    "Sulawesi Barat",    -2.6743, 118.8912),
    ("K7-LOK02", "Kel. Binanga",        "Binanga",        "Mamuju",       "Mamuju",    "Sulawesi Barat",    -2.6812, 118.9034),
    ("K7-LOK03", "Kel. Karema",         "Karema",         "Mamuju",       "Mamuju",    "Sulawesi Barat",    -2.6934, 118.8867),
    ("K7-LOK04", "Kel. Rangas",         "Rangas",         "Simboro",      "Mamuju",    "Sulawesi Barat",    -2.7012, 118.8723),
    ("K7-LOK05", "Kel. Beru-Beru",      "Beru-Beru",      "Simboro",      "Mamuju",    "Sulawesi Barat",    -2.7134, 118.8645),
    ("K7-LOK06", "Kel. Kalukku",        "Kalukku",        "Kalukku",      "Mamuju",    "Sulawesi Barat",    -2.7891, 118.8412),
    ("K7-LOK07", "Kel. Tadui",          "Tadui",          "Mamuju",       "Mamuju",    "Sulawesi Barat",    -2.6621, 118.9156),
    ("K7-LOK08", "Kel. Rimuku",         "Rimuku",         "Mamuju",       "Mamuju",    "Sulawesi Barat",    -2.6512, 118.9278),
    ("K7-LOK09", "Kel. Mamunyu",        "Mamunyu",        "Mamuju Utara", "Mamuju",    "Sulawesi Barat",    -2.6234, 118.9534),
]
LOCATIONS_K8 = [  # 5 lokasi — Bone, Sulsel
    ("K8-LOK01", "Kel. Bajoe",          "Bajoe",          "Tanete Riattang","Bone",    "Sulawesi Selatan",  -4.5345, 120.3712),
    ("K8-LOK02", "Kel. Watampone",      "Watampone",      "Tanete Riattang","Bone",    "Sulawesi Selatan",  -4.5421, 120.3367),
    ("K8-LOK03", "Kel. Pattiro Bajo",   "Pattiro Bajo",   "Sibulue",      "Bone",      "Sulawesi Selatan",  -4.4789, 120.4123),
    ("K8-LOK04", "Kel. Lappa Riaja",    "Lappa Riaja",    "Kajuara",      "Bone",      "Sulawesi Selatan",  -4.6234, 120.4587),
    ("K8-LOK05", "Kel. Macope",         "Macope",         "Awangpone",    "Bone",      "Sulawesi Selatan",  -4.5912, 120.3945),
]
LOCATIONS_K9 = [  # 4 lokasi — Bima, NTB
    ("K9-LOK01", "Kel. Jatibaru",       "Jatibaru",       "Asakota",      "Bima",      "Nusa Tenggara Barat", -8.4578, 118.7234),
    ("K9-LOK02", "Kel. Melayu",         "Melayu",         "Rasanae Barat","Bima",      "Nusa Tenggara Barat", -8.4612, 118.7312),
    ("K9-LOK03", "Kel. Tanjung",        "Tanjung",        "Rasanae Barat","Bima",      "Nusa Tenggara Barat", -8.4521, 118.7456),
    ("K9-LOK04", "Kel. Dara",           "Dara",           "Rasanae Barat","Bima",      "Nusa Tenggara Barat", -8.4645, 118.7123),
]
LOCATIONS_K10 = [  # 3 lokasi — Buton, Sultra
    ("K10-LOK01","Kel. Baubau",         "Baubau",         "Kokalukuna",   "Baubau",    "Sulawesi Tenggara",  -5.4723, 122.5912),
    ("K10-LOK02","Kel. Wameo",          "Wameo",          "Batupoaro",    "Baubau",    "Sulawesi Tenggara",  -5.4812, 122.6034),
    ("K10-LOK03","Kel. Nganganaumala",  "Nganganaumala",  "Batupoaro",    "Baubau",    "Sulawesi Tenggara",  -5.4945, 122.5878),
]
LOCATIONS_K11 = [  # 4 lokasi — Takalar, Sulsel
    ("K11-LOK01","Kel. Bontokadatto",   "Bontokadatto",   "Polombangkeng Utara","Takalar", "Sulawesi Selatan",-5.4123, 119.4567),
    ("K11-LOK02","Kel. Bulukunyi",      "Bulukunyi",      "Polongbangkeng Selatan","Takalar","Sulawesi Selatan",-5.4312,119.4423),
    ("K11-LOK03","Kel. Pa'lalakkang",   "Pa'lalakkang",   "Galesong",     "Takalar",   "Sulawesi Selatan",  -5.2834, 119.3678),
    ("K11-LOK04","Kel. Sampulungan",    "Sampulungan",    "Galesong Utara","Takalar",  "Sulawesi Selatan",  -5.2712, 119.3512),
]
LOCATIONS_K12 = [  # 4 lokasi — Polewali, Sulbar
    ("K12-LOK01","Kel. Polewali",       "Polewali",       "Polewali",     "Polewali Mandar","Sulawesi Barat",-3.4267,119.3412),
    ("K12-LOK02","Kel. Manding",        "Manding",        "Polewali",     "Polewali Mandar","Sulawesi Barat",-3.4178,119.3567),
    ("K12-LOK03","Kel. Darma",          "Darma",          "Polewali",     "Polewali Mandar","Sulawesi Barat",-3.4312,119.3523),
    ("K12-LOK04","Kel. Sulewatang",     "Sulewatang",     "Polewali",     "Polewali Mandar","Sulawesi Barat",-3.4089,119.3278),
]
LOCATIONS_K13 = [  # 5 lokasi — Lombok Tengah, NTB
    ("K13-LOK01","Kel. Kuta",           "Kuta",           "Pujut",        "Lombok Tengah","Nusa Tenggara Barat",-8.8934,116.2712),
    ("K13-LOK02","Kel. Selong Belanak", "Selong Belanak", "Praya Barat",  "Lombok Tengah","Nusa Tenggara Barat",-8.8723,116.1578),
    ("K13-LOK03","Kel. Tanjung Aan",    "Tanjung Aan",    "Pujut",        "Lombok Tengah","Nusa Tenggara Barat",-8.9012,116.3034),
    ("K13-LOK04","Kel. Gerupuk",        "Gerupuk",        "Pujut",        "Lombok Tengah","Nusa Tenggara Barat",-8.9123,116.3212),
    ("K13-LOK05","Kel. Mawun",          "Mawun",          "Praya Barat",  "Lombok Tengah","Nusa Tenggara Barat",-8.8812,116.1734),
]
LOCATIONS_K14 = [  # 5 lokasi — Larantuka/Flores Timur, NTT
    ("K14-LOK01","Kel. Larantuka",      "Larantuka",      "Larantuka",    "Flores Timur","Nusa Tenggara Timur",-8.3412,122.9878),
    ("K14-LOK02","Kel. Waibalun",       "Waibalun",       "Larantuka",    "Flores Timur","Nusa Tenggara Timur",-8.3523,122.9934),
    ("K14-LOK03","Kel. Lewolere",       "Lewolere",       "Larantuka",    "Flores Timur","Nusa Tenggara Timur",-8.3289,122.9812),
    ("K14-LOK04","Kel. Sarotari",       "Sarotari",       "Larantuka",    "Flores Timur","Nusa Tenggara Timur",-8.3634,123.0012),
    ("K14-LOK05","Kel. Balela",         "Balela",         "Larantuka",    "Flores Timur","Nusa Tenggara Timur",-8.3723,123.0134),
]
LOCATIONS_K15 = [  # 5 lokasi — Donggala, Sulteng
    ("K15-LOK01","Kel. Ganti",          "Ganti",          "Banawa",       "Donggala",  "Sulawesi Tengah",   -0.6812, 119.7423),
    ("K15-LOK02","Kel. Labuan Bajo",    "Labuan Bajo",    "Labuan",       "Donggala",  "Sulawesi Tengah",   -0.6523, 119.7534),
    ("K15-LOK03","Kel. Kabonga Besar",  "Kabonga Besar",  "Banawa",       "Donggala",  "Sulawesi Tengah",   -0.6912, 119.7234),
    ("K15-LOK04","Kel. Tanjung Batu",   "Tanjung Batu",   "Banawa",       "Donggala",  "Sulawesi Tengah",   -0.7012, 119.7112),
    ("K15-LOK05","Kel. Tovale",         "Tovale",         "Sindue",       "Donggala",  "Sulawesi Tengah",   -0.5823, 119.7812),
]
# Total: 6+5+4+3+2+1+9+5+4+3+4+4+5+5+5 = 65 lokasi ✓


# ─────────────────────────────────────────────────────────────────────────────
# Fasilitas template per profil lokasi
# (facility_code, facility_name, facility_type, display_order)
# ─────────────────────────────────────────────────────────────────────────────
FAC_TEMPLATE = {
    "lengkap": [  # 5 fasilitas
        ("F-01", "Tambatan Perahu",      "perikanan",  1),
        ("F-02", "Gudang Beku Portable", "perikanan",  2),
        ("F-03", "Revetmen",             "perikanan",  3),
        ("F-04", "Saluran & Jalan",      "sitework",   4),
        ("F-05", "Kantor & Toilet",      "utilitas",   5),
    ],
    "sedang": [   # 3 fasilitas
        ("F-01", "Tambatan Perahu",      "perikanan",  1),
        ("F-02", "Revetmen",             "perikanan",  2),
        ("F-03", "Kantor & Toilet",      "utilitas",   3),
    ],
    "minimal": [  # 2 fasilitas
        ("F-01", "Tambatan Perahu",      "perikanan",  1),
        ("F-02", "Saluran & Jalan",      "sitework",   2),
    ],
}

# BOQ items per tipe fasilitas
# (desc, unit, volume, unit_price, level, is_leaf)
BOQ_TEMPLATE = {
    # Format: (desc, unit, volume, unit_price, level, is_leaf, master_work_code)
    # master_work_code = None → item custom (tidak ada di master)
    "Tambatan Perahu": [
        ("Pekerjaan Persiapan",             "ls",    1,  45_000_000, 0, False, None),
        ("  Mobilisasi & Demobilisasi",     "ls",    1,  30_000_000, 1, True,  "PER-001"),
        ("  Direksi Keet & Papan Nama",     "ls",    1,  15_000_000, 1, True,  "PER-002"),
        ("Pekerjaan Pondasi & Struktur",    "ls",    1, 380_000_000, 0, False, None),
        ("  Tiang Pancang Beton Pracetak",  "m",    40,   2_200_000, 1, True,  "STR-P04"),
        ("  Balok & Pelat Beton K-300",     "m³",   75,   2_500_000, 1, True,  "STR-B04"),
        ("  Pengecatan Anti Karat",         "m²",  180,      95_000, 1, True,  "ARS-F02"),
        ("  Fender Karet Tipe V 150x150",   "unit", 12,   4_500_000, 1, True,  None),
        ("  Bollard Baja 10 Ton",           "unit",  6,   8_200_000, 1, True,  None),
    ],
    "Gudang Beku Portable": [
        ("Pekerjaan Persiapan & Pondasi",   "ls",    1,  35_000_000, 0, False, None),
        ("  Mobilisasi Unit Gudang Beku",   "ls",    1,  20_000_000, 1, True,  "PER-001"),
        ("  Pondasi Telapak Beton K-250",   "m³",   10,   4_200_000, 1, True,  "STR-P02"),
        ("Unit Gudang Beku Portable 10 Ton","unit",  1, 1_200_000_000, 1, True, "KHS-005"),
        ("Instalasi Listrik 3 Phase",       "ls",    1,  95_000_000, 1, True,  "MEP-E05"),
    ],
    "Revetmen": [
        ("Pekerjaan Tanah",                 "ls",    1,  28_000_000, 0, False, None),
        ("  Galian Tanah",                  "m³",  120,      75_000, 1, True,  "PER-006"),
        ("  Urugan Batu Gunung",            "m³",   80,     115_000, 1, True,  "PER-008"),
        ("Pemasangan Batu Revetmen",        "m³",  380,     880_000, 1, True,  "KHS-010"),
        ("Batu Pelindung Armor Rock",       "m³",   65,   1_250_000, 1, True,  None),
        ("Geotextile Woven 200 gr/m²",      "m²",  420,      45_000, 1, True,  None),
    ],
    "Saluran & Jalan": [
        ("Saluran Drainase Beton U-40",     "m",   180,     450_000, 1, True,  "SW-001"),
        ("Jalan Beton K-250 t.15cm",        "m²",  320,     680_000, 1, True,  "SW-003"),
        ("Perkerasan Paving Block",         "m²",  150,     350_000, 1, True,  "SW-005"),
    ],
    "Kantor & Toilet": [
        ("Bangunan Kantor 6x8m",            "m²",   48,   2_900_000, 1, True,  "ARS-L03"),
        ("Toilet Umum 2 Unit",              "unit",  2,  38_000_000, 1, True,  "MEP-S01"),
        ("Instalasi Air Bersih & Kotor",    "ls",    1,  25_000_000, 1, True,  "MEP-P01"),
        ("Instalasi Listrik",               "ls",    1,  18_000_000, 1, True,  "MEP-E01"),
    ],
}


# ─────────────────────────────────────────────────────────────────────────────
# Kontrak configuration
# ─────────────────────────────────────────────────────────────────────────────
# (nomor, nama, total_weeks, current_week, status, nilai, profil_progress,
#  lokasi_list, fac_profile_list)
#
# profil_progress: "normal" | "warning" | "critical" | "fast"
# fac_profile_list: satu per lokasi, pilih dari "lengkap"/"sedang"/"minimal"

TODAY = date.today()

CONTRACTS = [
    {
        "nomor":   "KKP-DEMO-2025-001",
        "nama":    "Pembangunan KNMP Kota Makassar Paket I",
        "provinsi":"Sulawesi Selatan",
        "nilai":   Decimal("18_500_000_000"),
        "total_weeks": 16, "current_week": 10,
        "status":  ContractStatus.ACTIVE,
        "profil":  "warning",   # sedikit terlambat
        "lokasi":  LOCATIONS_K1,
        "fac_profiles": ["lengkap","lengkap","sedang","sedang","minimal","minimal"],
        "kontraktor": "PT Bangun Bahari Nusantara",
        "konsultan":  "PT Konsultan Kelautan Indonesia",
        "ppk":        "Drs. Ahmad Fauzi, M.Si",
    },
    {
        "nomor":   "KKP-DEMO-2025-002",
        "nama":    "Pembangunan KNMP Kota Mataram NTB",
        "provinsi":"Nusa Tenggara Barat",
        "nilai":   Decimal("12_750_000_000"),
        "total_weeks": 20, "current_week": 7,
        "status":  ContractStatus.ACTIVE,
        "profil":  "normal",
        "lokasi":  LOCATIONS_K2,
        "fac_profiles": ["lengkap","sedang","sedang","minimal","minimal"],
        "kontraktor": "CV Karya Laut Mandiri",
        "konsultan":  "PT Konsultan Kelautan Indonesia",
        "ppk":        "Ir. Dewi Permatasari, M.Sc",
    },
    {
        "nomor":   "KKP-DEMO-2025-003",
        "nama":    "Pembangunan KNMP Kota Kendari Sultra",
        "provinsi":"Sulawesi Tenggara",
        "nilai":   Decimal("9_200_000_000"),
        "total_weeks": 12, "current_week": 4,
        "status":  ContractStatus.ACTIVE,
        "profil":  "fast",      # lebih cepat dari rencana
        "lokasi":  LOCATIONS_K3,
        "fac_profiles": ["lengkap","sedang","sedang","minimal"],
        "kontraktor": "PT Tirta Samudera Konstruksi",
        "konsultan":  "CV Mitra Konsultan Teknik",
        "ppk":        "Drs. Ahmad Fauzi, M.Si",
    },
    {
        "nomor":   "KKP-DEMO-2025-004",
        "nama":    "Pembangunan KNMP Kota Pare-Pare Sulsel",
        "provinsi":"Sulawesi Selatan",
        "nilai":   Decimal("7_600_000_000"),
        "total_weeks": 16, "current_week": 12,
        "status":  ContractStatus.ACTIVE,
        "profil":  "critical",  # sangat terlambat
        "lokasi":  LOCATIONS_K4,
        "fac_profiles": ["lengkap","sedang","minimal"],
        "kontraktor": "PT Bangun Bahari Nusantara",
        "konsultan":  "PT Konsultan Kelautan Indonesia",
        "ppk":        "Ir. Dewi Permatasari, M.Sc",
    },
    {
        "nomor":   "KKP-DEMO-2025-005",
        "nama":    "Pembangunan KNMP Kota Banjarmasin Kalsel",
        "provinsi":"Kalimantan Selatan",
        "nilai":   Decimal("5_400_000_000"),
        "total_weeks": 14, "current_week": 0,
        "status":  ContractStatus.DRAFT,
        "profil":  None,
        "lokasi":  LOCATIONS_K5,
        "fac_profiles": ["sedang","minimal"],
        "kontraktor": "PT Barito Konstruksi Bahari",
        "konsultan":  "CV Mitra Konsultan Teknik",
        "ppk":        "Drs. Ahmad Fauzi, M.Si",
    },
    {
        "nomor":   "KKP-DEMO-2025-006",
        "nama":    "Pembangunan KNMP Kota Surabaya Jatim",
        "provinsi":"Jawa Timur",
        "nilai":   Decimal("4_100_000_000"),
        "total_weeks": 16, "current_week": 0,
        "status":  ContractStatus.DRAFT,
        "profil":  None,
        "lokasi":  LOCATIONS_K6,
        "fac_profiles": ["sedang"],
        "kontraktor": "CV Karya Laut Mandiri",
        "konsultan":  "PT Konsultan Kelautan Indonesia",
        "ppk":        "Ir. Dewi Permatasari, M.Sc",
    },
    {
        "nomor":   "KKP-DEMO-2025-007",
        "nama":    "Pembangunan KNMP Kabupaten Mamuju Sulawesi Barat",
        "provinsi":"Sulawesi Barat",
        "nilai":   Decimal("22_300_000_000"),
        "total_weeks": 24, "current_week": 3,
        "status":  ContractStatus.ACTIVE,
        "profil":  "normal",
        "lokasi":  LOCATIONS_K7,
        "fac_profiles": ["lengkap","lengkap","sedang","sedang","sedang",
                         "minimal","minimal","minimal","minimal"],
        "kontraktor": "PT Tirta Samudera Konstruksi",
        "konsultan":  "PT Konsultan Kelautan Indonesia",
        "ppk":        "Drs. Ahmad Fauzi, M.Si",
    },
    # K8 — Bone, Sulsel — ACTIVE dengan VO (akan di-generate di generator section)
    {
        "nomor":   "KKP-DEMO-2025-008",
        "nama":    "Pembangunan KNMP Kabupaten Bone",
        "provinsi":"Sulawesi Selatan",
        "nilai":   Decimal("11_400_000_000"),
        "total_weeks": 18, "current_week": 5,
        "status":  ContractStatus.ACTIVE,
        "profil":  "normal",
        "lokasi":  LOCATIONS_K8,
        "fac_profiles": ["lengkap","sedang","sedang","minimal","minimal"],
        "kontraktor": "PT Bangun Bahari Nusantara",
        "konsultan":  "CV Mitra Konsultan Teknik",
        "ppk":        "Drs. Ahmad Fauzi, M.Si",
        "generate_vo": ["draft", "under_review"],
    },
    # K9 — Bima, NTB — ADDENDUM_PENDING dengan VO APPROVED menunggu di-bundle
    {
        "nomor":   "KKP-DEMO-2025-009",
        "nama":    "Pembangunan KNMP Kota Bima NTB",
        "provinsi":"Nusa Tenggara Barat",
        "nilai":   Decimal("7_800_000_000"),
        "total_weeks": 14, "current_week": 9,
        "status":  ContractStatus.ADDENDUM,
        "profil":  "warning",
        "lokasi":  LOCATIONS_K9,
        "fac_profiles": ["sedang","sedang","minimal","minimal"],
        "kontraktor": "CV Karya Laut Mandiri",
        "konsultan":  "CV Mitra Konsultan Teknik",
        "ppk":        "Ir. Dewi Permatasari, M.Sc",
        "generate_vo": ["approved"],
    },
    # K10 — Buton/Baubau, Sultra — ACTIVE
    {
        "nomor":   "KKP-DEMO-2025-010",
        "nama":    "Pembangunan KNMP Kota Baubau Buton",
        "provinsi":"Sulawesi Tenggara",
        "nilai":   Decimal("5_600_000_000"),
        "total_weeks": 12, "current_week": 6,
        "status":  ContractStatus.ACTIVE,
        "profil":  "fast",
        "lokasi":  LOCATIONS_K10,
        "fac_profiles": ["sedang","minimal","minimal"],
        "kontraktor": "PT Samudera Biru Konstruksi",
        "konsultan":  "PT Konsultan Kelautan Indonesia",
        "ppk":        "Muh. Ridwan, S.T., M.T.",
    },
    # K11 — Takalar, Sulsel — ACTIVE critical (butuh tindak lanjut)
    {
        "nomor":   "KKP-DEMO-2025-011",
        "nama":    "Pembangunan KNMP Kabupaten Takalar",
        "provinsi":"Sulawesi Selatan",
        "nilai":   Decimal("8_900_000_000"),
        "total_weeks": 16, "current_week": 9,
        "status":  ContractStatus.ACTIVE,
        "profil":  "critical",
        "lokasi":  LOCATIONS_K11,
        "fac_profiles": ["sedang","sedang","minimal","minimal"],
        "kontraktor": "PT Bangun Bahari Nusantara",
        "konsultan":  "CV Mitra Konsultan Teknik",
        "ppk":        "Drs. Ahmad Fauzi, M.Si",
        "generate_vo": ["rejected"],
    },
    # K12 — Polewali, Sulbar — COMPLETED
    {
        "nomor":   "KKP-DEMO-2024-012",
        "nama":    "Pembangunan KNMP Polewali Mandar Tahap I",
        "provinsi":"Sulawesi Barat",
        "nilai":   Decimal("6_200_000_000"),
        "total_weeks": 20, "current_week": 20,
        "status":  ContractStatus.COMPLETED,
        "profil":  "normal",
        "lokasi":  LOCATIONS_K12,
        "fac_profiles": ["sedang","sedang","minimal","minimal"],
        "kontraktor": "PT Tirta Samudera Konstruksi",
        "konsultan":  "PT Konsultan Kelautan Indonesia",
        "ppk":        "Ir. Hartono Wijaya, M.Si",
    },
    # K13 — Lombok Tengah, NTB — ACTIVE dengan VO bundled (pernah ada addendum)
    {
        "nomor":   "KKP-DEMO-2025-013",
        "nama":    "Pembangunan KNMP Lombok Tengah Paket II",
        "provinsi":"Nusa Tenggara Barat",
        "nilai":   Decimal("13_500_000_000"),
        "total_weeks": 22, "current_week": 11,
        "status":  ContractStatus.ACTIVE,
        "profil":  "normal",
        "lokasi":  LOCATIONS_K13,
        "fac_profiles": ["lengkap","sedang","sedang","minimal","minimal"],
        "kontraktor": "CV Karya Laut Mandiri",
        "konsultan":  "CV Mitra Konsultan Teknik",
        "ppk":        "Ir. Dewi Permatasari, M.Sc",
        "generate_vo": ["bundled"],
    },
    # K14 — Flores Timur, NTT — ADDENDUM_PENDING
    {
        "nomor":   "KKP-DEMO-2025-014",
        "nama":    "Pembangunan KNMP Larantuka Flores Timur",
        "provinsi":"Nusa Tenggara Timur",
        "nilai":   Decimal("9_700_000_000"),
        "total_weeks": 18, "current_week": 13,
        "status":  ContractStatus.ADDENDUM,
        "profil":  "warning",
        "lokasi":  LOCATIONS_K14,
        "fac_profiles": ["lengkap","sedang","sedang","minimal","minimal"],
        "kontraktor": "PT Samudera Biru Konstruksi",
        "konsultan":  "PT Konsultan Kelautan Indonesia",
        "ppk":        "Yohanes P. Lewotobi, S.T.",
        "generate_vo": ["approved", "draft"],
    },
    # K15 — Donggala, Sulteng — COMPLETED
    {
        "nomor":   "KKP-DEMO-2024-015",
        "nama":    "Pembangunan KNMP Donggala Sulteng Paket I",
        "provinsi":"Sulawesi Tengah",
        "nilai":   Decimal("10_800_000_000"),
        "total_weeks": 24, "current_week": 24,
        "status":  ContractStatus.COMPLETED,
        "profil":  "normal",
        "lokasi":  LOCATIONS_K15,
        "fac_profiles": ["lengkap","sedang","sedang","minimal","minimal"],
        "kontraktor": "PT Tirta Samudera Konstruksi",
        "konsultan":  "CV Mitra Konsultan Teknik",
        "ppk":        "Hendrik Kambey, S.T., M.T.",
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# Progress curve per profil
# ─────────────────────────────────────────────────────────────────────────────
def planned_pct(week, total_weeks):
    """Linear S-curve: ramp up slow, main body, taper."""
    x = week / total_weeks
    if x <= 0.15:
        return x / 0.15 * 0.10
    elif x <= 0.85:
        return 0.10 + (x - 0.15) / 0.70 * 0.80
    else:
        return 0.90 + (x - 0.85) / 0.15 * 0.10


def actual_pct(week, total_weeks, profil):
    base = planned_pct(week, total_weeks)
    if profil == "normal":
        return min(1.0, base * random.uniform(0.97, 1.01))
    if profil == "fast":
        return min(1.0, base * random.uniform(1.04, 1.10))
    if profil == "warning":
        factor = 0.88 if week <= total_weeks * 0.5 else 0.93
        return min(1.0, base * random.uniform(factor - 0.02, factor + 0.01))
    if profil == "critical":
        factor = 0.72 if week <= total_weeks * 0.5 else 0.78
        return min(1.0, base * random.uniform(factor - 0.02, factor + 0.02))
    return base


def deviation_status(dev):
    if dev >= 0:       return DeviationStatus.FAST
    if dev >= -0.05:   return DeviationStatus.NORMAL
    if dev >= -0.10:   return DeviationStatus.WARNING
    return DeviationStatus.CRITICAL


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
def run():
    db = SessionLocal()
    try:
        # Guard
        if db.query(Contract).filter(
            Contract.contract_number == "KKP-DEMO-2025-001"
        ).first():
            print("Demo data sudah ada. Hapus kontrak KKP-DEMO-* dulu jika ingin seed ulang.")
            return

        # ── Demo users ────────────────────────────────────────────────────────
        print("▸ Demo users...")
        roles = {r.code: r for r in db.query(Role).all()}

        def _user(email, uname, name, role_code):
            if not db.query(User).filter(User.email == email).first():
                db.add(User(
                    email=email, username=uname, full_name=name,
                    hashed_password=get_password_hash("Demo@123!"),
                    role_id=roles[role_code].id,
                    is_active=True, must_change_password=False, auto_provisioned=False,
                ))

        _user("konsultan.demo@marlin.id",  "konsultan.demo",  "Arif Wibowo, ST",           "konsultan")
        _user("ppk.demo@marlin.id",        "ppk.demo",        "Drs. Ahmad Fauzi, M.Si",    "ppk")
        _user("kontraktor.demo@marlin.id", "kontraktor.demo", "Budi Santoso, ST",           "kontraktor")
        _user("manager.demo@marlin.id",    "manager.demo",    "Rachmat Hidayat, SE",        "manager")
        _user("kpa.demo@marlin.id",        "kpa.demo",        "Ir. Sutrisno, M.Eng",       "kpa")
        _user("itjen.demo@marlin.id",      "itjen.demo",      "Endah Kusumawati, S.H.",    "itjen")
        db.flush()
        print("  ✓ 6 demo users (password: Demo@123!) — konsultan/ppk/kontraktor/manager/kpa/itjen\n")

        # Handles user untuk dipakai generator VO/MC-0/Payment
        u_ppk        = db.query(User).filter(User.email == "ppk.demo@marlin.id").first()
        u_konsultan  = db.query(User).filter(User.email == "konsultan.demo@marlin.id").first()
        u_kontraktor = db.query(User).filter(User.email == "kontraktor.demo@marlin.id").first()
        u_kpa        = db.query(User).filter(User.email == "kpa.demo@marlin.id").first()

        # ── Perusahaan & PPK ──────────────────────────────────────────────────
        print("▸ Perusahaan & PPK...")

        def _company(name, ctype, npwp, addr, city, prov, cp, phone, email):
            c = db.query(Company).filter(Company.name == name).first()
            if not c:
                c = Company(name=name, company_type=ctype, npwp=npwp, address=addr,
                            city=city, province=prov, contact_person=cp,
                            phone=phone, email=email, is_active=True)
                db.add(c); db.flush()
            return c

        def _ppk(name, nip, jabatan, satker, phone, wa, email):
            p = db.query(PPK).filter(PPK.name == name).first()
            if not p:
                p = PPK(name=name, nip=nip, jabatan=jabatan, satker=satker,
                        phone=phone, whatsapp_number=wa, email=email, is_active=True)
                db.add(p); db.flush()
            return p

        companies = {
            "PT Bangun Bahari Nusantara": _company(
                "PT Bangun Bahari Nusantara", "contractor",
                "01.234.567.8-901.000",
                "Jl. Pelabuhan Baru No. 12, Makassar",
                "Makassar", "Sulawesi Selatan",
                "Ir. Hendra Kusuma, MT", "0411-887766", "hendra@bbn.co.id"),
            "CV Karya Laut Mandiri": _company(
                "CV Karya Laut Mandiri", "contractor",
                "02.345.678.9-012.000",
                "Jl. Nelayan Raya No. 45, Mataram",
                "Mataram", "Nusa Tenggara Barat",
                "Budi Santoso, ST", "0370-663344", "budi@klm.co.id"),
            "PT Tirta Samudera Konstruksi": _company(
                "PT Tirta Samudera Konstruksi", "contractor",
                "03.456.789.0-123.000",
                "Jl. Samudera No. 8, Kendari",
                "Kendari", "Sulawesi Tenggara",
                "Amir Husain, ST", "0401-334455", "amir@tsk.co.id"),
            "PT Barito Konstruksi Bahari": _company(
                "PT Barito Konstruksi Bahari", "contractor",
                "04.567.890.1-234.000",
                "Jl. Barito No. 21, Banjarmasin",
                "Banjarmasin", "Kalimantan Selatan",
                "Suharto, ST, MT", "0511-556677", "suharto@bkb.co.id"),
            # K10, K14 — kontraktor Sulawesi Tenggara / NTT
            "PT Samudera Biru Konstruksi": _company(
                "PT Samudera Biru Konstruksi", "contractor",
                "07.890.123.4-567.000",
                "Jl. Diponegoro No. 17, Baubau",
                "Baubau", "Sulawesi Tenggara",
                "Rahmat Saleh, ST", "0402-221133", "rahmat@sbk.co.id"),
            "PT Konsultan Kelautan Indonesia": _company(
                "PT Konsultan Kelautan Indonesia", "consultant",
                "05.678.901.2-345.000",
                "Jl. Gatot Subroto Kav. 56, Jakarta Selatan",
                "Jakarta", "DKI Jakarta",
                "Dr. Siti Rahayu, ST, MT", "021-52907788", "siti@kki.co.id"),
            # Dipakai oleh K3, K8, K9, K11, K13, K15
            "CV Mitra Konsultan Teknik": _company(
                "CV Mitra Konsultan Teknik", "consultant",
                "06.789.012.3-456.000",
                "Jl. Pantai Losari No. 3, Makassar",
                "Makassar", "Sulawesi Selatan",
                "Yusuf Darmawan, ST", "0411-224433", "yusuf@mkt.co.id"),
            # Kontraktor tambahan untuk K10, K14
            "PT Samudera Biru Konstruksi": _company(
                "PT Samudera Biru Konstruksi", "contractor",
                "07.890.123.4-567.000",
                "Jl. Pasar Ikan Raya No. 17, Baubau",
                "Baubau", "Sulawesi Tenggara",
                "Ir. Rafi Nasution, MT", "0402-445566", "rafi@sbk.co.id"),
        }

        ppks = {
            "Drs. Ahmad Fauzi, M.Si": _ppk(
                "Drs. Ahmad Fauzi, M.Si", "197508152003121004",
                "PPK Satker BPBL Makassar", "BPBL Makassar — KKP",
                "081234567890", "6281234567890", "ahmad.fauzi@kkp.go.id"),
            "Ir. Dewi Permatasari, M.Sc": _ppk(
                "Ir. Dewi Permatasari, M.Sc", "198003102005012003",
                "PPK Satker SKIPM NTB", "SKIPM Mataram — KKP",
                "081298765432", "6281298765432", "dewi.permata@kkp.go.id"),
            # K10 — PPK Sultra
            "Muh. Ridwan, S.T., M.T.": _ppk(
                "Muh. Ridwan, S.T., M.T.", "198112202006041002",
                "PPK Satker BPSPL Makassar", "BPSPL Makassar — KKP",
                "081355667788", "6281355667788", "m.ridwan@kkp.go.id"),
            # K12 — PPK Sulbar
            "Ir. Hartono Wijaya, M.Si": _ppk(
                "Ir. Hartono Wijaya, M.Si", "197603152002121003",
                "PPK Satker Ditjen PDSPKP", "Ditjen PDSPKP — KKP",
                "081244556677", "6281244556677", "hartono.wijaya@kkp.go.id"),
            # K14 — PPK NTT
            "Yohanes P. Lewotobi, S.T.": _ppk(
                "Yohanes P. Lewotobi, S.T.", "198507122010011005",
                "PPK Satker BPBL Kupang", "BPBL Kupang — KKP",
                "081237889900", "6281237889900", "y.lewotobi@kkp.go.id"),
            # K15 — PPK Sulteng
            "Hendrik Kambey, S.T., M.T.": _ppk(
                "Hendrik Kambey, S.T., M.T.", "197811042005011004",
                "PPK Satker SKIPM Palu", "SKIPM Palu — KKP",
                "081298001122", "6281298001122", "h.kambey@kkp.go.id"),
        }
        print(f"  ✓ {len(companies)} perusahaan, {len(ppks)} PPK\n")

        # ── Kontrak + Lokasi + Fasilitas + BOQ + Laporan ──────────────────────
        total_lokasi = 0
        total_boq    = 0
        total_weekly = 0
        total_daily  = 0

        # Track kontrak yang dibuat, dipakai nanti untuk auto-assign ke demo
        # users (STRICT access policy — konsultan/ppk/kontraktor harus ada
        # di assigned_contract_ids, kalau kosong tidak bisa akses apapun).
        created_contract_ids = []

        for cfg in CONTRACTS:
            print(f"▸ Kontrak {cfg['nomor']}...")
            start_date = TODAY - timedelta(weeks=cfg["current_week"])
            end_date   = start_date + timedelta(weeks=cfg["total_weeks"])
            is_active  = cfg["status"] == ContractStatus.ACTIVE

            contract = Contract(
                contract_number=cfg["nomor"],
                contract_name=cfg["nama"],
                company_id=companies[cfg["kontraktor"]].id,
                ppk_id=ppks[cfg["ppk"]].id,
                konsultan_id=companies[cfg["konsultan"]].id,
                fiscal_year=2025,
                # nilai kontrak POST-PPN: BOQ + 11% PPN. cfg["nilai"] sudah
                # disesuaikan supaya konsisten dengan total BOQ × 1.11.
                original_value=cfg["nilai"],
                current_value=cfg["nilai"],
                ppn_pct=Decimal("11.00"),
                start_date=start_date,
                original_end_date=end_date,
                end_date=end_date,
                duration_days=(end_date - start_date).days,
                status=cfg["status"],
                description=(
                    f"Pembangunan dan peningkatan infrastruktur Kampung Nelayan "
                    f"Merah Putih di wilayah {cfg['provinsi']}. Lingkup pekerjaan "
                    f"meliputi tambatan perahu, gudang beku, revetmen, saluran, "
                    f"jalan kawasan, dan fasilitas penunjang."
                ),
                daily_report_required=True,
                weekly_report_due_day=1,
                activated_at=(
                    datetime.combine(start_date, datetime.min.time())
                    if is_active else None
                ),
            )
            db.add(contract); db.flush()
            created_contract_ids.append(contract.id)
            rev = BOQRevision(
                contract_id=contract.id,
                cco_number=0, revision_code="V0",
                name="BOQ V0 (Kontrak Baseline)",
                status=RevisionStatus.APPROVED if is_active else RevisionStatus.DRAFT,
                is_active=is_active,
                approved_at=(
                    datetime.combine(start_date, datetime.min.time())
                    if is_active else None
                ),
            )
            db.add(rev); db.flush()

            # Lokasi — kumpulkan semua BOQ items di scope KONTRAK agar bobot
            # bisa dihitung lintas-lokasi (jumlah bobot semua leaf = 100% per
            # kontrak). Weekly reports dibuat SEKALI per kontrak, BUKAN per
            # lokasi (karena contract_id+week_number unik, pernah bikin dua
            # kali untuk lokasi ke-2 akan bentrok unique constraint).
            contract_all_items = []  # lintas semua lokasi di kontrak ini
            contract_all_facs  = []

            for loc_idx, loc_data in enumerate(cfg["lokasi"]):
                code, name, vill, dist, city, prov, lat, lon = loc_data
                profile = cfg["fac_profiles"][loc_idx]

                loc = Location(
                    contract_id=contract.id,
                    location_code=code, name=name,
                    village=vill, district=dist,
                    city=city, province=prov,
                    latitude=Decimal(str(lat)),
                    longitude=Decimal(str(lon)),
                    konsultan_id=companies[cfg["konsultan"]].id,
                    is_active=True,
                )
                db.add(loc); db.flush()
                total_lokasi += 1

                # Fasilitas + BOQ per lokasi
                for fac_code, fac_name, fac_type, fac_order in FAC_TEMPLATE[profile]:
                    fac = Facility(
                        location_id=loc.id,
                        facility_code=fac_code, facility_name=fac_name,
                        facility_type=fac_type, display_order=fac_order,
                        is_active=True,
                    )
                    db.add(fac); db.flush()
                    contract_all_facs.append(fac)

                    items_def = BOQ_TEMPLATE.get(fac_name, BOQ_TEMPLATE["Saluran & Jalan"])
                    # Stack-based parent_id resolver — parent = item terakhir
                    # dengan level lebih kecil. Konsisten dengan logika import
                    # Excel di boq.py supaya hirarki terbentuk benar.
                    parent_stack = []  # list of (item, level)
                    for order_i, (desc, unit, vol, up, level, is_leaf, mwc) in enumerate(items_def):
                        # Pop stack hingga top punya level < current
                        while parent_stack and parent_stack[-1][1] >= level:
                            parent_stack.pop()
                        parent_item = parent_stack[-1][0] if parent_stack else None
                        local_code = mwc if mwc else f"{fac_code}.{order_i+1}"
                        full_code = (
                            f"{parent_item.full_code}.{local_code}"
                            if parent_item and parent_item.full_code
                            else local_code
                        )
                        item = BOQItem(
                            boq_revision_id=rev.id,
                            facility_id=fac.id,
                            parent_id=parent_item.id if parent_item else None,
                            master_work_code=mwc,
                            original_code=local_code,
                            full_code=full_code,
                            level=level,
                            display_order=len(contract_all_items) + order_i,
                            description=desc.strip(),
                            unit=unit,
                            volume=Decimal(str(vol)),
                            unit_price=Decimal(str(up)),
                            total_price=Decimal(str(vol * up)),
                            is_leaf=is_leaf, is_active=True,
                        )
                        db.add(item); db.flush()
                        parent_stack.append((item, level))
                        contract_all_items.append(item)

            # ── Auto-derive is_leaf dari parent_id graph ──────────────────────
            # Item yang di-refer sebagai parent oleh item lain → is_leaf=False.
            # Konsisten dengan _recompute_is_leaf() di boq.py.
            parent_ids_set = {it.parent_id for it in contract_all_items if it.parent_id is not None}
            for it in contract_all_items:
                it.is_leaf = it.id not in parent_ids_set

            # ── Hitung bobot leaf items CONTRACT-WIDE ─────────────────────────
            leaf_items  = [it for it in contract_all_items if it.is_leaf]
            leaf_total  = sum(it.volume * it.unit_price for it in leaf_items)
            for it in leaf_items:
                it.weight_pct = (
                    (it.volume * it.unit_price) / leaf_total
                    if leaf_total > 0 else Decimal("0")
                )

            # Update facility totals (sum of leaf items per facility)
            facility_totals = {}
            for it in leaf_items:
                facility_totals[it.facility_id] = (
                    facility_totals.get(it.facility_id, Decimal("0"))
                    + (it.volume * it.unit_price)
                )
            for fac in contract_all_facs:
                fac.total_value = facility_totals.get(fac.id, Decimal("0"))

            rev.total_value = leaf_total
            rev.item_count  = len(contract_all_items)
            total_boq += len(contract_all_items)

            # Sync nilai kontrak ke BOQ + PPN supaya seed konsisten.
            # original_value/current_value selalu POST-PPN (= BOQ × 1.11).
            ppn_factor = Decimal("1") + (contract.ppn_pct or Decimal("0")) / Decimal("100")
            contract_value_with_ppn = (leaf_total * ppn_factor).quantize(Decimal("0.01"))
            contract.original_value = contract_value_with_ppn
            contract.current_value = contract_value_with_ppn

            db.flush()

            # ── Weekly reports: SEKALI per kontrak ────────────────────────────
            if is_active and cfg["current_week"] > 0:
                for week in range(1, cfg["current_week"] + 1):
                    plan      = Decimal(str(round(planned_pct(week, cfg["total_weeks"]), 6)))
                    plan_prev = Decimal(str(round(planned_pct(week - 1, cfg["total_weeks"]), 6)))
                    act       = Decimal(str(round(actual_pct(week, cfg["total_weeks"], cfg["profil"]), 6)))
                    act_prev  = Decimal(str(round(actual_pct(week - 1, cfg["total_weeks"], cfg["profil"]), 6)))
                    dev       = act - plan
                    spi       = (act / plan) if plan > 0 else Decimal("1")

                    period_start = start_date + timedelta(weeks=week - 1)
                    period_end   = period_start + timedelta(days=6)

                    report = WeeklyReport(
                        contract_id=contract.id,
                        week_number=week,
                        period_start=period_start,
                        period_end=period_end,
                        report_date=period_end,
                        planned_weekly_pct=plan - plan_prev,
                        planned_cumulative_pct=plan,
                        actual_weekly_pct=act - act_prev,
                        actual_cumulative_pct=act,
                        deviation_pct=dev,
                        deviation_status=deviation_status(float(dev)),
                        spi=round(spi, 4),
                        manpower_count=random.randint(25, 50),
                        manpower_skilled=random.randint(8, 18),
                        manpower_unskilled=random.randint(15, 32),
                        rain_days=random.randint(0, 3),
                        obstacles=(
                            "Material terlambat tiba dari supplier, pengiriman "
                            "dialihkan melalui jalur darat karena cuaca buruk."
                            if week % 4 == 0 else ""
                        ),
                        solutions=(
                            "Penambahan jam kerja dan koordinasi dengan "
                            "supplier alternatif."
                            if week % 4 == 0 else ""
                        ),
                        is_locked=(week < cfg["current_week"]),
                        submitted_by="Arif Wibowo, ST",
                    )
                    db.add(report); db.flush()
                    total_weekly += 1

                    # Progress items hanya pada minggu terakhir
                    if week == cfg["current_week"]:
                        for item in leaf_items:
                            vol_cum = float(item.volume) * float(act)
                            vol_wk  = float(item.volume) * float(act - act_prev)
                            db.add(WeeklyProgressItem(
                                weekly_report_id=report.id,
                                boq_item_id=item.id,
                                volume_this_week=Decimal(str(round(max(0, vol_wk), 4))),
                                volume_cumulative=Decimal(str(round(max(0, vol_cum), 4))),
                                progress_cumulative_pct=Decimal(str(round(float(act), 6))),
                                weighted_progress_pct=Decimal(str(
                                    round(float(act) * float(item.weight_pct), 8)
                                )),
                            ))

            # Daily reports (7 hari terakhir, hanya kontrak aktif).
            # Sejak revamp laporan harian berbasis fasilitas, setiap laporan
            # dipaku ke Lokasi + Fasilitas spesifik supaya foto dokumentasi
            # bisa muncul di galeri Dashboard Eksekutif per-fasilitas.
            if is_active and cfg["current_week"] > 0:
                weather = ["Cerah", "Berawan", "Mendung", "Gerimis"]
                from app.models.models import Location as _Loc, Facility as _Fac
                demo_locs = db.query(_Loc).filter(_Loc.contract_id == contract.id).all()
                demo_facs_by_loc = {
                    str(l.id): db.query(_Fac).filter(_Fac.location_id == l.id).all()
                    for l in demo_locs
                }
                for day_i in range(6, -1, -1):
                    rep_date = TODAY - timedelta(days=day_i)
                    if rep_date.weekday() == 6:
                        continue
                    chosen_loc = random.choice(demo_locs) if demo_locs else None
                    facs_in_loc = demo_facs_by_loc.get(str(chosen_loc.id), []) if chosen_loc else []
                    chosen_fac = random.choice(facs_in_loc) if facs_in_loc else None
                    db.add(DailyReport(
                        contract_id=contract.id,
                        location_id=chosen_loc.id if chosen_loc else None,
                        facility_id=chosen_fac.id if chosen_fac else None,
                        report_date=rep_date,
                        activities=(
                            f"Pekerjaan pasang batu revetmen lanjutan. "
                            f"Pengecoran balok tambatan perahu segmen {day_i+1}. "
                            f"Pemasangan besi tulangan pelat lantai."
                        ),
                        manpower_count=random.randint(28, 48),
                        manpower_skilled=random.randint(10, 16),
                        manpower_unskilled=random.randint(18, 32),
                        equipment_used="Excavator 1 unit, Concrete mixer 2 unit",
                        materials_received=(
                            "Batu split 15 m³, Besi D16 2 ton"
                            if day_i % 3 == 0 else ""
                        ),
                        weather_morning=random.choice(weather),
                        weather_afternoon=random.choice(weather),
                        rain_hours=Decimal(str(random.choice([0, 0, 0, 1.5, 2.0]))),
                        submitted_by="Arif Wibowo, ST",
                    ))
                total_daily += 6

            db.flush()

            # ── MC-0 Field Observation (semua kontrak non-DRAFT) ────────────
            from app.models.models import (
                FieldObservation, FieldObservationType,
                VariationOrder, VariationOrderItem, VOStatus, VOItemAction,
                PaymentTerm, PaymentTermStatus,
            )
            if cfg["status"] != ContractStatus.DRAFT:
                mc0_date = contract.start_date + timedelta(days=3) if contract.start_date else TODAY
                db.add(FieldObservation(
                    contract_id=contract.id,
                    type=FieldObservationType.MC_0,
                    observation_date=mc0_date,
                    title=f"MC-0 {cfg['nama']}",
                    findings=(
                        "Pengukuran bersama di awal pelaksanaan untuk validasi "
                        f"volume BOQ kontrak vs kondisi lapangan aktual di "
                        f"{len(cfg['lokasi'])} lokasi. Ditemukan selisih minor "
                        "pada elevasi beberapa titik tambatan dan kondisi subsoil "
                        "yang membutuhkan penyesuaian volume pondasi."
                    ),
                    attendees=(
                        f"PPK: {cfg['ppk']}, "
                        f"Konsultan Pengawas: {cfg['konsultan']}, "
                        f"Kontraktor: {cfg['kontraktor']}"
                    ),
                    submitted_by_user_id=u_ppk.id if u_ppk else None,
                ))

            # ── Variation Orders (opsional, sesuai config generate_vo) ─────
            vo_profiles = cfg.get("generate_vo", [])
            vo_seq = 0
            for vo_status_target in vo_profiles:
                vo_seq += 1
                vo_num = f"VO-{vo_seq:03d}"
                # Titles realistis sesuai jenis perubahan
                titles = {
                    "draft": "Penambahan Volume Revetmen akibat Erosi Pantai",
                    "under_review": "Penyesuaian Dimensi Tambatan Perahu",
                    "approved": "Penambahan Bollard dan Fender Tambatan",
                    "rejected": "Usulan Penggantian Material Gudang Beku",
                    "bundled": "CCO Penambahan Revetmen Seg. Barat (sudah bundled)",
                }
                vo = VariationOrder(
                    contract_id=contract.id,
                    vo_number=vo_num,
                    status=VOStatus(vo_status_target),
                    title=titles.get(vo_status_target, f"Variation Order {vo_num}"),
                    technical_justification=(
                        "Berdasarkan hasil MC-0 dan observasi lapangan lanjutan, "
                        "diperlukan penyesuaian volume pekerjaan sesuai kondisi "
                        "aktual lapangan. Perubahan ini didasarkan pada gambar "
                        "as-built hasil pengukuran bersama Konsultan Pengawas "
                        "dan Kontraktor pada tanggal pelaksanaan MC-0."
                    ),
                    quantity_calculation=(
                        "Lihat lampiran perhitungan teknis. Volume delta "
                        "dihitung berdasar selisih antara volume BOQ kontrak "
                        "awal dengan volume hasil pengukuran ulang lapangan."
                    ),
                    cost_impact=Decimal("0"),  # akan dihitung dari items
                    submitted_by_user_id=u_kontraktor.id if u_kontraktor else None,
                    submitted_at=TODAY - timedelta(days=random.randint(3, 30)),
                )
                if vo_status_target in ("under_review", "approved", "bundled"):
                    vo.reviewed_by_user_id = u_konsultan.id if u_konsultan else None
                    vo.reviewed_at = TODAY - timedelta(days=random.randint(2, 10))
                if vo_status_target in ("approved", "bundled"):
                    vo.approved_by_user_id = u_ppk.id if u_ppk else None
                    vo.approved_at = TODAY - timedelta(days=random.randint(1, 5))
                if vo_status_target == "rejected":
                    vo.rejected_by_user_id = u_ppk.id if u_ppk else None
                    vo.rejected_at = TODAY - timedelta(days=random.randint(1, 15))
                    vo.rejection_reason = (
                        "Usulan tidak disetujui: perubahan material di luar "
                        "spesifikasi teknis yang disepakati di kontrak. "
                        "Kontraktor diminta mengikuti spek asli atau mengajukan "
                        "ulang dengan justifikasi teknis yang lebih kuat."
                    )
                db.add(vo)
                db.flush()

                # Generate items perubahan — variasi action sesuai vo_seq
                # supaya demo cover semua jenis: INCREASE, ADD-with-parent,
                # DECREASE, REMOVE_FACILITY.
                fac_sample = random.choice(contract_all_facs) if contract_all_facs else None
                total_impact = Decimal("0")
                if fac_sample:
                    fac_items = [b for b in contract_all_items if b.facility_id == fac_sample.id and b.is_leaf]
                    fac_parents = [b for b in contract_all_items if b.facility_id == fac_sample.id and not b.is_leaf]

                    # Variasi action berdasarkan vo_seq + status target
                    if vo_status_target == "draft" and len(fac_items) >= 1:
                        # DRAFT: kombinasi INCREASE + ADD baru (with parent)
                        boq1 = fac_items[0]
                        d1 = Decimal("25")
                        p1 = Decimal(boq1.unit_price or 0)
                        db.add(VariationOrderItem(
                            variation_order_id=vo.id,
                            action=VOItemAction.INCREASE,
                            boq_item_id=boq1.id,
                            facility_id=fac_sample.id,
                            master_work_code=boq1.master_work_code,
                            description=boq1.description,
                            unit=boq1.unit,
                            volume_delta=d1, unit_price=p1,
                            cost_impact=d1 * p1,
                            notes="Penambahan akibat kondisi lapangan",
                        ))
                        total_impact += d1 * p1
                        # ADD item baru di bawah parent existing kalau ada
                        if fac_parents:
                            parent = fac_parents[0]
                            d2 = Decimal("3")
                            p2 = Decimal("8500000")
                            db.add(VariationOrderItem(
                                variation_order_id=vo.id,
                                action=VOItemAction.ADD,
                                boq_item_id=None,
                                facility_id=fac_sample.id,
                                parent_boq_item_id=parent.id,
                                description="Item tambahan: pengaman tambahan kondisi pasut tinggi",
                                unit="unit",
                                volume_delta=d2, unit_price=p2,
                                cost_impact=d2 * p2,
                                notes="Penambahan baru di bawah parent existing",
                            ))
                            total_impact += d2 * p2

                    elif vo_status_target == "under_review" and len(fac_items) >= 2:
                        # UNDER_REVIEW: DECREASE + INCREASE
                        b1, b2 = fac_items[0], fac_items[1]
                        d1 = -Decimal("10"); p1 = Decimal(b1.unit_price or 0)
                        db.add(VariationOrderItem(
                            variation_order_id=vo.id,
                            action=VOItemAction.DECREASE,
                            boq_item_id=b1.id, facility_id=fac_sample.id,
                            master_work_code=b1.master_work_code,
                            description=b1.description, unit=b1.unit,
                            volume_delta=d1, unit_price=p1,
                            cost_impact=d1 * p1,
                            notes="Pengurangan setelah review desain",
                        ))
                        total_impact += d1 * p1
                        d2 = Decimal("15"); p2 = Decimal(b2.unit_price or 0)
                        db.add(VariationOrderItem(
                            variation_order_id=vo.id,
                            action=VOItemAction.INCREASE,
                            boq_item_id=b2.id, facility_id=fac_sample.id,
                            master_work_code=b2.master_work_code,
                            description=b2.description, unit=b2.unit,
                            volume_delta=d2, unit_price=p2,
                            cost_impact=d2 * p2,
                            notes="Penambahan akibat penyesuaian dimensi",
                        ))
                        total_impact += d2 * p2

                    elif vo_status_target in ("approved", "bundled") and len(contract_all_facs) >= 2:
                        # APPROVED/BUNDLED: REMOVE_FACILITY satu fasilitas kecil
                        # untuk demonstrate enum baru
                        target_fac = min(contract_all_facs, key=lambda f: float(f.total_value or 0))
                        if float(target_fac.total_value or 0) > 0:
                            cost = -Decimal(str(target_fac.total_value))
                            db.add(VariationOrderItem(
                                variation_order_id=vo.id,
                                action=VOItemAction.REMOVE_FACILITY,
                                boq_item_id=None,
                                facility_id=target_fac.id,
                                description=f"Hilangkan fasilitas {target_fac.facility_code} {target_fac.facility_name}",
                                unit="",
                                volume_delta=Decimal("0"), unit_price=Decimal("0"),
                                cost_impact=cost,
                                notes="Re-design: fasilitas tidak diperlukan",
                            ))
                            total_impact += cost
                        # Plus 1 INCREASE supaya nett positif
                        b1 = fac_items[0] if fac_items else None
                        if b1:
                            d1 = Decimal("30"); p1 = Decimal(b1.unit_price or 0)
                            db.add(VariationOrderItem(
                                variation_order_id=vo.id,
                                action=VOItemAction.INCREASE,
                                boq_item_id=b1.id, facility_id=fac_sample.id,
                                master_work_code=b1.master_work_code,
                                description=b1.description, unit=b1.unit,
                                volume_delta=d1, unit_price=p1,
                                cost_impact=d1 * p1,
                                notes="Pekerjaan tambah",
                            ))
                            total_impact += d1 * p1

                    elif fac_items:
                        # Default fallback: 1 INCREASE
                        b1 = fac_items[0]
                        d1 = Decimal("25"); p1 = Decimal(b1.unit_price or 0)
                        db.add(VariationOrderItem(
                            variation_order_id=vo.id,
                            action=VOItemAction.INCREASE,
                            boq_item_id=b1.id, facility_id=fac_sample.id,
                            master_work_code=b1.master_work_code,
                            description=b1.description, unit=b1.unit,
                            volume_delta=d1, unit_price=p1,
                            cost_impact=d1 * p1,
                            notes="Penambahan akibat kondisi lapangan",
                        ))
                        total_impact += d1 * p1

                vo.cost_impact = total_impact
                db.flush()

            # ── Payment Terms (hanya untuk kontrak aktif/completed/addendum) ─
            if cfg["status"] != ContractStatus.DRAFT:
                total_val = Decimal(cfg["nilai"])
                # Skema termin standar Perpres: 20% UM, 40% termin-1, 40% termin-2,
                # dengan retensi 5% per termin
                terms_def = [
                    (1, "Uang Muka 20%",             Decimal("0.00"), Decimal("0.20"), Decimal("0.00")),
                    (2, "Termin I (Progres 50%)",    Decimal("0.50"), Decimal("0.40"), Decimal("0.05")),
                    (3, "Termin II (Progres 100%)",  Decimal("1.00"), Decimal("0.40"), Decimal("0.05")),
                ]
                current_progress = actual_pct(cfg["current_week"], cfg["total_weeks"], cfg["profil"])
                active_rev_for_payment = db.query(BOQRevision).filter(
                    BOQRevision.contract_id == contract.id,
                    BOQRevision.is_active == True,
                ).first()
                for tnum, tname, req_pct, pay_pct, ret_pct in terms_def:
                    amount = total_val * pay_pct
                    status = PaymentTermStatus.PLANNED
                    paid_date = None
                    boq_rev_id = None
                    if current_progress >= float(req_pct):
                        status = PaymentTermStatus.PAID if cfg["status"] == ContractStatus.COMPLETED else (
                            PaymentTermStatus.PAID if tnum <= 2 else PaymentTermStatus.VERIFIED
                        )
                        # Anchor ke revisi aktif
                        if active_rev_for_payment:
                            boq_rev_id = active_rev_for_payment.id
                        if status == PaymentTermStatus.PAID:
                            paid_date = TODAY - timedelta(days=random.randint(7, 60))
                    planned_offset = int(tnum * cfg["total_weeks"] / 4) * 7
                    db.add(PaymentTerm(
                        contract_id=contract.id,
                        term_number=tnum,
                        name=tname,
                        required_progress_pct=req_pct,
                        payment_pct=pay_pct,
                        amount=amount,
                        retention_pct=ret_pct,
                        planned_date=contract.start_date + timedelta(days=planned_offset) if contract.start_date else None,
                        paid_date=paid_date,
                        status=status,
                        boq_revision_id=boq_rev_id,
                        created_by=u_ppk.id if u_ppk else None,
                    ))
            db.flush()

            n_lok = len(cfg["lokasi"])
            print(f"  ✓ {n_lok} lokasi, {len(cfg['lokasi']) * 3:.0f}±  fasilitas"
                  f"{' + ' + str(len(vo_profiles)) + ' VO' if vo_profiles else ''}")

        # ── Auto-assign demo users ke semua kontrak demo ─────────────────────
        # Konsekuensi STRICT contract access: konsultan/ppk/kontraktor yang
        # tidak punya assigned_contract_ids → tidak bisa akses kontrak
        # apapun. Untuk demo, assign semuanya ke semua kontrak supaya tester
        # bisa login dengan 4 demo user dan langsung melihat data.
        print("\n▸ Auto-assign demo users ke kontrak demo...")
        demo_emails = [
            "konsultan.demo@marlin.id",
            "ppk.demo@marlin.id",
            "kontraktor.demo@marlin.id",
            "manager.demo@marlin.id",
            "kpa.demo@marlin.id",
            "itjen.demo@marlin.id",
        ]
        assigned_count = 0
        for email in demo_emails:
            u = db.query(User).filter(User.email == email).first()
            if u:
                # stringify karena kolom JSON string array
                u.assigned_contract_ids = [str(cid) for cid in created_contract_ids]
                assigned_count += 1
        db.flush()
        print(f"  ✓ {assigned_count} demo user → {len(created_contract_ids)} kontrak\n")

        db.commit()

        print()
        print("═" * 60)
        print("✓ seed_demo selesai")
        print(f"  Total lokasi  : {total_lokasi}")
        print(f"  Total BOQ item: {total_boq}")
        print(f"  Weekly reports: {total_weekly}")
        print(f"  Daily reports : {total_daily}")
        print()
        print("  Demo users:")
        print("    admin@marlin.id            / Admin@123!")
        print("    konsultan.demo@marlin.id   / Demo@123!")
        print("    ppk.demo@marlin.id         / Demo@123!")
        print("    kontraktor.demo@marlin.id  / Demo@123!")
        print("    manager.demo@marlin.id     / Demo@123!")
        print("═" * 60)

    except Exception as e:
        db.rollback()
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run()
