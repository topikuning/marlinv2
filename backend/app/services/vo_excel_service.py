"""
Excel snapshot + import untuk VO bulk edit.

Alur (Konvensi B):
  - Export: BOQ aktif per facility + ringkasan VO APPROVED-unbundled lain
  - User edit kolom 'vol_baru' di Excel
  - Import: hitung delta = vol_baru - vol_efektif_snapshot per item, infer
    action otomatis, return list VOItemInput yg client gabung ke form

Konvensi: vol_baru = volume final yg user inginkan dengan asumsi semua VO
APPROVED-pending (vol_pending_vo_lain) ikut di-bundle. delta yg disimpan
relatif ke vol_efektif, bukan vol_awal.
"""
from __future__ import annotations
import io
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from sqlalchemy.orm import Session

from app.models.models import (
    Contract, BOQItem, BOQRevision, RevisionStatus, Facility, Location,
    VariationOrder, VariationOrderItem, VOStatus, VOItemAction,
)


HEADERS = [
    "facility_code", "facility_name",
    "code", "parent_code",
    "description", "unit",
    "vol_awal", "vol_pending_vo_lain", "nilai_pending",
    "vol_efektif", "vol_baru",
    "unit_price", "catatan_vo_lain",
]


def _active_revision(db: Session, contract_id) -> Optional[BOQRevision]:
    return (
        db.query(BOQRevision)
        .filter(
            BOQRevision.contract_id == contract_id,
            BOQRevision.is_active == True,  # noqa: E712
            BOQRevision.status == RevisionStatus.APPROVED,
        )
        .first()
    )


def _pending_for_item(
    db: Session, boq_item_id, exclude_vo_id=None
) -> Tuple[Decimal, Decimal, List[str]]:
    """
    Ringkasan VO APPROVED-unbundled lain yang menyentuh item ini.

    Return: (sum_volume_delta, sum_cost_impact, ['VO-001: +5 m³', ...]).
    Hanya hitung action yang ubah volume (INCREASE/DECREASE/REMOVE).
    """
    q = (
        db.query(VariationOrderItem, VariationOrder)
        .join(VariationOrder, VariationOrder.id == VariationOrderItem.variation_order_id)
        .filter(
            VariationOrderItem.boq_item_id == boq_item_id,
            VariationOrder.status == VOStatus.APPROVED,
            VariationOrder.bundled_addendum_id.is_(None),
        )
    )
    if exclude_vo_id:
        q = q.filter(VariationOrder.id != exclude_vo_id)

    total_vol = Decimal("0")
    total_cost = Decimal("0")
    notes: List[str] = []
    for vi, vo in q.all():
        if vi.action not in (VOItemAction.INCREASE, VOItemAction.DECREASE, VOItemAction.REMOVE):
            continue
        d = Decimal(vi.volume_delta or 0)
        if vi.action == VOItemAction.REMOVE:
            d = -Decimal(vi.volume_delta or 0)  # delta sudah negatif kalau remove
            # actually for REMOVE we typically store delta = -original. Re-fetch
            # safe via cost_impact sign. Just use vi.volume_delta as-is.
            d = Decimal(vi.volume_delta or 0)
        total_vol += d
        total_cost += Decimal(vi.cost_impact or 0)
        sign = "+" if d >= 0 else ""
        notes.append(f"{vo.vo_number}: {sign}{d} {vi.unit or ''}")
    return total_vol, total_cost, notes


def export_snapshot(
    db: Session,
    contract_id: str,
    facility_ids: Optional[List[str]] = None,
    exclude_vo_id: Optional[str] = None,
) -> bytes:
    """
    Generate Excel snapshot. facility_ids=None → semua facility kontrak.
    exclude_vo_id → VO yang sedang di-edit, item-nya di-skip dari pending sum
    dan vol_baru di-prefill dari delta VO ini.
    """
    rev = _active_revision(db, contract_id)
    if not rev:
        # Fallback: revisi DRAFT terbaru
        rev = (
            db.query(BOQRevision)
            .filter(BOQRevision.contract_id == contract_id)
            .order_by(BOQRevision.cco_number.desc())
            .first()
        )
    if not rev:
        raise ValueError("Kontrak belum punya revisi BOQ.")

    # Resolve facilities
    fac_q = (
        db.query(Facility, Location)
        .join(Location, Facility.location_id == Location.id)
        .filter(Location.contract_id == contract_id)
    )
    if facility_ids:
        fac_q = fac_q.filter(Facility.id.in_(facility_ids))
    facilities = fac_q.order_by(Location.location_code, Facility.facility_code).all()

    # VO yang sedang di-edit — ambil itemnya untuk pre-fill vol_baru
    edit_vo_items_by_boq: Dict[str, VariationOrderItem] = {}
    if exclude_vo_id:
        for vi in db.query(VariationOrderItem).filter(
            VariationOrderItem.variation_order_id == exclude_vo_id
        ).all():
            if vi.boq_item_id:
                edit_vo_items_by_boq[str(vi.boq_item_id)] = vi

    wb = Workbook()
    ws = wb.active
    ws.title = "BOQ_Snapshot"
    ws.append(HEADERS)
    # Style header
    fill = PatternFill("solid", fgColor="0F172A")
    font_h = Font(color="FFFFFF", bold=True, size=10)
    for c in ws[1]:
        c.fill = fill
        c.font = font_h
        c.alignment = Alignment(horizontal="center", vertical="center")
    ws.freeze_panes = "A2"

    for fac, loc in facilities:
        # Items active di facility, sort by display_order
        items = (
            db.query(BOQItem)
            .filter(
                BOQItem.boq_revision_id == rev.id,
                BOQItem.facility_id == fac.id,
                BOQItem.is_active == True,  # noqa: E712
            )
            .order_by(BOQItem.display_order, BOQItem.full_code)
            .all()
        )
        # Map id → original_code untuk parent_code lookup
        code_by_id: Dict[str, str] = {str(it.id): (it.original_code or "") for it in items}

        for it in items:
            if not it.is_leaf:
                # Group rows: tampilkan untuk konteks tapi vol_baru kosong
                ws.append([
                    fac.facility_code, fac.facility_name,
                    it.original_code or "", code_by_id.get(str(it.parent_id), "") if it.parent_id else "",
                    it.description, it.unit or "",
                    "", "", "", "", "",
                    "", "(group/parent — vol_baru kosong)",
                ])
                continue

            vol_awal = Decimal(it.volume or 0)
            unit_price = Decimal(it.unit_price or 0)
            sum_vol, sum_cost, notes = _pending_for_item(db, it.id, exclude_vo_id=exclude_vo_id)
            vol_efektif = vol_awal + sum_vol

            # Pre-fill vol_baru: kalau VO yang sedang di-edit punya item ini,
            # hitung vol_baru = vol_efektif + delta_VO_ini. Kalau tidak, default
            # vol_baru = vol_efektif (no change).
            existing = edit_vo_items_by_boq.get(str(it.id))
            if existing:
                d_this = Decimal(existing.volume_delta or 0)
                vol_baru = vol_efektif + d_this
            else:
                vol_baru = vol_efektif

            ws.append([
                fac.facility_code, fac.facility_name,
                it.original_code or "",
                code_by_id.get(str(it.parent_id), "") if it.parent_id else "",
                it.description, it.unit or "",
                float(vol_awal),
                float(sum_vol),
                float(sum_cost),
                float(vol_efektif),
                float(vol_baru),
                float(unit_price),
                "; ".join(notes) if notes else "",
            ])

    # Auto width
    for col in ws.columns:
        max_len = 8
        for cell in col:
            if cell.value is None:
                continue
            v = str(cell.value)
            if len(v) > max_len:
                max_len = min(len(v), 60)
        ws.column_dimensions[col[0].column_letter].width = max_len + 2

    # Petunjuk sheet
    ws2 = wb.create_sheet("Petunjuk")
    ws2["A1"] = "PETUNJUK PENGISIAN BOQ SNAPSHOT (untuk VO Bulk Edit)"
    ws2["A1"].font = Font(bold=True, size=14)
    instr = [
        "",
        "Konsep: Anda terima snapshot BOQ aktif + info VO lain yang sudah APPROVED",
        "tapi belum di-bundle. Anda edit kolom 'vol_baru' saja, sistem hitung delta",
        "otomatis saat upload kembali.",
        "",
        "KOLOM:",
        "- facility_code, facility_name, code, parent_code, description, unit: identifier (read-only)",
        "- vol_awal: volume di revisi aktif kontrak (read-only)",
        "- vol_pending_vo_lain: total Δ volume dari VO APPROVED lain yang menyentuh item ini",
        "- nilai_pending: total Δ Rp dari VO lain itu",
        "- vol_efektif: vol_awal + vol_pending — proyeksi kalau semua VO pending lolos",
        "- vol_baru: ★ KOLOM YG ANDA EDIT ★ — volume final yang anda inginkan",
        "  Default = vol_efektif (artinya tidak ada perubahan baru dari VO ini)",
        "- unit_price: harga satuan (read-only — kontrak tidak boleh diubah)",
        "- catatan_vo_lain: daftar VO lain yang sudah ubah item ini",
        "",
        "AKSI OTOMATIS:",
        "- vol_baru > vol_efektif → INCREASE (Δ = vol_baru - vol_efektif)",
        "- vol_baru < vol_efektif (tapi > 0) → DECREASE",
        "- vol_baru = 0 → REMOVE (item dihapus)",
        "- Tambah baris baru (kosongkan code) → ADD",
        "  - Untuk ADD, isi: facility_code, parent_code (opsional), description, unit, vol_baru, unit_price",
        "  - vol_efektif & vol_pending biarkan kosong",
        "",
        "EDGE CASES:",
        "- Vol_baru < 0: tidak diizinkan, akan ditolak saat upload.",
        "- Group row (parent, is_leaf=false): biarkan vol_baru kosong; tidak ditolak.",
        "- Code tidak ditemukan saat upload: dianggap baris ADD (item baru).",
        "- VO referensi di-reject oleh PPK: VO Anda tetap valid tapi hasilnya tidak match.",
        "  Sistem kasih warning di addendum modal saat bundle.",
    ]
    for i, line in enumerate(instr, start=2):
        ws2[f"A{i}"] = line
    ws2.column_dimensions["A"].width = 100

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def parse_snapshot(
    db: Session,
    contract_id: str,
    file_bytes: bytes,
    exclude_vo_id: Optional[str] = None,
) -> Dict:
    """
    Parse Excel hasil export. Return list VOItemInput dicts + warnings.

    Hasil dipakai client untuk replace items di form VO (per facility scope
    dari file). Tidak menyentuh DB.
    """
    rev = _active_revision(db, contract_id)
    if not rev:
        rev = (
            db.query(BOQRevision)
            .filter(BOQRevision.contract_id == contract_id)
            .order_by(BOQRevision.cco_number.desc())
            .first()
        )
    if not rev:
        raise ValueError("Kontrak belum punya revisi BOQ.")

    df = pd.read_excel(io.BytesIO(file_bytes), sheet_name=0, header=0, dtype=object)
    cols = [str(c).strip().lower() for c in df.columns]
    required = ["facility_code", "code", "vol_baru"]
    missing = [c for c in required if c not in cols]
    if missing:
        return {"items": [], "warnings": [], "errors": [f"Kolom wajib hilang: {', '.join(missing)}"]}

    # Index BOQItem per (facility_code, code)
    fac_index: Dict[str, Facility] = {}
    for fac, loc in (
        db.query(Facility, Location)
        .join(Location, Facility.location_id == Location.id)
        .filter(Location.contract_id == contract_id)
        .all()
    ):
        fac_index[fac.facility_code] = fac

    boq_index: Dict[Tuple[str, str], BOQItem] = {}
    for it in (
        db.query(BOQItem)
        .filter(
            BOQItem.boq_revision_id == rev.id,
            BOQItem.is_active == True,  # noqa: E712
        )
        .all()
    ):
        fac = next((f for f in fac_index.values() if str(f.id) == str(it.facility_id)), None)
        if fac and it.original_code:
            boq_index[(fac.facility_code, str(it.original_code).strip())] = it

    items_out: List[Dict] = []
    warnings: List[str] = []
    errors: List[str] = []
    facility_codes_in_file: set = set()

    for idx, row in df.iterrows():
        rec = {cols[i]: row.iloc[i] for i in range(len(cols))}
        fac_code = _safe_str(rec.get("facility_code"))
        code = _safe_str(rec.get("code"))
        if not fac_code:
            continue
        facility_codes_in_file.add(fac_code)

        fac = fac_index.get(fac_code)
        if not fac:
            errors.append(f"Baris {idx+2}: facility_code '{fac_code}' tidak ada di kontrak.")
            continue

        vol_baru_raw = rec.get("vol_baru")
        if vol_baru_raw is None or (isinstance(vol_baru_raw, str) and not vol_baru_raw.strip()):
            # Skip row tanpa vol_baru (mis. group row)
            continue
        try:
            vol_baru = float(vol_baru_raw)
        except (TypeError, ValueError):
            errors.append(f"Baris {idx+2}: vol_baru '{vol_baru_raw}' bukan angka.")
            continue
        if vol_baru < 0:
            errors.append(f"Baris {idx+2} ({fac_code}/{code}): vol_baru < 0 ditolak.")
            continue

        unit = _safe_str(rec.get("unit"))
        unit_price = _safe_float(rec.get("unit_price"))
        description = _safe_str(rec.get("description"))
        parent_code = _safe_str(rec.get("parent_code"))

        if not code:
            # ADD — item baru
            if vol_baru <= 0:
                continue  # skip empty add row
            if not description:
                errors.append(f"Baris {idx+2}: ADD perlu description.")
                continue
            if unit_price <= 0:
                errors.append(f"Baris {idx+2}: ADD perlu unit_price > 0.")
                continue
            # Parent lookup (kalau parent_code diisi)
            parent_boq_id = None
            if parent_code:
                parent_item = boq_index.get((fac_code, parent_code))
                if parent_item:
                    parent_boq_id = str(parent_item.id)
                else:
                    warnings.append(
                        f"Baris {idx+2}: parent_code '{parent_code}' tidak ditemukan di {fac_code}, "
                        f"item dibuat sebagai root."
                    )
            items_out.append({
                "action": "add",
                "facility_id": str(fac.id),
                "boq_item_id": None,
                "parent_boq_item_id": parent_boq_id,
                "description": description,
                "unit": unit,
                "volume_delta": vol_baru,
                "unit_price": unit_price,
            })
            continue

        # Existing item — INCREASE/DECREASE/REMOVE
        boq_item = boq_index.get((fac_code, code))
        if not boq_item:
            errors.append(f"Baris {idx+2}: code '{code}' tidak ditemukan di facility {fac_code}.")
            continue

        # Snapshot vol_efektif from Excel column (preferred) — fallback recompute
        vol_efektif_excel = _safe_float(rec.get("vol_efektif"))
        sum_vol_now, _, _ = _pending_for_item(db, boq_item.id, exclude_vo_id=exclude_vo_id)
        vol_awal = float(boq_item.volume or 0)
        vol_efektif_now = vol_awal + float(sum_vol_now)

        vol_efektif_used = vol_efektif_excel if vol_efektif_excel else vol_efektif_now
        if vol_efektif_excel and abs(vol_efektif_excel - vol_efektif_now) > 1e-6:
            warnings.append(
                f"Baris {idx+2} ({fac_code}/{code}): vol_efektif berubah sejak export "
                f"({vol_efektif_excel} → {vol_efektif_now}). Disarankan re-export."
            )

        delta = vol_baru - vol_efektif_used
        # Fix floating noise
        if abs(delta) < 1e-6:
            continue  # no change

        if vol_baru == 0 and vol_awal > 0:
            # REMOVE — delta = -vol_awal (kembalikan dari rev aktif)
            items_out.append({
                "action": "remove",
                "facility_id": str(boq_item.facility_id),
                "boq_item_id": str(boq_item.id),
                "description": boq_item.description,
                "unit": boq_item.unit,
                "volume_delta": -vol_awal,
                "unit_price": float(boq_item.unit_price or 0),
            })
        elif delta > 0:
            items_out.append({
                "action": "increase",
                "facility_id": str(boq_item.facility_id),
                "boq_item_id": str(boq_item.id),
                "description": boq_item.description,
                "unit": boq_item.unit,
                "volume_delta": delta,
                "unit_price": float(boq_item.unit_price or 0),
            })
        elif delta < 0:
            items_out.append({
                "action": "decrease",
                "facility_id": str(boq_item.facility_id),
                "boq_item_id": str(boq_item.id),
                "description": boq_item.description,
                "unit": boq_item.unit,
                "volume_delta": delta,
                "unit_price": float(boq_item.unit_price or 0),
            })

    return {
        "items": items_out,
        "warnings": warnings,
        "errors": errors,
        "facility_codes_in_file": sorted(facility_codes_in_file),
    }


def _safe_str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and pd.isna(v):
        return ""
    return str(v).strip()


def _safe_float(v) -> float:
    try:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return 0.0
        if isinstance(v, str) and not v.strip():
            return 0.0
        return float(v)
    except (TypeError, ValueError):
        return 0.0
