import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { History, Filter, ChevronDown, ChevronRight as ChevRight } from "lucide-react";
import { auditAPI } from "@/api";
import {
  PageHeader, PageLoader, Empty, SearchInput, Modal,
} from "@/components/ui";
import { parseApiError } from "@/utils/format";


const ACTION_BADGE = {
  create: "bg-green-50 text-green-700 border-green-200",
  update: "bg-blue-50 text-blue-700 border-blue-200",
  delete: "bg-red-50 text-red-700 border-red-200",
  login: "bg-slate-100 text-slate-700 border-slate-200",
  logout: "bg-slate-100 text-slate-600 border-slate-200",
  unlock: "bg-amber-50 text-amber-800 border-amber-300",
  lock: "bg-indigo-50 text-indigo-700 border-indigo-200",
  approve: "bg-emerald-50 text-emerald-700 border-emerald-200",
  bulk_create: "bg-green-50 text-green-700 border-green-200",
  import_excel: "bg-teal-50 text-teal-700 border-teal-200",
};


function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("id-ID", {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return iso;
  }
}


export default function AuditLogPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [facets, setFacets] = useState({ actions: [], entity_types: [] });
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    auditAPI.facets().then(({ data }) => setFacets(data)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [page, action, entityType, dateFrom, dateTo]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await auditAPI.list({
        page, page_size: pageSize,
        q: q || undefined,
        action: action || undefined,
        entity_type: entityType || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setQ(""); setAction(""); setEntityType("");
    setDateFrom(""); setDateTo(""); setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Audit Log"
        description="Riwayat semua aksi penting (buat/ubah/hapus, login, approve, unlock). Hanya bisa dibaca — data tidak bisa diubah atau dihapus."
      />

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-2">
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="Cari nama user, email, atau entity id..."
            />
          </div>
          <select className="select" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <option value="">Semua action</option>
            {facets.actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select className="select" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
            <option value="">Semua entitas</option>
            {facets.entity_types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => { setPage(1); load(); }}>
              <Filter size={13} /> Cari
            </button>
            <button className="btn-ghost" onClick={reset}>Reset</button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-3">
          <label className="flex items-center gap-2 text-xs text-ink-600">
            Dari:
            <input type="date" className="input" value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-600">
            Sampai:
            <input type="date" className="input" value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </label>
          <div className="md:col-span-3 text-right text-xs text-ink-500 self-center">
            {total} entri · Halaman {page} / {totalPages}
          </div>
        </div>
      </div>

      {loading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <Empty icon={History} title="Tidak ada audit log" description="Belum ada aktivitas yang cocok dengan filter ini." />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-th">Waktu</th>
                  <th className="table-th">User</th>
                  <th className="table-th">Action</th>
                  <th className="table-th">Entitas</th>
                  <th className="table-th">Entity ID</th>
                  <th className="table-th">IP</th>
                  <th className="table-th text-right">Detail</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-ink-50">
                    <td className="table-td font-mono text-[11px] whitespace-nowrap">
                      {fmtDateTime(r.created_at)}
                    </td>
                    <td className="table-td text-xs">
                      {r.user_name || "—"}
                      {r.user_email && (
                        <span className="text-ink-400 block text-[10px]">{r.user_email}</span>
                      )}
                    </td>
                    <td className="table-td">
                      <span className={`text-[10px] px-2 py-0.5 rounded border font-mono ${ACTION_BADGE[r.action] || "bg-ink-100 text-ink-700 border-ink-200"}`}>
                        {r.action}
                      </span>
                    </td>
                    <td className="table-td text-xs">{r.entity_type}</td>
                    <td className="table-td font-mono text-[10px] text-ink-500 max-w-[180px] truncate" title={r.entity_id}>
                      {r.entity_id || "—"}
                    </td>
                    <td className="table-td text-[10px] text-ink-400 font-mono">
                      {r.ip_address || "—"}
                    </td>
                    <td className="table-td text-right">
                      {r.changes && Object.keys(r.changes).length > 0 && (
                        <button
                          className="btn-ghost btn-xs"
                          onClick={() => setDetail(r)}
                        >
                          <ChevRight size={11} /> Lihat
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button className="btn-ghost btn-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Sebelumnya
          </button>
          <span className="text-xs text-ink-600">Hal {page} / {totalPages}</span>
          <button className="btn-ghost btn-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Berikutnya →
          </button>
        </div>
      )}

      {detail && (
        <Modal
          open={!!detail}
          onClose={() => setDetail(null)}
          title={`Detail Audit · ${detail.action} ${detail.entity_type}`}
          size="lg"
          footer={
            <button className="btn-primary" onClick={() => setDetail(null)}>Tutup</button>
          }
        >
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <KV label="Waktu" value={fmtDateTime(detail.created_at)} />
              <KV label="User" value={detail.user_name ? `${detail.user_name} (${detail.user_email})` : "—"} />
              <KV label="Action" value={detail.action} mono />
              <KV label="Entitas" value={`${detail.entity_type} · ${detail.entity_id || "—"}`} mono />
              <KV label="IP Address" value={detail.ip_address || "—"} mono />
              <KV label="User Agent" value={detail.user_agent || "—"} className="col-span-2" />
            </div>
            <div>
              <p className="text-xs font-medium text-ink-800 mb-1">Changes / Payload</p>
              <pre className="bg-ink-50 border border-ink-200 rounded-lg p-3 text-[11px] overflow-x-auto whitespace-pre-wrap break-words font-mono max-h-96">
{JSON.stringify(detail.changes, null, 2)}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}


function KV({ label, value, mono, className = "" }) {
  return (
    <div className={className}>
      <p className="text-[10px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className={`text-xs text-ink-800 mt-0.5 ${mono ? "font-mono" : ""} break-words`}>{value}</p>
    </div>
  );
}
