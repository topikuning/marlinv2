import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Plus, Edit2, Trash2, KeyRound, UserCheck, UserX, Users as UsersIcon,
} from "lucide-react";
import { usersAPI, rbacAPI, contractsAPI } from "@/api";
import {
  PageHeader, PageLoader, Modal, Empty, Spinner,
  ConfirmDialog, SearchInput,
} from "@/components/ui";
import { fmtDate, parseApiError } from "@/utils/format";

export default function UsersPage() {
  const [items, setItems] = useState([]);
  const [roles, setRoles] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  useEffect(() => {
    Promise.all([
      usersAPI.list({ page_size: 500 }),
      rbacAPI.roles(),
      contractsAPI.list({ page_size: 500 }),
    ])
      .then(([u, r, c]) => {
        setItems(u.data.items || []);
        setRoles(r.data || []);
        setContracts(c.data.items || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const refresh = async () => {
    const { data } = await usersAPI.list({ page_size: 500 });
    setItems(data.items || []);
  };

  const save = async (form) => {
    try {
      if (editing?.id) await usersAPI.update(editing.id, form);
      else await usersAPI.create(form);
      toast.success("Tersimpan");
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  const del = async () => {
    try {
      await usersAPI.remove(confirmDel.id);
      toast.success("Dihapus");
      setConfirmDel(null);
      refresh();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  const filtered = items.filter((u) =>
    !search ||
    [u.full_name, u.email, u.username, u.role?.name]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="User"
        description="Kelola akun pengguna sistem"
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} />
            <button className="btn-primary" onClick={() => setEditing({})}>
              <Plus size={14} /> User Baru
            </button>
          </>
        }
      />
      {loading ? (
        <PageLoader />
      ) : filtered.length === 0 ? (
        <Empty icon={UsersIcon} title="Belum ada user" />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">User</th>
                <th className="table-th">Role</th>
                <th className="table-th">Kontrak</th>
                <th className="table-th">Last Login</th>
                <th className="table-th">Status</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td className="table-td">
                    <p className="font-medium flex items-center gap-2">
                      {u.full_name}
                      {u.auto_provisioned && (
                        <span className="badge-gray text-[10px]" title="Dibuat otomatis dari PPK/Perusahaan">
                          Auto
                        </span>
                      )}
                      {u.must_change_password && (
                        <span className="badge-yellow text-[10px]" title="Harus ganti password saat login">
                          Ganti PW
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-ink-500">
                      {u.email} · @{u.username}
                    </p>
                  </td>
                  <td className="table-td">
                    <span className="badge-blue">{u.role?.name || u.role_name || "—"}</span>
                  </td>
                  <td className="table-td text-xs">
                    {u.assigned_contract_ids?.length
                      ? `${u.assigned_contract_ids.length} kontrak`
                      : "Semua"}
                  </td>
                  <td className="table-td text-xs">
                    {u.last_login_at ? fmtDate(u.last_login_at) : "—"}
                  </td>
                  <td className="table-td">
                    {u.is_active ? (
                      <span className="badge-green">
                        <UserCheck size={10} /> Aktif
                      </span>
                    ) : (
                      <span className="badge-gray">
                        <UserX size={10} /> Non-aktif
                      </span>
                    )}
                  </td>
                  <td className="table-td">
                    <div className="flex gap-1">
                      <button
                        className="btn-ghost btn-xs"
                        onClick={() => setEditing(u)}
                      >
                        <Edit2 size={11} />
                      </button>
                      <button
                        className="btn-ghost btn-xs"
                        onClick={() => setResetting(u)}
                        title="Reset password"
                      >
                        <KeyRound size={11} />
                      </button>
                      <button
                        className="btn-ghost btn-xs text-red-600"
                        onClick={() => setConfirmDel(u)}
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

      {editing !== null && (
        <UserModal
          initial={editing.id ? editing : null}
          roles={roles}
          contracts={contracts}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}

      {resetting && (
        <ResetModal
          user={resetting}
          onClose={() => setResetting(null)}
        />
      )}

      <ConfirmDialog
        open={!!confirmDel}
        danger
        title="Hapus user?"
        description={`"${confirmDel?.full_name}" akan dinon-aktifkan.`}
        onCancel={() => setConfirmDel(null)}
        onConfirm={del}
      />
    </div>
  );
}

function UserModal({ initial, roles: propRoles, contracts, onClose, onSave }) {
  // Fallback-load roles if the parent passed an empty array.
  // This guards against a race where the modal mounts before the parent's
  // Promise.all has resolved, which used to leave the dropdown blank
  // (catatan #10a).
  const [roles, setRoles] = useState(propRoles || []);
  useEffect(() => {
    if (propRoles?.length) {
      setRoles(propRoles);
      return;
    }
    rbacAPI.roles().then(({ data }) => setRoles(data || []));
  }, [propRoles]);

  const [form, setForm] = useState(
    initial || {
      email: "",
      username: "",
      full_name: "",
      password: "",
      role_id: "",
      is_active: true,
      phone: "",
      whatsapp: "",
      assigned_contract_ids: [],
    }
  );

  // Once roles are available and we don't have a role yet (new-user path),
  // default to the first role so the dropdown never shows a blank value
  // that the backend would reject.
  useEffect(() => {
    if (!form.role_id && roles.length > 0 && !initial) {
      setForm((f) => ({ ...f, role_id: roles[0].id }));
    }
  }, [roles, form.role_id, initial]);

  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const payload = { ...form };
      if (initial) delete payload.password;
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  const toggleContract = (cid) => {
    const curr = form.assigned_contract_ids || [];
    setForm({
      ...form,
      assigned_contract_ids: curr.includes(cid)
        ? curr.filter((x) => x !== cid)
        : [...curr, cid],
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? "Edit User" : "User Baru"}
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
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Nama Lengkap *</label>
            <input
              className="input"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Email *</label>
            <input
              type="email"
              className="input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Username *</label>
            <input
              className="input"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Role *</label>
            <select
              className="select"
              value={form.role_id}
              onChange={(e) => setForm({ ...form, role_id: e.target.value })}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {!initial && (
            <div className="col-span-2">
              <label className="label">Password Awal *</label>
              <input
                type="password"
                className="input"
                value={form.password || ""}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Minimal 8 karakter"
              />
            </div>
          )}
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) =>
                  setForm({ ...form, is_active: e.target.checked })
                }
              />
              Aktif
            </label>
          </div>
        </div>

        <div className="border-t border-ink-200 pt-4">
          <label className="label">
            Assigned Kontrak (kosongkan untuk akses semua)
          </label>
          <div className="max-h-48 overflow-y-auto border border-ink-200 rounded-lg p-2 space-y-1">
            {contracts.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 text-sm hover:bg-ink-50 px-2 py-1 rounded"
              >
                <input
                  type="checkbox"
                  checked={(form.assigned_contract_ids || []).includes(c.id)}
                  onChange={() => toggleContract(c.id)}
                />
                <span className="font-mono text-xs text-ink-500">
                  {c.contract_number}
                </span>
                <span className="truncate flex-1">{c.contract_name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ResetModal({ user, onClose }) {
  const [pwd, setPwd] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (pwd.length < 8) return toast.error("Minimal 8 karakter");
    setSaving(true);
    try {
      await usersAPI.resetPassword(user.id, pwd);
      toast.success("Password di-reset");
      onClose();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset Password · ${user.full_name}`}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving && <Spinner size={14} />} Reset
          </button>
        </>
      }
    >
      <div>
        <label className="label">Password Baru</label>
        <input
          type="password"
          className="input"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          placeholder="Minimal 8 karakter"
        />
      </div>
    </Modal>
  );
}
