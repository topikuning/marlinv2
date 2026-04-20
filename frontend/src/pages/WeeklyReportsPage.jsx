import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Plus, FileSpreadsheet, Calendar, TrendingUp, TrendingDown, ChevronRight, Download,
} from "lucide-react";
import {
  contractsAPI, weeklyAPI, downloadBlob,
} from "../api";
import {
  PageHeader, PageLoader, Modal, Empty, Spinner,
} from "../components/ui";
import {
  fmtPct, fmtDate, deviationBadge, parseApiError,
} from "../utils/format";

export default function WeeklyReportsPage() {
  const [contracts, setContracts] = useState([]);
  const [selected, setSelected] = useState("");
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    contractsAPI.list({ page_size: 500 }).then(({ data }) =>
      setContracts(data.items || [])
    );
  }, []);

  useEffect(() => {
    if (!selected) return setReports([]);
    setLoading(true);
    weeklyAPI
      .listByContract(selected)
      .then(({ data }) => setReports(data.items || []))
      .finally(() => setLoading(false));
  }, [selected]);

  const contract = contracts.find((c) => c.id === selected);

  async function downloadTemplate() {
    try {
      const { data } = await weeklyAPI.template(selected);
      downloadBlob(data, `template_progress_${contract.contract_number}.xlsx`);
    } catch (e) {
      toast.error(parseApiError(e));
    }
  }

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Laporan Mingguan"
        description="Input dan review laporan progres mingguan per kontrak"
        actions={
          selected && (
            <>
              <button className="btn-secondary" onClick={downloadTemplate}>
                <Download size={14} /> Template Excel
              </button>
              <button
                className="btn-primary"
                onClick={() => setShowCreate(true)}
              >
                <Plus size={14} /> Input Minggu Baru
              </button>
            </>
          )
        }
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
        <Empty
          icon={Calendar}
          title="Pilih kontrak terlebih dahulu"
          description="Pilih kontrak untuk melihat daftar laporan mingguan"
        />
      ) : loading ? (
        <PageLoader />
      ) : reports.length === 0 ? (
        <Empty
          icon={FileSpreadsheet}
          title="Belum ada laporan"
          description="Input laporan pertama untuk minggu ke-1"
          action={
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> Input Minggu Baru
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-ink-200">
            <h2 className="text-sm font-display font-semibold text-ink-800">
              {reports.length} Laporan
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-th">Minggu</th>
                  <th className="table-th">Periode</th>
                  <th className="table-th">Rencana</th>
                  <th className="table-th">Aktual</th>
                  <th className="table-th">Deviasi</th>
                  <th className="table-th">SPI</th>
                  <th className="table-th">Oleh</th>
                  <th className="table-th"></th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/reports/weekly/${r.id}`)}
                    className="hover:bg-brand-50/40 cursor-pointer"
                  >
                    <td className="table-td font-semibold text-ink-900">
                      M-{r.week_number}
                    </td>
                    <td className="table-td text-xs">
                      {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                    </td>
                    <td className="table-td">
                      {fmtPct(r.planned_cumulative_pct * 100, 2)}
                    </td>
                    <td className="table-td font-medium">
                      {fmtPct(r.actual_cumulative_pct * 100, 2)}
                    </td>
                    <td className="table-td">
                      <span className={deviationBadge(r.deviation_status)}>
                        {r.deviation_pct > 0 ? (
                          <TrendingUp size={10} />
                        ) : (
                          <TrendingDown size={10} />
                        )}
                        {fmtPct(r.deviation_pct * 100, 2)}
                      </span>
                    </td>
                    <td className="table-td font-mono text-xs">
                      {r.spi ? Number(r.spi).toFixed(3) : "—"}
                    </td>
                    <td className="table-td text-xs text-ink-500">
                      {r.submitted_by || "—"}
                    </td>
                    <td className="table-td">
                      <ChevronRight size={14} className="text-ink-300" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateWeeklyModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        contract={contract}
        onSuccess={(id) => {
          setShowCreate(false);
          navigate(`/reports/weekly/${id}`);
        }}
      />
    </div>
  );
}

function CreateWeeklyModal({ open, onClose, contract, onSuccess }) {
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && contract) {
      // default to next week number
      weeklyAPI.listByContract(contract.id).then(({ data }) => {
        const next = ((data.items || []).reduce((m, r) => Math.max(m, r.week_number), 0) || 0) + 1;
        const start = new Date(contract.start_date);
        const ps = new Date(start);
        ps.setDate(start.getDate() + (next - 1) * 7);
        const pe = new Date(ps);
        pe.setDate(ps.getDate() + 6);
        setForm({
          week_number: next,
          period_start: ps.toISOString().slice(0, 10),
          period_end: pe.toISOString().slice(0, 10),
          planned_cumulative_pct: 0,
          manpower_count: 0,
          rain_days: 0,
          obstacles: "",
          solutions: "",
        });
      });
    }
  }, [open, contract]);

  const submit = async () => {
    setLoading(true);
    try {
      const { data } = await weeklyAPI.create(contract.id, {
        ...form,
        week_number: parseInt(form.week_number),
        planned_cumulative_pct: parseFloat(form.planned_cumulative_pct) / 100,
        planned_weekly_pct: 0,
        manpower_count: parseInt(form.manpower_count) || 0,
        rain_days: parseInt(form.rain_days) || 0,
        progress_items: [],
      });
      toast.success(`Minggu ke-${form.week_number} dibuat`);
      onSuccess?.(data.id);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Input Laporan Minggu Baru"
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading && <Spinner size={14} />} Buat & Lanjut
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Minggu ke- *</label>
          <input
            type="number"
            className="input"
            value={form.week_number || ""}
            onChange={(e) => setForm({ ...form, week_number: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Rencana Kumulatif (%)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.planned_cumulative_pct || 0}
            onChange={(e) =>
              setForm({ ...form, planned_cumulative_pct: e.target.value })
            }
          />
        </div>
        <div>
          <label className="label">Periode Mulai *</label>
          <input
            type="date"
            className="input"
            value={form.period_start || ""}
            onChange={(e) => setForm({ ...form, period_start: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Periode Selesai *</label>
          <input
            type="date"
            className="input"
            value={form.period_end || ""}
            onChange={(e) => setForm({ ...form, period_end: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Jumlah Tenaga Kerja</label>
          <input
            type="number"
            className="input"
            value={form.manpower_count || 0}
            onChange={(e) => setForm({ ...form, manpower_count: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Hari Hujan</label>
          <input
            type="number"
            className="input"
            value={form.rain_days || 0}
            onChange={(e) => setForm({ ...form, rain_days: e.target.value })}
          />
        </div>
      </div>
      <p className="text-xs text-ink-500 mt-3">
        Setelah dibuat, Anda akan diarahkan ke halaman detail untuk input progress
        per-item BOQ dan upload foto.
      </p>
    </Modal>
  );
}
