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
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((d) => d.msg || JSON.stringify(d)).join(", ");
  return err?.message || "Terjadi kesalahan";
}
