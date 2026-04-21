import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, Wallet, Activity, AlertTriangle, TrendingUp,
  CalendarX, MapPin, ChevronRight, CheckCircle,
} from "lucide-react";
import { analyticsAPI, notificationsAPI } from "@/api";
import {
  PageHeader, PageLoader, StatCard, SearchInput, Empty,
} from "@/components/ui";
import {
  fmtCurrency, fmtPct, deviationBadge, contractStatusBadge,
} from "@/utils/format";

const STATUS_LABEL = {
  draft: "Draft", active: "Aktif", addendum: "Addendum",
  on_hold: "Ditahan", completed: "Selesai", terminated: "Diputus",
};

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
    <div className="p-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Dashboard"
        description="Ringkasan kondisi seluruh kontrak secara real-time"
      />

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Total Kontrak"
            value={stats.total_contracts}
            sub={`${stats.total_locations} lokasi · ${stats.total_facilities} fasilitas`}
            icon={Building2}
          />
          <StatCard
            label="Nilai Kontrak"
            value={fmtCurrency(stats.total_value)}
            sub="Akumulasi semua kontrak"
            icon={Wallet}
            iconBg="bg-emerald-50"
          />
          <StatCard
            label="Progress Rata-rata"
            value={fmtPct(stats.avg_progress)}
            sub={`${stats.contracts_on_track} on-track · ${stats.contracts_warning} waspada`}
            icon={Activity}
            iconBg="bg-brand-50"
          />
          <StatCard
            label="Early Warning"
            value={stats.active_warnings}
            sub={`${stats.contracts_critical} kritis · ${stats.missing_daily_reports + stats.missing_weekly_reports} lap. telat`}
            icon={AlertTriangle}
            iconBg="bg-red-50"
            subColor={stats.active_warnings > 0 ? "text-red-600" : undefined}
          />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Contracts Table */}
        <div className="xl:col-span-3 card">
          <div className="px-5 py-4 border-b border-ink-200 flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-sm font-display font-semibold text-ink-800">
              Daftar Kontrak
            </h2>
            <div className="flex items-center gap-2">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="input py-1.5 text-xs w-auto"
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
                    <th className="table-th">Kontrak</th>
                    <th className="table-th">Lokasi</th>
                    <th className="table-th">Progress</th>
                    <th className="table-th">Deviasi</th>
                    <th className="table-th">SPI</th>
                    <th className="table-th">Minggu</th>
                    <th className="table-th">Status</th>
                    <th className="table-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/contracts/${c.id}`)}
                      className="hover:bg-brand-50/40 cursor-pointer transition"
                    >
                      <td className="table-td max-w-xs">
                        <p className="font-medium text-ink-900 truncate">
                          {c.contract_name}
                        </p>
                        <p className="text-xs text-ink-500 font-mono truncate">
                          {c.contract_number}
                        </p>
                        <p className="text-xs text-ink-400 truncate">
                          {c.company_name}
                        </p>
                      </td>
                      <td className="table-td">
                        <span className="flex items-center gap-1 text-xs">
                          <MapPin size={11} className="text-ink-400" />
                          {c.location_count}
                        </span>
                        <span className="text-xs text-ink-400">
                          {c.city || "—"}
                        </span>
                      </td>
                      <td className="table-td">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-[60px] h-1.5 bg-ink-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-brand-500 rounded-full"
                              style={{
                                width: `${Math.min(c.actual_cumulative, 100)}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs font-medium text-ink-700 whitespace-nowrap">
                            {fmtPct(c.actual_cumulative, 1)}
                          </span>
                        </div>
                        <p className="text-[10px] text-ink-400 mt-1">
                          Rencana: {fmtPct(c.planned_cumulative, 1)}
                        </p>
                      </td>
                      <td className="table-td">
                        <span className={deviationBadge(c.deviation_status)}>
                          {c.deviation > 0 ? "+" : ""}
                          {fmtPct(c.deviation, 2)}
                        </span>
                      </td>
                      <td className="table-td text-xs font-mono">
                        {c.spi ? c.spi.toFixed(2) : "—"}
                      </td>
                      <td className="table-td text-xs">
                        M-{c.current_week}/{c.total_weeks}
                        {c.has_active_warning && (
                          <AlertTriangle size={11} className="inline ml-1 text-red-500" />
                        )}
                      </td>
                      <td className="table-td">
                        <span className={contractStatusBadge(c.status)}>
                          {STATUS_LABEL[c.status] || c.status}
                        </span>
                      </td>
                      <td className="table-td">
                        <ChevronRight size={14} className="text-ink-300" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Warnings panel */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-ink-200 flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-ink-800 flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-500" /> Early Warning
            </h2>
            <button
              onClick={() => navigate("/warnings")}
              className="text-xs text-brand-600 hover:underline"
            >
              Semua
            </button>
          </div>
          <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto">
            {warnings.length === 0 ? (
              <div className="text-center py-10">
                <CheckCircle size={26} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-xs text-ink-500">Tidak ada peringatan</p>
              </div>
            ) : (
              warnings.slice(0, 10).map((w) => (
                <div
                  key={w.id}
                  onClick={() => navigate(`/contracts/${w.contract_id}`)}
                  className={`p-3 rounded-lg border text-xs cursor-pointer hover:-translate-y-0.5 transition ${
                    w.severity === "critical"
                      ? "bg-red-50 border-red-200"
                      : "bg-amber-50 border-amber-200"
                  }`}
                >
                  <p
                    className={`font-semibold mb-1 font-mono ${
                      w.severity === "critical"
                        ? "text-red-700"
                        : "text-amber-700"
                    }`}
                  >
                    {w.contract_number}
                  </p>
                  <p className="text-ink-700 leading-snug">{w.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
