import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  AlertTriangle, CheckCircle, Clock, Zap,
} from "lucide-react";
import { notificationsAPI } from "../api";
import {
  PageHeader, PageLoader, Empty, Tabs, Spinner,
} from "../components/ui";
import { fmtDate, parseApiError } from "../utils/format";

const TYPE_ICON = {
  deviation: AlertTriangle,
  missing_report: Clock,
  spi: Zap,
  generic: AlertTriangle,
};

export default function WarningsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("active");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runningCheck, setRunningCheck] = useState(false);

  useEffect(() => {
    refresh();
  }, [tab]);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await notificationsAPI.warnings({
        resolved: tab === "resolved",
      });
      setItems(data.items || []);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const resolve = async (id) => {
    try {
      await notificationsAPI.resolveWarning(id);
      toast.success("Peringatan ditutup");
      refresh();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  const runChecks = async () => {
    setRunningCheck(true);
    try {
      const { data } = await notificationsAPI.runChecks();
      toast.success(
        `Scan selesai · ${data.new_warnings || 0} peringatan baru`
      );
      refresh();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setRunningCheck(false);
    }
  };

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Early Warning"
        description="Deteksi otomatis deviasi, laporan telat, dan SPI rendah"
        actions={
          <button
            className="btn-primary"
            onClick={runChecks}
            disabled={runningCheck}
          >
            {runningCheck && <Spinner size={14} />} Jalankan Scan
          </button>
        }
      />

      <Tabs
        tabs={[
          { id: "active", label: "Aktif" },
          { id: "resolved", label: "Sudah Ditutup" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {loading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <Empty
          icon={tab === "active" ? CheckCircle : AlertTriangle}
          title={
            tab === "active"
              ? "Tidak ada peringatan aktif"
              : "Belum ada peringatan yang ditutup"
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((w) => {
            const Icon = TYPE_ICON[w.warning_type] || AlertTriangle;
            return (
              <div
                key={w.id}
                className={`card p-4 border-l-4 ${
                  w.severity === "critical"
                    ? "border-l-red-500"
                    : "border-l-amber-500"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      w.severity === "critical"
                        ? "bg-red-50 text-red-600"
                        : "bg-amber-50 text-amber-600"
                    }`}
                  >
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span
                        className={
                          w.severity === "critical" ? "badge-red" : "badge-yellow"
                        }
                      >
                        {w.severity}
                      </span>
                      <span className="badge-gray">{w.warning_type}</span>
                      <span className="text-xs font-mono text-ink-500">
                        {w.contract_number}
                      </span>
                    </div>
                    <p className="text-sm text-ink-800 font-medium">
                      {w.contract_name}
                    </p>
                    <p className="text-sm text-ink-600 mt-1">{w.message}</p>
                    <p className="text-[10px] text-ink-400 mt-1">
                      {fmtDate(w.detected_at)}
                      {w.resolved_at && ` · ditutup ${fmtDate(w.resolved_at)}`}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      className="btn-ghost btn-xs"
                      onClick={() => navigate(`/contracts/${w.contract_id}`)}
                    >
                      Lihat
                    </button>
                    {!w.resolved_at && (
                      <button
                        className="btn-primary btn-xs"
                        onClick={() => resolve(w.id)}
                      >
                        <CheckCircle size={11} /> Tutup
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
