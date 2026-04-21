import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  CheckCircle2, XCircle, Play, Flag, Loader2, AlertTriangle,
} from "lucide-react";
import { contractsAPI } from "@/api";
import { Spinner } from "@/components/ui";
import { parseApiError, fmtCurrency } from "@/utils/format";

/**
 * Contract activation panel.
 *
 * Renders inline in the Contract Detail header for DRAFT contracts.
 * Polls /readiness to show a 4-step checklist and enables the Activate
 * button only when all four are green. For ACTIVE contracts, renders a
 * "Complete" button instead. For completed/terminated, renders nothing.
 *
 * This is the UI counterpart to the backend's check_readiness + activate
 * endpoints added in Tahap 2.
 */
export default function ContractActivationPanel({ contract, onChange }) {
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState(false);
  const [completing, setCompleting] = useState(false);

  const status = contract?.status;
  const canShowReadiness = status === "draft";
  const canComplete = status === "active" || status === "addendum";

  useEffect(() => {
    if (!canShowReadiness || !contract?.id) return;
    refresh();
  }, [contract?.id, status]);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await contractsAPI.readiness(contract.id);
      setReadiness(data);
    } catch (e) {
      // don't toast on background refresh; just keep old state
      console.warn("readiness check failed", e);
    } finally {
      setLoading(false);
    }
  };

  const activate = async () => {
    if (!readiness?.ready) {
      toast.error("Kontrak belum siap diaktifkan — perbaiki item di checklist.");
      return;
    }
    if (!confirm("Aktifkan kontrak sekarang? Setelah aktif, BOQ dan beberapa field utama hanya bisa diubah via Addendum.")) return;
    setActivating(true);
    try {
      await contractsAPI.activate(contract.id);
      toast.success("Kontrak diaktifkan");
      onChange?.();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (detail?.reasons?.length) {
        toast.error(detail.reasons[0]);
      } else {
        toast.error(parseApiError(e));
      }
    } finally {
      setActivating(false);
    }
  };

  const complete = async () => {
    if (!confirm("Tandai kontrak selesai? Setelah selesai, kontrak menjadi read-only.")) return;
    setCompleting(true);
    try {
      await contractsAPI.complete(contract.id);
      toast.success("Kontrak diselesaikan");
      onChange?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setCompleting(false);
    }
  };

  if (status === "completed" || status === "terminated") return null;

  if (canComplete) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <div className="badge-green flex items-center gap-1">
          <CheckCircle2 size={11} /> Kontrak Aktif
        </div>
        <button
          className="btn-secondary"
          onClick={complete}
          disabled={completing}
          title="Tandai kontrak selesai (read-only)"
        >
          {completing ? <Spinner size={13} /> : <Flag size={13} />} Tandai Selesai
        </button>
      </div>
    );
  }

  // DRAFT → show readiness checklist + Activate button
  const checks = readiness?.checks || {};
  const items = [
    { key: "has_locations", label: "Minimal 1 lokasi" },
    { key: "has_facilities", label: "Setiap lokasi punya ≥1 fasilitas" },
    { key: "has_approved_cco_zero", label: "BOQ CCO-0 sudah Approved" },
    {
      key: "value_ok",
      label: readiness
        ? `Total BOQ ≤ Nilai Kontrak (${fmtCurrency(
            readiness.boq_total_value
          )} / ${fmtCurrency(readiness.contract_value)})`
        : "Total BOQ ≤ Nilai Kontrak",
    },
  ];

  return (
    <div className="card p-4 border-brand-200 bg-brand-50/30">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h4 className="text-sm font-display font-semibold text-ink-900 flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-amber-600" />
            Kontrak masih Draft
          </h4>
          <p className="text-xs text-ink-600 mt-0.5">
            Selesaikan checklist di bawah, lalu aktifkan kontrak untuk mulai input laporan.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={activate}
          disabled={activating || !readiness?.ready}
          title={
            readiness?.ready
              ? "Aktifkan kontrak sekarang"
              : "Lengkapi checklist dulu"
          }
        >
          {activating ? <Spinner size={13} /> : <Play size={13} />}
          Aktifkan Kontrak
        </button>
      </div>

      <ul className="mt-3 space-y-1.5">
        {items.map((it) => {
          const pass = !!checks[it.key];
          return (
            <li key={it.key} className="flex items-start gap-2 text-xs">
              {loading ? (
                <Loader2
                  size={13}
                  className="animate-spin text-ink-400 mt-0.5 flex-shrink-0"
                />
              ) : pass ? (
                <CheckCircle2
                  size={13}
                  className="text-emerald-600 mt-0.5 flex-shrink-0"
                />
              ) : (
                <XCircle
                  size={13}
                  className="text-red-500 mt-0.5 flex-shrink-0"
                />
              )}
              <span className={pass ? "text-ink-700" : "text-ink-600"}>
                {it.label}
              </span>
            </li>
          );
        })}
      </ul>

      {readiness?.reasons?.length > 0 && (
        <div className="mt-3 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
          {readiness.reasons.map((r, i) => (
            <p key={i}>• {r}</p>
          ))}
        </div>
      )}
    </div>
  );
}
