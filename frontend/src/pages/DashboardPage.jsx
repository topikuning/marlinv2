import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, Wallet, Activity, AlertTriangle,
  MapPin, ChevronRight, CheckCircle,
} from "lucide-react";
import { analyticsAPI, notificationsAPI } from "@/api";
import {
  PageHeader, PageLoader, GlassCard, GlassStatCard, SearchInput, Empty,
} from "@/components/ui";
import { fmtCurrency, fmtPct } from "@/utils/format";

const STATUS_LABEL = {
  draft: "Draft", active: "Aktif", addendum: "Addendum",
  on_hold: "Ditahan", completed: "Selesai", terminated: "Diputus",
};

// Status badge color (token-aware) — pakai inline style supaya bekerja di
// light & dark mode tanpa hardcode tailwind colors.
const STATUS_BG = {
  active:    "rgba(91,139,255,0.15)",
  addendum:  "rgba(251,191,36,0.16)",
  on_hold:   "rgba(248,113,113,0.14)",
  completed: "rgba(52,211,153,0.16)",
  terminated:"rgba(148,163,184,0.18)",
  draft:     "rgba(148,163,184,0.18)",
};
const STATUS_TEXT = {
  active: "#5b8bff", addendum: "#fbbf24", on_hold: "#f87171",
  completed: "#34d399", terminated: "#94a3b8", draft: "#94a3b8",
};

// Deviation color helper
function deviationColor(d) {
  if (d == null) return "var(--c-text-2)";
  if (d >= -3) return "#34d399";
  if (d >= -8) return "#fbbf24";
  return "#f87171";
}

// Tiny helper components — token-aware progress bar + table cells
function ProgressBar({ value, color }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div
      className="h-1.5 rounded-full overflow-hidden"
      style={{ background: "var(--c-progress-track)" }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{
          width: `${pct}%`,
          background: color || "#5b8bff",
        }}
      />
    </div>
  );
}

function StatusBadge({ status }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{
        background: STATUS_BG[status] || STATUS_BG.draft,
        color: STATUS_TEXT[status] || STATUS_TEXT.draft,
      }}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const [{ data: s }, { data: cs }, { data: ws }] = await Promise.all([
          analyticsAPI.dashboard(),
          analyticsAPI.contractsSummary(),
          notificationsAPI.warnings({ resolved: false }),
        ]);
        setStats(s);
        setContracts(cs.items || []);
        setWarnings(ws.items || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return contracts.filter((c) => {
      if (search) {
        const s = search.toLowerCase();
        if (
          !c.contract_number.toLowerCase().includes(s) &&
          !c.contract_name.toLowerCase().includes(s) &&
          !(c.company_name || "").toLowerCase().includes(s)
        ) return false;
      }
      if (filterStatus === "on_track" && !(c.deviation >= -5)) return false;
      if (filterStatus === "warning" && !(c.deviation < -5)) return false;
      if (filterStatus === "completed" && c.status !== "completed") return false;
      return true;
    });
  }, [contracts, search, filterStatus]);

  if (loading) return <PageLoader />;

  return (
    <div className="p-7 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Dashboard"
        description="Ringkasan kondisi seluruh kontrak secara real-time"
      />

      {/* Stat cards — glass + accent icon box */}
      {stats && (
        <div
          className="grid gap-4 mb-7"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}
        >
          <GlassStatCard
            label="Total Kontrak"
            value={stats.total_contracts}
            sub={`${stats.total_locations} lokasi · ${stats.total_facilities} fasilitas`}
            icon={Building2}
            accent="#5b8bff"
          />
          <GlassStatCard
            label="Total Nilai"
            value={fmtCurrency(stats.total_value)}
            sub="Akumulasi semua kontrak"
            icon={Wallet}
            accent="#34d399"
          />
          <GlassStatCard
            label="Progress Rata-rata"
            value={fmtPct(stats.avg_progress)}
            sub={`${stats.contracts_on_track} on-track · ${stats.contracts_warning} waspada`}
            icon={Activity}
            accent="#22d3ee"
          />
          <GlassStatCard
            label="Early Warning"
            value={stats.active_warnings}
            sub={`${stats.contracts_critical} kritis · ${stats.missing_daily_reports + stats.missing_weekly_reports} lap. telat`}
            icon={AlertTriangle}
            accent="#f87171"
            subColor={stats.active_warnings > 0 ? "#f87171" : undefined}
          />
        </div>
      )}

      {/* Main grid: contracts table (3-col) + warnings panel (1-col) */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5 items-start">
        {/* Contracts Table */}
        <GlassCard className="xl:col-span-3 overflow-hidden">
          <div
            className="px-5 py-4 flex items-center justify-between flex-wrap gap-3"
            style={{ borderBottom: "1px solid var(--c-divider)" }}
          >
            <h2
              className="font-display"
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: "var(--c-text-1)",
              }}
            >
              Daftar Kontrak
            </h2>
            <div className="flex items-center gap-2">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="text-xs rounded-lg outline-none cursor-pointer transition-colors"
                style={{
                  background: "var(--c-input-bg)",
                  border: "1px solid var(--c-border)",
                  color: "var(--c-text-2)",
                  padding: "6px 10px",
                }}
              >
                <option value="all">Semua Status</option>
                <option value="on_track">On Track</option>
                <option value="warning">Waspada / Kritis</option>
                <option value="completed">Selesai</option>
              </select>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Cari kontrak, perusahaan..."
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <Empty
              icon={Building2}
              title="Belum ada kontrak"
              description="Tambahkan kontrak baru lewat menu Kontrak"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    {["Kontrak", "Lokasi", "Progress", "Deviasi", "SPI", "Minggu", "Status", ""].map((h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-3 uppercase tracking-wider"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "var(--c-text-3)",
                          letterSpacing: "0.08em",
                          borderBottom: "1px solid var(--c-divider)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/contracts/${c.id}`)}
                      className="cursor-pointer transition-colors"
                      style={{ borderBottom: "1px solid var(--c-divider-lite)" }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "var(--c-row-hover)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                    >
                      <td className="px-4 py-3 max-w-xs">
                        <p
                          className="truncate"
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "var(--c-text-1)",
                          }}
                        >
                          {c.contract_name}
                        </p>
                        <p
                          className="truncate font-mono mt-0.5"
                          style={{ fontSize: 10, color: "var(--c-text-3)" }}
                        >
                          {c.contract_number}
                        </p>
                        <p
                          className="truncate mt-0.5"
                          style={{ fontSize: 11, color: "var(--c-text-2)" }}
                        >
                          {c.company_name}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="flex items-center gap-1"
                          style={{ fontSize: 12, color: "var(--c-text-2)" }}
                        >
                          <MapPin size={11} style={{ color: "var(--c-text-3)" }} />
                          {c.location_count}
                        </span>
                        <span
                          className="block mt-0.5"
                          style={{ fontSize: 10, color: "var(--c-text-3)" }}
                        >
                          {c.city || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 min-w-[140px]">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: "var(--c-text-1)",
                              minWidth: 38,
                            }}
                          >
                            {fmtPct(c.actual_cumulative, 1)}
                          </span>
                          <span style={{ fontSize: 10, color: "var(--c-text-3)" }}>
                            / {fmtPct(c.planned_cumulative, 1)}
                          </span>
                        </div>
                        <ProgressBar
                          value={c.actual_cumulative}
                          color={
                            c.actual_cumulative >= 70
                              ? "#34d399"
                              : c.actual_cumulative >= 40
                              ? "#5b8bff"
                              : "#fbbf24"
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: deviationColor(c.deviation),
                          }}
                        >
                          {c.deviation > 0 ? "+" : ""}
                          {fmtPct(c.deviation, 2)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="font-mono"
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: c.spi >= 1
                              ? "#34d399"
                              : c.spi >= 0.9
                              ? "#fbbf24"
                              : "#f87171",
                          }}
                        >
                          {c.spi ? c.spi.toFixed(2) : "—"}
                        </span>
                      </td>
                      <td
                        className="px-4 py-3"
                        style={{ fontSize: 12, color: "var(--c-text-2)" }}
                      >
                        M-{c.current_week}/{c.total_weeks}
                        {c.has_active_warning && (
                          <AlertTriangle
                            size={11}
                            className="inline ml-1"
                            style={{ color: "#f87171" }}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight size={14} style={{ color: "var(--c-text-3)" }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>

        {/* Warnings panel */}
        <GlassCard className="overflow-hidden">
          <div
            className="px-5 py-4 flex items-center justify-between"
            style={{ borderBottom: "1px solid var(--c-divider)" }}
          >
            <h2
              className="flex items-center gap-2"
              style={{
                fontFamily: "Lexend, sans-serif",
                fontWeight: 700,
                fontSize: 14,
                color: "var(--c-text-1)",
              }}
            >
              <AlertTriangle size={14} style={{ color: "#f87171" }} />
              Early Warning
            </h2>
            <button
              onClick={() => navigate("/warnings")}
              className="text-xs hover:underline"
              style={{ color: "#5b8bff" }}
            >
              Semua
            </button>
          </div>
          <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto">
            {warnings.length === 0 ? (
              <div className="text-center py-10">
                <CheckCircle
                  size={26}
                  className="mx-auto mb-2"
                  style={{ color: "#34d399" }}
                />
                <p className="text-xs" style={{ color: "var(--c-text-2)" }}>
                  Tidak ada peringatan
                </p>
              </div>
            ) : (
              warnings.slice(0, 10).map((w) => {
                const critical = w.severity === "critical";
                return (
                  <div
                    key={w.id}
                    onClick={() => navigate(`/contracts/${w.contract_id}`)}
                    className="px-3 py-2.5 rounded-[10px] cursor-pointer transition-opacity"
                    style={{
                      background: critical
                        ? "rgba(248,113,113,0.07)"
                        : "rgba(251,191,36,0.06)",
                      border: critical
                        ? "1px solid rgba(248,113,113,0.2)"
                        : "1px solid rgba(251,191,36,0.15)",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.75")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
                  >
                    <p
                      className="font-mono mb-1"
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: critical ? "#f87171" : "#fbbf24",
                      }}
                    >
                      {w.contract_number}
                    </p>
                    <p
                      className="leading-snug"
                      style={{ fontSize: 12, color: "var(--c-text-2)" }}
                    >
                      {w.message}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
