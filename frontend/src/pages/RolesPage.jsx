import { useEffect, useState, useMemo } from "react";
import toast from "react-hot-toast";
import { Plus, Edit2, Trash2, ShieldCheck, Lock } from "lucide-react";
import { rbacAPI } from "@/api";
import {
  PageHeader, PageLoader, Modal, Empty, Spinner, ConfirmDialog,
} from "@/components/ui";
import { parseApiError } from "@/utils/format";

export default function RolesPage() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  useEffect(() => {
    Promise.all([rbacAPI.roles(), rbacAPI.permissions(), rbacAPI.menus()])
      .then(([r, p, m]) => {
        setRoles(r.data || []);
        setPermissions(p.data || []);
        setMenus(m.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const refresh = async () => {
    const { data } = await rbacAPI.roles();
    setRoles(data || []);
  };

  const openEdit = async (role) => {
    if (role?.id) {
      const { data } = await rbacAPI.role(role.id);
      setEditing(data);
    } else {
      setEditing({
        code: "",
        name: "",
        description: "",
        permission_ids: [],
        menu_ids: [],
        is_system: false,
      });
    }
  };

  const save = async (form) => {
    try {
      if (form.id) await rbacAPI.updateRole(form.id, form);
      else await rbacAPI.createRole(form);
      toast.success("Tersimpan");
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  const del = async () => {
    try {
      await rbacAPI.deleteRole(confirmDel.id);
      toast.success("Dihapus");
      setConfirmDel(null);
      refresh();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Role & Permission"
        description="Kelola role dan hak akses"
        actions={
          <button className="btn-primary" onClick={() => openEdit(null)}>
            <Plus size={14} /> Role Baru
          </button>
        }
      />

      {loading ? (
        <PageLoader />
      ) : roles.length === 0 ? (
        <Empty icon={ShieldCheck} title="Belum ada role" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map((r) => (
            <div key={r.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-display font-semibold text-ink-900 flex items-center gap-1.5">
                    {r.name}
                    {r.is_system && (
                      <Lock size={11} className="text-amber-500" />
                    )}
                  </p>
                  <p className="text-xs text-ink-500 font-mono">{r.code}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    className="btn-ghost btn-xs"
                    onClick={() => openEdit(r)}
                  >
                    <Edit2 size={11} />
                  </button>
                  {!r.is_system && (
                    <button
                      className="btn-ghost btn-xs text-red-600"
                      onClick={() => setConfirmDel(r)}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
              {r.description && (
                <p className="text-xs text-ink-600 mb-3">{r.description}</p>
              )}
              <div className="flex gap-2 text-xs">
                <span className="badge-blue">
                  {r.permission_count || 0} permission
                </span>
                <span className="badge-gray">
                  {r.menu_count || 0} menu
                </span>
                <span className="badge-gray">{r.user_count || 0} user</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <RoleModal
          initial={editing}
          permissions={permissions}
          menus={menus}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      <ConfirmDialog
        open={!!confirmDel}
        danger
        title="Hapus role?"
        description={`"${confirmDel?.name}" akan dihapus. Pastikan tidak ada user yang menggunakan role ini.`}
        onCancel={() => setConfirmDel(null)}
        onConfirm={del}
      />
    </div>
  );
}

/**
 * Turn a server-shaped role object into the flat form shape the modal uses.
 *
 * The /rbac/roles/{id} endpoint returns:
 *   { ...role, permissions: [{id,...}, ...], menus: [{id,...}, ...] }
 *
 * But the form binds to `permission_ids` / `menu_ids` (flat arrays).
 * Keeping this normalization in one place means we can't accidentally
 * get out of sync when the shape evolves.
 */
function normalizeInitial(initial) {
  if (!initial) {
    return {
      code: "",
      name: "",
      description: "",
      permission_ids: [],
      menu_ids: [],
      is_system: false,
    };
  }
  return {
    ...initial,
    permission_ids:
      initial.permissions?.map((p) => p.id) ||
      initial.permission_ids ||
      [],
    menu_ids:
      initial.menus?.map((m) => m.id) || initial.menu_ids || [],
  };
}


function RoleModal({ initial, permissions, menus, onClose, onSave }) {
  // on mount. Previously (useState(...) only), opening a different role
  // after saving left the checkbox matrix showing the *first* role's
  // state — fixed catatan #10b.
  //
  // We also normalize the server response (which comes back with
  // `permissions: [...]` / `menus: [...]`) into a flat id-array shape
  // the form actually binds to.
  const [form, setForm] = useState(() => normalizeInitial(initial));

  useEffect(() => {
    setForm(normalizeInitial(initial));
  }, [initial]);

  // Sets for O(1) membership checks — checkboxes render often.
  const selectedPerms = useMemo(
    () => new Set(form.permission_ids || []),
    [form.permission_ids]
  );
  const selectedMenus = useMemo(
    () => new Set(form.menu_ids || []),
    [form.menu_ids]
  );

  const [saving, setSaving] = useState(false);

  const grouped = permissions.reduce((acc, p) => {
    (acc[p.module] = acc[p.module] || []).push(p);
    return acc;
  }, {});

  const toggle = (key, id) => {
    setForm((prev) => {
      const curr = prev[key] || [];
      return {
        ...prev,
        [key]: curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id],
      };
    });
  };

  const toggleModule = (module, allIds) => {
    setForm((prev) => {
      const curr = prev.permission_ids || [];
      const allSelected = allIds.every((id) => curr.includes(id));
      return {
        ...prev,
        permission_ids: allSelected
          ? curr.filter((id) => !allIds.includes(id))
          : [...new Set([...curr, ...allIds])],
      };
    });
  };

  const submit = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  const disabled = form.is_system && form.code === "superadmin";

  return (
    <Modal
      open
      onClose={onClose}
      title={initial.id ? `Edit Role: ${initial.name}` : "Role Baru"}
      size="xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button
            className="btn-primary"
            onClick={submit}
            disabled={saving || disabled}
          >
            {saving && <Spinner size={14} />} Simpan
          </button>
        </>
      }
    >
      {disabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 mb-3">
          Role superadmin bersifat system dan tidak bisa diubah.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="label">Kode *</label>
          <input
            className="input font-mono"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            disabled={!!initial.id || disabled}
          />
        </div>
        <div>
          <label className="label">Nama *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div className="col-span-2">
          <label className="label">Deskripsi</label>
          <input
            className="input"
            value={form.description || ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="border-t border-ink-200 pt-4 mb-4">
        <h4 className="text-sm font-display font-semibold text-ink-800 mb-2">
          Permissions
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(grouped).map(([mod, perms]) => {
            const allIds = perms.map((p) => p.id);
            const allSelected = allIds.every((id) => selectedPerms.has(id));
            return (
              <div
                key={mod}
                className="border border-ink-200 rounded-lg p-3"
              >
                <label className="flex items-center gap-2 mb-2 font-medium text-sm capitalize">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => toggleModule(mod, allIds)}
                    disabled={disabled}
                  />
                  {mod}
                </label>
                <div className="space-y-1 pl-5">
                  {perms.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPerms.has(p.id)}
                        onChange={() => toggle("permission_ids", p.id)}
                        disabled={disabled}
                      />
                      <span className="font-mono text-ink-500">
                        {p.action}
                      </span>
                      <span className="text-ink-700">{p.description}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-ink-200 pt-4">
        <h4 className="text-sm font-display font-semibold text-ink-800 mb-2">
          Menu yang Bisa Diakses
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {menus.map((m) => (
            <label
              key={m.id}
              className={`flex items-center gap-2 text-sm p-2 rounded-lg border ${
                selectedMenus.has(m.id)
                  ? "bg-brand-50 border-brand-200"
                  : "border-ink-200"
              }`}
            >
              <input
                type="checkbox"
                checked={selectedMenus.has(m.id)}
                onChange={() => toggle("menu_ids", m.id)}
                disabled={disabled}
              />
              {m.parent_id && <span className="text-ink-400 ml-2">↳</span>}
              {m.label}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
