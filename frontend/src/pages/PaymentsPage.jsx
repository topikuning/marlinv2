import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Edit2, Trash2, Upload, FileText, Wallet } from "lucide-react";
import { contractsAPI, paymentsAPI } from "../api";
import {
  PageHeader, PageLoader, Modal, Empty, Spinner, ConfirmDialog,
} from "../components/ui";
import { fmtCurrency, fmtPct, fmtDate, parseApiError } from "../utils/format";

const STATUS_BADGE = {
  planned: "badge-gray",
  eligible: "badge-blue",
  submitted: "badge-yellow",
  verified: "badge-yellow",
  paid: "badge-green",
  rejected: "badge-red",
};
const STATUS_LABEL = {
  planned: "Direncanakan",
  eligible: "Memenuhi Syarat",
  submitted: "Diajukan",
  verified: "Diverifikasi",
  paid: "Dibayar",
  rejected: "Ditolak",
};

export default function PaymentsPage() {
  const [contracts, setContracts] = useState([]);
  const [selected, setSelected] = useState("");
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  useEffect(() => {
    contractsAPI.list({ page_size: 500 }).then(({ data }) => setContracts(data.items || []));
  }, []);

  useEffect(() => {
    if (!selected) return setTerms([]);
    refresh();
  }, [selected]);

  const refresh = () => {
    setLoading(true);
    paymentsAPI.listByContract(selected).then(({ data }) => setTerms(data.items || [])).finally(() => setLoading(false));
  };

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Termin Pembayaran"
        description="Kelola termin pembayaran kontrak"
        actions={
          selected && (
            <button className="btn-primary" onClick={() => setEditing({})}>
              <Plus size={14} /> Termin Baru
            </button>
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
        <Empty icon={Wallet} title="Pilih kontrak" />
      ) : loading ? (
        <PageLoader />
      ) : terms.length === 0 ? (
        <Empty icon={Wallet} title="Belum ada termin" />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Termin</th>
                <th className="table-th">Syarat Progres</th>
                <th className="table-th">Nilai</th>
                <th className="table-th">Status</th>
                <th className="table-th">Rencana</th>
                <th className="table-th">Dibayar</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {terms.map((t) => (
                <tr key={t.id} className="hover:bg-brand-50/40">
                  <td className="table-td">
                    <p className="font-medium">#{t.term_number}</p>
                    <p className="text-xs text-ink-500">{t.name}</p>
                  </td>
                  <td className="table-td">
                    {fmtPct(t.required_progress_pct * 100, 1)}
                  </td>
                  <td className="table-td font-medium">{fmtCurrency(t.amount)}</td>
                  <td className="table-td">
                    <span className={STATUS_BADGE[t.status]}>
                      {STATUS_LABEL[t.status] || t.status}
                    </span>
                  </td>
                  <td className="table-td text-xs">{fmtDate(t.planned_date)}</td>
                  <td className="table-td text-xs">{fmtDate(t.paid_date)}</td>
                  <td className="table-td">
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEditing(t)}
                        className="btn-ghost btn-xs"
                      >
                        <Edit2 size={11} />
                      </button>
                      <button
                        onClick={() => setConfirmDel(t)}
                        className="btn-ghost btn-xs text-red-600"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TermModal
          contractId={selected}
          initial={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={!!confirmDel}
        danger
        title="Hapus termin?"
        description={`Termin #${confirmDel?.term_number} akan dihapus.`}
        onCancel={() => setConfirmDel(null)}
        onConfirm={async () => {
          try {
            await paymentsAPI.remove(confirmDel.id);
            toast.success("Dihapus");
            setConfirmDel(null);
            refresh();
          } catch (e) {
            toast.error(parseApiError(e));
          }
        }}
      />
    </div>
  );
}

function TermModal({ contractId, initial, onClose, onSuccess }) {
  const [form, setForm] = useState(
    initial || {
      term_number: 1,
      name: "",
      required_progress_pct: 0,
      payment_pct: 0,
      amount: 0,
      retention_pct: 0,
      planned_date: "",
      notes: "",
    }
  );
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      const payload = {
        ...form,
        term_number: parseInt(form.term_number),
        required_progress_pct: parseFloat(form.required_progress_pct) / 100,
        payment_pct: parseFloat(form.payment_pct) / 100,
        amount: parseFloat(form.amount) || 0,
        retention_pct: parseFloat(form.retention_pct) / 100,
        planned_date: form.planned_date || null,
      };
      if (initial) {
        await paymentsAPI.update(initial.id, payload);
      } else {
        await paymentsAPI.create(contractId, payload);
      }
      toast.success("Tersimpan");
      onSuccess?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? "Edit Termin" : "Termin Baru"}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading && <Spinner size={14} />} Simpan
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Nomor Termin *</label>
          <input
            type="number"
            className="input"
            value={form.term_number}
            onChange={(e) => setForm({ ...form, term_number: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Nama *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Termin 1 / Uang Muka"
          />
        </div>
        <div>
          <label className="label">Syarat Progres (%)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.required_progress_pct * (initial ? 100 : 1) || 0}
            onChange={(e) =>
              setForm({ ...form, required_progress_pct: e.target.value })
            }
          />
        </div>
        <div>
          <label className="label">Porsi Bayar (%)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.payment_pct * (initial ? 100 : 1) || 0}
            onChange={(e) => setForm({ ...form, payment_pct: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Nilai (Rp)</label>
          <input
            type="number"
            className="input"
            value={form.amount || 0}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Retensi (%)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.retention_pct * (initial ? 100 : 1) || 0}
            onChange={(e) => setForm({ ...form, retention_pct: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Tanggal Rencana</label>
          <input
            type="date"
            className="input"
            value={form.planned_date || ""}
            onChange={(e) => setForm({ ...form, planned_date: e.target.value })}
          />
        </div>
        {initial && (
          <div>
            <label className="label">Status</label>
            <select
              className="select"
              value={form.status || "planned"}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="mt-3">
        <label className="label">Catatan</label>
        <textarea
          className="textarea h-16 resize-none"
          value={form.notes || ""}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>
    </Modal>
  );
}
