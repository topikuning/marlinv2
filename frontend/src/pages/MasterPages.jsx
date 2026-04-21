import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Edit2, Trash2, Building2, UserCog, Tags, Copy, UserCheck } from "lucide-react";
import { masterAPI } from "../api";
import {
  PageHeader, PageLoader, Modal, Empty, Spinner,
  ConfirmDialog, SearchInput,
} from "../components/ui";
import { parseApiError } from "../utils/format";


/**
 * Shown once after an admin creates a Company/PPK — the backend
 * auto-generates a User with a known default password, and this modal
 * hands those credentials to the admin so they can deliver them to the
 * user out-of-band (SMS, WA, email, etc). The user will be forced to
 * change the password on first login.
 *
 * The default password is shown in plaintext here on purpose — it is the
 * ONE moment it is safe to expose it. It never hits any log or API
 * response after this point.
 */
function ProvisionedUserModal({ info, onClose }) {
  if (!info) return null;
  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(() =>
      toast.success("Disalin ke clipboard")
    );
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Akun User Otomatis Dibuat"
      size="sm"
      footer={
        <button className="btn-primary" onClick={onClose}>
          Mengerti, Tutup
        </button>
      }
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
          <UserCheck size={18} className="text-emerald-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-ink-800">
            User login untuk entitas ini telah dibuat secara otomatis.
          </p>
          <p className="text-xs text-ink-500 mt-0.5">
            Bagikan kredensial di bawah ke pemilik akun. Mereka wajib
            mengganti password saat login pertama.
          </p>
        </div>
      </div>

      <div className="space-y-3 bg-ink-50/70 rounded-xl p-4 border border-ink-200">
        <CredField label="Username" value={info.username} onCopy={copy} />
        <CredField label="Email" value={info.email} onCopy={copy} />
        <CredField
          label="Password Awal"
          value={info.default_password}
          onCopy={copy}
          mono
        />
      </div>

      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-3">
        ⚠️ Password ini <b>tidak akan ditampilkan lagi</b>. Salin sekarang.
      </p>
    </Modal>
  );
}

function CredField({ label, value, onCopy, mono }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-[11px] text-ink-500 uppercase tracking-wider font-medium">
        {label}
      </div>
      <div
        className={`flex-1 text-sm text-ink-900 ${mono ? "font-mono" : ""} truncate`}
      >
        {value}
      </div>
      <button
        className="btn-ghost btn-xs"
        onClick={() => onCopy(value)}
        title="Salin"
      >
        <Copy size={11} />
      </button>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
//  Generic CRUD helper (DRY) - used by all three master pages
// ════════════════════════════════════════════════════════════════════════════
function useCrudPage({ listFn, createFn, updateFn, deleteFn, idField = "id", onProvisioned }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await listFn({ page_size: 500, q: search });
      setItems(data.items || []);
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
      let resp;
      if (editing && editing[idField]) {
        resp = await updateFn(editing[idField], form);
      } else {
        resp = await createFn(form);
      }
      // If the backend auto-provisioned a user (Company/PPK create path
      // returns this payload), surface it through the optional callback
      // so the page can show the one-time credential info.
      const provisioned = resp?.data?.auto_provisioned_user;
      if (provisioned && onProvisioned) {
        onProvisioned(provisioned);
      } else {
        toast.success("Tersimpan");
      }
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  const del = async () => {
    try {
      await deleteFn(confirmDel[idField]);
      toast.success("Dihapus");
      setConfirmDel(null);
      refresh();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  const filtered = items.filter((i) =>
    search
      ? JSON.stringify(i).toLowerCase().includes(search.toLowerCase())
      : true
  );

  return {
    items: filtered,
    loading,
    search,
    setSearch,
    editing,
    setEditing,
    confirmDel,
    setConfirmDel,
    save,
    del,
    refresh,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  COMPANIES
// ════════════════════════════════════════════════════════════════════════════
export function CompaniesPage() {
  const [provisioned, setProvisioned] = useState(null);
  const c = useCrudPage({
    listFn: masterAPI.companies,
    createFn: masterAPI.createCompany,
    updateFn: masterAPI.updateCompany,
    deleteFn: masterAPI.deleteCompany,
    onProvisioned: setProvisioned,
  });

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Master Perusahaan"
        description="Kontraktor dan konsultan"
        actions={
          <>
            <SearchInput value={c.search} onChange={c.setSearch} />
            <button className="btn-primary" onClick={() => c.setEditing({})}>
              <Plus size={14} /> Perusahaan Baru
            </button>
          </>
        }
      />
      {c.loading ? (
        <PageLoader />
      ) : c.items.length === 0 ? (
        <Empty icon={Building2} title="Belum ada data" />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Nama</th>
                <th className="table-th">Tipe</th>
                <th className="table-th">Kontak</th>
                <th className="table-th">Telp</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((it) => (
                <tr key={it.id}>
                  <td className="table-td">
                    <p className="font-medium">{it.name}</p>
                    <p className="text-xs text-ink-500">{it.address || "—"}</p>
                  </td>
                  <td className="table-td">
                    <span className="badge-blue">{it.type}</span>
                  </td>
                  <td className="table-td">{it.contact_person || "—"}</td>
                  <td className="table-td text-xs">{it.phone || "—"}</td>
                  <td className="table-td">
                    <div className="flex gap-1">
                      <button
                        className="btn-ghost btn-xs"
                        onClick={() => c.setEditing(it)}
                      >
                        <Edit2 size={11} />
                      </button>
                      <button
                        className="btn-ghost btn-xs text-red-600"
                        onClick={() => c.setConfirmDel(it)}
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

      {c.editing !== null && (
        <CompanyModal
          initial={c.editing.id ? c.editing : null}
          onClose={() => c.setEditing(null)}
          onSave={c.save}
        />
      )}
      <ConfirmDialog
        open={!!c.confirmDel}
        danger
        title="Hapus perusahaan?"
        description={`"${c.confirmDel?.name}" akan dihapus.`}
        onCancel={() => c.setConfirmDel(null)}
        onConfirm={c.del}
      />
      {provisioned && (
        <ProvisionedUserModal
          info={provisioned}
          onClose={() => setProvisioned(null)}
        />
      )}
    </div>
  );
}

function CompanyModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(
    initial || {
      name: "", type: "contractor", address: "", phone: "",
      email: "", contact_person: "", npwp: "", is_active: true,
    }
  );
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? "Edit Perusahaan" : "Perusahaan Baru"}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving && <Spinner size={14} />} Simpan
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Nama *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Tipe *</label>
          <select
            className="select"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            <option value="contractor">Kontraktor</option>
            <option value="consultant">Konsultan</option>
            <option value="supplier">Supplier</option>
          </select>
        </div>
        <div>
          <label className="label">NPWP</label>
          <input
            className="input"
            value={form.npwp || ""}
            onChange={(e) => setForm({ ...form, npwp: e.target.value })}
          />
        </div>
        <div className="col-span-2">
          <label className="label">Alamat</label>
          <input
            className="input"
            value={form.address || ""}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Kontak Person</label>
          <input
            className="input"
            value={form.contact_person || ""}
            onChange={(e) =>
              setForm({ ...form, contact_person: e.target.value })
            }
          />
        </div>
        <div>
          <label className="label">Telepon</label>
          <input
            className="input"
            value={form.phone || ""}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div className="col-span-2">
          <label className="label">Email</label>
          <input
            type="email"
            className="input"
            value={form.email || ""}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  PPK
// ════════════════════════════════════════════════════════════════════════════
export function PPKPage() {
  const [provisioned, setProvisioned] = useState(null);
  const c = useCrudPage({
    listFn: masterAPI.ppk,
    createFn: masterAPI.createPPK,
    updateFn: masterAPI.updatePPK,
    deleteFn: masterAPI.deletePPK,
    onProvisioned: setProvisioned,
  });

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Master PPK"
        description="Pejabat Pembuat Komitmen"
        actions={
          <>
            <SearchInput value={c.search} onChange={c.setSearch} />
            <button className="btn-primary" onClick={() => c.setEditing({})}>
              <Plus size={14} /> PPK Baru
            </button>
          </>
        }
      />
      {c.loading ? (
        <PageLoader />
      ) : c.items.length === 0 ? (
        <Empty icon={UserCog} title="Belum ada data" />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Nama</th>
                <th className="table-th">NIP</th>
                <th className="table-th">Satker</th>
                <th className="table-th">Telepon</th>
                <th className="table-th">WhatsApp</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((it) => (
                <tr key={it.id}>
                  <td className="table-td">
                    <p className="font-medium">{it.name}</p>
                    <p className="text-xs text-ink-500">{it.email || "—"}</p>
                  </td>
                  <td className="table-td text-xs font-mono">{it.nip || "—"}</td>
                  <td className="table-td">{it.satker || "—"}</td>
                  <td className="table-td text-xs">{it.phone || "—"}</td>
                  <td className="table-td text-xs">{it.whatsapp || "—"}</td>
                  <td className="table-td">
                    <div className="flex gap-1">
                      <button
                        className="btn-ghost btn-xs"
                        onClick={() => c.setEditing(it)}
                      >
                        <Edit2 size={11} />
                      </button>
                      <button
                        className="btn-ghost btn-xs text-red-600"
                        onClick={() => c.setConfirmDel(it)}
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

      {c.editing !== null && (
        <PPKModal
          initial={c.editing.id ? c.editing : null}
          onClose={() => c.setEditing(null)}
          onSave={c.save}
        />
      )}
      <ConfirmDialog
        open={!!c.confirmDel}
        danger
        title="Hapus PPK?"
        description={`"${c.confirmDel?.name}" akan dihapus.`}
        onCancel={() => c.setConfirmDel(null)}
        onConfirm={c.del}
      />
      {provisioned && (
        <ProvisionedUserModal
          info={provisioned}
          onClose={() => setProvisioned(null)}
        />
      )}
    </div>
  );
}

function PPKModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(
    initial || {
      name: "", nip: "", satker: "", position: "",
      phone: "", whatsapp: "", email: "", is_active: true,
    }
  );
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? "Edit PPK" : "PPK Baru"}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving && <Spinner size={14} />} Simpan
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Nama *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">NIP</label>
          <input
            className="input"
            value={form.nip || ""}
            onChange={(e) => setForm({ ...form, nip: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Jabatan</label>
          <input
            className="input"
            value={form.position || ""}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
          />
        </div>
        <div className="col-span-2">
          <label className="label">Satker</label>
          <input
            className="input"
            value={form.satker || ""}
            onChange={(e) => setForm({ ...form, satker: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Telepon</label>
          <input
            className="input"
            value={form.phone || ""}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div>
          <label className="label">WhatsApp</label>
          <input
            className="input"
            value={form.whatsapp || ""}
            onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            placeholder="628xxx"
          />
        </div>
        <div className="col-span-2">
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={form.email || ""}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  WORK CODES
// ════════════════════════════════════════════════════════════════════════════
export function WorkCodesPage() {
  const c = useCrudPage({
    listFn: masterAPI.workCodes,
    createFn: masterAPI.createWorkCode,
    updateFn: (code, d) => masterAPI.updateWorkCode(code, d),
    deleteFn: (code) => masterAPI.deleteWorkCode(code),
    idField: "code",
  });

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Master Kode Pekerjaan"
        description="Standar item BOQ lintas kontrak"
        actions={
          <>
            <SearchInput value={c.search} onChange={c.setSearch} />
            <button className="btn-primary" onClick={() => c.setEditing({})}>
              <Plus size={14} /> Kode Baru
            </button>
          </>
        }
      />
      {c.loading ? (
        <PageLoader />
      ) : c.items.length === 0 ? (
        <Empty icon={Tags} title="Belum ada data" />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Kode</th>
                <th className="table-th">Kategori</th>
                <th className="table-th">Sub</th>
                <th className="table-th">Deskripsi</th>
                <th className="table-th">Unit</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((it) => (
                <tr key={it.code}>
                  <td className="table-td font-mono text-xs">{it.code}</td>
                  <td className="table-td">
                    <span className="badge-gray">{it.category}</span>
                  </td>
                  <td className="table-td text-xs">{it.sub_category || "—"}</td>
                  <td className="table-td">{it.description}</td>
                  <td className="table-td text-xs">{it.default_unit}</td>
                  <td className="table-td">
                    <div className="flex gap-1">
                      <button
                        className="btn-ghost btn-xs"
                        onClick={() => c.setEditing(it)}
                      >
                        <Edit2 size={11} />
                      </button>
                      <button
                        className="btn-ghost btn-xs text-red-600"
                        onClick={() => c.setConfirmDel(it)}
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

      {c.editing !== null && (
        <WorkCodeModal
          initial={c.editing.code ? c.editing : null}
          onClose={() => c.setEditing(null)}
          onSave={c.save}
        />
      )}
      <ConfirmDialog
        open={!!c.confirmDel}
        danger
        title="Hapus kode pekerjaan?"
        description={`"${c.confirmDel?.description}" akan dihapus.`}
        onCancel={() => c.setConfirmDel(null)}
        onConfirm={c.del}
      />
    </div>
  );
}

function WorkCodeModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(
    initial || {
      code: "", category: "arsitektural", sub_category: "",
      description: "", default_unit: "", description_template: "",
    }
  );
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? "Edit Kode Pekerjaan" : "Kode Pekerjaan Baru"}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving && <Spinner size={14} />} Simpan
          </button>
        </>
      }
    >
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
          <label className="label">Kategori *</label>
          <select
            className="select"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {[
              "persiapan", "struktural", "arsitektural", "mep",
              "site_work", "khusus",
            ].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Sub-Kategori</label>
          <input
            className="input"
            value={form.sub_category || ""}
            onChange={(e) => setForm({ ...form, sub_category: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Satuan *</label>
          <input
            className="input"
            value={form.default_unit || ""}
            onChange={(e) => setForm({ ...form, default_unit: e.target.value })}
          />
        </div>
        <div className="col-span-2">
          <label className="label">Deskripsi *</label>
          <input
            className="input"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
}
