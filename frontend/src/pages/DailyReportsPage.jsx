import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Plus, Calendar, Upload, Trash2, Image, Edit2,
} from "lucide-react";
import { contractsAPI, dailyAPI } from "@/api";
import {
  PageHeader, PageLoader, Modal, Empty, Spinner, ConfirmDialog,
} from "@/components/ui";
import { fmtDate, parseApiError, assetUrl } from "@/utils/format";

export default function DailyReportsPage() {
  const [contracts, setContracts] = useState([]);
  const [selected, setSelected] = useState("");
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  useEffect(() => {
    contractsAPI.list({ page_size: 500 }).then(({ data }) => setContracts(data.items || []));
  }, []);

  useEffect(() => {
    if (!selected) return setReports([]);
    refresh();
  }, [selected]);

  const refresh = () => {
    setLoading(true);
    dailyAPI
      .listByContract(selected)
      .then(({ data }) => setReports(data.items || []))
      .finally(() => setLoading(false));
  };

  const openDetail = async (r) => {
    const { data } = await dailyAPI.get(r.id);
    setDetail(data);
  };

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Laporan Harian"
        description="Catatan kegiatan & foto harian — tidak ada input persentase progres"
        actions={
          selected && (
            <button
              className="btn-primary"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={14} /> Laporan Hari Ini
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
        <Empty icon={Calendar} title="Pilih kontrak dulu" />
      ) : loading ? (
        <PageLoader />
      ) : reports.length === 0 ? (
        <Empty
          icon={Calendar}
          title="Belum ada laporan harian"
          description="Klik 'Laporan Hari Ini' untuk mulai"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map((r) => (
            <div
              key={r.id}
              onClick={() => openDetail(r)}
              className="card p-5 hover:border-brand-400 hover:-translate-y-0.5 transition cursor-pointer"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-display font-semibold text-ink-900">
                    {fmtDate(r.report_date)}
                  </p>
                  <p className="text-xs text-ink-500">{r.submitted_by}</p>
                </div>
                <div className="flex gap-1">
                  <span className="badge-gray">TK: {r.manpower_count}</span>
                </div>
              </div>
              {(r.facility_name || r.location_name) && (
                <div className="text-[11px] text-ink-600 mb-2 pb-2 border-b border-ink-100">
                  {r.location_name && (
                    <div className="flex items-start gap-1">
                      <span className="text-ink-400">📍</span>
                      <span className="truncate">{r.location_name}</span>
                    </div>
                  )}
                  {r.facility_name && (
                    <div className="flex items-start gap-1 mt-0.5">
                      <span className="text-ink-400">🏗️</span>
                      <span className="truncate font-medium">
                        {r.facility_code && (
                          <span className="font-mono text-ink-500 mr-1">{r.facility_code}</span>
                        )}
                        {r.facility_name}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {!r.facility_id && (
                <p className="text-[10px] text-amber-700 bg-amber-50 px-2 py-1 rounded mb-2">
                  ⚠ Laporan tanpa fasilitas (legacy) — foto tidak muncul di Dashboard Eksekutif
                </p>
              )}
              {r.activities && (
                <p className="text-sm text-ink-700 line-clamp-3 mb-2">
                  {r.activities}
                </p>
              )}
              <div className="flex items-center justify-between text-xs text-ink-500 pt-2 border-t border-ink-100">
                <span>
                  ☀️ {r.weather_morning || "—"} · 🌦️ {r.weather_afternoon || "—"}
                </span>
                {r.rain_hours > 0 && <span>🌧️ {r.rain_hours}j</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <DailyReportModal
          contractId={selected}
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      )}

      {detail && (
        <DailyDetailModal
          report={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
          }}
          onDelete={() => setConfirmDel(detail)}
          onChange={(r) => setDetail(r)}
        />
      )}

      {editing && (
        <DailyReportModal
          contractId={selected}
          initial={editing}
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
        title="Hapus laporan harian?"
        description={`Laporan tanggal ${fmtDate(confirmDel?.report_date)} akan dihapus permanen.`}
        onCancel={() => setConfirmDel(null)}
        onConfirm={async () => {
          try {
            await dailyAPI.remove(confirmDel.id);
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

function DailyReportModal({ contractId, initial, onClose, onSuccess }) {
  const [form, setForm] = useState(
    initial || {
      contract_id: contractId,
      location_id: "",
      facility_id: "",
      report_date: new Date().toISOString().slice(0, 10),
      activities: "",
      manpower_count: 0,
      manpower_skilled: 0,
      manpower_unskilled: 0,
      equipment_used: "",
      materials_received: "",
      weather_morning: "Cerah",
      weather_afternoon: "Cerah",
      rain_hours: 0,
      obstacles: "",
      notes: "",
    }
  );
  const [contractDetail, setContractDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  // Load contract detail untuk dapat list Lokasi + Fasilitas yang
  // tersedia. Daily report baru wajib merujuk ke fasilitas spesifik
  // supaya foto masuk galeri Dashboard Eksekutif.
  useEffect(() => {
    contractsAPI
      .get(contractId)
      .then(({ data }) => setContractDetail(data))
      .catch(() => setContractDetail(null));
  }, [contractId]);

  const locations = contractDetail?.locations || [];
  const selectedLocation = locations.find((l) => l.id === form.location_id);
  const facilitiesInLocation = selectedLocation?.facilities || [];

  const submit = async () => {
    if (!form.location_id || !form.facility_id) {
      toast.error("Pilih Lokasi & Fasilitas terlebih dahulu.");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...form,
        manpower_count: parseInt(form.manpower_count) || 0,
        manpower_skilled: parseInt(form.manpower_skilled) || 0,
        manpower_unskilled: parseInt(form.manpower_unskilled) || 0,
        rain_hours: parseFloat(form.rain_hours) || 0,
      };
      if (initial) await dailyAPI.update(initial.id, payload);
      else await dailyAPI.create(payload);
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
      title={initial ? "Edit Laporan Harian" : "Laporan Harian Baru"}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading && <Spinner size={14} />} Simpan
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Pilih lokasi & fasilitas — wajib agar foto laporan harian masuk
            ke galeri Dashboard Eksekutif untuk fasilitas yang tepat. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Lokasi *</label>
            <select
              className="select"
              value={form.location_id || ""}
              onChange={(e) =>
                setForm({ ...form, location_id: e.target.value, facility_id: "" })
              }
            >
              <option value="">-- Pilih lokasi --</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  [{l.location_code}] {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Fasilitas *</label>
            <select
              className="select"
              value={form.facility_id || ""}
              onChange={(e) => setForm({ ...form, facility_id: e.target.value })}
              disabled={!form.location_id}
            >
              <option value="">
                {form.location_id ? "-- Pilih fasilitas --" : "Pilih lokasi dulu"}
              </option>
              {facilitiesInLocation.map((f) => (
                <option key={f.id} value={f.id}>
                  [{f.facility_code}] {f.facility_name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label">Tanggal *</label>
            <input
              type="date"
              className="input"
              value={form.report_date}
              onChange={(e) => setForm({ ...form, report_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Cuaca Pagi</label>
            <select
              className="select"
              value={form.weather_morning}
              onChange={(e) => setForm({ ...form, weather_morning: e.target.value })}
            >
              {["Cerah", "Berawan", "Mendung", "Gerimis", "Hujan", "Badai"].map(
                (w) => (
                  <option key={w}>{w}</option>
                )
              )}
            </select>
          </div>
          <div>
            <label className="label">Cuaca Sore</label>
            <select
              className="select"
              value={form.weather_afternoon}
              onChange={(e) => setForm({ ...form, weather_afternoon: e.target.value })}
            >
              {["Cerah", "Berawan", "Mendung", "Gerimis", "Hujan", "Badai"].map(
                (w) => (
                  <option key={w}>{w}</option>
                )
              )}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Kegiatan Hari Ini *</label>
          <textarea
            className="textarea h-28 resize-none"
            value={form.activities}
            onChange={(e) => setForm({ ...form, activities: e.target.value })}
            placeholder="Narasi kegiatan lapangan, pekerjaan apa saja yang dilakukan hari ini..."
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["Total TK", "manpower_count"],
            ["Skilled", "manpower_skilled"],
            ["Unskilled", "manpower_unskilled"],
            ["Jam Hujan", "rain_hours"],
          ].map(([label, key]) => (
            <div key={key}>
              <label className="label">{label}</label>
              <input
                type="number"
                className="input"
                value={form[key] || 0}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Peralatan Digunakan</label>
            <textarea
              className="textarea h-20 resize-none"
              value={form.equipment_used || ""}
              onChange={(e) => setForm({ ...form, equipment_used: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Material Masuk</label>
            <textarea
              className="textarea h-20 resize-none"
              value={form.materials_received || ""}
              onChange={(e) => setForm({ ...form, materials_received: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label">Hambatan</label>
          <textarea
            className="textarea h-16 resize-none"
            value={form.obstacles || ""}
            onChange={(e) => setForm({ ...form, obstacles: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
}

function DailyDetailModal({ report, onClose, onEdit, onDelete, onChange }) {
  const [uploading, setUploading] = useState(false);

  const onFile = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        await dailyAPI.uploadPhoto(report.id, f);
      }
      toast.success(`${files.length} foto di-upload`);
      const { data } = await dailyAPI.get(report.id);
      onChange(data);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (pid) => {
    if (!confirm("Hapus foto?")) return;
    try {
      await dailyAPI.deletePhoto(report.id, pid);
      const { data } = await dailyAPI.get(report.id);
      onChange(data);
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Laporan Harian · ${fmtDate(report.report_date)}`}
      size="xl"
      footer={
        <>
          <button className="btn-danger" onClick={onDelete}>
            <Trash2 size={14} /> Hapus
          </button>
          <div className="flex-1" />
          <button className="btn-secondary" onClick={onClose}>Tutup</button>
          <button className="btn-primary" onClick={onEdit}>
            <Edit2 size={14} /> Edit
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs text-ink-500 mb-1">Kegiatan</p>
          <p className="text-sm whitespace-pre-line">{report.activities || "—"}</p>
        </div>
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-ink-500">Tenaga Kerja</p>
            <p className="font-medium">{report.manpower_count}</p>
          </div>
          <div>
            <p className="text-xs text-ink-500">Cuaca</p>
            <p>{report.weather_morning} / {report.weather_afternoon}</p>
          </div>
          <div>
            <p className="text-xs text-ink-500">Jam Hujan</p>
            <p>{report.rain_hours}</p>
          </div>
          <div>
            <p className="text-xs text-ink-500">Oleh</p>
            <p>{report.submitted_by || "—"}</p>
          </div>
        </div>
        {report.equipment_used && (
          <div>
            <p className="text-xs text-ink-500 mb-1">Peralatan</p>
            <p className="text-sm">{report.equipment_used}</p>
          </div>
        )}
        {report.materials_received && (
          <div>
            <p className="text-xs text-ink-500 mb-1">Material Masuk</p>
            <p className="text-sm">{report.materials_received}</p>
          </div>
        )}
        {report.obstacles && (
          <div>
            <p className="text-xs text-ink-500 mb-1">Hambatan</p>
            <p className="text-sm">{report.obstacles}</p>
          </div>
        )}

        <div className="pt-4 border-t border-ink-200">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium">
              Foto ({report.photos?.length || 0})
            </p>
            <label className="btn-primary btn-xs cursor-pointer">
              <Upload size={11} /> Upload
              <input
                type="file"
                hidden
                multiple
                accept="image/*"
                onChange={onFile}
              />
            </label>
          </div>
          {uploading && (
            <div className="text-xs text-ink-500 flex items-center gap-2 mb-2">
              <Spinner size={12} /> Mengunggah...
            </div>
          )}
          {!report.photos?.length ? (
            <Empty icon={Image} title="Belum ada foto" />
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
              {report.photos.map((p) => (
                <div
                  key={p.id}
                  className="relative group aspect-square rounded-lg overflow-hidden bg-ink-100"
                >
                  <img
                    src={assetUrl(p.thumbnail_path || p.file_path)}
                    className="w-full h-full object-cover"
                    alt=""
                  />
                  <button
                    onClick={() => removePhoto(p.id)}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-red-600 text-white p-1 rounded"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
