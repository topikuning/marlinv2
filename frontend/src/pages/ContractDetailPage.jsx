import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ChevronRight, Plus, MapPin, Layers, FileText, Upload,
  Trash2, Edit2, Download, Building2,
} from "lucide-react";
import {
  contractsAPI, locationsAPI, facilitiesAPI, boqAPI, templatesAPI, downloadBlob,
} from "../api";
import {
  PageLoader, Modal, Tabs, Empty, Spinner, ConfirmDialog,
} from "../components/ui";
import {
  fmtCurrency, fmtDate, contractStatusBadge, parseApiError, fmtNum,
} from "../utils/format";
import BOQGrid from "../components/grids/BOQGrid";
import BOQImportWizard from "../components/modals/BOQImportWizard";

export default function ContractDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [showAddFacility, setShowAddFacility] = useState(null); // location obj
  const [showAddendum, setShowAddendum] = useState(false);
  const [boqFacility, setBoqFacility] = useState(null);
  const [boqItems, setBoqItems] = useState([]);
  const [boqLocation, setBoqLocation] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    try {
      const { data } = await contractsAPI.get(id);
      setContract(data);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  }

  async function openBOQ(facility, location) {
    setBoqLocation(location);
    setBoqFacility(facility);
    try {
      const { data } = await boqAPI.listByFacility(facility.id);
      setBoqItems(data);
      setTab("boq");
    } catch (e) {
      toast.error(parseApiError(e));
    }
  }

  async function deleteLocation(loc) {
    try {
      await locationsAPI.remove(loc.id);
      toast.success("Lokasi dihapus");
      load();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  }

  async function deleteFacility(fac) {
    try {
      await facilitiesAPI.remove(fac.id);
      toast.success("Fasilitas dihapus");
      load();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  }

  if (loading) return <PageLoader />;
  if (!contract)
    return <div className="p-6 text-ink-500">Kontrak tidak ditemukan</div>;

  const tabs = [
    { id: "overview", label: "Ringkasan" },
    { id: "locations", label: "Lokasi & Fasilitas", count: contract.locations?.length },
    { id: "addenda", label: "Addendum", count: contract.addenda?.length },
    ...(boqFacility ? [{ id: "boq", label: `BOQ: ${boqFacility.facility_name}` }] : []),
  ];

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-ink-500 mb-5">
        <button onClick={() => navigate("/contracts")} className="hover:text-ink-900">
          Kontrak
        </button>
        <ChevronRight size={12} />
        <span className="text-ink-900 font-medium truncate">
          {contract.contract_number}
        </span>
      </div>

      {/* Header Card */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <span className={`${contractStatusBadge(contract.status)} mb-2`}>
              {contract.status}
            </span>
            <h1 className="text-xl font-display font-semibold text-ink-900 mb-1">
              {contract.contract_name}
            </h1>
            <p className="text-sm text-ink-500 font-mono">
              {contract.contract_number}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              onClick={() => navigate(`/scurve?contract=${id}`)}
            >
              <FileText size={14} /> Kurva S
            </button>
            <button
              className="btn-secondary"
              onClick={() => setShowAddendum(true)}
            >
              <Plus size={14} /> Addendum
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 border-t border-ink-100">
          {[
            ["Nilai Kontrak", fmtCurrency(contract.current_value)],
            ["Perusahaan", contract.company_name],
            ["PPK", contract.ppk_name],
            ["Durasi", `${contract.duration_days} hari`],
            ["Mulai", fmtDate(contract.start_date)],
            ["Selesai", fmtDate(contract.end_date)],
            ["Tahun Anggaran", contract.fiscal_year],
            ["Lokasi", `${contract.locations?.length || 0}`],
          ].map(([label, val]) => (
            <div key={label}>
              <p className="text-[10px] uppercase tracking-wider text-ink-400 font-medium">
                {label}
              </p>
              <p className="text-sm font-medium text-ink-800 mt-0.5 truncate">
                {val}
              </p>
            </div>
          ))}
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {/* Overview */}
      {tab === "overview" && (
        <div className="card p-6 text-sm text-ink-600">
          <p className="font-medium text-ink-800 mb-2">Deskripsi Kontrak</p>
          <p className="whitespace-pre-line">
            {contract.description || "Tidak ada deskripsi."}
          </p>
        </div>
      )}

      {/* Locations & Facilities */}
      {tab === "locations" && (
        <div>
          <div className="flex justify-end mb-4">
            <button
              className="btn-primary"
              onClick={() => setShowAddLocation(true)}
            >
              <Plus size={14} /> Tambah Lokasi
            </button>
          </div>

          {!contract.locations?.length ? (
            <Empty
              icon={MapPin}
              title="Belum ada lokasi"
              description="Tambah lokasi untuk mulai input fasilitas & BOQ"
            />
          ) : (
            <div className="space-y-4">
              {contract.locations.map((loc) => (
                <div key={loc.id} className="card p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-mono text-xs text-brand-600 mb-1">
                        {loc.location_code}
                      </p>
                      <p className="font-semibold text-ink-900">{loc.name}</p>
                      <p className="text-xs text-ink-500 flex items-center gap-1 mt-0.5">
                        <MapPin size={11} />
                        {[loc.village, loc.district, loc.city, loc.province]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        className="btn-ghost btn-xs"
                        onClick={() => setShowAddFacility(loc)}
                      >
                        <Plus size={11} /> Fasilitas
                      </button>
                      <button
                        className="btn-ghost btn-xs"
                        onClick={() => {
                          setBoqLocation(loc);
                          setShowImport(true);
                        }}
                      >
                        <Upload size={11} /> BOQ
                      </button>
                      <button
                        className="btn-ghost btn-xs text-red-600"
                        onClick={() =>
                          setConfirmDel({ type: "loc", loc, name: loc.name })
                        }
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {loc.facilities?.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3 pt-3 border-t border-ink-100">
                      {loc.facilities.map((f) => (
                        <div
                          key={f.id}
                          className="group flex items-center gap-2 px-3 py-2 bg-ink-50 hover:bg-brand-50 rounded-lg border border-ink-200 hover:border-brand-300 transition"
                        >
                          <Layers size={12} className="text-brand-600 flex-shrink-0" />
                          <button
                            onClick={() => openBOQ(f, loc)}
                            className="flex-1 text-left min-w-0"
                          >
                            <p className="text-xs font-medium text-ink-800 truncate">
                              {f.facility_name}
                            </p>
                            <p className="text-[10px] text-ink-400 font-mono">
                              {f.facility_code} · {fmtNum(f.total_value)}
                            </p>
                          </button>
                          <button
                            onClick={() =>
                              setConfirmDel({
                                type: "fac",
                                fac: f,
                                name: f.facility_name,
                              })
                            }
                            className="opacity-0 group-hover:opacity-100 text-red-500 p-1"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Addenda */}
      {tab === "addenda" && (
        <div>
          {!contract.addenda?.length ? (
            <Empty
              icon={FileText}
              title="Belum ada addendum"
              description="Tambahkan ketika ada perubahan kontrak"
            />
          ) : (
            <div className="space-y-3">
              {contract.addenda.map((a) => (
                <div key={a.id} className="card p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                    <FileText size={16} className="text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-ink-900">{a.number}</p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {a.addendum_type?.toUpperCase()} · {fmtDate(a.effective_date)}
                    </p>
                    {a.description && (
                      <p className="text-xs text-ink-600 mt-1">{a.description}</p>
                    )}
                  </div>
                  {a.extension_days > 0 && (
                    <span className="badge-yellow">+{a.extension_days} hari</span>
                  )}
                  {a.new_contract_value && (
                    <span className="text-xs font-medium">
                      {fmtCurrency(a.new_contract_value)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BOQ editor */}
      {tab === "boq" && boqFacility && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-ink-500">
                {boqLocation?.name} · {boqFacility.facility_code}
              </p>
              <h3 className="font-display font-semibold text-ink-900">
                BOQ: {boqFacility.facility_name}
              </h3>
            </div>
            <button
              className="btn-secondary btn-xs"
              onClick={() => setTab("locations")}
            >
              ← Kembali
            </button>
          </div>
          <BOQGrid
            facilityId={boqFacility.id}
            items={boqItems}
            onChange={() => {
              boqAPI.listByFacility(boqFacility.id).then(({ data }) => setBoqItems(data));
              load();
            }}
          />
        </div>
      )}

      {/* Modals */}
      <AddLocationModal
        open={showAddLocation}
        onClose={() => setShowAddLocation(false)}
        contractId={id}
        onSuccess={() => {
          setShowAddLocation(false);
          load();
        }}
      />
      <AddFacilityModal
        open={!!showAddFacility}
        onClose={() => setShowAddFacility(null)}
        location={showAddFacility}
        onSuccess={() => {
          setShowAddFacility(null);
          load();
        }}
      />
      <AddAddendumModal
        open={showAddendum}
        onClose={() => setShowAddendum(false)}
        contract={contract}
        onSuccess={() => {
          setShowAddendum(false);
          load();
        }}
      />
      {boqLocation && (
        <BOQImportWizard
          open={showImport}
          onClose={() => setShowImport(false)}
          locationId={boqLocation.id}
          existingFacilities={boqLocation.facilities || []}
          onDone={load}
        />
      )}
      <ConfirmDialog
        open={!!confirmDel}
        danger
        title={`Hapus ${confirmDel?.type === "loc" ? "lokasi" : "fasilitas"}?`}
        description={`"${confirmDel?.name}" akan dihapus permanen beserta semua data di dalamnya. Lanjutkan?`}
        onCancel={() => setConfirmDel(null)}
        onConfirm={async () => {
          if (confirmDel.type === "loc") await deleteLocation(confirmDel.loc);
          else await deleteFacility(confirmDel.fac);
          setConfirmDel(null);
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Add Location Modal — single + bulk
// ════════════════════════════════════════════════════════════════════════════

function AddLocationModal({ open, onClose, contractId, onSuccess }) {
  const [mode, setMode] = useState("single");
  const [form, setForm] = useState({
    location_code: "", name: "", village: "", district: "", city: "", province: "",
  });
  const [bulk, setBulk] = useState([{ location_code: "", name: "" }]);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      if (mode === "single") {
        await locationsAPI.create(contractId, form);
        toast.success("Lokasi ditambahkan");
      } else if (mode === "bulk") {
        const items = bulk.filter((b) => b.location_code && b.name);
        const { data } = await locationsAPI.bulk(contractId, items);
        toast.success(`${data.created} lokasi ditambahkan`);
      } else if (mode === "excel") {
        if (!file) return toast.error("Pilih file");
        const { data } = await locationsAPI.importExcel(contractId, file);
        if (data.success) {
          toast.success(`${data.items_imported} lokasi di-import`);
        } else {
          toast.error(data.errors?.[0] || "Import gagal");
        }
      }
      onSuccess?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = async () => {
    const { data } = await templatesAPI.locations();
    downloadBlob(data, "template_lokasi.xlsx");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tambah Lokasi"
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
      <div className="flex gap-1 border-b border-ink-200 mb-4">
        {["single", "bulk", "excel"].map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              mode === m ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500"
            }`}
          >
            {m === "single" ? "Satu Lokasi" : m === "bulk" ? "Banyak Sekaligus" : "Import Excel"}
          </button>
        ))}
      </div>

      {mode === "single" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Kode *</label>
            <input
              className="input"
              value={form.location_code}
              onChange={(e) => setForm({ ...form, location_code: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Nama *</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          {["village", "district", "city", "province"].map((f) => (
            <div key={f}>
              <label className="label capitalize">{f}</label>
              <input
                className="input"
                value={form[f]}
                onChange={(e) => setForm({ ...form, [f]: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      {mode === "bulk" && (
        <div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {bulk.map((b, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <input
                  className="input col-span-3"
                  placeholder="LOK-01"
                  value={b.location_code}
                  onChange={(e) =>
                    setBulk((bs) =>
                      bs.map((x, idx) =>
                        idx === i ? { ...x, location_code: e.target.value } : x
                      )
                    )
                  }
                />
                <input
                  className="input col-span-4"
                  placeholder="Nama lokasi"
                  value={b.name}
                  onChange={(e) =>
                    setBulk((bs) =>
                      bs.map((x, idx) =>
                        idx === i ? { ...x, name: e.target.value } : x
                      )
                    )
                  }
                />
                <input
                  className="input col-span-2"
                  placeholder="Kota"
                  value={b.city || ""}
                  onChange={(e) =>
                    setBulk((bs) =>
                      bs.map((x, idx) =>
                        idx === i ? { ...x, city: e.target.value } : x
                      )
                    )
                  }
                />
                <input
                  className="input col-span-2"
                  placeholder="Provinsi"
                  value={b.province || ""}
                  onChange={(e) =>
                    setBulk((bs) =>
                      bs.map((x, idx) =>
                        idx === i ? { ...x, province: e.target.value } : x
                      )
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() => setBulk((bs) => bs.filter((_, idx) => idx !== i))}
                  className="col-span-1 text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary btn-xs mt-3"
            onClick={() => setBulk((b) => [...b, { location_code: "", name: "" }])}
          >
            <Plus size={11} /> Baris
          </button>
        </div>
      )}

      {mode === "excel" && (
        <div>
          <button
            onClick={downloadTemplate}
            className="btn-secondary btn-xs mb-3"
          >
            <Download size={11} /> Download Template
          </button>
          <label className="flex items-center gap-3 p-4 border-2 border-dashed border-ink-300 rounded-xl cursor-pointer hover:border-brand-400">
            <Upload size={20} className="text-brand-600" />
            <div className="flex-1 text-sm">
              {file ? file.name : "Klik untuk pilih file .xlsx"}
            </div>
            <input
              type="file"
              accept=".xlsx"
              hidden
              onChange={(e) => setFile(e.target.files[0])}
            />
          </label>
        </div>
      )}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Add Facility Modal — with bulk support
// ════════════════════════════════════════════════════════════════════════════

function AddFacilityModal({ open, onClose, location, onSuccess }) {
  const [rows, setRows] = useState([blankFac()]);
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("bulk");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setRows([blankFac()]);
      setFile(null);
    }
  }, [open]);

  const submit = async () => {
    if (!location) return;
    setLoading(true);
    try {
      if (mode === "bulk") {
        const items = rows.filter((r) => r.facility_code && r.facility_name);
        if (!items.length) return toast.error("Minimal satu fasilitas");
        const { data } = await facilitiesAPI.bulk(location.id, items);
        toast.success(`${data.created} fasilitas ditambahkan`);
      } else {
        if (!file) return toast.error("Pilih file");
        const { data } = await facilitiesAPI.importExcel(location.id, file);
        if (data.success) {
          toast.success(`${data.items_imported} fasilitas di-import`);
        } else {
          toast.error(data.errors?.[0] || "Import gagal");
        }
      }
      onSuccess?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = async () => {
    const { data } = await templatesAPI.facilities();
    downloadBlob(data, "template_fasilitas.xlsx");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Fasilitas di: ${location?.name || ""}`}
      size="xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading && <Spinner size={14} />} Simpan
          </button>
        </>
      }
    >
      <div className="flex gap-1 border-b border-ink-200 mb-4">
        {[
          ["bulk", "Input Langsung"],
          ["excel", "Import Excel"],
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              mode === k ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {mode === "bulk" && (
        <div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <input
                  className="input col-span-2"
                  placeholder="Kode"
                  value={r.facility_code}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((x, idx) =>
                        idx === i ? { ...x, facility_code: e.target.value } : x
                      )
                    )
                  }
                />
                <input
                  className="input col-span-5"
                  placeholder="Nama fasilitas (Gudang Beku, Pabrik Es, ...)"
                  value={r.facility_name}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((x, idx) =>
                        idx === i ? { ...x, facility_name: e.target.value } : x
                      )
                    )
                  }
                />
                <input
                  className="input col-span-3"
                  placeholder="Tipe (opsional)"
                  value={r.facility_type || ""}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((x, idx) =>
                        idx === i ? { ...x, facility_type: e.target.value } : x
                      )
                    )
                  }
                />
                <input
                  type="number"
                  className="input col-span-1"
                  placeholder="Urut"
                  value={r.display_order}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((x, idx) =>
                        idx === i ? { ...x, display_order: e.target.value } : x
                      )
                    )
                  }
                />
                <button
                  type="button"
                  className="col-span-1 text-red-500"
                  onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary btn-xs mt-3"
            onClick={() => setRows((rs) => [...rs, blankFac(rs.length)])}
          >
            <Plus size={11} /> Baris
          </button>
        </div>
      )}

      {mode === "excel" && (
        <div>
          <button
            type="button"
            onClick={downloadTemplate}
            className="btn-secondary btn-xs mb-3"
          >
            <Download size={11} /> Download Template
          </button>
          <label className="flex items-center gap-3 p-4 border-2 border-dashed border-ink-300 rounded-xl cursor-pointer hover:border-brand-400">
            <Upload size={20} className="text-brand-600" />
            <div className="flex-1 text-sm">
              {file ? file.name : "Klik untuk pilih file .xlsx"}
            </div>
            <input
              type="file"
              accept=".xlsx"
              hidden
              onChange={(e) => setFile(e.target.files[0])}
            />
          </label>
        </div>
      )}
    </Modal>
  );
}

function blankFac(order = 0) {
  return {
    facility_code: "",
    facility_name: "",
    facility_type: "",
    display_order: order,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Add Addendum Modal
// ════════════════════════════════════════════════════════════════════════════

function AddAddendumModal({ open, onClose, contract, onSuccess }) {
  const [form, setForm] = useState({
    number: "",
    addendum_type: "cco",
    effective_date: new Date().toISOString().slice(0, 10),
    extension_days: 0,
    new_end_date: "",
    new_contract_value: "",
    description: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && contract) {
      setForm({
        number: "",
        addendum_type: "cco",
        effective_date: new Date().toISOString().slice(0, 10),
        extension_days: 0,
        new_end_date: contract.end_date || "",
        new_contract_value: contract.current_value || "",
        description: "",
      });
    }
  }, [open, contract]);

  const submit = async () => {
    setLoading(true);
    try {
      await contractsAPI.createAddendum(contract.id, {
        ...form,
        extension_days: parseInt(form.extension_days) || 0,
        new_contract_value: form.new_contract_value
          ? parseFloat(form.new_contract_value)
          : null,
      });
      toast.success("Addendum tersimpan");
      onSuccess?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tambah Addendum"
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
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Nomor *</label>
            <input
              className="input"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Jenis *</label>
            <select
              className="select"
              value={form.addendum_type}
              onChange={(e) => setForm({ ...form, addendum_type: e.target.value })}
            >
              <option value="cco">CCO (perubahan item)</option>
              <option value="extension">Perpanjangan Waktu</option>
              <option value="value_change">Perubahan Nilai</option>
              <option value="combined">Gabungan</option>
            </select>
          </div>
          <div>
            <label className="label">Tanggal Berlaku *</label>
            <input
              type="date"
              className="input"
              value={form.effective_date}
              onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Tambah Hari</label>
            <input
              type="number"
              className="input"
              value={form.extension_days}
              onChange={(e) => setForm({ ...form, extension_days: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Tanggal Selesai Baru</label>
            <input
              type="date"
              className="input"
              value={form.new_end_date}
              onChange={(e) => setForm({ ...form, new_end_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Nilai Kontrak Baru</label>
            <input
              type="number"
              className="input"
              value={form.new_contract_value}
              onChange={(e) => setForm({ ...form, new_contract_value: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="label">Keterangan</label>
          <textarea
            className="textarea h-20 resize-none"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
}
