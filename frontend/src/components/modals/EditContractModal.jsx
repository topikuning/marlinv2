import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Info, Lock } from "lucide-react";
import { contractsAPI, masterAPI } from "@/api";
import { Modal, Spinner } from "@/components/ui";
import { parseApiError } from "@/utils/format";

/**
 * Edit an existing Contract. Backend enforces the edit matrix:
 *   - DRAFT      → all fields editable
 *   - ACTIVE     → descriptive fields only (name, description, doc, report config)
 *   - ADDENDUM   → same as ACTIVE
 *   - COMPLETED / TERMINATED → 400 refused
 *
 * This modal mirrors that on the UI by disabling locked fields and showing
 * a hint banner, but the real enforcement happens server-side so a
 * tampered client can't bypass it.
 */
const STATUS_LABEL = {
  draft: "Draft",
  active: "Aktif",
  addendum: "Addendum",
  completed: "Selesai",
  terminated: "Diputus",
};

// Must match backend _DRAFT_ONLY_FIELDS exactly.
const DRAFT_ONLY_FIELDS = new Set([
  "contract_number",
  "company_id",
  "ppk_id",
  "konsultan_id",
  "fiscal_year",
  "original_value",
  "start_date",
  "end_date",
]);

export default function EditContractModal({ open, contract, onClose, onSuccess }) {
  const [form, setForm] = useState({});
  const [companies, setCompanies] = useState([]);
  const [ppks, setPpks] = useState([]);
  const [saving, setSaving] = useState(false);

  const status = contract?.status || "draft";
  const isDraft = status === "draft";
  const isUnlocked =
    !!contract?.unlock_until && new Date() < new Date(contract.unlock_until);
  // COMPLETED/TERMINATED normally read-only. Unlock Mode membuka juga —
  // inti safety valve adalah koreksi retroaktif pada kontrak yang sudah
  // selesai sekalipun.
  const isLocked =
    (status === "completed" || status === "terminated") && !isUnlocked;

  useEffect(() => {
    if (!open || !contract) return;
    setForm({
      contract_number: contract.contract_number || "",
      contract_name: contract.contract_name || "",
      company_id: contract.company_id || "",
      ppk_id: contract.ppk_id || "",
      konsultan_id: contract.konsultan_id || "",
      fiscal_year: contract.fiscal_year || new Date().getFullYear(),
      original_value: contract.original_value || 0,
      start_date: contract.start_date || "",
      end_date: contract.end_date || "",
      description: contract.description || "",
      weekly_report_due_day: contract.weekly_report_due_day ?? 1,
      daily_report_required: !!contract.daily_report_required,
    });
    (async () => {
      const [{ data: cs }, { data: ps }] = await Promise.all([
        masterAPI.companies({ page_size: 1000, is_active: true }),
        masterAPI.ppk({ page_size: 1000, is_active: true }),
      ]);
      setCompanies(cs.items || []);
      setPpks(ps.items || []);
    })();
  }, [open, contract]);

  const isFieldDisabled = (field) => {
    if (isLocked) return true;
    // Unlock Mode membuka field DRAFT-only juga (ppk_id, original_value,
    // start/end_date, dll). Backend memvalidasi pada save dan menolak jika
    // bukan unlock/draft.
    if (!isDraft && !isUnlocked && DRAFT_ONLY_FIELDS.has(field)) return true;
    return false;
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (isLocked) return;
    setSaving(true);
    try {
      // Build payload with only fields user can actually edit in this status.
      const payload = {};
      const allFields = Object.keys(form);
      for (const k of allFields) {
        if (isFieldDisabled(k)) continue;
        let v = form[k];
        if (
          ["original_value"].includes(k) &&
          v !== "" &&
          v !== null
        )
          v = parseFloat(v);
        if (["fiscal_year", "weekly_report_due_day"].includes(k) && v !== "")
          v = parseInt(v);
        payload[k] = v;
      }
      await contractsAPI.update(contract.id, payload);
      toast.success("Perubahan tersimpan");
      onSuccess?.();
    } catch (e) {
      // Backend returns {detail:{message, rejected_fields}} for matrix violations
      const detail = e?.response?.data?.detail;
      if (detail?.rejected_fields) {
        toast.error(
          `Field tidak bisa diubah: ${detail.rejected_fields.join(", ")}`
        );
      } else {
        toast.error(parseApiError(e));
      }
    } finally {
      setSaving(false);
    }
  };

  if (!contract) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit Kontrak · ${contract.contract_number || ""}`}
      size="xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn-primary"
            onClick={submit}
            disabled={saving || isLocked}
          >
            {saving && <Spinner size={14} />} Simpan Perubahan
          </button>
        </>
      }
    >
      {/* Status hint */}
      <div
        className={`flex items-start gap-2 p-3 rounded-xl mb-4 text-xs ${
          isUnlocked
            ? "bg-red-50 text-red-800 border border-red-300"
            : isDraft
            ? "bg-brand-50 text-brand-800 border border-brand-200"
            : isLocked
            ? "bg-red-50 text-red-800 border border-red-200"
            : "bg-amber-50 text-amber-800 border border-amber-200"
        }`}
      >
        {isLocked ? (
          <Lock size={13} className="mt-0.5 flex-shrink-0" />
        ) : (
          <Info size={13} className="mt-0.5 flex-shrink-0" />
        )}
        <div>
          <p className="font-medium mb-0.5">
            Status kontrak:{" "}
            <span className="uppercase">{STATUS_LABEL[status] || status}</span>
            {isUnlocked && " · UNLOCK MODE"}
          </p>
          <p>
            {isUnlocked
              ? "Unlock Mode aktif — semua field, termasuk nilai/tanggal/PPK, bisa diedit untuk koreksi kesalahan input. Setelah selesai, tutup Unlock Mode di halaman kontrak; sistem akan memvalidasi total BOQ = nilai kontrak."
              : isLocked
              ? "Kontrak yang sudah Selesai/Diputus tidak bisa diedit. Gunakan Addendum jika ada revisi, atau Unlock Mode (superadmin) untuk koreksi retroaktif."
              : isDraft
              ? "Semua field bisa diedit karena kontrak masih Draft. Pastikan data benar sebelum diaktifkan."
              : "Hanya nama, deskripsi, dan pengaturan laporan yang bisa diedit. Perubahan nilai/tanggal/nomor kontrak memerlukan Addendum, atau Unlock Mode untuk koreksi kesalahan input."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Nomor Kontrak *</label>
          <input
            className="input"
            value={form.contract_number || ""}
            onChange={(e) => set("contract_number", e.target.value)}
            disabled={isFieldDisabled("contract_number")}
          />
        </div>
        <div>
          <label className="label">Tahun Anggaran *</label>
          <input
            type="number"
            className="input"
            value={form.fiscal_year || ""}
            onChange={(e) => set("fiscal_year", e.target.value)}
            disabled={isFieldDisabled("fiscal_year")}
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="label">Nama Kontrak *</label>
        <input
          className="input"
          value={form.contract_name || ""}
          onChange={(e) => set("contract_name", e.target.value)}
          disabled={isFieldDisabled("contract_name")}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <div>
          <label className="label">Perusahaan Kontraktor *</label>
          <select
            className="select"
            value={form.company_id || ""}
            onChange={(e) => set("company_id", e.target.value)}
            disabled={isFieldDisabled("company_id")}
          >
            <option value="">-- Pilih --</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Konsultan MK (fallback)</label>
          <select
            className="select"
            value={form.konsultan_id || ""}
            onChange={(e) => set("konsultan_id", e.target.value)}
            disabled={isFieldDisabled("konsultan_id")}
          >
            <option value="">-- Opsional --</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-ink-400 mt-1">
            Konsultan per-lokasi sekarang diatur di tab Lokasi.
          </p>
        </div>
        <div>
          <label className="label">PPK *</label>
          <select
            className="select"
            value={form.ppk_id || ""}
            onChange={(e) => set("ppk_id", e.target.value)}
            disabled={isFieldDisabled("ppk_id")}
          >
            <option value="">-- Pilih --</option>
            {ppks.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <div>
          <label className="label">Nilai Kontrak (Rp) *</label>
          <input
            type="number"
            className="input"
            value={form.original_value || 0}
            onChange={(e) => set("original_value", e.target.value)}
            disabled={isFieldDisabled("original_value")}
          />
        </div>
        <div>
          <label className="label">Tanggal Mulai *</label>
          <input
            type="date"
            className="input"
            value={form.start_date || ""}
            onChange={(e) => set("start_date", e.target.value)}
            disabled={isFieldDisabled("start_date")}
          />
        </div>
        <div>
          <label className="label">Tanggal Selesai *</label>
          <input
            type="date"
            className="input"
            value={form.end_date || ""}
            onChange={(e) => set("end_date", e.target.value)}
            disabled={isFieldDisabled("end_date")}
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="label">Deskripsi</label>
        <textarea
          className="textarea h-20 resize-none"
          value={form.description || ""}
          onChange={(e) => set("description", e.target.value)}
          disabled={isLocked}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div>
          <label className="label">Hari Deadline Laporan Mingguan</label>
          <select
            className="select"
            value={form.weekly_report_due_day ?? 1}
            onChange={(e) => set("weekly_report_due_day", e.target.value)}
            disabled={isLocked}
          >
            <option value={1}>Senin</option>
            <option value={2}>Selasa</option>
            <option value={3}>Rabu</option>
            <option value={4}>Kamis</option>
            <option value={5}>Jumat</option>
            <option value={6}>Sabtu</option>
            <option value={7}>Minggu</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!form.daily_report_required}
              onChange={(e) => set("daily_report_required", e.target.checked)}
              disabled={isLocked}
            />
            Wajib laporan harian
          </label>
        </div>
      </div>
    </Modal>
  );
}
