"""Pydantic schemas for API I/O."""
from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional, List, Any, Dict
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
from app.models.models import (
    ContractStatus, AddendumType, DeviationStatus, WorkCategory,
    PaymentTermStatus, ReviewStatus, FindingSeverity, FindingStatus,
    NotificationChannel, NotificationStatus,
)


# ─── Generic ─────────────────────────────────────────────────────────────────

class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Paginated(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[Any]


# ─── Auth ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ─── Users & RBAC ────────────────────────────────────────────────────────────

class PermissionOut(ORMBase):
    id: UUID
    code: str
    module: str
    action: str
    description: Optional[str] = None


class MenuOut(ORMBase):
    id: UUID
    code: str
    label: str
    icon: Optional[str] = None
    path: Optional[str] = None
    parent_id: Optional[UUID] = None
    order_index: int
    is_active: bool


class RoleBase(BaseModel):
    code: str
    name: str
    description: Optional[str] = None


class RoleCreate(RoleBase):
    permission_codes: List[str] = []
    menu_codes: List[str] = []


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permission_codes: Optional[List[str]] = None
    menu_codes: Optional[List[str]] = None
    is_active: Optional[bool] = None


class RoleOut(ORMBase):
    id: UUID
    code: str
    name: str
    description: Optional[str] = None
    is_system: bool
    is_active: bool


class UserCreate(BaseModel):
    email: EmailStr
    username: Optional[str] = None
    full_name: str
    password: str = Field(min_length=8)
    role_code: str
    phone: Optional[str] = None
    whatsapp_number: Optional[str] = None
    assigned_contract_ids: List[UUID] = []


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    username: Optional[str] = None
    role_code: Optional[str] = None
    phone: Optional[str] = None
    whatsapp_number: Optional[str] = None
    assigned_contract_ids: Optional[List[UUID]] = None
    is_active: Optional[bool] = None


class UserOut(ORMBase):
    id: UUID
    email: str
    username: Optional[str] = None
    full_name: str
    phone: Optional[str] = None
    whatsapp_number: Optional[str] = None
    role_id: UUID
    role: Optional[RoleOut] = None
    assigned_contract_ids: List[UUID] = []
    is_active: bool
    last_login_at: Optional[datetime] = None
    created_at: datetime


# ─── Master ──────────────────────────────────────────────────────────────────

class CompanyCreate(BaseModel):
    name: str
    npwp: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class CompanyUpdate(CompanyCreate):
    name: Optional[str] = None
    is_active: Optional[bool] = None


class CompanyOut(ORMBase):
    id: UUID
    name: str
    npwp: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_active: bool
    created_at: datetime


class PPKCreate(BaseModel):
    name: str
    nip: Optional[str] = None
    jabatan: Optional[str] = None
    phone: Optional[str] = None
    whatsapp_number: Optional[str] = None
    email: Optional[str] = None
    satker: Optional[str] = None


class PPKUpdate(PPKCreate):
    name: Optional[str] = None
    is_active: Optional[bool] = None


class PPKOut(ORMBase):
    id: UUID
    name: str
    nip: Optional[str] = None
    jabatan: Optional[str] = None
    phone: Optional[str] = None
    whatsapp_number: Optional[str] = None
    email: Optional[str] = None
    satker: Optional[str] = None
    is_active: bool


class MasterWorkCodeCreate(BaseModel):
    code: str
    category: WorkCategory
    sub_category: Optional[str] = None
    description: str
    default_unit: Optional[str] = None
    keywords: Optional[str] = None
    notes: Optional[str] = None


class MasterWorkCodeOut(ORMBase):
    code: str
    category: WorkCategory
    sub_category: Optional[str] = None
    description: str
    default_unit: Optional[str] = None
    keywords: Optional[str] = None
    is_active: bool


# ─── Location / Facility ─────────────────────────────────────────────────────

class LocationCreate(BaseModel):
    location_code: str
    name: str
    village: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    latitude: Optional[Decimal] = None
    longitude: Optional[Decimal] = None


class LocationUpdate(LocationCreate):
    location_code: Optional[str] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None


class LocationOut(ORMBase):
    id: UUID
    contract_id: UUID
    location_code: str
    name: str
    village: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    latitude: Optional[Decimal] = None
    longitude: Optional[Decimal] = None
    is_active: bool
    facilities: List["FacilityOut"] = []


class FacilityCreate(BaseModel):
    location_id: UUID
    facility_code: str
    facility_type: Optional[str] = None
    facility_name: str
    display_order: int = 0
    notes: Optional[str] = None


class FacilityBulkCreate(BaseModel):
    location_id: UUID
    facilities: List[Dict[str, Any]]  # [{facility_code, facility_name, facility_type}]


class FacilityUpdate(BaseModel):
    facility_code: Optional[str] = None
    facility_type: Optional[str] = None
    facility_name: Optional[str] = None
    display_order: Optional[int] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class FacilityOut(ORMBase):
    id: UUID
    location_id: UUID
    facility_code: str
    facility_type: Optional[str] = None
    facility_name: str
    display_order: int
    total_value: Decimal
    is_active: bool


# ─── BOQ ─────────────────────────────────────────────────────────────────────

class BOQItemCreate(BaseModel):
    facility_id: UUID
    parent_id: Optional[UUID] = None
    original_code: Optional[str] = None
    full_code: Optional[str] = None
    level: int = 0
    display_order: int = 0
    description: str
    unit: Optional[str] = None
    volume: Decimal = Decimal("0")
    unit_price: Decimal = Decimal("0")
    total_price: Decimal = Decimal("0")
    weight_pct: Decimal = Decimal("0")
    master_work_code: Optional[str] = None
    planned_start_week: Optional[int] = None
    planned_duration_weeks: Optional[int] = None
    is_leaf: bool = True


class BOQItemUpdate(BaseModel):
    description: Optional[str] = None
    unit: Optional[str] = None
    volume: Optional[Decimal] = None
    unit_price: Optional[Decimal] = None
    total_price: Optional[Decimal] = None
    weight_pct: Optional[Decimal] = None
    master_work_code: Optional[str] = None
    planned_start_week: Optional[int] = None
    planned_duration_weeks: Optional[int] = None
    is_active: Optional[bool] = None
    addendum_id: Optional[UUID] = None
    change_reason: Optional[str] = None


class BOQItemOut(ORMBase):
    id: UUID
    facility_id: UUID
    parent_id: Optional[UUID] = None
    original_code: Optional[str] = None
    full_code: Optional[str] = None
    level: int
    display_order: int
    description: str
    unit: Optional[str] = None
    volume: Decimal
    unit_price: Decimal
    total_price: Decimal
    weight_pct: Decimal
    master_work_code: Optional[str] = None
    planned_start_week: Optional[int] = None
    planned_duration_weeks: Optional[int] = None
    planned_end_week: Optional[int] = None
    version: int
    is_active: bool
    is_leaf: bool


# ─── Contract ────────────────────────────────────────────────────────────────

class ContractCreate(BaseModel):
    contract_number: str
    contract_name: str
    company_id: UUID
    ppk_id: UUID
    konsultan_id: Optional[UUID] = None
    fiscal_year: int
    original_value: Decimal
    start_date: date
    end_date: date
    description: Optional[str] = None
    weekly_report_due_day: int = 1
    daily_report_required: bool = True
    # NEW: accept locations upfront (array)
    locations: List[LocationCreate] = []


class ContractUpdate(BaseModel):
    # Field yang selalu editable
    contract_name: Optional[str] = None
    description: Optional[str] = None
    weekly_report_due_day: Optional[int] = None
    daily_report_required: Optional[bool] = None
    # Field DRAFT-only — backend menolak pemakaiannya saat status != draft
    # dan kontrak belum Unlock Mode. Tanpa mendeklarasikannya di schema,
    # Pydantic akan men-drop-nya dari payload sehingga guard + edit DRAFT
    # sama-sama tidak bekerja.
    contract_number: Optional[str] = None
    company_id: Optional[UUID] = None
    ppk_id: Optional[UUID] = None
    konsultan_id: Optional[UUID] = None
    fiscal_year: Optional[int] = None
    original_value: Optional[Decimal] = None
    current_value: Optional[Decimal] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[ContractStatus] = None


class ContractOut(ORMBase):
    id: UUID
    contract_number: str
    contract_name: str
    company_id: UUID
    ppk_id: UUID
    konsultan_id: Optional[UUID] = None
    fiscal_year: int
    original_value: Decimal
    current_value: Decimal
    start_date: date
    original_end_date: date
    end_date: date
    duration_days: int
    status: ContractStatus
    description: Optional[str] = None
    weekly_report_due_day: int
    daily_report_required: bool
    created_at: datetime


class ContractDetail(ContractOut):
    company: Optional[CompanyOut] = None
    ppk: Optional[PPKOut] = None
    konsultan: Optional[CompanyOut] = None
    locations: List[LocationOut] = []
    addenda: List["AddendumOut"] = []


class AddendumCreate(BaseModel):
    number: str
    addendum_type: AddendumType
    effective_date: date
    extension_days: int = 0
    new_end_date: Optional[date] = None
    new_contract_value: Optional[Decimal] = None
    description: Optional[str] = None


class AddendumOut(ORMBase):
    id: UUID
    contract_id: UUID
    number: str
    addendum_type: AddendumType
    effective_date: date
    extension_days: int
    old_end_date: Optional[date] = None
    new_end_date: Optional[date] = None
    old_contract_value: Optional[Decimal] = None
    new_contract_value: Optional[Decimal] = None
    description: Optional[str] = None
    created_at: datetime


# ─── Weekly Report ───────────────────────────────────────────────────────────

class ProgressItemInput(BaseModel):
    boq_item_id: UUID
    volume_this_week: Decimal = Decimal("0")
    # volume_cumulative tetap diterima untuk kompatibilitas mundur, tapi
    # server akan override dengan perhitungan: previous_week + this_week.
    # Lihat app.services.progress_service.update_progress_item_calculations.
    volume_cumulative: Decimal = Decimal("0")
    notes: Optional[str] = None


class WeeklyReportCreate(BaseModel):
    week_number: int
    period_start: date
    period_end: date
    report_date: Optional[date] = None
    planned_weekly_pct: Optional[Decimal] = None
    planned_cumulative_pct: Optional[Decimal] = None
    manpower_count: int = 0
    manpower_skilled: int = 0
    manpower_unskilled: int = 0
    rain_days: int = 0
    obstacles: Optional[str] = None
    solutions: Optional[str] = None
    executive_summary: Optional[str] = None
    submitted_by: Optional[str] = None
    progress_items: List[ProgressItemInput] = []


class WeeklyReportUpdate(BaseModel):
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    planned_weekly_pct: Optional[Decimal] = None
    planned_cumulative_pct: Optional[Decimal] = None
    manpower_count: Optional[int] = None
    manpower_skilled: Optional[int] = None
    manpower_unskilled: Optional[int] = None
    rain_days: Optional[int] = None
    obstacles: Optional[str] = None
    solutions: Optional[str] = None
    executive_summary: Optional[str] = None
    progress_items: Optional[List[ProgressItemInput]] = None
    is_locked: Optional[bool] = None


class WeeklyProgressItemOut(ORMBase):
    id: UUID
    boq_item_id: UUID
    volume_this_week: Decimal
    volume_cumulative: Decimal
    progress_this_week_pct: Decimal
    progress_cumulative_pct: Decimal
    weighted_progress_pct: Decimal
    notes: Optional[str] = None


class WeeklyPhotoOut(ORMBase):
    id: UUID
    weekly_report_id: UUID
    facility_id: Optional[UUID] = None
    file_path: str
    thumbnail_path: Optional[str] = None
    caption: Optional[str] = None
    taken_at: Optional[datetime] = None
    created_at: datetime


class WeeklyReportOut(ORMBase):
    id: UUID
    contract_id: UUID
    week_number: int
    period_start: date
    period_end: date
    report_date: Optional[date] = None
    planned_weekly_pct: Decimal
    planned_cumulative_pct: Decimal
    actual_weekly_pct: Decimal
    actual_cumulative_pct: Decimal
    deviation_pct: Decimal
    deviation_status: DeviationStatus
    days_elapsed: int
    days_remaining: int
    spi: Optional[Decimal] = None
    manpower_count: int
    rain_days: int
    obstacles: Optional[str] = None
    solutions: Optional[str] = None
    executive_summary: Optional[str] = None
    submitted_by: Optional[str] = None
    is_locked: bool
    created_at: datetime


class WeeklyReportDetail(WeeklyReportOut):
    progress_items: List[WeeklyProgressItemOut] = []
    photos: List[WeeklyPhotoOut] = []


# ─── Daily Report ────────────────────────────────────────────────────────────

class DailyReportCreate(BaseModel):
    contract_id: UUID
    location_id: Optional[UUID] = None
    facility_id: Optional[UUID] = None
    report_date: date
    activities: Optional[str] = None
    manpower_count: int = 0
    manpower_skilled: int = 0
    manpower_unskilled: int = 0
    equipment_used: Optional[str] = None
    materials_received: Optional[str] = None
    weather_morning: Optional[str] = None
    weather_afternoon: Optional[str] = None
    rain_hours: Decimal = Decimal("0")
    obstacles: Optional[str] = None
    notes: Optional[str] = None


class DailyReportUpdate(BaseModel):
    location_id: Optional[UUID] = None
    facility_id: Optional[UUID] = None
    report_date: Optional[date] = None
    activities: Optional[str] = None
    manpower_count: Optional[int] = None
    manpower_skilled: Optional[int] = None
    manpower_unskilled: Optional[int] = None
    equipment_used: Optional[str] = None
    materials_received: Optional[str] = None
    weather_morning: Optional[str] = None
    weather_afternoon: Optional[str] = None
    rain_hours: Optional[Decimal] = None
    obstacles: Optional[str] = None
    notes: Optional[str] = None


class DailyPhotoOut(ORMBase):
    id: UUID
    daily_report_id: UUID
    file_path: str
    thumbnail_path: Optional[str] = None
    caption: Optional[str] = None
    taken_at: Optional[datetime] = None
    created_at: datetime


class DailyReportOut(ORMBase):
    id: UUID
    contract_id: UUID
    location_id: Optional[UUID] = None
    report_date: date
    activities: Optional[str] = None
    manpower_count: int
    equipment_used: Optional[str] = None
    weather_morning: Optional[str] = None
    weather_afternoon: Optional[str] = None
    rain_hours: Decimal
    obstacles: Optional[str] = None
    notes: Optional[str] = None
    submitted_by: Optional[str] = None
    created_at: datetime


class DailyReportDetail(DailyReportOut):
    photos: List[DailyPhotoOut] = []


# ─── Payment Terms ───────────────────────────────────────────────────────────

class PaymentTermCreate(BaseModel):
    term_number: int
    name: str
    required_progress_pct: Decimal = Decimal("0")
    payment_pct: Decimal = Decimal("0")
    amount: Decimal = Decimal("0")
    retention_pct: Decimal = Decimal("0")
    planned_date: Optional[date] = None
    notes: Optional[str] = None


class PaymentTermUpdate(BaseModel):
    name: Optional[str] = None
    required_progress_pct: Optional[Decimal] = None
    payment_pct: Optional[Decimal] = None
    amount: Optional[Decimal] = None
    retention_pct: Optional[Decimal] = None
    planned_date: Optional[date] = None
    submitted_date: Optional[date] = None
    paid_date: Optional[date] = None
    status: Optional[PaymentTermStatus] = None
    invoice_number: Optional[str] = None
    notes: Optional[str] = None


class PaymentTermOut(ORMBase):
    id: UUID
    contract_id: UUID
    term_number: int
    name: str
    required_progress_pct: Decimal
    payment_pct: Decimal
    amount: Decimal
    retention_pct: Decimal
    planned_date: Optional[date] = None
    eligible_date: Optional[date] = None
    submitted_date: Optional[date] = None
    paid_date: Optional[date] = None
    status: PaymentTermStatus
    invoice_number: Optional[str] = None
    notes: Optional[str] = None


# ─── Field Review ────────────────────────────────────────────────────────────

class FieldReviewCreate(BaseModel):
    contract_id: UUID
    location_id: Optional[UUID] = None
    review_number: Optional[str] = None
    review_date: date
    reviewer_name: str
    reviewer_institution: Optional[str] = None
    summary: Optional[str] = None
    recommendations: Optional[str] = None


class FieldReviewUpdate(BaseModel):
    review_number: Optional[str] = None
    review_date: Optional[date] = None
    reviewer_name: Optional[str] = None
    reviewer_institution: Optional[str] = None
    status: Optional[ReviewStatus] = None
    summary: Optional[str] = None
    recommendations: Optional[str] = None


class FindingCreate(BaseModel):
    finding_number: Optional[int] = None
    title: str
    description: str
    severity: FindingSeverity = FindingSeverity.MEDIUM
    recommendation: Optional[str] = None
    due_date: Optional[date] = None


class FindingUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[FindingSeverity] = None
    status: Optional[FindingStatus] = None
    recommendation: Optional[str] = None
    response: Optional[str] = None
    response_date: Optional[date] = None
    due_date: Optional[date] = None
    closed_date: Optional[date] = None


class FindingPhotoOut(ORMBase):
    id: UUID
    file_path: str
    thumbnail_path: Optional[str] = None
    caption: Optional[str] = None


class FindingOut(ORMBase):
    id: UUID
    review_id: UUID
    finding_number: Optional[int] = None
    title: str
    description: str
    severity: FindingSeverity
    status: FindingStatus
    recommendation: Optional[str] = None
    response: Optional[str] = None
    response_date: Optional[date] = None
    due_date: Optional[date] = None
    closed_date: Optional[date] = None
    photos: List[FindingPhotoOut] = []


class FieldReviewOut(ORMBase):
    id: UUID
    contract_id: UUID
    location_id: Optional[UUID] = None
    review_number: Optional[str] = None
    review_date: date
    reviewer_name: str
    reviewer_institution: Optional[str] = None
    status: ReviewStatus
    summary: Optional[str] = None
    recommendations: Optional[str] = None
    findings: List[FindingOut] = []
    created_at: datetime


# ─── Notifications ───────────────────────────────────────────────────────────

class NotificationRuleCreate(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    trigger_type: str
    channel: NotificationChannel = NotificationChannel.WHATSAPP
    threshold_config: Dict[str, Any] = {}
    message_template: str
    target_roles: List[str] = []


class NotificationRuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    trigger_type: Optional[str] = None
    channel: Optional[NotificationChannel] = None
    threshold_config: Optional[Dict[str, Any]] = None
    message_template: Optional[str] = None
    target_roles: Optional[List[str]] = None
    is_active: Optional[bool] = None


class NotificationRuleOut(ORMBase):
    id: UUID
    code: str
    name: str
    description: Optional[str] = None
    trigger_type: str
    channel: NotificationChannel
    threshold_config: Dict[str, Any]
    message_template: str
    target_roles: List[str]
    is_active: bool


# ─── Analytics ───────────────────────────────────────────────────────────────

class SCurvePoint(BaseModel):
    week: int
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    planned_cumulative: float
    actual_cumulative: Optional[float] = None
    deviation: Optional[float] = None
    deviation_status: Optional[str] = None
    spi: Optional[float] = None


class SCurveResponse(BaseModel):
    contract_id: str
    contract_number: str
    contract_name: str
    total_weeks: int
    current_week: int
    latest_actual: float
    latest_planned: float
    latest_deviation: float
    forecast_completion_week: Optional[int] = None
    forecast_delay_days: Optional[int] = None
    points: List[SCurvePoint]
    addendum_weeks: List[int] = []


class DashboardStats(BaseModel):
    total_contracts: int
    total_locations: int
    total_facilities: int
    total_value: float
    avg_progress: float
    contracts_on_track: int
    contracts_warning: int
    contracts_critical: int
    contracts_completed: int
    active_warnings: int
    missing_daily_reports: int
    missing_weekly_reports: int


class ContractSummary(BaseModel):
    id: str
    contract_number: str
    contract_name: str
    company_name: str
    ppk_name: str
    city: Optional[str] = None
    province: Optional[str] = None
    current_week: int
    total_weeks: int
    actual_cumulative: float
    planned_cumulative: float
    deviation: float
    deviation_status: str
    spi: Optional[float] = None
    days_remaining: int
    location_count: int
    facility_count: int
    contract_value: float
    has_active_warning: bool
    status: str


# ─── Import Results ──────────────────────────────────────────────────────────

class ExcelImportResult(BaseModel):
    success: bool
    message: Optional[str] = None
    items_imported: int = 0
    items_skipped: int = 0
    facilities_created: int = 0
    warnings: List[str] = []
    errors: List[str] = []
    preview: List[Dict[str, Any]] = []


LocationOut.model_rebuild()
ContractDetail.model_rebuild()
