import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Plus, Edit2, Trash2, Bell, Play, Send, CheckCircle, AlertCircle, Clock,
} from "lucide-react";
import { notificationsAPI } from "@/api";
import {
  PageHeader, PageLoader, Modal, Empty, Spinner,
  ConfirmDialog, Tabs,
} from "@/components/ui";
import { fmtDate, parseApiError } from "@/utils/format";

const TRIGGER_LABEL = {
  daily_report_missing: "Laporan Harian Telat",
  weekly_report_missing: "Laporan Mingguan Telat",
  deviation_warning: "Deviasi Waspada (-5%)",
  deviation_critical: "Deviasi Kritis (-10%)",
  spi_warning: "SPI < 0.92",
  spi_critical: "SPI < 0.85",
  finding_overdue: "Temuan Belum Ditindaklanjuti",
};

const STATUS_BADGE = {
  pending: "badge-gray",
  sent: "badge-green",
  failed: "badge-red",
  skipped: "badge-yellow",
};

export default function NotificationsPage() {
  const [tab, setTab] = useState("rules");

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Notifikasi"
        description="Aturan peringatan otomatis via WhatsApp"
      />
      <Tabs
        tabs={[
          { id: "rules", label: "Aturan" },
          { id: "queue", label: "Antrian Terkirim" },
          { id: "test", label: "Tes & Monitor" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "rules" && <RulesTab />}
      {tab === "queue" && <QueueTab />}
      {tab === "test" && <TestTab />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════

function RulesTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await notificationsAPI.rules();
      setItems(data || []);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const save = async (form) => {
    try {
      if (editing?.id) await notificationsAPI.updateRule(editing.id, form);
      else await notificationsAPI.createRule(form);
      toast.success("Tersimpan");
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  const del = async () => {
    try {
      await notificationsAPI.deleteRule(confirmDel.id);
      toast.success("Dihapus");
      setConfirmDel(null);
      refresh();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button className="btn-primary" onClick={() => setEditing({})}>
          <Plus size={14} /> Aturan Baru
        </button>
      </div>

      {loading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <Empty icon={Bell} title="Belum ada aturan" />
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <div key={r.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className={
                        r.is_active ? "badge-green" : "badge-gray"
                      }
                    >
                      {r.is_active ? "Aktif" : "Off"}
                    </span>
                    <span className="badge-blue">{r.channel}</span>
                    <p className="font-display font-semibold text-ink-900">
                      {r.name}
                    </p>
                  </div>
                  <p className="text-xs text-ink-500 mb-2">
                    Trigger:{" "}
                    <b>{TRIGGER_LABEL[r.trigger_type] || r.trigger_type}</b>
                    {r.target_roles?.length > 0 && (
                      <>
                        {" · "}Target:{" "}
                        <b>{r.target_roles.join(", ")}</b>
                      </>
                    )}
                  </p>
                  {r.description && (
                    <p className="text-xs text-ink-600 mb-2">{r.description}</p>
                  )}
                  <pre className="text-[11px] bg-ink-50 p-2 rounded border border-ink-200 whitespace-pre-wrap font-sans max-h-24 overflow-y-auto">
                    {r.message_template}
                  </pre>
                </div>
                <div className="flex gap-1">
                  <button
                    className="btn-ghost btn-xs"
                    onClick={() => setEditing(r)}
                  >
                    <Edit2 size={11} />
                  </button>
                  <button
                    className="btn-ghost btn-xs text-red-600"
                    onClick={() => setConfirmDel(r)}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== null && (
        <RuleModal
          initial={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      <ConfirmDialog
        open={!!confirmDel}
        danger
        title="Hapus aturan?"
        description={`"${confirmDel?.name}" akan dihapus.`}
        onCancel={() => setConfirmDel(null)}
        onConfirm={del}
      />
    </div>
  );
}

function RuleModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(
    initial || {
      code: "",
      name: "",
      description: "",
      trigger_type: "deviation_warning",
      channel: "whatsapp",
      threshold_config: {},
      message_template:
        "⚠️ {{contract_number}}\n{{contract_name}}\n\n{{warning}}",
      target_roles: ["ppk"],
      is_active: true,
    }
  );
  const [saving, setSaving] = useState(false);

  const toggleRole = (role) => {
    const curr = form.target_roles || [];
    setForm({
      ...form,
      target_roles: curr.includes(role)
        ? curr.filter((r) => r !== role)
        : [...curr, role],
    });
  };

  const submit = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? "Edit Aturan" : "Aturan Baru"}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving && <Spinner size={14} />} Simpan
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Kode *</label>
            <input
              className="input font-mono"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              disabled={!!initial}
            />
          </div>
          <div>
            <label className="label">Channel *</label>
            <select
              className="select"
              value={form.channel}
              onChange={(e) => setForm({ ...form, channel: e.target.value })}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="in_app">In-app</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Nama *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Deskripsi</label>
          <input
            className="input"
            value={form.description || ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Trigger Type *</label>
          <select
            className="select"
            value={form.trigger_type}
            onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}
          >
            {Object.entries(TRIGGER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Target Roles</label>
          <div className="flex gap-2 flex-wrap">
            {[
              "superadmin", "admin_pusat", "ppk", "manager",
              "konsultan", "kontraktor", "itjen",
            ].map((r) => (
              <label
                key={r}
                className={`px-3 py-1.5 rounded-full text-xs cursor-pointer border ${
                  (form.target_roles || []).includes(r)
                    ? "bg-brand-50 border-brand-400 text-brand-700"
                    : "border-ink-200 text-ink-600"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={(form.target_roles || []).includes(r)}
                  onChange={() => toggleRole(r)}
                />
                {r}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">
            Template Pesan{" "}
            <span className="text-ink-400 font-normal">
              (variabel:{" "}
              <code>
                {`{{contract_number}}, {{contract_name}}, {{warning}}, {{week_number}}, {{date}}`}
              </code>
              )
            </span>
          </label>
          <textarea
            className="textarea h-32 resize-none font-mono text-xs"
            value={form.message_template}
            onChange={(e) =>
              setForm({ ...form, message_template: e.target.value })
            }
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) =>
              setForm({ ...form, is_active: e.target.checked })
            }
          />
          Aktifkan aturan ini
        </label>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════

function QueueTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [processing, setProcessing] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await notificationsAPI.queue({
        status: statusFilter || undefined,
        limit: 100,
      });
      setItems(data || []);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [statusFilter]);

  const processNow = async () => {
    setProcessing(true);
    try {
      const { data } = await notificationsAPI.processQueue();
      toast.success(`${data.sent} terkirim, ${data.failed} gagal`);
      refresh();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center gap-2 mb-4">
        <select
          className="select max-w-48"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Semua Status</option>
          <option value="pending">Pending</option>
          <option value="sent">Terkirim</option>
          <option value="failed">Gagal</option>
          <option value="skipped">Skipped</option>
        </select>
        <button
          className="btn-primary"
          onClick={processNow}
          disabled={processing}
        >
          {processing ? <Spinner size={14} /> : <Play size={14} />} Proses Queue
        </button>
      </div>

      {loading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <Empty icon={Bell} title="Antrian kosong" />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Status</th>
                <th className="table-th">Tujuan</th>
                <th className="table-th">Pesan</th>
                <th className="table-th">Dijadwalkan</th>
                <th className="table-th">Terkirim</th>
              </tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr key={q.id}>
                  <td className="table-td">
                    <span className={STATUS_BADGE[q.status]}>{q.status}</span>
                  </td>
                  <td className="table-td text-xs">
                    <p>{q.recipient_name || "—"}</p>
                    <p className="text-ink-500 font-mono">{q.recipient_address}</p>
                  </td>
                  <td className="table-td">
                    <p className="text-xs truncate max-w-md">{q.message}</p>
                  </td>
                  <td className="table-td text-xs">
                    {fmtDate(q.scheduled_at)}
                  </td>
                  <td className="table-td text-xs">
                    {q.sent_at ? fmtDate(q.sent_at) : "—"}
                    {q.error_message && (
                      <p className="text-red-600 text-[10px]">
                        {q.error_message}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════

function TestTab() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(
    "Ini test pesan KNMP Monitor — jika Anda menerima ini, konfigurasi WhatsApp berfungsi."
  );
  const [sending, setSending] = useState(false);
  const [running, setRunning] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      const { data } = await notificationsAPI.testSend(phone, message);
      if (data.success) toast.success("Pesan terkirim");
      else toast.error(data.error || "Gagal");
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setSending(false);
    }
  };

  const runChecks = async () => {
    setRunning(true);
    try {
      const { data } = await notificationsAPI.runChecks();
      toast.success(
        `Selesai · warning baru: ${data.new_warnings || 0} · notif queued: ${data.notifications_queued || 0}`
      );
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="card p-5">
        <h3 className="font-display font-semibold text-ink-800 mb-1">
          Test Kirim WhatsApp
        </h3>
        <p className="text-xs text-ink-500 mb-4">
          Uji konfigurasi Fonnte / WA API
        </p>
        <div className="space-y-3">
          <div>
            <label className="label">Nomor WhatsApp</label>
            <input
              className="input"
              placeholder="628xxxx"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Pesan</label>
            <textarea
              className="textarea h-24 resize-none"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <button
            className="btn-primary w-full"
            onClick={send}
            disabled={sending || !phone}
          >
            {sending ? <Spinner size={14} /> : <Send size={14} />} Kirim
          </button>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-display font-semibold text-ink-800 mb-1">
          Jalankan Scan Manual
        </h3>
        <p className="text-xs text-ink-500 mb-4">
          Periksa deviasi, laporan terlambat, dan antrikan notifikasi sekarang
          (normalnya berjalan otomatis harian)
        </p>
        <button
          className="btn-primary w-full"
          onClick={runChecks}
          disabled={running}
        >
          {running ? <Spinner size={14} /> : <Play size={14} />} Jalankan Scan
          Sekarang
        </button>
      </div>
    </div>
  );
}
