import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Plus, MapPin, ChevronRight, Trash2, Building2, Upload,
} from "lucide-react";
import {
  contractsAPI, masterAPI, locationsAPI, templatesAPI, downloadBlob,
} from "@/api";
import {
  PageHeader, PageLoader, Modal, Empty, SearchInput, Spinner,
} from "@/components/ui";
import {
  fmtCurrency, fmtDate, contractStatusBadge, parseApiError,
} from "@/utils/format";

const STATUS_LABEL = {
  draft: "Draft", active: "Aktif", addendum: "Addendum",
  on_hold: "Ditahan", completed: "Selesai", terminated: "Diputus",
};

export default function ContractsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await contractsAPI.list({ q: search, page_size: 200 });
      setItems(data.items || []);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Kontrak"
        description="Kelola seluruh kontrak konstruksi"
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} />
            <button className="btn-secondary" onClick={load}>
              Refresh
            </button>
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> Kontrak Baru
            </button>
          </>
        }
      />

      {loading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <Empty
          icon={Building2}
          title="Belum ada kontrak"
          description="Klik 'Kontrak Baru' untuk menambahkan"
          action={
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> Kontrak Baru
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items
            .filter(
              (c) =>
                !search ||
                c.contract_number.toLowerCase().includes(search.toLowerCase()) ||
                c.contract_name.toLowerCase().includes(search.toLowerCase())
            )
            .map((c) => (
              <div
                key={c.id}
                onClick={() => navigate(`/contracts/${c.id}`)}
                className="card p-5 hover:border-brand-400 hover:-translate-y-0.5 transition cursor-pointer"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className={contractStatusBadge(c.status)}>
                    {STATUS_LABEL[c.status] || c.status}
                  </span>
                  <ChevronRight size={14} className="text-ink-300" />
                </div>
                <p className="font-semibold text-ink-900 leading-snug mb-1">
                  {c.contract_name}
                </p>
                <p className="text-xs text-ink-500 font-mono mb-3 truncate">
                  {c.contract_number}
                </p>
                <p className="text-xs text-ink-500 truncate">
                  {c.company_name}
                </p>
                <div className="border-t border-ink-100 mt-3 pt-3 flex items-center justify-between text-xs text-ink-600">
                  <span className="flex items-center gap-1">
                    <MapPin size={11} /> {c.location_count} lokasi
                  </span>
                  <span className="font-medium">
                    {fmtCurrency(c.current_value)}
                  </span>
                </div>
                <div className="text-[10px] text-ink-400 mt-1">
                  {fmtDate(c.start_date)} → {fmtDate(c.end_date)}
                </div>
              </div>
            ))}
        </div>
      )}

      <CreateContractModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => {
          setShowCreate(false);
          load();
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//   CREATE MODAL - with multi-location repeater (fixes old UX)
// ════════════════════════════════════════════════════════════════════════════

function CreateContractModal({ open, onClose, onSuccess }) {
  const [form, setForm] = useState(initForm());
  const [companies, setCompanies] = useState([]);
  const [ppks, setPpks] = useState([]);
  const [locations, setLocations] = useState([blankLoc()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initForm());
    setLocations([blankLoc()]);
    (async () => {
      const [{ data: cs }, { data: ps }] = await Promise.all([
        masterAPI.companies({ page_size: 500, is_active: true }),
        masterAPI.ppk({ page_size: 500, is_active: true }),
      ]);
      setCompanies(cs.items || []);
      setPpks(ps.items || []);
    })();
  }, [open]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setLoc = (i, k, v) =>
    setLocations((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  const addLoc = () => setLocations((ls) => [...ls, blankLoc()]);
  const removeLoc = (i) =>
    setLocations((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)));

  async function downloadTemplate() {
    try {
      const { data } = await templatesAPI.locations();
      downloadBlob(data, "template_lokasi.xlsx");
    } catch (e) {
      toast.error(parseApiError(e));
    }
  }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const cleanLocs = locations
        .filter((l) => l.location_code && l.name)
        .map((l) => ({
          ...l,
          latitude: l.latitude ? parseFloat(l.latitude) : null,
          longitude: l.longitude ? parseFloat(l.longitude) : null,
        }));
      const payload = {
        ...form,
        original_value: parseFloat(form.original_value || 0),
        fiscal_year: parseInt(form.fiscal_year),
        weekly_report_due_day: parseInt(form.weekly_report_due_day),
        konsultan_id: form.konsultan_id || null,
        locations: cleanLocs,
      };
      await contractsAPI.create(payload);
      toast.success("Kontrak dibuat");
      onSuccess?.();
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Kontrak Baru"
      size="xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} type="button">
            Batal
          </button>
          <button
            onClick={submit}
            className="btn-primary"
            disabled={submitting}
          >
            {submitting && <Spinner size={14} />} Simpan Kontrak
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Nomor Kontrak *</label>
            <input
              className="input"
              value={form.contract_number}
              onChange={(e) => set("contract_number", e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Tahun Anggaran *</label>
            <input
              type="number"
              className="input"
              value={form.fiscal_year}
              onChange={(e) => set("fiscal_year", e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <label className="label">Nama Kontrak *</label>
          <input
            className="input"
            value={form.contract_name}
            onChange={(e) => set("contract_name", e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Perusahaan Kontraktor *</label>
            <select
              className="select"
              value={form.company_id}
              onChange={(e) => set("company_id", e.target.value)}
              required
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
            <label className="label">Konsultan MK</label>
            <select
              className="select"
              value={form.konsultan_id}
              onChange={(e) => set("konsultan_id", e.target.value)}
            >
              <option value="">-- Opsional --</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">PPK *</label>
            <select
              className="select"
              value={form.ppk_id}
              onChange={(e) => set("ppk_id", e.target.value)}
              required
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Nilai Kontrak (Rp) *</label>
            <input
              type="number"
              className="input"
              value={form.original_value}
              onChange={(e) => set("original_value", e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Tanggal Mulai *</label>
            <input
              type="date"
              className="input"
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Tanggal Selesai *</label>
            <input
              type="date"
              className="input"
              value={form.end_date}
              onChange={(e) => set("end_date", e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <label className="label">Deskripsi</label>
          <textarea
            className="textarea h-20 resize-none"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>

        {/* Multi-Location Repeater */}
        <div className="pt-4 border-t border-ink-200">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="text-sm font-display font-semibold text-ink-800">
                Lokasi Proyek
              </h4>
              <p className="text-xs text-ink-500 mt-0.5">
                Tambahkan satu atau lebih lokasi. Bisa juga ditambahkan nanti dari halaman detail kontrak.
              </p>
            </div>
            <button
              type="button"
              onClick={downloadTemplate}
              className="btn-ghost btn-xs"
            >
              <Upload size={11} /> Template Excel
            </button>
          </div>

          <div className="space-y-3">
            {locations.map((l, i) => (
              <div
                key={i}
                className="p-4 bg-ink-50/60 rounded-xl border border-ink-200 relative"
              >
                {locations.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLoc(i)}
                    className="absolute top-2 right-2 p-1 rounded-lg text-red-500 hover:bg-red-50"
                    title="Hapus lokasi"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="label">Kode Lokasi *</label>
                    <input
                      className="input"
                      value={l.location_code}
                      onChange={(e) => setLoc(i, "location_code", e.target.value)}
                      placeholder="LOK-01"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="label">Nama Lokasi *</label>
                    <input
                      className="input"
                      value={l.name}
                      onChange={(e) => setLoc(i, "name", e.target.value)}
                      placeholder="Desa Bintaro, Kec. Ampean"
                    />
                  </div>
                  <div>
                    <label className="label">Desa/Kelurahan</label>
                    <input
                      className="input"
                      value={l.village}
                      onChange={(e) => setLoc(i, "village", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Kecamatan</label>
                    <input
                      className="input"
                      value={l.district}
                      onChange={(e) => setLoc(i, "district", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Kabupaten/Kota</label>
                    <input
                      className="input"
                      value={l.city}
                      onChange={(e) => setLoc(i, "city", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Provinsi</label>
                    <input
                      className="input"
                      value={l.province}
                      onChange={(e) => setLoc(i, "province", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addLoc}
            className="btn-secondary btn-xs mt-3"
          >
            <Plus size={12} /> Tambah Lokasi
          </button>
        </div>
      </form>
    </Modal>
  );
}

function initForm() {
  return {
    contract_number: "",
    contract_name: "",
    company_id: "",
    konsultan_id: "",
    ppk_id: "",
    fiscal_year: new Date().getFullYear(),
    original_value: "",
    start_date: "",
    end_date: "",
    description: "",
    weekly_report_due_day: 1,
    daily_report_required: true,
  };
}

function blankLoc() {
  return {
    location_code: "",
    name: "",
    village: "",
    district: "",
    city: "",
    province: "",
    latitude: "",
    longitude: "",
  };
}
