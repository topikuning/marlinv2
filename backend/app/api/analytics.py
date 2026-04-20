from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date, timedelta

from app.core.database import get_db
from app.models.models import (
    Contract, Location, Facility, WeeklyReport, EarlyWarning,
    DailyReport, User, ContractStatus, Company, PPK,
)
from app.schemas.schemas import DashboardStats, SCurveResponse
from app.api.deps import get_current_user, user_can_access_contract, require_permission
from app.services.progress_service import get_scurve_data

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/dashboard", response_model=dict)
def dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    scope = db.query(Contract).filter(Contract.deleted_at.is_(None))
    role = current_user.role_obj
    if role and role.code in ("konsultan", "kontraktor", "ppk"):
        assigned = [str(c) for c in (current_user.assigned_contract_ids or [])]
        if assigned:
            scope = scope.filter(Contract.id.in_(assigned))

    contracts = scope.all()
    contract_ids = [c.id for c in contracts]

    total_contracts = len(contracts)
    total_value = sum(float(c.current_value) for c in contracts)

    total_locations = db.query(Location).filter(
        Location.contract_id.in_(contract_ids) if contract_ids else False,
    ).count()
    total_facilities = 0
    if contract_ids:
        total_facilities = (
            db.query(Facility)
            .join(Location)
            .filter(Location.contract_id.in_(contract_ids))
            .count()
        )

    # latest report per contract
    avg_progress = 0.0
    on_track = warning = critical = completed = 0
    total_progress = 0.0
    counted = 0
    for c in contracts:
        if c.status == ContractStatus.COMPLETED:
            completed += 1
            continue
        latest = (
            db.query(WeeklyReport)
            .filter(WeeklyReport.contract_id == c.id, WeeklyReport.is_deleted == False)
            .order_by(WeeklyReport.week_number.desc())
            .first()
        )
        if not latest:
            continue
        act = float(latest.actual_cumulative_pct or 0)
        dev = float(latest.deviation_pct or 0)
        total_progress += act
        counted += 1
        if dev <= -0.10:
            critical += 1
        elif dev <= -0.05:
            warning += 1
        else:
            on_track += 1
    if counted > 0:
        avg_progress = total_progress / counted * 100

    active_warnings = db.query(EarlyWarning).filter(
        EarlyWarning.is_resolved == False,
        EarlyWarning.contract_id.in_(contract_ids) if contract_ids else False,
    ).count()

    # missing reports yesterday
    yesterday = date.today() - timedelta(days=1)
    missing_daily = 0
    for c in contracts:
        if c.daily_report_required and c.status == ContractStatus.ACTIVE:
            if not db.query(DailyReport).filter(
                DailyReport.contract_id == c.id,
                DailyReport.report_date == yesterday,
                DailyReport.is_deleted == False,
            ).first():
                missing_daily += 1

    missing_weekly = 0
    for c in contracts:
        if c.status != ContractStatus.ACTIVE or not c.start_date:
            continue
        elapsed = (date.today() - c.start_date).days
        if elapsed < 7:
            continue
        last_week = elapsed // 7
        if not db.query(WeeklyReport).filter(
            WeeklyReport.contract_id == c.id,
            WeeklyReport.week_number == last_week,
            WeeklyReport.is_deleted == False,
        ).first():
            missing_weekly += 1

    return {
        "total_contracts": total_contracts,
        "total_locations": total_locations,
        "total_facilities": total_facilities,
        "total_value": total_value,
        "avg_progress": round(avg_progress, 2),
        "contracts_on_track": on_track,
        "contracts_warning": warning,
        "contracts_critical": critical,
        "contracts_completed": completed,
        "active_warnings": active_warnings,
        "missing_daily_reports": missing_daily,
        "missing_weekly_reports": missing_weekly,
    }


@router.get("/contracts-summary", response_model=dict)
def contracts_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Contract).filter(Contract.deleted_at.is_(None))
    role = current_user.role_obj
    if role and role.code in ("konsultan", "kontraktor", "ppk"):
        assigned = [str(c) for c in (current_user.assigned_contract_ids or [])]
        if assigned:
            query = query.filter(Contract.id.in_(assigned))

    rows = []
    for c in query.all():
        company = db.query(Company).filter(Company.id == c.company_id).first()
        ppk = db.query(PPK).filter(PPK.id == c.ppk_id).first()
        loc_count = db.query(Location).filter(Location.contract_id == c.id).count()
        fac_count = (
            db.query(Facility).join(Location)
            .filter(Location.contract_id == c.id)
            .count()
        )
        latest = (
            db.query(WeeklyReport)
            .filter(WeeklyReport.contract_id == c.id, WeeklyReport.is_deleted == False)
            .order_by(WeeklyReport.week_number.desc())
            .first()
        )
        actual = float(latest.actual_cumulative_pct or 0) * 100 if latest else 0
        planned = float(latest.planned_cumulative_pct or 0) * 100 if latest else 0
        deviation = actual - planned
        spi = float(latest.spi) if latest and latest.spi else None
        dev_status = latest.deviation_status.value if latest and hasattr(latest.deviation_status, "value") else (latest.deviation_status if latest else "normal")
        current_week = latest.week_number if latest else 0
        days_remaining = latest.days_remaining if latest else (
            max((c.end_date - date.today()).days, 0) if c.end_date else 0
        )

        has_warning = db.query(EarlyWarning).filter(
            EarlyWarning.contract_id == c.id, EarlyWarning.is_resolved == False,
        ).count() > 0

        total_weeks = max((c.duration_days or 7) // 7, 1)

        # primary city/province
        first_loc = db.query(Location).filter(Location.contract_id == c.id).first()

        rows.append({
            "id": str(c.id),
            "contract_number": c.contract_number,
            "contract_name": c.contract_name,
            "company_name": company.name if company else "",
            "ppk_name": ppk.name if ppk else "",
            "city": first_loc.city if first_loc else None,
            "province": first_loc.province if first_loc else None,
            "current_week": current_week,
            "total_weeks": total_weeks,
            "actual_cumulative": round(actual, 2),
            "planned_cumulative": round(planned, 2),
            "deviation": round(deviation, 2),
            "deviation_status": dev_status,
            "spi": spi,
            "days_remaining": days_remaining,
            "location_count": loc_count,
            "facility_count": fac_count,
            "contract_value": float(c.current_value),
            "has_active_warning": has_warning,
            "status": c.status.value if hasattr(c.status, "value") else c.status,
        })
    return {"items": rows}


@router.get("/scurve/{contract_id}", response_model=SCurveResponse)
def scurve(
    contract_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")
    try:
        return get_scurve_data(db, contract_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
