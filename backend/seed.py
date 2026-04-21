"""
Initial seed: creates tables + default roles, permissions, menus, admin user,
master work codes, and default notification rules.

Usage: python seed.py
"""
import sys
from app.core.database import SessionLocal, engine, Base
from app.core.security import get_password_hash
from app.models.models import (
    Role, Permission, RolePermission, MenuItem, RoleMenu, User,
    MasterWorkCode, WorkCategory, NotificationRule, NotificationChannel,
    MasterFacility, Contract,
)


# ═══════════════════════════════════════════ DEFINITIONS ═════════════════════

PERMISSIONS = [
    # module, action, description
    ("user", "read", "Lihat user"),
    ("user", "create", "Tambah user"),
    ("user", "update", "Ubah user"),
    ("user", "delete", "Hapus user"),
    ("role", "read", "Lihat role"),
    ("role", "create", "Tambah role"),
    ("role", "update", "Ubah role"),
    ("role", "delete", "Hapus role"),
    ("master", "read", "Lihat master data"),
    ("master", "create", "Tambah master data"),
    ("master", "update", "Ubah master data"),
    ("master", "delete", "Hapus master data"),
    ("contract", "read", "Lihat kontrak"),
    ("contract", "create", "Tambah kontrak"),
    ("contract", "update", "Ubah kontrak"),
    ("contract", "delete", "Hapus kontrak"),
    ("report", "read", "Lihat laporan"),
    ("report", "create", "Buat laporan"),
    ("report", "update", "Ubah laporan"),
    ("report", "delete", "Hapus laporan"),
    ("payment", "read", "Lihat pembayaran"),
    ("payment", "create", "Tambah termin"),
    ("payment", "update", "Ubah termin"),
    ("payment", "delete", "Hapus termin"),
    ("review", "read", "Lihat review lapangan"),
    ("review", "create", "Buat review"),
    ("review", "update", "Ubah review"),
    ("review", "delete", "Hapus review"),
    ("notification", "read", "Lihat notifikasi"),
    ("notification", "manage", "Kelola aturan notifikasi"),
]

MENU_ITEMS = [
    # code, label, icon, path, parent_code, order
    ("dashboard", "Dashboard", "LayoutDashboard", "/", None, 1),
    ("contracts", "Kontrak", "FileText", "/contracts", None, 2),
    ("reports_daily", "Laporan Harian", "CalendarDays", "/reports/daily", None, 3),
    ("reports_weekly", "Laporan Mingguan", "CalendarRange", "/reports/weekly", None, 4),
    ("scurve", "Kurva S", "TrendingUp", "/scurve", None, 5),
    ("payments", "Termin Pembayaran", "Wallet", "/payments", None, 6),
    ("reviews", "Review Lapangan", "ClipboardCheck", "/reviews", None, 7),
    ("warnings", "Early Warning", "AlertTriangle", "/warnings", None, 8),
    ("master", "Master Data", "Database", None, None, 90),
    ("master_companies", "Perusahaan", "Building2", "/master/companies", "master", 91),
    ("master_ppk", "PPK", "UserCog", "/master/ppk", "master", 92),
    ("master_work_codes", "Kode Pekerjaan", "Tags", "/master/work-codes", "master", 93),
    ("admin", "Administrasi", "Settings", None, None, 100),
    ("admin_users", "User", "Users", "/admin/users", "admin", 101),
    ("admin_roles", "Role & Permission", "ShieldCheck", "/admin/roles", "admin", 102),
    ("admin_notifications", "Notifikasi", "Bell", "/admin/notifications", "admin", 103),
    ("admin_audit", "Audit Log", "History", "/admin/audit", "admin", 104),
]

ROLES = [
    # code, name, description, is_system, permission_codes, menu_codes
    ("superadmin", "Super Administrator",
     "Akses penuh ke seluruh sistem", True,
     ["*"], ["*"]),
    ("admin_pusat", "Admin Pusat",
     "Admin di pusat, mengelola semua kontrak tanpa akses user management", False,
     [
        "master.*", "contract.*", "report.*", "payment.*", "review.*",
        "notification.read",
     ],
     ["dashboard", "contracts", "reports_daily", "reports_weekly", "scurve",
      "payments", "reviews", "warnings", "master", "master_companies",
      "master_ppk", "master_work_codes"]),
    ("ppk", "PPK (Pejabat Pembuat Komitmen)",
     "PPK yang membawahi kontrak tertentu", False,
     [
        "contract.read", "contract.update", "report.read",
        "payment.read", "payment.update", "review.read", "review.update",
     ],
     ["dashboard", "contracts", "reports_daily", "reports_weekly",
      "scurve", "payments", "reviews", "warnings"]),
    ("manager", "Manajer / Koordinator",
     "Manajer di satuan kerja untuk memantau beberapa kontrak", False,
     [
        "contract.read", "report.read", "payment.read", "review.read",
     ],
     ["dashboard", "contracts", "reports_daily", "reports_weekly",
      "scurve", "payments", "reviews", "warnings"]),
    ("konsultan", "Konsultan Pengawas",
     "Konsultan MK yang input laporan harian & mingguan", False,
     [
        "contract.read", "report.read", "report.create", "report.update",
        "review.read",
     ],
     ["dashboard", "contracts", "reports_daily", "reports_weekly",
      "scurve", "warnings"]),
    ("kontraktor", "Kontraktor",
     "Kontraktor pelaksana yang bisa lihat data & update termin", False,
     [
        "contract.read", "report.read", "payment.read",
     ],
     ["dashboard", "contracts", "reports_daily", "reports_weekly",
      "scurve", "payments"]),
    ("itjen", "Inspektorat / Reviewer",
     "Inspektorat jenderal untuk inspeksi lapangan", False,
     [
        "contract.read", "report.read",
        "review.read", "review.create", "review.update",
     ],
     ["dashboard", "contracts", "reports_daily", "reports_weekly",
      "scurve", "reviews", "warnings"]),
    ("viewer", "Viewer (Read-only)",
     "Hanya bisa melihat, tidak bisa mengubah apapun", False,
     [
        "contract.read", "report.read", "payment.read", "review.read",
     ],
     ["dashboard", "contracts", "reports_daily", "reports_weekly",
      "scurve", "payments", "reviews", "warnings"]),
]

MASTER_WORK_CODES = [
    ("PER-MOBILISASI",  WorkCategory.PERSIAPAN,    "Persiapan",   "Mobilisasi & Demobilisasi",       "ls"),
    ("PER-DIREKSI-KIT", WorkCategory.PERSIAPAN,    "Persiapan",   "Direksi Keet & Barak",            "m²"),
    ("PER-PAPAN-NAMA",  WorkCategory.PERSIAPAN,    "Persiapan",   "Papan Nama Proyek",               "unit"),
    ("PER-UITZET",      WorkCategory.PERSIAPAN,    "Persiapan",   "Pengukuran & Uitzet / Bouwplank", "m"),
    ("STR-FDN-BATU",    WorkCategory.STRUKTURAL,   "Pondasi",     "Pondasi Batu Belah",              "m³"),
    ("STR-FDN-TELAPAK", WorkCategory.STRUKTURAL,   "Pondasi",     "Pondasi Telapak Beton",           "m³"),
    ("STR-FDN-TIANG",   WorkCategory.STRUKTURAL,   "Pondasi",     "Tiang Pancang / Minipile",        "m"),
    ("STR-SLOOF",       WorkCategory.STRUKTURAL,   "Struktur",    "Sloof Beton",                     "m³"),
    ("STR-KOLOM",       WorkCategory.STRUKTURAL,   "Struktur",    "Kolom Beton",                     "m³"),
    ("STR-BALOK",       WorkCategory.STRUKTURAL,   "Struktur",    "Balok Beton",                     "m³"),
    ("STR-PELAT",       WorkCategory.STRUKTURAL,   "Struktur",    "Pelat Lantai / Atap Beton",       "m³"),
    ("ARS-PASBATA",     WorkCategory.ARSITEKTURAL, "Dinding",     "Pasangan Batu Bata / Bata Ringan","m²"),
    ("ARS-PLESTERAN",   WorkCategory.ARSITEKTURAL, "Dinding",     "Plesteran",                       "m²"),
    ("ARS-ACIAN",       WorkCategory.ARSITEKTURAL, "Dinding",     "Acian",                           "m²"),
    ("ARS-LANTAI",      WorkCategory.ARSITEKTURAL, "Lantai",      "Pemasangan Keramik / Granit",     "m²"),
    ("ARS-ATAP",        WorkCategory.ARSITEKTURAL, "Atap",        "Penutup Atap (Genteng / Metal)",  "m²"),
    ("ARS-PLAFOND",     WorkCategory.ARSITEKTURAL, "Plafond",     "Plafond Gypsum / GRC",            "m²"),
    ("ARS-CAT",         WorkCategory.ARSITEKTURAL, "Finishing",   "Pengecatan",                      "m²"),
    ("ARS-KUSEN",       WorkCategory.ARSITEKTURAL, "Bukaan",      "Kusen Pintu / Jendela",           "unit"),
    ("MEP-LIS",         WorkCategory.MEP,          "Elektrikal",  "Instalasi Listrik",               "ls"),
    ("MEP-AIR",         WorkCategory.MEP,          "Plumbing",    "Instalasi Air Bersih / Kotor",    "ls"),
    ("MEP-SANITAIR",    WorkCategory.MEP,          "Sanitair",    "Sanitair (WC, wastafel)",         "unit"),
    ("SW-DRAIN",        WorkCategory.SITE_WORK,    "Drainase",    "Drainase / Saluran",              "m"),
    ("SW-JALAN",        WorkCategory.SITE_WORK,    "Jalan",       "Perkerasan Jalan",                "m²"),
    ("SW-PAGAR",        WorkCategory.SITE_WORK,    "Pagar",       "Pagar Kawasan",                   "m"),
    ("KHS-REVETMEN",    WorkCategory.KHUSUS,       "Perikanan",   "Revetmen / Pengaman Pantai",      "m³"),
    ("KHS-TAMBATAN",    WorkCategory.KHUSUS,       "Perikanan",   "Tambatan Perahu",                 "m"),
    ("KHS-TANGGA-PEND", WorkCategory.KHUSUS,       "Perikanan",   "Tangga Pendaratan Ikan",          "unit"),
    ("KHS-GUDANG-BEKU", WorkCategory.KHUSUS,       "Perikanan",   "Gudang Beku Portable",            "unit"),
    ("KHS-PABRIK-ES",   WorkCategory.KHUSUS,       "Perikanan",   "Pabrik Es",                       "unit"),
    ("KHS-COOL-BOX",    WorkCategory.KHUSUS,       "Perikanan",   "Cool Box / Cold Storage",         "unit"),
    ("KHS-TURAP",       WorkCategory.KHUSUS,       "Perikanan",   "Turap",                           "m"),
    ("KHS-DPT",         WorkCategory.KHUSUS,       "Struktur",    "Dinding Penahan Tanah",           "m³"),
    ("KHS-IPAL",        WorkCategory.KHUSUS,       "Sanitasi",    "IPAL (Instalasi Pengolahan Air Limbah)", "unit"),
]


# Master catalog of facility types observed across KNMP BOQ files
# (Ampean, Nisombalia, Tanete, Malang). The `display_order` follows the
# numbering convention used in the original BOQ sheets so the UI can
# show facilities in the same order field engineers are used to.
# Format: (code, name, facility_type, typical_unit, display_order, description)
MASTER_FACILITIES = [
    ("PERSIAPAN",        "Persiapan",                        "umum",       "ls",   1,  "Mobilisasi, direksi keet, papan nama, uitzet"),
    ("REVETMEN",         "Revetmen",                         "perikanan",  "m³",   2,  "Revetmen / pengaman pantai"),
    ("TAMBATAN_PERAHU",  "Tambatan Perahu",                  "perikanan",  "m",    3,  "Tambatan & sandar perahu nelayan"),
    ("DPT",              "Dinding Penahan Tanah (DPT)",      "struktur",   "m³",   4,  "DPT / retaining wall"),
    ("PENDARATAN_IKAN",  "Tangga Pendaratan Ikan",           "perikanan",  "unit", 5,  "Tangga pendaratan ikan"),
    ("GUDANG_BEKU",      "Gudang Beku Portable",             "perikanan",  "unit", 6,  "Gudang beku portable / cold storage"),
    ("PABRIK_ES",        "Pabrik Es",                        "perikanan",  "unit", 7,  "Pabrik es mini"),
    ("AREA_PARKIR",      "Area Parkir",                      "utilitas",   "m²",   8,  "Area parkir kendaraan"),
    ("COOL_BOX",         "Cool Box",                         "perikanan",  "unit", 9,  "Kotak pendingin hasil tangkapan"),
    ("KIOS",             "Kios",                             "utilitas",   "unit", 10, "Kios pedagang"),
    ("BENGKEL",          "Bengkel",                          "utilitas",   "unit", 11, "Bengkel alat tangkap / mesin"),
    ("KANTOR",           "Kantor",                           "utilitas",   "unit", 12, "Kantor pengelola kampung nelayan"),
    ("TOILET",           "Toilet Umum",                      "sanitasi",   "unit", 13, "Toilet umum"),
    ("TANGKI",           "Tangki Air",                       "utilitas",   "unit", 14, "Tangki air bersih"),
    ("PENERANGAN",       "Penerangan Kawasan",               "utilitas",   "ls",   15, "Lampu jalan & penerangan kawasan"),
    ("TPS",              "TPS (Tempat Pembuangan Sampah)",   "sanitasi",   "unit", 16, "Tempat pembuangan sampah sementara"),
    ("GENSET",           "Genset / Rumah Genset",            "utilitas",   "unit", 17, "Generator set & rumah genset"),
    ("SALURAN_JALAN",    "Saluran & Jalan",                  "sitework",   "m",    18, "Drainase, saluran air, jalan kawasan"),
    ("GAPURA",           "Gapura",                           "sitework",   "unit", 19, "Gapura / gerbang kawasan"),
    ("POS_JAGA",         "Pos Jaga",                         "utilitas",   "unit", 20, "Pos jaga keamanan"),
    ("LEVELLING",        "Leveling",                         "sitework",   "m²",   21, "Leveling / urugan tanah"),
    ("DOCKING",          "Docking Kapal",                    "perikanan",  "unit", 22, "Tempat perbaikan kapal"),
    ("PAGAR",            "Pagar Kawasan",                    "sitework",   "m",    23, "Pagar kawasan"),
    ("SHELTER_JARING",   "Shelter Jaring",                   "perikanan",  "unit", 24, "Tempat simpan & perbaikan jaring"),
    ("SENKUL_R",         "Sentra Kuliner",                   "utilitas",   "unit", 26, "Sentra kuliner / R"),
    ("BALAI",            "Balai Pertemuan",                  "utilitas",   "unit", 27, "Balai pertemuan nelayan"),
    ("PASAR_IKAN",       "Pasar Ikan",                       "perikanan",  "unit", 28, "Pasar ikan"),
    ("IPAL",             "IPAL",                             "sanitasi",   "unit", 29, "Instalasi Pengolahan Air Limbah"),
    ("TURAP",            "Turap",                            "perikanan",  "m",    30, "Turap pantai"),
]


NOTIFICATION_RULES = [
    {
        "code": "daily_report_missing",
        "name": "Laporan Harian Belum Masuk",
        "description": "Kontrak aktif yang tidak ada laporan harian kemarin",
        "trigger_type": "daily_report_missing",
        "channel": NotificationChannel.WHATSAPP,
        "threshold_config": {"grace_hours": 12},
        "message_template": (
            "⏰ *Pengingat Laporan Harian*\n\n"
            "Kontrak: *{{contract_number}}*\n"
            "{{contract_name}}\n\n"
            "Tanggal *{{date}}* belum ada laporan harian yang masuk.\n"
            "Mohon segera input melalui aplikasi KNMP Monitor."
        ),
        "target_roles": ["konsultan", "ppk"],
    },
    {
        "code": "weekly_report_missing",
        "name": "Laporan Mingguan Belum Masuk",
        "description": "Kontrak aktif yang belum upload laporan minggu terakhir",
        "trigger_type": "weekly_report_missing",
        "channel": NotificationChannel.WHATSAPP,
        "threshold_config": {"grace_days": 2},
        "message_template": (
            "⏰ *Pengingat Laporan Mingguan*\n\n"
            "Kontrak: *{{contract_number}}*\n"
            "Minggu ke-*{{week_number}}* belum ada laporan.\n\n"
            "Mohon segera input/import laporan mingguan."
        ),
        "target_roles": ["konsultan", "ppk"],
    },
    {
        "code": "deviation_warning",
        "name": "Deviasi Waspada (-5%)",
        "description": "Progres aktual tertinggal dari rencana melebihi -5%",
        "trigger_type": "deviation_warning",
        "channel": NotificationChannel.WHATSAPP,
        "threshold_config": {"deviation_pct": -0.05},
        "message_template": (
            "⚠️ *Peringatan Deviasi*\n\n"
            "Kontrak: *{{contract_number}}*\n"
            "{{warning}}\n\n"
            "Mohon evaluasi dan tindak lanjuti."
        ),
        "target_roles": ["ppk", "manager", "admin_pusat"],
    },
    {
        "code": "deviation_critical",
        "name": "Deviasi Kritis (-10%)",
        "description": "Progres aktual tertinggal kritis melebihi -10%",
        "trigger_type": "deviation_critical",
        "channel": NotificationChannel.WHATSAPP,
        "threshold_config": {"deviation_pct": -0.10},
        "message_template": (
            "🚨 *DEVIASI KRITIS*\n\n"
            "Kontrak: *{{contract_number}}*\n"
            "{{warning}}\n\n"
            "Status: *KRITIS* — perlu rencana percepatan segera."
        ),
        "target_roles": ["ppk", "manager", "admin_pusat"],
    },
    {
        "code": "spi_warning",
        "name": "SPI Waspada (< 0.92)",
        "description": "Schedule Performance Index di bawah 0.92",
        "trigger_type": "spi_warning",
        "channel": NotificationChannel.WHATSAPP,
        "threshold_config": {"spi": 0.92},
        "message_template": (
            "⚠️ *SPI Rendah*\n\n"
            "Kontrak: *{{contract_number}}*\n"
            "{{warning}}"
        ),
        "target_roles": ["ppk", "manager"],
    },
    {
        "code": "spi_critical",
        "name": "SPI Kritis (< 0.85)",
        "description": "SPI di bawah 0.85 — indikasi proyek sangat terlambat",
        "trigger_type": "spi_critical",
        "channel": NotificationChannel.WHATSAPP,
        "threshold_config": {"spi": 0.85},
        "message_template": (
            "🚨 *SPI KRITIS*\n\n"
            "Kontrak: *{{contract_number}}*\n"
            "{{warning}}\n\nIndikasi proyek sangat terlambat."
        ),
        "target_roles": ["ppk", "manager", "admin_pusat"],
    },
]


# ═══════════════════════════════════════════ HELPERS ═════════════════════════

def _expand_permission_globs(permission_codes, all_perm_codes):
    """Expand patterns like 'master.*' or '*'."""
    out = set()
    for p in permission_codes:
        if p == "*":
            return set(all_perm_codes)
        if p.endswith(".*"):
            prefix = p[:-2]
            out.update(c for c in all_perm_codes if c.startswith(prefix + "."))
        else:
            out.add(p)
    return out


# ═══════════════════════════════════════════ MAIN ════════════════════════════

def seed():
    print("▸ Creating tables...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Permissions
        created_perms = 0
        for module, action, desc in PERMISSIONS:
            code = f"{module}.{action}"
            if not db.query(Permission).filter(Permission.code == code).first():
                db.add(Permission(code=code, module=module, action=action, description=desc))
                created_perms += 1
        db.flush()
        all_perm_codes = [p.code for p in db.query(Permission).all()]
        print(f"  ✓ Permissions: +{created_perms} (total {len(all_perm_codes)})")

        # Menus (parents first because children reference them)
        parent_map = {}
        created_menus = 0
        for code, label, icon, path, parent_code, order in [m for m in MENU_ITEMS if m[4] is None]:
            m = db.query(MenuItem).filter(MenuItem.code == code).first()
            if not m:
                m = MenuItem(code=code, label=label, icon=icon, path=path, order_index=order)
                db.add(m)
                db.flush()
                created_menus += 1
            parent_map[code] = m.id
        for code, label, icon, path, parent_code, order in [m for m in MENU_ITEMS if m[4] is not None]:
            m = db.query(MenuItem).filter(MenuItem.code == code).first()
            if not m:
                m = MenuItem(code=code, label=label, icon=icon, path=path,
                             parent_id=parent_map.get(parent_code), order_index=order)
                db.add(m)
                created_menus += 1
        db.flush()
        print(f"  ✓ Menus: +{created_menus}")

        all_menu_codes = [m.code for m in db.query(MenuItem).all()]

        # Roles
        for code, name, desc, is_system, perm_globs, menu_codes in ROLES:
            role = db.query(Role).filter(Role.code == code).first()
            created = False
            if not role:
                role = Role(code=code, name=name, description=desc, is_system=is_system)
                db.add(role)
                db.flush()
                created = True

            # refresh permissions
            expanded_perms = _expand_permission_globs(perm_globs, all_perm_codes)
            db.query(RolePermission).filter(RolePermission.role_id == role.id).delete()
            for pcode in expanded_perms:
                perm = db.query(Permission).filter(Permission.code == pcode).first()
                if perm:
                    db.add(RolePermission(role_id=role.id, permission_id=perm.id))

            # refresh menus
            resolved_menus = all_menu_codes if menu_codes == ["*"] else menu_codes
            db.query(RoleMenu).filter(RoleMenu.role_id == role.id).delete()
            for mcode in resolved_menus:
                menu = db.query(MenuItem).filter(MenuItem.code == mcode).first()
                if menu:
                    db.add(RoleMenu(role_id=role.id, menu_id=menu.id))

            status = "created" if created else "updated"
            print(f"  ✓ Role '{code}' {status} ({len(expanded_perms)} perms, {len(resolved_menus)} menus)")

        db.flush()

        # Admin user
        admin_email = "admin@knmp.id"
        admin = db.query(User).filter(User.email == admin_email).first()
        if not admin:
            superadmin_role = db.query(Role).filter(Role.code == "superadmin").first()
            admin = User(
                email=admin_email,
                username="admin",
                full_name="Super Administrator",
                hashed_password=get_password_hash("Admin@123!"),
                role_id=superadmin_role.id,
                is_active=True,
            )
            db.add(admin)
            print(f"  ✓ Admin user created: {admin_email} / Admin@123!")
        else:
            print(f"  → Admin user exists: {admin_email}")

        # Master work codes
        created_mwc = 0
        for code, category, sub, desc, unit in MASTER_WORK_CODES:
            if not db.query(MasterWorkCode).filter(MasterWorkCode.code == code).first():
                db.add(MasterWorkCode(
                    code=code, category=category, sub_category=sub,
                    description=desc, default_unit=unit,
                ))
                created_mwc += 1
        print(f"  ✓ Master work codes: +{created_mwc}")

        # Notification rules
        created_rules = 0
        for rule in NOTIFICATION_RULES:
            if not db.query(NotificationRule).filter(NotificationRule.code == rule["code"]).first():
                db.add(NotificationRule(**rule))
                created_rules += 1
        print(f"  ✓ Notification rules: +{created_rules}")

        # Master Facilities (new in v2.1) — pick-list for Facility dropdown.
        # Derived from the real BOQ files (Ampean, Nisombalia, Tanete, Malang);
        # you can extend this list via the Master Data UI.
        created_facilities = 0
        for code, name, ftype, unit, order, desc in MASTER_FACILITIES:
            existing = db.query(MasterFacility).filter(MasterFacility.code == code).first()
            if not existing:
                db.add(MasterFacility(
                    code=code,
                    name=name,
                    facility_type=ftype,
                    typical_unit=unit,
                    display_order=order,
                    description=desc,
                    is_active=True,
                ))
                created_facilities += 1
        print(f"  ✓ Master facilities: +{created_facilities}")

        db.flush()

        # ── Data-fix step: CCO-0 bootstrap for existing contracts ─────────
        # Runs only if there are Contracts that don't yet have a BOQRevision.
        # Idempotent: safe to re-run. This makes the CCO versioning work
        # transparently for upgrades from v2.0 -> v2.1.
        from app.services import boq_revision_service
        contracts = db.query(Contract).filter(Contract.deleted_at.is_(None)).all()
        migrated = 0
        for c in contracts:
            # auto_approve=True only when contract is already ACTIVE — those
            # contracts already have production BOQ that should be treated
            # as a signed-off CCO-0.
            status_val = c.status.value if hasattr(c.status, "value") else str(c.status)
            auto_approve = status_val in ("active", "addendum", "completed")
            rev = boq_revision_service.ensure_cco_zero(
                db, c, auto_approve=auto_approve,
            )
            migrated += 1
        print(f"  ✓ BOQ CCO-0 revisions ensured for {migrated} contract(s)")

        db.commit()
        print("\n✓ Seed complete.")
        print("\nLogin: admin@knmp.id / Admin@123!")
    except Exception as e:
        db.rollback()
        print(f"\n✗ Error: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
