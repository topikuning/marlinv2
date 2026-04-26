"""
KNMP Monitor v2 — Full data model.

Coverage:
- Auth: users, roles, permissions, role_permissions, user_sessions, menus, role_menus
- Master: companies, ppk, master_work_codes, notification_rules
- Contract: contracts, contract_addenda, locations, facilities, boq_items, boq_item_versions
- Reporting: weekly_reports, weekly_progress_items, weekly_report_photos,
             daily_reports, daily_report_photos
- Financial: payment_terms, payment_term_documents
- Supervision: field_reviews, field_review_findings, field_review_photos
- Alerts: early_warnings, notification_queue, whatsapp_logs
- Audit: audit_logs
"""
import uuid
import enum
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import (
    Column, String, Text, Integer, Numeric, Boolean,
    DateTime, Date, ForeignKey, Enum, Index, UniqueConstraint,
    JSON as SQLJson, text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.core.database import Base


# ═════════════════════════════════════════════════════════════════════════════
# ENUMS
# ═════════════════════════════════════════════════════════════════════════════

class UserRoleCode(str, enum.Enum):
    SUPERADMIN = "superadmin"
    ADMIN_PUSAT = "admin_pusat"
    KPA = "kpa"                 # Kuasa Pengguna Anggaran (tt-tangan Addendum > 10%)
    PPK = "ppk"
    MANAGER = "manager"
    KONSULTAN = "konsultan"
    KONTRAKTOR = "kontraktor"
    ITJEN = "itjen"
    VIEWER = "viewer"


class ContractStatus(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ADDENDUM = "addendum"
    ON_HOLD = "on_hold"
    COMPLETED = "completed"
    TERMINATED = "terminated"


class AddendumType(str, enum.Enum):
    CCO = "cco"
    EXTENSION = "extension"
    VALUE_CHANGE = "value_change"
    COMBINED = "combined"


class DeviationStatus(str, enum.Enum):
    FAST = "fast"
    NORMAL = "normal"
    WARNING = "warning"
    CRITICAL = "critical"


class WorkCategory(str, enum.Enum):
    PERSIAPAN = "persiapan"
    STRUKTURAL = "struktural"
    ARSITEKTURAL = "arsitektural"
    MEP = "mep"
    SITE_WORK = "site_work"
    KHUSUS = "khusus"


class PaymentTermStatus(str, enum.Enum):
    PLANNED = "planned"
    ELIGIBLE = "eligible"        # progress sudah cukup
    SUBMITTED = "submitted"      # tagihan masuk
    VERIFIED = "verified"
    PAID = "paid"
    REJECTED = "rejected"


class ReviewStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    CLOSED = "closed"


class FindingSeverity(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class FindingStatus(str, enum.Enum):
    OPEN = "open"
    RESPONDED = "responded"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    CLOSED = "closed"


class NotificationChannel(str, enum.Enum):
    WHATSAPP = "whatsapp"
    EMAIL = "email"
    IN_APP = "in_app"


class RevisionStatus(str, enum.Enum):
    """BOQ revision lifecycle for CCO versioning.

    - draft: being edited, not yet legally in force
    - approved: signed off and active (exactly one per contract is active)
    - superseded: was active once but a newer approved revision has replaced it
    """
    DRAFT = "draft"
    APPROVED = "approved"
    SUPERSEDED = "superseded"


class BOQChangeType(str, enum.Enum):
    """How a BOQ item in revision N relates to revision N-1."""
    UNCHANGED = "unchanged"       # cloned as-is from previous revision
    MODIFIED = "modified"         # changed volume / unit_price / description
    ADDED = "added"               # brand new item in this CCO (no predecessor)
    REMOVED = "removed"           # tombstone: existed before, dropped in this CCO


# ─── BOQ Lifecycle (state machine selaras Perpres 16/2018 ps. 54) ────────────

class FieldObservationType(str, enum.Enum):
    """
    MC_0 — Mutual Check 0, pengukuran bersama di awal pelaksanaan (unik per
           kontrak, non-legal, hanya identifikasi selisih lapangan vs BOQ)
    MC_INTERIM — MC lanjutan selama proyek berjalan (boleh banyak)
    """
    MC_0 = "mc_0"
    MC_INTERIM = "mc_interim"


class VOStatus(str, enum.Enum):
    """
    Lifecycle Variation Order:
      DRAFT          → diajukan, bisa diedit
      UNDER_REVIEW   → diajukan untuk review, tidak bisa diedit
      APPROVED       → disetujui, menunggu di-bundle ke Addendum
      REJECTED       → ditolak (terminal, append-only)
      BUNDLED        → sudah ter-bundle ke Addendum ditandatangani (legal)
    """
    DRAFT = "draft"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    BUNDLED = "bundled"


class VOItemAction(str, enum.Enum):
    """Jenis perubahan BOQ yang diusulkan dalam satu baris VO item."""
    ADD = "add"                         # tambah item baru
    INCREASE = "increase"               # tambah volume item existing
    DECREASE = "decrease"               # kurangi volume item existing
    MODIFY_SPEC = "modify_spec"         # ubah spesifikasi (deskripsi/satuan)
    REMOVE = "remove"                   # hilangkan item dari BOQ
    REMOVE_FACILITY = "remove_facility" # hilangkan seluruh fasilitas beserta item-nya
    ADD_FACILITY = "add_facility"       # tambah fasilitas baru di lokasi existing


class NotificationStatus(str, enum.Enum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    SKIPPED = "skipped"


# ═════════════════════════════════════════════════════════════════════════════
# RBAC
# ═════════════════════════════════════════════════════════════════════════════

class Role(Base):
    __tablename__ = "roles"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    is_system = Column(Boolean, default=False)  # tidak bisa dihapus
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("User", back_populates="role_obj")
    permissions = relationship("RolePermission", back_populates="role", cascade="all, delete-orphan")
    menus = relationship("RoleMenu", back_populates="role", cascade="all, delete-orphan")


class Permission(Base):
    __tablename__ = "permissions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(100), unique=True, nullable=False, index=True)  # e.g. "contract.create"
    module = Column(String(50), nullable=False, index=True)
    action = Column(String(50), nullable=False)
    description = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow)


class RolePermission(Base):
    __tablename__ = "role_permissions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role_id = Column(UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), nullable=False)
    permission_id = Column(UUID(as_uuid=True), ForeignKey("permissions.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    role = relationship("Role", back_populates="permissions")
    permission = relationship("Permission")
    __table_args__ = (UniqueConstraint("role_id", "permission_id", name="uq_role_permission"),)


class MenuItem(Base):
    __tablename__ = "menu_items"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(50), unique=True, nullable=False)
    label = Column(String(100), nullable=False)
    icon = Column(String(50))
    path = Column(String(255))
    parent_id = Column(UUID(as_uuid=True), ForeignKey("menu_items.id"))
    order_index = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    children = relationship("MenuItem", backref="parent", remote_side=[id])


class RoleMenu(Base):
    __tablename__ = "role_menus"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role_id = Column(UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), nullable=False)
    menu_id = Column(UUID(as_uuid=True), ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False)

    role = relationship("Role", back_populates="menus")
    menu = relationship("MenuItem")
    __table_args__ = (UniqueConstraint("role_id", "menu_id", name="uq_role_menu"),)


class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(100), unique=True, index=True)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role_id = Column(UUID(as_uuid=True), ForeignKey("roles.id"), nullable=False)
    phone = Column(String(30))
    whatsapp_number = Column(String(30))  # for alerts
    avatar_url = Column(String(500))

    # Scope assignment (optional; null = access to all)
    assigned_contract_ids = Column(JSONB, default=list)  # array of contract UUIDs for konsultan/kontraktor

    is_active = Column(Boolean, default=True)

    # Force user to change password on next login.
    # Set to True when admin creates/resets the account or when a user entity
    # (PPK/Company) is auto-provisioned with the default password.
    must_change_password = Column(Boolean, default=False, nullable=False)

    # Marks users that were auto-generated from a PPK / Company creation event,
    # so the UI can label them and the admin can see who was provisioned vs
    # created manually.
    auto_provisioned = Column(Boolean, default=False, nullable=False)

    last_login_at = Column(DateTime)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime)  # soft delete

    role_obj = relationship("Role", back_populates="users")


# ═════════════════════════════════════════════════════════════════════════════
# AUDIT
# ═════════════════════════════════════════════════════════════════════════════

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    action = Column(String(50), nullable=False, index=True)  # create, update, delete, login, etc.
    entity_type = Column(String(50), nullable=False, index=True)
    entity_id = Column(String(100), index=True)
    changes = Column(JSONB)  # before/after snapshot
    ip_address = Column(String(50))
    user_agent = Column(String(500))
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


# ═════════════════════════════════════════════════════════════════════════════
# MASTER DATA
# ═════════════════════════════════════════════════════════════════════════════

class Company(Base):
    __tablename__ = "companies"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, index=True)
    npwp = Column(String(30))
    address = Column(Text)
    city = Column(String(100))
    province = Column(String(100))
    contact_person = Column(String(255))
    phone = Column(String(30))
    email = Column(String(255))

    # Typing: distinguishes kontraktor from konsultan so we can assign
    # the right role automatically when we auto-create a user.
    # Values: "contractor" | "consultant" | "supplier"
    company_type = Column(String(30), default="contractor", nullable=False, index=True)

    # 1:1 link to the auto-generated user account.
    # Nullable because (a) existing rows predate auto-provisioning and
    # (b) not every company needs a login (e.g. suppliers).
    default_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime)

    default_user = relationship("User", foreign_keys=[default_user_id], post_update=True)


class PPK(Base):
    __tablename__ = "ppk"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, index=True)
    nip = Column(String(30))
    jabatan = Column(String(255))
    phone = Column(String(30))
    whatsapp_number = Column(String(30))
    email = Column(String(255))
    satker = Column(String(255))

    # 1:1 link to the auto-generated user account for this PPK.
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, unique=True)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime)

    user = relationship("User", foreign_keys=[user_id], post_update=True)


class MasterFacility(Base):
    """Catalog of standard facility types used across KNMP contracts.

    Facilities inside a Contract -> Location should be picked from this
    catalog (Gudang Beku, Pabrik Es, Cool Box, Tambatan Perahu, etc.)
    instead of being typed as free text by the admin. This makes reporting,
    benchmarking and BOQ-import mapping consistent across sites.
    """
    __tablename__ = "master_facilities"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(40), unique=True, nullable=False, index=True)  # "GUDANG_BEKU"
    name = Column(String(200), nullable=False)                          # "Gudang Beku"
    facility_type = Column(String(60), nullable=False)                  # "perikanan" / "utilitas" / ...
    typical_unit = Column(String(20))                                   # "unit", "m²"
    description = Column(Text)
    display_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MasterWorkCode(Base):
    __tablename__ = "master_work_codes"
    code = Column(String(50), primary_key=True)
    category = Column(Enum(WorkCategory), nullable=False)
    sub_category = Column(String(100))
    description = Column(String(500), nullable=False)
    default_unit = Column(String(30))
    keywords = Column(Text)  # comma-separated for fuzzy matching
    notes = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


# ═════════════════════════════════════════════════════════════════════════════
# CONTRACTS & STRUCTURE
# ═════════════════════════════════════════════════════════════════════════════

class Contract(Base):
    __tablename__ = "contracts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_number = Column(String(255), unique=True, nullable=False, index=True)
    contract_name = Column(String(500), nullable=False)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    ppk_id = Column(UUID(as_uuid=True), ForeignKey("ppk.id"), nullable=False)
    # DEPRECATED as source of truth: konsultan is now assigned per-location
    # via Location.konsultan_id. This column remains as a contract-wide default
    # / fallback for legacy rows and will be phased out of write paths.
    konsultan_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"))

    fiscal_year = Column(Integer, nullable=False)
    original_value = Column(Numeric(18, 2), nullable=False)
    current_value = Column(Numeric(18, 2), nullable=False)
    # PPN (Pajak Pertambahan Nilai) percentage. BOQ items disimpan PRE-PPN.
    # Nilai kontrak (original_value/current_value) adalah POST-PPN (= BOQ × (1 + ppn/100)).
    # Default 11% sesuai UU HPP 2021. Bisa diubah per kontrak (mis. 0% kalau
    # kontrak non-BKP/JKP, atau 12% kalau aturan berubah).
    ppn_pct = Column(Numeric(5, 2), nullable=False, default=Decimal("11.00"))
    start_date = Column(Date, nullable=False)
    original_end_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)  # after addendum
    duration_days = Column(Integer, nullable=False)

    status = Column(Enum(ContractStatus), default=ContractStatus.DRAFT, nullable=False)
    description = Column(Text)
    document_file = Column(String(500))

    # Report schedule config
    weekly_report_due_day = Column(Integer, default=1)  # Monday = 1 (ISO)
    daily_report_required = Column(Boolean, default=True)

    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))

    # Activation tracking. A contract stays DRAFT until explicitly activated
    # (requires: locations, facilities, an APPROVED CCO-0 BOQ revision, and
    # total BOQ value <= contract value). Nullable because DRAFT contracts
    # have never been activated.
    activated_at = Column(DateTime, nullable=True)
    activated_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # Unlock mode — safety valve untuk koreksi kesalahan input manusia.
    # Saat unlocked_at IS NOT NULL, semua guard write (BOQ, fasilitas,
    # field kontrak yang biasanya terkunci di ACTIVE) dilewati. Hanya
    # superadmin yang bisa membuka/menutup. Saat menutup, sistem
    # memvalidasi sum(BOQ item aktif) == current_value — selisih =
    # refuse lock. Lihat POST /contracts/{id}/unlock dan /lock.
    #
    # Mode ini BUKAN pengganti Addendum: Addendum adalah perubahan
    # administratif resmi dengan jejak dokumen; unlock hanya koreksi
    # kesalahan input di level sistem. Audit log tetap mencatat
    # perubahan seperti biasa.
    unlocked_at = Column(DateTime, nullable=True)
    unlock_until = Column(DateTime, nullable=True)
    unlocked_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    unlock_reason = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime)

    company = relationship("Company", foreign_keys=[company_id])
    konsultan = relationship("Company", foreign_keys=[konsultan_id])
    ppk = relationship("PPK", foreign_keys=[ppk_id])
    locations = relationship("Location", back_populates="contract", cascade="all, delete-orphan")
    addenda = relationship("ContractAddendum", back_populates="contract", cascade="all, delete-orphan")
    weekly_reports = relationship("WeeklyReport", back_populates="contract", cascade="all, delete-orphan")
    daily_reports = relationship("DailyReport", back_populates="contract", cascade="all, delete-orphan")
    payment_terms = relationship("PaymentTerm", back_populates="contract", cascade="all, delete-orphan")
    field_reviews = relationship("FieldReview", back_populates="contract", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_contract_status", "status"),
        Index("idx_contract_fiscal", "fiscal_year"),
    )


class ContractAddendum(Base):
    __tablename__ = "contract_addenda"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    number = Column(String(100), nullable=False)
    addendum_type = Column(Enum(AddendumType), nullable=False)
    effective_date = Column(Date, nullable=False)
    extension_days = Column(Integer, default=0)
    old_end_date = Column(Date)
    new_end_date = Column(Date)
    old_contract_value = Column(Numeric(18, 2))
    new_contract_value = Column(Numeric(18, 2))
    description = Column(Text)
    document_file = Column(String(500))
    # Untuk perubahan nilai >10%, butuh persetujuan KPA/PA. Saat signed oleh
    # KPA, kolom ini terisi; audit BPK bisa trace authority chain.
    kpa_approved_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    kpa_approved_at = Column(DateTime, nullable=True)
    kpa_approval_notes = Column(Text)
    # Signed by PPK (primary signer for all addenda)
    signed_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    signed_at = Column(DateTime, nullable=True)
    # Bypass god-mode (Unlock Mode superadmin) audit tag
    god_mode_bypass = Column(Boolean, default=False, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    contract = relationship("Contract", back_populates="addenda")
    variation_orders = relationship("VariationOrder", back_populates="addendum")


# ─── Field Observation (MC-0 & MC-N) — non-legal, identifikasi lapangan ──────

class FieldObservation(Base):
    """
    Berita Acara pengukuran lapangan. Non-legal: tidak mengubah kontrak
    atau BOQ, hanya menghasilkan temuan yang bisa memicu VariationOrder.

    MC-0 unik per kontrak (constraint); MC_INTERIM boleh banyak.
    """
    __tablename__ = "field_observations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    type = Column(Enum(FieldObservationType), nullable=False)
    observation_date = Column(Date, nullable=False)
    title = Column(String(255), nullable=False)
    findings = Column(Text, nullable=False)                 # temuan (wajib)
    attendees = Column(Text)                                # daftar hadir / pihak
    document_file = Column(String(500))                     # BA MC-0 scan
    submitted_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    contract = relationship("Contract")
    variation_orders = relationship("VariationOrder", back_populates="source_observation")

    __table_args__ = (
        # MC-0 unik per kontrak (boleh banyak MC_INTERIM)
        Index("idx_field_obs_contract_type", "contract_id", "type"),
    )


# ─── Variation Order (VO) — usulan perubahan pre-Addendum ────────────────────

class VariationOrder(Base):
    """
    Dokumen usulan perubahan pekerjaan (Justifikasi Teknis formal).
    Non-legal sampai di-bundle ke Addendum yang ditandatangani.

    Lifecycle (VOStatus):
      DRAFT → UNDER_REVIEW → APPROVED → BUNDLED (to Addendum)
                              ↓
                           REJECTED (terminal, audit-preserved)

    Satu Addendum bisa bundle banyak VO (one-to-many).
    """
    __tablename__ = "variation_orders"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    vo_number = Column(String(50), nullable=False)         # VO-001, VO-002 per kontrak
    status = Column(Enum(VOStatus), default=VOStatus.DRAFT, nullable=False)

    title = Column(String(255), nullable=False)
    technical_justification = Column(Text, nullable=False)  # min 50 char, wajib
    quantity_calculation = Column(Text)                     # cara hitung volume
    cost_impact = Column(Numeric(18, 2), default=0)         # delta nilai (bisa -)

    # Sumber temuan (optional; VO bisa juga lahir tanpa MC formal)
    source_observation_id = Column(
        UUID(as_uuid=True),
        ForeignKey("field_observations.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Submission
    submitted_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    submitted_at = Column(DateTime, default=datetime.utcnow)

    # Review (teknis oleh konsultan)
    reviewed_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text)

    # Approval (PPK) — sebelum bundling ke Addendum
    approved_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)

    # Rejection (terminal)
    rejected_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    rejection_reason = Column(Text)                         # min 20 char bila REJECTED

    # Bundling ke Addendum (saat sign_addendum, status → BUNDLED)
    bundled_addendum_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contract_addenda.id", ondelete="SET NULL"),
        nullable=True,
    )

    # God-mode (Unlock Mode) bypass tag
    god_mode_bypass = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    contract = relationship("Contract")
    source_observation = relationship("FieldObservation", back_populates="variation_orders")
    addendum = relationship("ContractAddendum", back_populates="variation_orders")
    items = relationship("VariationOrderItem", back_populates="vo", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("contract_id", "vo_number", name="uq_vo_number_per_contract"),
        Index("idx_vo_contract_status", "contract_id", "status"),
    )


class VariationOrderItem(Base):
    """
    Baris perubahan dalam satu VO. Bisa ADD (item baru), INCREASE/DECREASE
    volume, MODIFY_SPEC (ubah deskripsi/satuan), atau REMOVE (hapus item).

    Reference ke BOQItem.id wajib untuk INCREASE/DECREASE/MODIFY_SPEC/REMOVE.
    Untuk ADD, boq_item_id NULL — saat VO di-bundle ke Addendum dan BOQ
    versi baru dibuat, item baru dibuatkan di revisi baru.
    """
    __tablename__ = "variation_order_items"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    variation_order_id = Column(UUID(as_uuid=True), ForeignKey("variation_orders.id", ondelete="CASCADE"), nullable=False)
    action = Column(Enum(VOItemAction), nullable=False)

    # Ref ke BOQ item existing (kecuali ADD)
    boq_item_id = Column(UUID(as_uuid=True), ForeignKey("boq_items.id"), nullable=True)

    # Untuk ADD: tempatkan di facility tertentu
    facility_id = Column(UUID(as_uuid=True), ForeignKey("facilities.id"), nullable=True)

    # Untuk ADD hierarchical: kalau item baru harus berada di bawah parent
    # tertentu (sub-item dari parent existing), simpan ID parent di sini.
    # Saat addendum dibuat & VO di-apply ke revisi baru, parent_id BOQItem
    # baru di-set = clone dari parent ini.
    parent_boq_item_id = Column(UUID(as_uuid=True), ForeignKey("boq_items.id"), nullable=True)

    # Untuk ADD chain (parent juga item ADD baru di VO yang sama):
    # parent_code = original_code item ADD yang jadi parent (fallback jika parent_boq_item_id null)
    # new_item_code = original_code yang akan di-assign ke BOQItem baru ini
    parent_code = Column(String(100), nullable=True)
    new_item_code = Column(String(100), nullable=True)

    # Untuk ADD_FACILITY:
    # location_id      = lokasi tempat fasilitas baru akan dibuat
    # new_facility_code = facility_code yang akan di-assign ke Facility baru
    # description       = facility_name (re-purposed dari kolom yang sama)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True)
    new_facility_code = Column(String(50), nullable=True)

    # Detail item (snapshot saat VO dibuat)
    master_work_code = Column(String(30))
    description = Column(Text, nullable=False)
    unit = Column(String(30))
    volume_delta = Column(Numeric(18, 4), default=0)       # + untuk tambah, - untuk kurang
    unit_price = Column(Numeric(18, 2), default=0)
    cost_impact = Column(Numeric(18, 2), default=0)        # volume_delta * unit_price

    # MODIFY_SPEC: snapshot deskripsi lama untuk diff audit
    old_description = Column(Text)
    old_unit = Column(String(30))

    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    vo = relationship("VariationOrder", back_populates="items")


class Location(Base):
    __tablename__ = "locations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    location_code = Column(String(50), nullable=False, index=True)
    name = Column(String(500), nullable=False)
    village = Column(String(255))
    district = Column(String(255))
    city = Column(String(255))
    province = Column(String(255))
    latitude = Column(Numeric(10, 7))
    longitude = Column(Numeric(10, 7))

    # One location = one supervising consultant (MK). This supersedes the
    # contract-level konsultan_id, which is kept only for backward compat.
    # Report-visibility queries for the "konsultan" role MUST filter on this,
    # not on contracts.konsultan_id.
    konsultan_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    contract = relationship("Contract", back_populates="locations")
    facilities = relationship("Facility", back_populates="location", cascade="all, delete-orphan")
    konsultan = relationship("Company", foreign_keys=[konsultan_id])

    __table_args__ = (
        UniqueConstraint("contract_id", "location_code", name="uq_location_code_per_contract"),
        Index("idx_location_konsultan", "konsultan_id"),
    )


class Facility(Base):
    __tablename__ = "facilities"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id", ondelete="CASCADE"), nullable=False)

    # NEW: pick from master catalog instead of free text.
    # Nullable to preserve backward compat with existing rows; the API
    # creation path will require it going forward.
    master_facility_id = Column(UUID(as_uuid=True), ForeignKey("master_facilities.id"), nullable=True)

    facility_code = Column(String(50), nullable=False)  # e.g. "6.GudangBeku"
    facility_type = Column(String(100))  # "gudang_beku", etc.
    facility_name = Column(String(500), nullable=False)
    display_order = Column(Integer, default=0)
    total_value = Column(Numeric(18, 2), default=0)
    notes = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    location = relationship("Location", back_populates="facilities")
    master_facility = relationship("MasterFacility")
    boq_items = relationship("BOQItem", back_populates="facility", cascade="all, delete-orphan")


class BOQRevision(Base):
    """Versi BOQ terikat ke kontrak dan (opsional) Addendum.

    Terminologi baru (sesuai lifecycle refactor):
      * V0 = BOQ baseline kontrak (addendum_id NULL)
      * V1, V2, … = versi baru dari Addendum yang menggabungkan VO
      * version_number menggantikan istilah "cco_number" yang lama

    Aturan:
      * V0 LOCKED permanen setelah kontrak aktif (append-only, audit-safe)
      * Hanya satu revision per kontrak yang is_active=True pada satu waktu
      * Addendum yang sign → spawn revision baru status DRAFT → dibuat aktif
        via activate_new_boq event (sekaligus supersede versi lama)
    """
    __tablename__ = "boq_revisions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)

    # NULL untuk V0 (BOQ kontrak baseline); non-null untuk V1+ yang lahir dari
    # Addendum formal.
    addendum_id = Column(UUID(as_uuid=True), ForeignKey("contract_addenda.id", ondelete="SET NULL"), nullable=True)

    # Nomor versi: 0, 1, 2, ...  Kolom DB masih cco_number untuk backward-
    # compat migrasi; semantik-nya version_number (V0/V1/…).
    cco_number = Column(Integer, nullable=False)
    revision_code = Column(String(20), nullable=False)  # "V0", "V1" (dulu "CCO-0")
    name = Column(String(255))
    description = Column(Text)

    status = Column(Enum(RevisionStatus), default=RevisionStatus.DRAFT, nullable=False)
    is_active = Column(Boolean, default=False, nullable=False)

    total_value = Column(Numeric(18, 2), default=0)    # sum of leaf total_prices
    item_count = Column(Integer, default=0)

    approved_at = Column(DateTime, nullable=True)
    approved_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    contract = relationship("Contract", foreign_keys=[contract_id])
    addendum = relationship("ContractAddendum", foreign_keys=[addendum_id])
    items = relationship("BOQItem", back_populates="revision", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("contract_id", "cco_number", name="uq_revision_cco_per_contract"),
        Index("idx_revision_contract_active", "contract_id", "is_active"),
        # DB-level guarantee that at most one revision per contract is active.
        Index(
            "uq_one_active_revision_per_contract",
            "contract_id",
            unique=True,
            postgresql_where=text("is_active = TRUE"),
        ),
    )


class BOQItem(Base):
    __tablename__ = "boq_items"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # NEW: item belongs to a specific BOQ revision (CCO-0, CCO-1, ...).
    # Nullable during migration only; the data-fix step in seed.py assigns
    # every pre-existing row to a synthesized CCO-0 revision before
    # anything else runs.
    boq_revision_id = Column(UUID(as_uuid=True), ForeignKey("boq_revisions.id", ondelete="CASCADE"), nullable=True)

    facility_id = Column(UUID(as_uuid=True), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False)
    master_work_code = Column(String(50), ForeignKey("master_work_codes.code"), nullable=True)

    # Cross-revision traceability. When a revision is cloned, each cloned
    # item points to its predecessor here so the frontend can diff CCO-N
    # against CCO-(N-1) without a separate "diff" computation.
    # NULL means: this item was newly added in this revision (or it is
    # itself in CCO-0 and has no predecessor).
    source_item_id = Column(UUID(as_uuid=True), ForeignKey("boq_items.id", ondelete="SET NULL"), nullable=True)
    change_type = Column(Enum(BOQChangeType), nullable=True)

    # hierarchy
    parent_id = Column(UUID(as_uuid=True), ForeignKey("boq_items.id"))
    original_code = Column(String(50))     # "1", "A", "a", "2.1"
    full_code = Column(String(100))        # dotted path "4.A.1.a"
    level = Column(Integer, default=0)     # 0=facility-root, 1=group (A/B), 2=item (1/2), 3=subitem (a/b)
    display_order = Column(Integer, default=0)

    description = Column(Text, nullable=False)
    unit = Column(String(30))
    volume = Column(Numeric(18, 4), default=0)
    unit_price = Column(Numeric(18, 2), default=0)
    total_price = Column(Numeric(18, 2), default=0)
    weight_pct = Column(Numeric(10, 8), default=0)

    planned_start_week = Column(Integer)
    planned_duration_weeks = Column(Integer)
    planned_end_week = Column(Integer)

    # DEPRECATED but kept for backward compat with older rows and
    # existing service-layer code. New writes should rely on
    # BOQRevision.cco_number / revision_code instead of these flags.
    version = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)
    is_addendum_item = Column(Boolean, default=False)

    is_leaf = Column(Boolean, default=True)  # only leaf items are entered in progress

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    revision = relationship("BOQRevision", back_populates="items", foreign_keys=[boq_revision_id])
    facility = relationship("Facility", back_populates="boq_items")
    parent = relationship("BOQItem", remote_side=[id], foreign_keys=[parent_id])
    source_item = relationship("BOQItem", remote_side=[id], foreign_keys=[source_item_id])
    versions = relationship("BOQItemVersion", back_populates="boq_item", cascade="all, delete-orphan")
    progress_entries = relationship("WeeklyProgressItem", back_populates="boq_item")

    __table_args__ = (
        Index("idx_boq_facility_active", "facility_id", "is_active"),
        Index("idx_boq_parent", "parent_id"),
        Index("idx_boq_revision", "boq_revision_id"),
        Index("idx_boq_source", "source_item_id"),
    )


class BOQItemVersion(Base):
    __tablename__ = "boq_item_versions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    boq_item_id = Column(UUID(as_uuid=True), ForeignKey("boq_items.id", ondelete="CASCADE"), nullable=False)
    addendum_id = Column(UUID(as_uuid=True), ForeignKey("contract_addenda.id"))
    version_number = Column(Integer, nullable=False)
    snapshot = Column(JSONB, nullable=False)  # full before-state
    change_reason = Column(Text)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    boq_item = relationship("BOQItem", back_populates="versions")


# ═════════════════════════════════════════════════════════════════════════════
# REPORTS
# ═════════════════════════════════════════════════════════════════════════════

class WeeklyReport(Base):
    __tablename__ = "weekly_reports"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    week_number = Column(Integer, nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    report_date = Column(Date)

    planned_weekly_pct = Column(Numeric(10, 8), default=0)
    planned_cumulative_pct = Column(Numeric(10, 8), default=0)
    actual_weekly_pct = Column(Numeric(10, 8), default=0)
    actual_cumulative_pct = Column(Numeric(10, 8), default=0)
    deviation_pct = Column(Numeric(10, 8), default=0)
    deviation_status = Column(Enum(DeviationStatus), default=DeviationStatus.NORMAL)

    days_elapsed = Column(Integer, default=0)
    days_remaining = Column(Integer, default=0)
    spi = Column(Numeric(8, 4))

    manpower_count = Column(Integer, default=0)
    manpower_skilled = Column(Integer, default=0)
    manpower_unskilled = Column(Integer, default=0)
    rain_days = Column(Integer, default=0)
    obstacles = Column(Text)
    solutions = Column(Text)
    executive_summary = Column(Text)

    submitted_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    submitted_by = Column(String(255))
    import_source = Column(String(50))
    source_filename = Column(String(500))
    is_locked = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    contract = relationship("Contract", back_populates="weekly_reports")
    progress_items = relationship("WeeklyProgressItem", back_populates="weekly_report", cascade="all, delete-orphan")
    photos = relationship("WeeklyReportPhoto", back_populates="weekly_report", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("contract_id", "week_number", name="uq_weekly_contract_week"),
    )


class WeeklyProgressItem(Base):
    __tablename__ = "weekly_progress_items"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    weekly_report_id = Column(UUID(as_uuid=True), ForeignKey("weekly_reports.id", ondelete="CASCADE"), nullable=False)
    boq_item_id = Column(UUID(as_uuid=True), ForeignKey("boq_items.id"), nullable=False)

    volume_this_week = Column(Numeric(18, 4), default=0)
    volume_cumulative = Column(Numeric(18, 4), default=0)
    progress_this_week_pct = Column(Numeric(10, 8), default=0)
    progress_cumulative_pct = Column(Numeric(10, 8), default=0)
    weighted_progress_pct = Column(Numeric(10, 8), default=0)
    notes = Column(Text)

    weekly_report = relationship("WeeklyReport", back_populates="progress_items")
    boq_item = relationship("BOQItem", back_populates="progress_entries")

    __table_args__ = (
        UniqueConstraint("weekly_report_id", "boq_item_id", name="uq_progress_report_item"),
    )


class WeeklyReportPhoto(Base):
    __tablename__ = "weekly_report_photos"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    weekly_report_id = Column(UUID(as_uuid=True), ForeignKey("weekly_reports.id", ondelete="CASCADE"), nullable=False)
    facility_id = Column(UUID(as_uuid=True), ForeignKey("facilities.id"))
    file_path = Column(String(500), nullable=False)
    thumbnail_path = Column(String(500))
    caption = Column(Text)
    taken_at = Column(DateTime)
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    weekly_report = relationship("WeeklyReport", back_populates="photos")


class DailyReport(Base):
    """Daily log: text & photos only. NO progress percentage."""
    __tablename__ = "daily_reports"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"))
    # Fasilitas target laporan harian. Nullable untuk kompatibilitas data
    # legacy (laporan lama tidak punya field ini), tapi form baru mewajibkan
    # supaya foto dari laporan ini bisa muncul di galeri Dashboard Eksekutif
    # per-fasilitas.
    facility_id = Column(UUID(as_uuid=True), ForeignKey("facilities.id"))
    report_date = Column(Date, nullable=False, index=True)

    activities = Column(Text)           # narrative of the day
    manpower_count = Column(Integer, default=0)
    manpower_skilled = Column(Integer, default=0)
    manpower_unskilled = Column(Integer, default=0)
    equipment_used = Column(Text)
    materials_received = Column(Text)
    weather_morning = Column(String(50))
    weather_afternoon = Column(String(50))
    rain_hours = Column(Numeric(4, 2), default=0)
    obstacles = Column(Text)
    notes = Column(Text)

    submitted_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    submitted_by = Column(String(255))
    is_deleted = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    contract = relationship("Contract", back_populates="daily_reports")
    photos = relationship("DailyReportPhoto", back_populates="daily_report", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_daily_contract_date", "contract_id", "report_date"),
    )


class DailyReportPhoto(Base):
    __tablename__ = "daily_report_photos"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    daily_report_id = Column(UUID(as_uuid=True), ForeignKey("daily_reports.id", ondelete="CASCADE"), nullable=False)
    # Foto terikat ke fasilitas tertentu (inherit dari DailyReport.facility_id
    # saat diunggah) supaya Dashboard Eksekutif bisa menampilkannya di galeri
    # fasilitas yang tepat. Nullable untuk foto legacy.
    facility_id = Column(UUID(as_uuid=True), ForeignKey("facilities.id"))
    file_path = Column(String(500), nullable=False)
    thumbnail_path = Column(String(500))
    caption = Column(Text)
    taken_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

    daily_report = relationship("DailyReport", back_populates="photos")


# ═════════════════════════════════════════════════════════════════════════════
# PAYMENT TERMS
# ═════════════════════════════════════════════════════════════════════════════

class PaymentTerm(Base):
    __tablename__ = "payment_terms"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    term_number = Column(Integer, nullable=False)
    name = Column(String(255), nullable=False)  # "Termin 1 (Uang Muka)" etc.
    required_progress_pct = Column(Numeric(10, 8), default=0)
    payment_pct = Column(Numeric(10, 8), default=0)
    amount = Column(Numeric(18, 2), default=0)
    retention_pct = Column(Numeric(10, 8), default=0)
    planned_date = Column(Date)
    eligible_date = Column(Date)
    submitted_date = Column(Date)
    paid_date = Column(Date)
    status = Column(Enum(PaymentTermStatus), default=PaymentTermStatus.PLANNED)
    invoice_number = Column(String(100))
    notes = Column(Text)
    # Anchor ke BOQ version saat termin di-submit (status SUBMITTED/VERIFIED/
    # PAID). Payment yang sudah paid TETAP terikat ke versi BOQ saat
    # pembayaran; jika BOQ nanti berubah (addendum), termin lama tidak
    # ikut berubah — audit BPK bisa trace kuantitas yang dipakai saat bayar.
    boq_revision_id = Column(UUID(as_uuid=True), ForeignKey("boq_revisions.id"), nullable=True)
    # God-mode audit tag
    god_mode_bypass = Column(Boolean, default=False, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    contract = relationship("Contract", back_populates="payment_terms")
    documents = relationship("PaymentTermDocument", back_populates="term", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("contract_id", "term_number", name="uq_payment_term_num"),
    )


class PaymentTermDocument(Base):
    __tablename__ = "payment_term_documents"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    term_id = Column(UUID(as_uuid=True), ForeignKey("payment_terms.id", ondelete="CASCADE"), nullable=False)
    doc_type = Column(String(50))  # "invoice", "bast", "progress_report", etc.
    file_path = Column(String(500), nullable=False)
    caption = Column(String(500))
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    term = relationship("PaymentTerm", back_populates="documents")


# ═════════════════════════════════════════════════════════════════════════════
# FIELD REVIEW (Itjen / supervisor inspection)
# ═════════════════════════════════════════════════════════════════════════════

class FieldReview(Base):
    __tablename__ = "field_reviews"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"))
    review_number = Column(String(100))
    review_date = Column(Date, nullable=False)
    reviewer_name = Column(String(255), nullable=False)
    reviewer_institution = Column(String(255))
    status = Column(Enum(ReviewStatus), default=ReviewStatus.OPEN)
    summary = Column(Text)
    recommendations = Column(Text)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    contract = relationship("Contract", back_populates="field_reviews")
    findings = relationship("FieldReviewFinding", back_populates="review", cascade="all, delete-orphan")


class FieldReviewFinding(Base):
    __tablename__ = "field_review_findings"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    review_id = Column(UUID(as_uuid=True), ForeignKey("field_reviews.id", ondelete="CASCADE"), nullable=False)
    finding_number = Column(Integer)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=False)
    severity = Column(Enum(FindingSeverity), default=FindingSeverity.MEDIUM)
    status = Column(Enum(FindingStatus), default=FindingStatus.OPEN)
    recommendation = Column(Text)
    response = Column(Text)
    response_date = Column(Date)
    due_date = Column(Date)
    closed_date = Column(Date)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    review = relationship("FieldReview", back_populates="findings")
    photos = relationship("FieldReviewPhoto", back_populates="finding", cascade="all, delete-orphan")


class FieldReviewPhoto(Base):
    __tablename__ = "field_review_photos"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    finding_id = Column(UUID(as_uuid=True), ForeignKey("field_review_findings.id", ondelete="CASCADE"), nullable=False)
    file_path = Column(String(500), nullable=False)
    thumbnail_path = Column(String(500))
    caption = Column(String(500))
    created_at = Column(DateTime, default=datetime.utcnow)

    finding = relationship("FieldReviewFinding", back_populates="photos")


# ═════════════════════════════════════════════════════════════════════════════
# ALERTS & NOTIFICATIONS
# ═════════════════════════════════════════════════════════════════════════════

class EarlyWarning(Base):
    __tablename__ = "early_warnings"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    weekly_report_id = Column(UUID(as_uuid=True), ForeignKey("weekly_reports.id"))
    warning_type = Column(String(50), nullable=False)
    severity = Column(String(20), nullable=False)
    message = Column(Text, nullable=False)
    parameter_name = Column(String(100))
    parameter_value = Column(Numeric(18, 4))
    threshold_value = Column(Numeric(18, 4))
    is_resolved = Column(Boolean, default=False)
    resolved_at = Column(DateTime)
    resolved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class NotificationRule(Base):
    __tablename__ = "notification_rules"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(100), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    trigger_type = Column(String(50), nullable=False)
    # trigger_type options:
    #  "daily_report_missing", "weekly_report_missing",
    #  "deviation_warning", "deviation_critical",
    #  "spi_warning", "spi_critical",
    #  "payment_term_due", "finding_due",
    #  "progress_stuck"
    channel = Column(Enum(NotificationChannel), default=NotificationChannel.WHATSAPP)
    threshold_config = Column(JSONB, default=dict)
    # example: {"deviation_pct": -0.05, "grace_hours": 24}
    message_template = Column(Text, nullable=False)
    # example: "⚠️ {{contract_number}} deviasi {{deviation}}% melebihi -5%"
    target_roles = Column(JSONB, default=list)  # ["ppk", "manager"]
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class NotificationQueue(Base):
    __tablename__ = "notification_queue"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_id = Column(UUID(as_uuid=True), ForeignKey("notification_rules.id"))
    channel = Column(Enum(NotificationChannel), nullable=False)
    recipient_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    recipient_address = Column(String(255), nullable=False)  # phone or email
    subject = Column(String(500))
    message = Column(Text, nullable=False)
    context = Column(JSONB)  # contract_id, etc.
    status = Column(Enum(NotificationStatus), default=NotificationStatus.PENDING, index=True)
    attempts = Column(Integer, default=0)
    error_message = Column(Text)
    scheduled_at = Column(DateTime, default=datetime.utcnow, index=True)
    sent_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)


class WhatsappLog(Base):
    __tablename__ = "whatsapp_logs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    queue_id = Column(UUID(as_uuid=True), ForeignKey("notification_queue.id"))
    phone = Column(String(30), nullable=False)
    message = Column(Text, nullable=False)
    provider = Column(String(50))
    response_status = Column(Integer)
    response_body = Column(Text)
    success = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
