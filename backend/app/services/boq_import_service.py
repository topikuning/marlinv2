"""
BOQ Excel import service.

Handles two formats:
A) SINGLE-SHEET SIMPLE TEMPLATE (our downloadable template):
    columns: level, code, description, unit, volume, unit_price, total_price,
             planned_start_week, planned_duration_weeks, facility_code

B) MULTI-SHEET ENGINEER FORMAT (like BOQ_AMPEAN_KOTA_MATARAM):
    - first sheet (REKAP / Sub Resume EE) lists facility groups
    - one sheet per facility, named like "6.Gudang Beku" or "6. EE Gd Beku Prtble"
    - inside each facility sheet:
        header row: No. | Jenis Pekerjaan |  | Volume | Satuan | Harga Satuan | Jumlah Harga
        items mix of: group rows (only description) and leaf rows (with volume+price)
"""
import re
import pandas as pd
import numpy as np
import openpyxl
from typing import List, Dict, Any, Optional, Tuple
from decimal import Decimal


FACILITY_KEYWORDS = [
    "persiapan", "revetmen", "tambat", "turap", "pendaratan", "gudang beku",
    "pabrik es", "parkir", "cool box", "kios", "bengkel", "kantor", "toilet",
    "tangki", "penerangan", "tps", "genset", "jalan", "saluran", "gapura",
    "pos jaga", "leveling", "levelling", "pagar", "docking", "shelter",
    "balai", "pasar ikan", "ipal", "dpt",
]


def _safe_num(val) -> float:
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        if np.isnan(val):
            return 0.0
        return float(val)
    try:
        s = str(val).strip().replace(",", ".")
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def _safe_str(val) -> str:
    if val is None:
        return ""
    if isinstance(val, float) and np.isnan(val):
        return ""
    return str(val).strip()


def detect_format(filepath: str) -> str:
    """Return 'simple' or 'engineer'."""
    try:
        wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
        sheets = wb.sheetnames
        wb.close()
    except Exception:
        return "engineer"

    if len(sheets) == 1:
        return "simple"

    for s in sheets:
        low = s.lower()
        if any(k in low for k in FACILITY_KEYWORDS) or re.match(r"^\d+\.", s):
            return "engineer"
    return "simple"


# ─────────────────────────────────────────────────────────────────────────────
# FORMAT A — Simple template
# ─────────────────────────────────────────────────────────────────────────────

SIMPLE_TEMPLATE_COLUMNS = [
    "facility_code", "facility_name",
    "level", "code", "parent_code",
    "description", "unit",
    "volume", "unit_price", "total_price",
    "planned_start_week", "planned_duration_weeks",
]


def parse_simple_template(filepath: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "success": False,
        "facilities": [],
        "warnings": [],
        "errors": [],
    }
    try:
        df = pd.read_excel(filepath, sheet_name=0, header=0, dtype=object)
    except Exception as e:
        result["errors"].append(f"Tidak bisa membaca file: {e}")
        return result

    cols_lower = [str(c).strip().lower() for c in df.columns]
    missing = [c for c in ["facility_code", "description", "volume"] if c not in cols_lower]
    if missing:
        result["errors"].append(f"Kolom wajib tidak ada: {', '.join(missing)}")
        return result

    # group items by facility_code
    by_fac: Dict[str, Dict[str, Any]] = {}
    for _, row in df.iterrows():
        rec = {cols_lower[i]: row.iloc[i] for i in range(len(cols_lower))}
        fac_code = _safe_str(rec.get("facility_code"))
        desc = _safe_str(rec.get("description"))
        if not fac_code or not desc:
            continue
        if fac_code not in by_fac:
            by_fac[fac_code] = {
                "facility_code": fac_code,
                "facility_name": _safe_str(rec.get("facility_name")) or fac_code,
                "items": [],
            }
        by_fac[fac_code]["items"].append({
            "level": int(_safe_num(rec.get("level")) or 0),
            "original_code": _safe_str(rec.get("code")),
            "parent_code": _safe_str(rec.get("parent_code")),
            "description": desc,
            "unit": _safe_str(rec.get("unit")),
            "volume": _safe_num(rec.get("volume")),
            "unit_price": _safe_num(rec.get("unit_price")),
            "total_price": _safe_num(rec.get("total_price")),
            "planned_start_week": int(_safe_num(rec.get("planned_start_week")) or 0) or None,
            "planned_duration_weeks": int(_safe_num(rec.get("planned_duration_weeks")) or 0) or None,
        })

    result["facilities"] = list(by_fac.values())
    result["success"] = bool(by_fac) and not result["errors"]
    return result


# ─────────────────────────────────────────────────────────────────────────────
# FORMAT B — Engineer multi-sheet
# ─────────────────────────────────────────────────────────────────────────────

def _classify_code(code: str) -> Tuple[int, bool]:
    """Return (level, is_numeric). Level: 0=group, 1=letter (A/B), 2=number (1/2), 3=small-letter (a/b)."""
    code = code.strip()
    if not code:
        return (0, False)
    if re.match(r"^[A-Z]$", code):
        return (1, False)
    if re.match(r"^\d+$", code):
        return (2, True)
    if re.match(r"^[a-z]$", code):
        return (3, False)
    if re.match(r"^\d+\.\d+", code):
        return (2, True)
    return (0, False)


def _detect_header_row(df: pd.DataFrame) -> Optional[int]:
    """Find the row containing 'No' + 'Volume' + 'Satuan' / 'Harga'."""
    for i, row in df.iterrows():
        vals = " | ".join(_safe_str(c).lower() for c in row.values)
        if ("volume" in vals or "vol" in vals) and ("satuan" in vals or "unit" in vals) and ("harga" in vals):
            return i
        if "no" in vals and "jenis pekerjaan" in vals:
            return i
    return None


def _parse_facility_sheet(sheet_name: str, df: pd.DataFrame) -> Optional[Dict[str, Any]]:
    """Parse a single facility sheet and return facility dict with items list."""
    if df is None or df.empty:
        return None

    hdr_idx = _detect_header_row(df)
    if hdr_idx is None:
        return None

    # pick column positions by header content
    header = [_safe_str(c).lower() for c in df.iloc[hdr_idx].values]
    col_map = {"no": None, "desc": None, "volume": None, "unit": None, "unit_price": None, "total": None}
    for i, h in enumerate(header):
        if col_map["no"] is None and h in ("no", "no.", "nomor"):
            col_map["no"] = i
        elif col_map["desc"] is None and ("jenis pekerjaan" in h or "uraian" in h or "description" in h):
            col_map["desc"] = i
        elif col_map["volume"] is None and h in ("volume", "vol"):
            col_map["volume"] = i
        elif col_map["unit"] is None and h in ("satuan", "unit"):
            col_map["unit"] = i
        elif col_map["unit_price"] is None and ("harga satuan" in h or "unit price" in h):
            col_map["unit_price"] = i
        elif col_map["total"] is None and ("jumlah harga" in h or "jumlah" in h or "total" in h):
            col_map["total"] = i

    # fallback positional defaults based on observed format
    col_map["no"] = col_map["no"] if col_map["no"] is not None else 0
    col_map["desc"] = col_map["desc"] if col_map["desc"] is not None else 1
    col_map["volume"] = col_map["volume"] if col_map["volume"] is not None else 4
    col_map["unit"] = col_map["unit"] if col_map["unit"] is not None else 5
    col_map["unit_price"] = col_map["unit_price"] if col_map["unit_price"] is not None else 6
    col_map["total"] = col_map["total"] if col_map["total"] is not None else 7

    items: List[Dict[str, Any]] = []
    facility_name = re.sub(r"^\d+[\.\s]+(EE\s+)?", "", sheet_name).strip() or sheet_name

    for i in range(hdr_idx + 1, len(df)):
        row = df.iloc[i]
        code = _safe_str(row.iloc[col_map["no"]])
        desc = _safe_str(row.iloc[col_map["desc"]])
        if not code and not desc:
            continue

        level, _ = _classify_code(code)
        volume = _safe_num(row.iloc[col_map["volume"]])
        unit = _safe_str(row.iloc[col_map["unit"]])
        unit_price = _safe_num(row.iloc[col_map["unit_price"]])
        total_price = _safe_num(row.iloc[col_map["total"]])

        is_leaf = volume > 0 or total_price > 0

        items.append({
            "level": level,
            "original_code": code,
            "parent_code": "",  # FORMAT B inherit dari level-stack saja
            "description": desc or f"(tanpa deskripsi, baris {i+1})",
            "unit": unit,
            "volume": volume,
            "unit_price": unit_price,
            "total_price": total_price,
            "is_leaf": is_leaf,
            "row_index": i,
        })

    # trim trailing empty / subtotal rows (no desc)
    while items and not items[-1]["description"].strip():
        items.pop()

    if not items:
        return None

    total_value = sum(it["total_price"] for it in items if it["is_leaf"])

    # derive facility_code from sheet name
    m = re.match(r"^(\d+)", sheet_name)
    fac_code = sheet_name if not m else f"FAC-{m.group(1).zfill(2)}"

    return {
        "facility_code": fac_code,
        "facility_name": facility_name,
        "sheet_name": sheet_name,
        "total_value": total_value,
        "items": items,
    }


def parse_engineer_format(filepath: str) -> Dict[str, Any]:
    """Walk every sheet; keep ones that look like a facility BOQ."""
    result: Dict[str, Any] = {
        "success": False,
        "facilities": [],
        "warnings": [],
        "errors": [],
    }
    try:
        all_sheets = pd.read_excel(filepath, sheet_name=None, header=None)
    except Exception as e:
        result["errors"].append(f"Tidak bisa membaca file: {e}")
        return result

    for sheet_name, df in all_sheets.items():
        low = sheet_name.lower()
        # skip known non-BOQ sheets
        if any(kw in low for kw in ["analisa", "resume", "rekap", "bahan", "rab", "sheet1", "cover"]):
            if "ee " not in low and not re.match(r"^\d+\.\s*ee\b", low) and not re.match(r"^\d+\.", sheet_name):
                continue
        fac = _parse_facility_sheet(sheet_name, df)
        if fac and fac["items"]:
            result["facilities"].append(fac)

    if not result["facilities"]:
        result["errors"].append("Tidak ada sheet fasilitas yang bisa diparse. Pastikan format sesuai.")
    else:
        result["success"] = True
        result["warnings"].append(
            f"Berhasil mendeteksi {len(result['facilities'])} fasilitas"
        )
    return result


def parse_boq_file(filepath: str, fmt: Optional[str] = None) -> Dict[str, Any]:
    fmt = fmt or detect_format(filepath)
    if fmt == "simple":
        return parse_simple_template(filepath)
    return parse_engineer_format(filepath)
