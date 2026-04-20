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
from sqlalchemy import (
    Column, String, Text, Integer, Numeric, Boolean,
    DateTime, Date, ForeignKey, Enum, Index, UniqueConstraint,
    JSON as SQLJson,
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
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime)


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
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime)


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
    konsultan_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"))  # MK / supervisor

    fiscal_year = Column(Integer, nullable=False)
    original_value = Column(Numeric(18, 2), nullable=False)
    current_value = Column(Numeric(18, 2), nullable=False)
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
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    contract = relationship("Contract", back_populates="addenda")


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
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    contract = relationship("Contract", back_populates="locations")
    facilities = relationship("Facility", back_populates="location", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("contract_id", "location_code", name="uq_location_code_per_contract"),
    )


class Facility(Base):
    __tablename__ = "facilities"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id", ondelete="CASCADE"), nullable=False)
    facility_code = Column(String(50), nullable=False)  # e.g. "6.GudangBeku"
    facility_type = Column(String(100))  # "gudang_beku", etc.
    facility_name = Column(String(500), nullable=False)
    display_order = Column(Integer, default=0)
    total_value = Column(Numeric(18, 2), default=0)
    notes = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    location = relationship("Location", back_populates="facilities")
    boq_items = relationship("BOQItem", back_populates="facility", cascade="all, delete-orphan")


class BOQItem(Base):
    __tablename__ = "boq_items"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    facility_id = Column(UUID(as_uuid=True), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False)
    master_work_code = Column(String(50), ForeignKey("master_work_codes.code"), nullable=True)

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

    version = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)
    is_addendum_item = Column(Boolean, default=False)
    is_leaf = Column(Boolean, default=True)  # only leaf items are entered in progress

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    facility = relationship("Facility", back_populates="boq_items")
    parent = relationship("BOQItem", remote_side=[id])
    versions = relationship("BOQItemVersion", back_populates="boq_item", cascade="all, delete-orphan")
    progress_entries = relationship("WeeklyProgressItem", back_populates="boq_item")

    __table_args__ = (
        Index("idx_boq_facility_active", "facility_id", "is_active"),
        Index("idx_boq_parent", "parent_id"),
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
