import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { contractsAPI, analyticsAPI } from "@/api";
import { PageHeader, PageLoader, Empty } from "@/components/ui";
import { fmtPct } from "@/utils/format";

export default function ScurvePage() {
  const [params] = useSearchParams();
  const [contracts, setContracts] = useState([]);
  const [selected, setSelected] = useState(params.get("contract") || "");
  const [scurve, setScurve] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    contractsAPI.list({ page_size: 500 }).then(({ data }) => setContracts(data.items || []));
  }, []);

  useEffect(() => {
    if (!selected) return setScurve(null);
    setLoading(true);
    analyticsAPI.scurve(selected).then(({ data }) => setScurve(data)).finally(() => setLoading(false));
  }, [selected]);

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Kurva S"
        description="Grafik Rencana vs Realisasi + Deviasi"
      />
      <div className="card p-4 mb-6">
        <label className="label">Pilih Kontrak</label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="select max-w-2xl"
        >
          <option value="">-- Pilih kontrak --</option>
          {contracts.map((c) => (
            <option key={c.id} value={c.id}>
              [{c.contract_number}] {c.contract_name}
            </option>
          ))}
        </select>
      </div>

      {!selected ? (
        <Empty icon={TrendingUp} title="Pilih kontrak untuk melihat Kurva S" />
      ) : loading ? (
        <PageLoader />
      ) : scurve ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="card p-4">
              <p className="text-xs text-ink-500">Minggu</p>
              <p className="text-lg font-display font-semibold">
                {scurve.current_week} / {scurve.total_weeks}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-ink-500">Rencana</p>
              <p className="text-lg font-display font-semibold">
                {fmtPct(scurve.latest_planned, 2)}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-ink-500">Aktual</p>
              <p className="text-lg font-display font-semibold text-brand-700">
                {fmtPct(scurve.latest_actual, 2)}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-ink-500">Deviasi</p>
              <p
                className={`text-lg font-display font-semibold ${
                  scurve.latest_deviation < -5
                    ? "text-red-600"
                    : scurve.latest_deviation < 0
                    ? "text-amber-600"
                    : "text-emerald-600"
                }`}
              >
                {scurve.latest_deviation > 0 ? "+" : ""}
                {fmtPct(scurve.latest_deviation, 2)}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-ink-500">Prediksi Selesai</p>
              <p className="text-lg font-display font-semibold">
                {scurve.forecast_completion_week
                  ? `M-${scurve.forecast_completion_week}`
                  : "Sesuai rencana"}
              </p>
              {scurve.forecast_delay_days > 0 && (
                <p className="text-xs text-red-600 mt-1">
                  +{scurve.forecast_delay_days} hari telat
                </p>
              )}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-display font-semibold text-ink-800 mb-3">
              {scurve.contract_name}
            </h3>
            <div style={{ height: 460 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={scurve.points} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="week"
                    tickFormatter={(v) => `M${v}`}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                  />
                  <YAxis
                    yAxisId="left"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[-20, 20]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                  />
                  <Tooltip
                    formatter={(v) =>
                      v === null || v === undefined ? "—" : `${Number(v).toFixed(2)}%`
                    }
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 10,
                      border: "1px solid #e5e7eb",
                    }}
                    labelFormatter={(v) => `Minggu ke-${v}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    yAxisId="right"
                    dataKey="deviation"
                    name="Deviasi"
                    fill="#3672fb"
                    opacity={0.25}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="planned_cumulative"
                    name="Rencana"
                    stroke="#1e50ef"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="actual_cumulative"
                    name="Aktual"
                    stroke="#059669"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  {scurve.addendum_weeks?.map((w) => (
                    <ReferenceLine
                      key={w}
                      x={w}
                      yAxisId="left"
                      stroke="#f59e0b"
                      strokeDasharray="3 3"
                      label={{ value: "Addendum", fontSize: 10, fill: "#d97706" }}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
