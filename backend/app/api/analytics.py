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


# ─────────────────────────────────────────────────────────────────────────────
# Spatial Dashboard
# ─────────────────────────────────────────────────────────────────────────────
from app.api.deps import filter_contracts_for_user
from app.models.models import (
    WeeklyReportPhoto, WeeklyReport, DailyReportPhoto, DailyReport,
)


@router.get("/map-locations", response_model=dict)
def map_locations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Daftar lokasi proyek dengan koordinat untuk dashboard peta. Hanya
    lokasi dengan latitude+longitude yang dikembalikan; lokasi tanpa
    koordinat di-skip secara senyap (akan tampil di list lokasi normal,
    tapi tidak di peta).

    Setiap entri membungkus location + ringkasan kontrak induk + daftar
    fasilitas. Frontend memakai ini untuk render marker dan panel info.
    """
    contracts_q = (
        db.query(Contract)
        .filter(Contract.deleted_at.is_(None))
    )
    contracts_q = filter_contracts_for_user(contracts_q, current_user)
    contract_ids = [c.id for c in contracts_q.all()]
    if not contract_ids:
        return {"items": []}

    locs = (
        db.query(Location, Contract)
        .join(Contract, Contract.id == Location.contract_id)
        .filter(
            Location.contract_id.in_(contract_ids),
            Location.latitude.isnot(None),
            Location.longitude.isnot(None),
            Location.is_active == True,  # noqa: E712
        )
        .all()
    )

    # Pre-fetch facilities + last weekly progress per contract.
    contract_progress = {}
    latest_weeklies = (
        db.query(WeeklyReport)
        .filter(WeeklyReport.contract_id.in_(contract_ids), WeeklyReport.is_deleted == False)  # noqa: E712
        .order_by(WeeklyReport.contract_id, WeeklyReport.week_number.desc())
        .all()
    )
    for w in latest_weeklies:
        if w.contract_id not in contract_progress:
            contract_progress[w.contract_id] = {
                "week_number": w.week_number,
                "planned_pct": float(w.planned_cumulative_pct or 0),
                "actual_pct": float(w.actual_cumulative_pct or 0),
            }

    items = []
    # Pre-fetch company + PPK names untuk search di dashboard eksekutif
    company_map = {c.id: c.name for c in db.query(Company).all()}
    ppk_map = {p.id: p.name for p in db.query(PPK).all()}
    for loc, c in locs:
        facilities = (
            db.query(Facility)
            .filter(Facility.location_id == loc.id, Facility.is_active == True)  # noqa: E712
            .order_by(Facility.display_order, Facility.facility_code)
            .all()
        )
        progress = contract_progress.get(c.id, {})
        items.append({
            "location_id": str(loc.id),
            "location_code": loc.location_code,
            "location_name": loc.name,
            "village": loc.village,
            "district": loc.district,
            "city": loc.city,
            "province": loc.province,
            "latitude": float(loc.latitude),
            "longitude": float(loc.longitude),
            "contract_id": str(c.id),
            "contract_number": c.contract_number,
            "contract_name": c.contract_name,
            "contract_status": c.status.value if hasattr(c.status, "value") else c.status,
            "company_name": company_map.get(c.company_id),
            "ppk_name": ppk_map.get(c.ppk_id),
            "current_value": float(c.current_value or 0),
            "start_date": c.start_date.isoformat() if c.start_date else None,
            "end_date": c.end_date.isoformat() if c.end_date else None,
            "duration_days": c.duration_days,
            "latest_week": progress.get("week_number"),
            "planned_pct": progress.get("planned_pct"),
            "actual_pct": progress.get("actual_pct"),
            "deviation_pct": (
                (progress.get("actual_pct", 0) - progress.get("planned_pct", 0))
                if progress.get("planned_pct") is not None else None
            ),
            "facilities": [
                {
                    "id": str(f.id),
                    "facility_code": f.facility_code,
                    "facility_name": f.facility_name,
                    "facility_type": f.facility_type,
                    "total_value": float(f.total_value or 0),
                }
                for f in facilities
            ],
        })
    return {"items": items}


@router.get("/facility-progress/{facility_id}", response_model=dict)
def facility_progress(
    facility_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Ringkasan progres fisik satu fasilitas (untuk panel Dashboard Eksekutif
    saat fasilitas diklik). Menghitung:
      - target_weight_pct (porsi fasilitas dari total kontrak)
      - actual_weight_pct (kontribusi realisasi saat ini)
      - facility_progress_pct (actual / target)
      - contract_progress_pct (rata-rata seluruh kontrak untuk referensi)
      - deviation_pct (selisih progress fasilitas vs rata-rata kontrak)
    """
    fac = db.query(Facility).filter(Facility.id == facility_id).first()
    if not fac:
        raise HTTPException(404, "Fasilitas tidak ditemukan")
    loc = db.query(Location).filter(Location.id == fac.location_id).first()
    if not loc or not user_can_access_contract(db, current_user, str(loc.contract_id)):
        raise HTTPException(403, "Akses ditolak")

    from app.services.progress_service import compute_facility_progress_summary
    summaries = compute_facility_progress_summary(db, loc.contract_id)
    target_facility = next((s for s in summaries if s["facility_id"] == str(facility_id)), None)
    if not target_facility:
        target_facility = {
            "facility_id": str(facility_id),
            "facility_code": fac.facility_code,
            "facility_name": fac.facility_name,
            "target_weight_pct": 0.0,
            "actual_weight_pct": 0.0,
            "facility_progress_pct": 0.0,
            "item_count": 0,
            "completed_item_count": 0,
        }

    # Rata-rata kontrak: jumlah actual_weight_pct (yang sama dengan
    # realisasi kumulatif kontrak)
    contract_actual = sum(s["actual_weight_pct"] for s in summaries)
    target_facility["contract_progress_pct"] = contract_actual
    target_facility["deviation_pct"] = (
        target_facility["facility_progress_pct"] - contract_actual
    )
    return target_facility


@router.get("/facility-photos/{facility_id}", response_model=dict)
def facility_photos(
    facility_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Foto dokumentasi suatu fasilitas, dikelompokkan per tanggal pengambilan.
    Sumber: weekly_report_photos.facility_id (daily report tidak punya
    facility_id, jadi tidak masuk gallery per-fasilitas).

    Akses: hanya kontrak yang user punya akses (sama seperti list normal).
    """
    fac = db.query(Facility).filter(Facility.id == facility_id).first()
    if not fac:
        raise HTTPException(404, "Fasilitas tidak ditemukan")
    loc = db.query(Location).filter(Location.id == fac.location_id).first()
    if not loc or not user_can_access_contract(db, current_user, str(loc.contract_id)):
        raise HTTPException(403, "Akses ditolak")

    # Foto dari 2 sumber: weekly_report_photos + daily_report_photos yang
    # terikat fasilitas ini. Digabung, lalu dikelompokkan per tanggal.
    weekly_rows = (
        db.query(WeeklyReportPhoto, WeeklyReport)
        .join(WeeklyReport, WeeklyReport.id == WeeklyReportPhoto.weekly_report_id)
        .filter(WeeklyReportPhoto.facility_id == facility_id)
        .all()
    )
    daily_rows = (
        db.query(DailyReportPhoto, DailyReport)
        .join(DailyReport, DailyReport.id == DailyReportPhoto.daily_report_id)
        .filter(
            DailyReportPhoto.facility_id == facility_id,
            DailyReport.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    groups: dict = {}

    def _pick_date(photo, report, fallback_attr):
        # Pakai taken_at kalau ada, fallback ke report_date (daily) atau
        # period_end (weekly), fallback terakhir ke created_at.
        if photo.taken_at:
            return photo.taken_at.date()
        if report is not None and hasattr(report, fallback_attr):
            val = getattr(report, fallback_attr)
            if val:
                return val if hasattr(val, "isoformat") and not hasattr(val, "hour") else val.date()
        if photo.created_at:
            return photo.created_at.date()
        return None

    for p, rep in weekly_rows:
        d = _pick_date(p, rep, "period_end")
        key = d.isoformat() if d else "unknown"
        groups.setdefault(key, []).append({
            "id": str(p.id),
            "source": "weekly",
            "file_path": p.file_path,
            "thumbnail_path": p.thumbnail_path,
            "caption": p.caption,
            "taken_at": p.taken_at.isoformat() + "Z" if p.taken_at else None,
            "created_at": p.created_at.isoformat() + "Z" if p.created_at else None,
        })

    for p, rep in daily_rows:
        d = _pick_date(p, rep, "report_date")
        key = d.isoformat() if d else "unknown"
        groups.setdefault(key, []).append({
            "id": str(p.id),
            "source": "daily",
            "file_path": p.file_path,
            "thumbnail_path": p.thumbnail_path,
            "caption": p.caption,
            "taken_at": p.taken_at.isoformat() + "Z" if p.taken_at else None,
            "created_at": p.created_at.isoformat() + "Z" if p.created_at else None,
        })

    sorted_groups = sorted(groups.items(), key=lambda kv: kv[0], reverse=True)
    total = len(weekly_rows) + len(daily_rows)
    return {
        "facility": {
            "id": str(fac.id),
            "code": fac.facility_code,
            "name": fac.facility_name,
            "type": fac.facility_type,
        },
        "groups": [{"date": k, "photos": v} for k, v in sorted_groups],
        "total": total,
        "sources": {"weekly": len(weekly_rows), "daily": len(daily_rows)},
    }
