"""Progress calculation & S-curve builder."""
from typing import List, Optional, Tuple
from decimal import Decimal
from datetime import date, timedelta
from sqlalchemy.orm import Session
from app.models.models import (
    Contract, WeeklyReport, WeeklyProgressItem, BOQItem,
    Facility, Location, DeviationStatus, EarlyWarning, ContractAddendum,
)
from app.schemas.schemas import SCurvePoint, SCurveResponse


def get_deviation_status(deviation: float) -> DeviationStatus:
    if deviation > 0.05:
        return DeviationStatus.FAST
    if deviation >= -0.05:
        return DeviationStatus.NORMAL
    if deviation >= -0.10:
        return DeviationStatus.WARNING
    return DeviationStatus.CRITICAL


def calculate_spi(actual: Optional[float], planned: Optional[float]) -> Optional[float]:
    if not planned or planned <= 0:
        return None
    if actual is None:
        return None
    return round(actual / planned, 4)


def update_progress_item_calculations(
    progress_item: WeeklyProgressItem,
    boq_item: BOQItem,
    *,
    previous_cumulative: Optional[float] = None,
):
    """
    Hitung ulang persentase progres untuk satu WeeklyProgressItem.

    Alur baru (selaras spek perbaikan_logika_laporan_mingguan):
      Volume Kumulatif = Volume Minggu Lalu + Volume Minggu Ini
      Volume Minggu Lalu = volume_cumulative dari minggu < current_week
      Volume Minggu Ini  = input user (progress_item.volume_this_week)
      Validasi: Volume Kumulatif tidak boleh > volume BOQ fasilitas.

    Parameter:
      previous_cumulative — sudah di-lookup oleh caller dari minggu-minggu
        sebelumnya (max volume_cumulative). Bila None, fallback dihitung
        dari existing pi.volume_cumulative - volume_this_week untuk
        kompatibilitas mundur.

    Raises ValueError kalau inputan menyebabkan kumulatif melebihi BOQ.
    """
    this_week = float(progress_item.volume_this_week or 0)
    if previous_cumulative is None:
        existing_cum = float(progress_item.volume_cumulative or 0)
        previous_cumulative = max(0.0, existing_cum - this_week)
    cumulative = max(0.0, previous_cumulative + this_week)

    vol = float(boq_item.volume or 0)
    label = (boq_item.description or "")[:80] or str(boq_item.id)

    if vol > 0:
        if cumulative > vol + 1e-6:
            raise ValueError(
                f"Volume kumulatif ({cumulative:g}) melebihi Volume BOQ "
                f"({vol:g}) untuk item '{label}'. Kurangi Volume Minggu Ini."
            )
        progress_item.progress_this_week_pct = Decimal(str(this_week / vol))
        progress_item.progress_cumulative_pct = Decimal(str(cumulative / vol))
    else:
        # Lumpsum — volume diinterpretasi sebagai persentase 0..1
        if cumulative > 1.0 + 1e-6:
            raise ValueError(
                f"Progress kumulatif melebihi 100% untuk item lumpsum '{label}'."
            )
        progress_item.progress_this_week_pct = Decimal(str(min(1.0, max(0.0, this_week))))
        progress_item.progress_cumulative_pct = Decimal(str(min(1.0, max(0.0, cumulative))))

    progress_item.volume_cumulative = Decimal(str(cumulative))
    progress_item.weighted_progress_pct = Decimal(str(
        float(progress_item.progress_cumulative_pct) * float(boq_item.weight_pct or 0)
    ))
    return progress_item


def get_previous_cumulatives(
    db: Session,
    contract_id,
    boq_item_ids: List,
    current_week: int,
) -> dict:
    """
    Batch-lookup Volume Minggu Lalu (= max volume_cumulative dari report
    mingguan dengan week_number < current_week) untuk setiap boq_item_id.
    Return dict {boq_item_id: float}.

    Progress sifatnya monotonic non-decreasing, jadi MAX dari semua minggu
    sebelumnya sama dengan minggu terakhir yang dilaporkan. Pakai MAX
    sebagai safety kalau ada history yang tidak rapi.
    """
    from sqlalchemy import func
    if not boq_item_ids:
        return {}
    rows = (
        db.query(
            WeeklyProgressItem.boq_item_id,
            func.max(WeeklyProgressItem.volume_cumulative),
        )
        .join(WeeklyReport, WeeklyReport.id == WeeklyProgressItem.weekly_report_id)
        .filter(
            WeeklyReport.contract_id == contract_id,
            WeeklyReport.week_number < current_week,
            WeeklyReport.is_deleted == False,  # noqa: E712
            WeeklyProgressItem.boq_item_id.in_(boq_item_ids),
        )
        .group_by(WeeklyProgressItem.boq_item_id)
        .all()
    )
    return {str(r[0]): float(r[1] or 0) for r in rows}


def compute_facility_progress_summary(
    db: Session,
    contract_id,
    *,
    revision_id=None,
) -> List[dict]:
    """
    Ringkasan progres per fasilitas untuk sebuah kontrak, berdasarkan
    WeeklyProgressItem terbaru (max volume_cumulative per BOQ). Untuk
    setiap fasilitas kembalikan:

      - facility_id, facility_code, facility_name, location_name
      - target_weight_pct: sum(BOQItem.weight_pct) untuk fasilitas ini
        (= porsi target fasilitas terhadap total kontrak)
      - actual_weight_pct: sum(weight_pct * progress_cumulative_pct)
        (= kontribusi realisasi ke total kontrak sampai saat ini)
      - facility_progress_pct: actual / target bila target > 0
        (= progress fisik internal fasilitas, 0..1)
      - item_count, completed_item_count

    Deviasi per fasilitas dihitung di frontend sebagai
    (facility_progress_pct - rata-rata progress kontrak) supaya konteks
    relatif terlihat.
    """
    from app.models.models import BOQRevision, RevisionStatus

    # Tentukan revisi aktif
    if revision_id is None:
        active = (
            db.query(BOQRevision)
            .filter(
                BOQRevision.contract_id == contract_id,
                BOQRevision.is_active == True,  # noqa: E712
            )
            .first()
        )
        revision_id = active.id if active else None
    if revision_id is None:
        return []

    # Ambil BOQ items + facility/location + max cumulative pct per item
    items = (
        db.query(BOQItem, Facility, Location)
        .join(Facility, Facility.id == BOQItem.facility_id)
        .join(Location, Location.id == Facility.location_id)
        .filter(
            Location.contract_id == contract_id,
            BOQItem.boq_revision_id == revision_id,
            BOQItem.is_active == True,  # noqa: E712
            BOQItem.is_leaf == True,    # noqa: E712
        )
        .all()
    )
    if not items:
        return []

    boq_ids = [b.id for b, _, _ in items]
    from sqlalchemy import func
    latest_progress = dict(
        db.query(
            WeeklyProgressItem.boq_item_id,
            func.max(WeeklyProgressItem.progress_cumulative_pct),
        )
        .filter(WeeklyProgressItem.boq_item_id.in_(boq_ids))
        .group_by(WeeklyProgressItem.boq_item_id)
        .all()
    )

    buckets = {}
    for b, f, l in items:
        key = str(f.id)
        bucket = buckets.setdefault(key, {
            "facility_id": key,
            "facility_code": f.facility_code,
            "facility_name": f.facility_name,
            "facility_type": f.facility_type,
            "location_id": str(l.id),
            "location_code": l.location_code,
            "location_name": l.name,
            "target_weight_pct": 0.0,
            "actual_weight_pct": 0.0,
            "item_count": 0,
            "completed_item_count": 0,
        })
        w = float(b.weight_pct or 0)
        p = float(latest_progress.get(b.id) or 0)
        bucket["target_weight_pct"] += w
        bucket["actual_weight_pct"] += w * p
        bucket["item_count"] += 1
        if p >= 0.999:
            bucket["completed_item_count"] += 1

    out = []
    for v in buckets.values():
        target = v["target_weight_pct"]
        actual = v["actual_weight_pct"]
        v["facility_progress_pct"] = (actual / target) if target > 0 else 0.0
        out.append(v)
    out.sort(key=lambda x: (x["location_code"], x["facility_code"]))
    return out


def recalculate_report_totals(db: Session, report: WeeklyReport):
    """Recompute cumulative pct, deviation, spi from progress_items."""
    items = db.query(WeeklyProgressItem).filter(
        WeeklyProgressItem.weekly_report_id == report.id
    ).all()

    cumulative = 0.0
    for it in items:
        if it.boq_item and it.boq_item.is_active:
            cumulative += float(it.progress_cumulative_pct or 0) * float(it.boq_item.weight_pct or 0)

    report.actual_cumulative_pct = Decimal(str(round(cumulative, 8)))

    prev = db.query(WeeklyReport).filter(
        WeeklyReport.contract_id == report.contract_id,
        WeeklyReport.week_number == report.week_number - 1,
        WeeklyReport.is_deleted == False,
    ).first()
    prev_cum = float(prev.actual_cumulative_pct) if prev else 0.0
    report.actual_weekly_pct = Decimal(str(round(cumulative - prev_cum, 8)))

    dev = cumulative - float(report.planned_cumulative_pct or 0)
    report.deviation_pct = Decimal(str(round(dev, 8)))
    report.deviation_status = get_deviation_status(dev)
    report.spi = Decimal(str(calculate_spi(cumulative, float(report.planned_cumulative_pct or 0)) or 0))


def build_planned_scurve(db: Session, contract: Contract) -> List[dict]:
    """Build planned cumulative curve from BOQ items' schedule."""
    total_weeks = max((contract.duration_days or 7) // 7, 1)

    boq_items = (
        db.query(BOQItem)
        .join(Facility, Facility.id == BOQItem.facility_id)
        .join(Location, Location.id == Facility.location_id)
        .filter(
            Location.contract_id == contract.id,
            BOQItem.is_active == True,
            BOQItem.is_leaf == True,
            BOQItem.weight_pct > 0,
        )
        .all()
    )

    weekly = [0.0] * (total_weeks + 2)
    for item in boq_items:
        start = item.planned_start_week or 1
        dur = item.planned_duration_weeks or total_weeks
        weight = float(item.weight_pct)
        per_week = weight / max(dur, 1)
        for w in range(start, min(start + dur, total_weeks + 1)):
            if 1 <= w <= total_weeks:
                weekly[w] += per_week

    out = []
    cum = 0.0
    for w in range(1, total_weeks + 1):
        cum += weekly[w]
        out.append({"week": w, "planned_weekly": weekly[w], "planned_cumulative": min(cum, 1.0)})
    return out


def get_scurve_data(db: Session, contract_id: str) -> SCurveResponse:
    contract = db.query(Contract).filter(Contract.id == contract_id).first()
    if not contract:
        raise ValueError("Kontrak tidak ditemukan")

    planned = build_planned_scurve(db, contract)

    reports = (
        db.query(WeeklyReport)
        .filter(WeeklyReport.contract_id == contract_id, WeeklyReport.is_deleted == False)
        .order_by(WeeklyReport.week_number)
        .all()
    )
    actual_map = {r.week_number: r for r in reports}

    addendum_weeks = []
    for adm in db.query(ContractAddendum).filter(ContractAddendum.contract_id == contract_id).all():
        if contract.start_date and adm.effective_date:
            delta = (adm.effective_date - contract.start_date).days
            addendum_weeks.append((delta // 7) + 1)

    total_weeks = max((contract.duration_days or 7) // 7, 1)
    current_week = 1
    if contract.start_date:
        elapsed = (date.today() - contract.start_date).days
        current_week = max(1, min(elapsed // 7 + 1, total_weeks + 5))

    points = []
    latest_actual = 0.0
    latest_planned = 0.0
    latest_deviation = 0.0

    for pd in planned:
        w = pd["week"]
        rep = actual_map.get(w)
        actual_cum = float(rep.actual_cumulative_pct) if rep else None
        dev = (actual_cum - pd["planned_cumulative"]) if actual_cum is not None else None
        status_val = get_deviation_status(dev).value if dev is not None else None
        spi_val = calculate_spi(actual_cum, pd["planned_cumulative"]) if actual_cum is not None else None

        p_start = contract.start_date + timedelta(weeks=w - 1) if contract.start_date else None
        p_end = p_start + timedelta(days=6) if p_start else None

        if rep:
            latest_actual = actual_cum
            latest_planned = pd["planned_cumulative"]
            latest_deviation = dev or 0.0
            current_week = w

        points.append(SCurvePoint(
            week=w,
            period_start=p_start,
            period_end=p_end,
            planned_cumulative=round(pd["planned_cumulative"] * 100, 4),
            actual_cumulative=round(actual_cum * 100, 4) if actual_cum is not None else None,
            deviation=round(dev * 100, 4) if dev is not None else None,
            deviation_status=status_val,
            spi=spi_val,
        ))

    forecast_week = None
    forecast_delay = None
    if latest_actual < 1.0 and latest_planned > 0 and current_week > 0:
        rate = latest_actual / current_week
        if rate > 0:
            remaining_weeks = (1.0 - latest_actual) / rate
            forecast_week = current_week + int(remaining_weeks) + 1
            forecast_delay = max(0, forecast_week - total_weeks) * 7

    return SCurveResponse(
        contract_id=str(contract.id),
        contract_number=contract.contract_number,
        contract_name=contract.contract_name,
        total_weeks=total_weeks,
        current_week=current_week,
        latest_actual=round(latest_actual * 100, 2),
        latest_planned=round(latest_planned * 100, 2),
        latest_deviation=round(latest_deviation * 100, 2),
        forecast_completion_week=forecast_week,
        forecast_delay_days=forecast_delay,
        points=points,
        addendum_weeks=addendum_weeks,
    )


def recalculate_facility_weights(db: Session, facility_id: str):
    """Recalculate weight_pct of all active leaf items in one facility (proportional to total_price)."""
    items = db.query(BOQItem).filter(
        BOQItem.facility_id == facility_id,
        BOQItem.is_active == True,
        BOQItem.is_leaf == True,
    ).all()

    total = sum(float(i.total_price or 0) for i in items)
    if total <= 0:
        return

    for i in items:
        i.weight_pct = Decimal(str(round(float(i.total_price or 0) / total, 8)))


def recalculate_contract_weights(db: Session, contract_id: str):
    """Each leaf item's contract-level weight = its value / sum of all leaf items in contract."""
    leaf_items = (
        db.query(BOQItem)
        .join(Facility, Facility.id == BOQItem.facility_id)
        .join(Location, Location.id == Facility.location_id)
        .filter(
            Location.contract_id == contract_id,
            BOQItem.is_active == True,
            BOQItem.is_leaf == True,
        )
        .all()
    )
    total = sum(float(i.total_price or 0) for i in leaf_items)
    if total <= 0:
        return
    for i in leaf_items:
        i.weight_pct = Decimal(str(round(float(i.total_price or 0) / total, 8)))


def run_early_warning_check(db: Session, contract_id: str) -> List[EarlyWarning]:
    contract = db.query(Contract).filter(Contract.id == contract_id).first()
    if not contract:
        return []

    created = []
    latest = (
        db.query(WeeklyReport)
        .filter(WeeklyReport.contract_id == contract_id, WeeklyReport.is_deleted == False)
        .order_by(WeeklyReport.week_number.desc())
        .first()
    )
    if not latest:
        return created

    dev = float(latest.deviation_pct or 0)
    if dev <= -0.10:
        created.append(_build_warning(
            contract_id, latest.id, "deviation", "critical",
            f"Deviasi kumulatif {dev*100:.2f}% melampaui batas kritis -10%",
            "deviation_pct", dev, -0.10,
        ))
    elif dev <= -0.05:
        created.append(_build_warning(
            contract_id, latest.id, "deviation", "warning",
            f"Deviasi kumulatif {dev*100:.2f}% melewati batas peringatan -5%",
            "deviation_pct", dev, -0.05,
        ))

    spi_val = float(latest.spi or 0)
    if 0 < spi_val < 0.85:
        created.append(_build_warning(
            contract_id, latest.id, "spi", "critical",
            f"SPI {spi_val:.3f} di bawah 0.85 — proyek sangat terlambat",
            "spi", spi_val, 0.85,
        ))
    elif 0 < spi_val < 0.92:
        created.append(_build_warning(
            contract_id, latest.id, "spi", "warning",
            f"SPI {spi_val:.3f} di bawah 0.92",
            "spi", spi_val, 0.92,
        ))

    if latest.days_remaining and latest.days_remaining > 0:
        remaining_work = 1.0 - float(latest.actual_cumulative_pct or 0)
        total_days = contract.duration_days or 1
        time_ratio = remaining_work / (latest.days_remaining / total_days) if total_days > 0 else 1
        if time_ratio > 1.30:
            created.append(_build_warning(
                contract_id, latest.id, "time_work_ratio", "critical",
                f"Sisa pekerjaan {remaining_work*100:.1f}% tidak sebanding dengan sisa waktu {latest.days_remaining} hari",
                "time_work_ratio", time_ratio, 1.30,
            ))

    saved = []
    for w in created:
        existing = db.query(EarlyWarning).filter(
            EarlyWarning.contract_id == contract_id,
            EarlyWarning.warning_type == w.warning_type,
            EarlyWarning.is_resolved == False,
        ).first()
        if not existing:
            db.add(w)
            saved.append(w)
    db.commit()
    return saved


def _build_warning(contract_id, report_id, wtype, severity, msg, pname, pval, tval):
    return EarlyWarning(
        contract_id=contract_id,
        weekly_report_id=str(report_id),
        warning_type=wtype,
        severity=severity,
        message=msg,
        parameter_name=pname,
        parameter_value=Decimal(str(round(pval, 4))),
        threshold_value=Decimal(str(round(tval, 4))),
    )
