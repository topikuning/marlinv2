export function fmtCurrency(val, short = true) {
  const n = Number(val || 0);
  if (short && Math.abs(n) >= 1e9)
    return "Rp " + (n / 1e9).toFixed(2) + " M";
  if (short && Math.abs(n) >= 1e6)
    return "Rp " + (n / 1e6).toFixed(1) + " Jt";
  return "Rp " + n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

export function fmtPct(val, decimals = 1) {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return Number(val).toFixed(decimals) + "%";
}

export function fmtDate(d) {
  if (!d) return "—";
  try {
    const dt = typeof d === "string" ? new Date(d) : d;
    return dt.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(d);
  }
}

export function fmtNum(n, dec = 0) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("id-ID", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

/**
 * fmtVolume — format volume konsisten dengan aturan presisi sistem 5 dp.
 * Smart decimal: trailing zeros dipotong supaya "10" tidak tampil "10,00000".
 * Tapi tetap presisi up to 5 digit kalau ada fraction.
 *   10        → "10"
 *   10.5      → "10,5"
 *   10.55     → "10,55"
 *   10.55555  → "10,55555"
 *   10.555555 → "10,55556"  (rounded to 5 decimals)
 */
export function fmtVolume(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 5,
  });
}

export function contractStatusBadge(status) {
  const map = {
    draft: "badge-gray",
    active: "badge-blue",
    addendum: "badge-yellow",
    on_hold: "badge-yellow",
    completed: "badge-green",
    terminated: "badge-red",
  };
  return map[status] || "badge-gray";
}

export function deviationBadge(status) {
  const map = {
    fast: "badge-green",
    normal: "badge-green",
    warning: "badge-yellow",
    critical: "badge-red",
  };
  return map[status] || "badge-gray";
}

export function assetUrl(path) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = import.meta.env.VITE_ASSET_URL || "/uploads";
  return `${base}/${path}`;
}

export function parseApiError(err) {
  const detail = err?.response?.data?.detail;

  // Plain string detail (most common FastAPI HTTPException)
  if (typeof detail === "string") return detail;

  // Validation errors from Pydantic — array of {loc, msg, type}
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (typeof d === "string") return d;
        // Pretty-print validation errors: "body.page_size: less than or equal to 200"
        const loc = Array.isArray(d.loc) ? d.loc.filter(Boolean).join(".") : "";
        const msg = d.msg || d.type || JSON.stringify(d);
        return loc ? `${loc}: ${msg}` : msg;
      })
      .join(", ");
  }

  // Structured error: {message, code, ...extras} — used by BOQ write-guard,
  // contract activation errors, etc. Return the human-readable message.
  if (detail && typeof detail === "object") {
    if (typeof detail.message === "string") return detail.message;
    // Matrix editor error shape
    if (detail.rejected_fields) {
      return `Field tidak bisa diubah: ${detail.rejected_fields.join(", ")}`;
    }
    // Last resort for unexpected dict shape
    return JSON.stringify(detail);
  }

  // Network / no-response errors
  if (err?.code === "ERR_NETWORK") return "Gagal terhubung ke server.";

  return err?.response?.statusText || err?.message || "Terjadi kesalahan";
}
