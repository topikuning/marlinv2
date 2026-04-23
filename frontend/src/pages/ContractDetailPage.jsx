import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ChevronRight, Plus, MapPin, Layers, FileText, Upload,
  Trash2, Edit2, Download, Building2, GitBranch, ClipboardList,
  Check, X as XIcon, Send, RotateCcw, AlertTriangle,
} from "lucide-react";
import {
  contractsAPI, locationsAPI, facilitiesAPI, boqAPI, masterAPI,
  templatesAPI, downloadBlob, voAPI, fieldObsAPI,
} from "@/api";
import {
  PageLoader, Modal, Tabs, Empty, Spinner, ConfirmDialog,
} from "@/components/ui";
import {
  fmtCurrency, fmtDate, contractStatusBadge, parseApiError, fmtNum,
} from "@/utils/format";
import BOQGrid from "@/components/grids/BOQGrid";
import BOQImportWizard from "@/components/modals/BOQImportWizard";
import EditContractModal from "@/components/modals/EditContractModal";
import ContractActivationPanel from "@/components/ContractActivationPanel";
import UnlockModePanel from "@/components/UnlockModePanel";

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
  const [showEdit, setShowEdit] = useState(false);

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
    { id: "rollup", label: "Rekap BOQ Lokasi" },
    { id: "revisions", label: "BOQ Versions" },
    { id: "variation_orders", label: "Variation Orders" },
    { id: "field_observations", label: "Observasi Lapangan" },
    { id: "addenda", label: "Addendum", count: contract.addenda?.length },
    ...(boqFacility ? [{ id: "boq", label: `BOQ: ${boqFacility.facility_name}` }] : []),
  ];

  // Unlock Mode: window terbuka bila unlock_until ada dan belum lewat.
  const isUnlocked =
    contract.unlock_until && new Date() < new Date(contract.unlock_until);

  // SCOPE kontrak (Lokasi, Fasilitas, rollback Addendum) editable saat:
  // - status DRAFT / ADDENDUM, atau
  // - superadmin membuka Unlock Mode (window belum expire)
  const scopeEditable =
    contract.status === "draft" ||
    contract.status === "addendum" ||
    isUnlocked;
  const facilitiesEditable = scopeEditable;
  const locationsEditable = scopeEditable;
  const scopeLockReason = scopeEditable
    ? null
    : `Lokasi & Fasilitas dikunci karena kontrak berstatus ${contract.status}. Buat Addendum untuk mengubah.`;
  const facilityLockReason = scopeLockReason;
  const locationLockReason = scopeLockReason;

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

      {/* Unlock-mode banner (hanya saat window masih aktif).
          Ditaruh di atas header agar user selalu sadar kontrak sedang
          dalam mode edit bypass. */}
      {isUnlocked && (
        <UnlockModePanel contract={contract} onChange={load} />
      )}

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
          <div className="flex gap-2 flex-wrap items-center">
            {/* Tombol "Buka Unlock Mode" (superadmin only, saat terkunci) */}
            {!isUnlocked && (
              <UnlockModePanel contract={contract} onChange={load} />
            )}
            <button
              className="btn-secondary"
              onClick={() => setShowEdit(true)}
              title="Edit detail kontrak"
            >
              <Edit2 size={14} /> Edit
            </button>
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

        {/* Activation panel — renders only for DRAFT / ACTIVE / ADDENDUM */}
        <div className="mt-5">
          <ContractActivationPanel contract={contract} onChange={load} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 border-t border-ink-100">
          {[
            ["Nilai Kontrak", fmtCurrency(contract.current_value), null],
            [
              "Total BOQ",
              fmtCurrency(contract.boq_total || 0),
              contract.boq_total != null &&
              Math.abs((contract.boq_total || 0) - (contract.current_value || 0)) >= 0.01
                ? `Selisih ${fmtCurrency((contract.boq_total || 0) - (contract.current_value || 0))} dari Nilai Kontrak`
                : null,
            ],
            ["Perusahaan", contract.company_name, null],
            ["PPK", contract.ppk_name, null],
            ["Konsultan", contract.konsultan_name || "—", null],
            ["Durasi", `${contract.duration_days} hari`, null],
            ["Mulai", fmtDate(contract.start_date), null],
            ["Selesai", fmtDate(contract.end_date), null],
            ["Tahun Anggaran", contract.fiscal_year, null],
            ["Lokasi", `${contract.locations?.length || 0}`, null],
          ].map(([label, val, hint]) => (
            <div key={label}>
              <p className="text-[10px] uppercase tracking-wider text-ink-400 font-medium">
                {label}
              </p>
              <p className="text-sm font-medium text-ink-800 mt-0.5 truncate">
                {val}
              </p>
              {hint && (
                <p className="text-[10px] text-amber-700 mt-0.5 truncate" title={hint}>
                  ⚠ {hint}
                </p>
              )}
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
          {facilityLockReason && (
            <div className="mb-4 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
              {facilityLockReason}
            </div>
          )}
          <div className="flex justify-end mb-4">
            <button
              className="btn-primary"
              onClick={() => setShowAddLocation(true)}
              disabled={!locationsEditable}
              title={locationLockReason || "Tambah lokasi baru"}
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
                        disabled={!facilitiesEditable}
                        title={facilityLockReason || "Tambah fasilitas"}
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
                      {locationsEditable && (
                        <button
                          className="btn-ghost btn-xs text-red-600"
                          onClick={() =>
                            setConfirmDel({ type: "loc", loc, name: loc.name })
                          }
                          title="Hapus lokasi"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
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
                          {facilitiesEditable && (
                            <button
                              onClick={() =>
                                setConfirmDel({
                                  type: "fac",
                                  fac: f,
                                  name: f.facility_name,
                                })
                              }
                              className="opacity-0 group-hover:opacity-100 text-red-500 p-1"
                              title="Hapus fasilitas"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
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

      {/* Rekap BOQ Lokasi (catatan #9c) */}
      {tab === "rollup" && (
        <LocationRollupPanel contract={contract} />
      )}

      {/* BOQ Versions */}
      {tab === "revisions" && (
        <RevisionsPanel contract={contract} onChange={load} />
      )}

      {/* Variation Orders */}
      {tab === "variation_orders" && (
        <VariationOrdersPanel contract={contract} onChange={load} />
      )}

      {/* Field Observations (MC-0 / MC-N) */}
      {tab === "field_observations" && (
        <FieldObservationsPanel contract={contract} onChange={load} />
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
            revisionLocked={
              // Working revision adalah revisi yang sedang dikerjakan:
              //   - DRAFT (CCO-0 baru atau CCO-N+1 hasil addendum) → editable
              //   - APPROVED aktif → locked, harus lewat Addendum baru
              // Dengan logic ini, setelah user buat Addendum, BOQ langsung
              // editable di DRAFT baru tanpa perlu navigasi tambahan.
              // Unlock Mode → bypass total: BOQ boleh diedit walau APPROVED.
              !isUnlocked &&
              contract.working_revision?.status === "approved"
            }
            readonly={
              // COMPLETED / TERMINATED normalnya readonly, tapi Unlock Mode
              // membuka juga untuk koreksi retroaktif.
              !isUnlocked &&
              (contract.status === "completed" ||
                contract.status === "terminated")
            }
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
      <EditContractModal
        open={showEdit}
        contract={contract}
        onClose={() => setShowEdit(false)}
        onSuccess={() => {
          setShowEdit(false);
          load();
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
    latitude: "", longitude: "",
  });
  const [bulk, setBulk] = useState([{ location_code: "", name: "" }]);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      if (mode === "single") {
        const payload = {
          ...form,
          latitude: form.latitude !== "" ? parseFloat(form.latitude) : null,
          longitude: form.longitude !== "" ? parseFloat(form.longitude) : null,
        };
        await locationsAPI.create(contractId, payload);
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
          {[
            ["village", "Desa/Kelurahan"],
            ["district", "Kecamatan"],
            ["city", "Kabupaten/Kota"],
            ["province", "Provinsi"],
          ].map(([f, label]) => (
            <div key={f}>
              <label className="label">{label}</label>
              <input
                className="input"
                value={form[f]}
                onChange={(e) => setForm({ ...form, [f]: e.target.value })}
              />
            </div>
          ))}
          <div>
            <label className="label">Latitude</label>
            <input
              className="input"
              type="number"
              step="any"
              placeholder="-6.2088"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Longitude</label>
            <input
              className="input"
              type="number"
              step="any"
              placeholder="106.8456"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
            />
          </div>
          <p className="col-span-2 text-[11px] text-ink-500 -mt-1">
            💡 Koordinat opsional, tapi diperlukan agar lokasi muncul di peta dashboard.
            Cara cepat: buka Google Maps, klik kanan titik lokasi, pilih koordinatnya.
          </p>
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

  // Master Fasilitas untuk autocomplete (opsi C — hybrid, boleh pilih
  // atau ketik manual). Diload sekali saat modal dibuka.
  const [masterFacilities, setMasterFacilities] = useState([]);

  useEffect(() => {
    if (open) {
      setRows([blankFac()]);
      setFile(null);
      masterAPI.facilities({ page_size: 200, is_active: true })
        .then(({ data }) => setMasterFacilities(data.items || []))
        .catch(() => setMasterFacilities([]));
    }
  }, [open]);

  // Helper: saat user pilih / ketik nama master, autofill code/type/unit
  const applyMasterMatch = (row, nameValue) => {
    const match = masterFacilities.find(
      (m) => m.name.toLowerCase() === nameValue.toLowerCase()
    );
    if (!match) return { ...row, facility_name: nameValue };
    return {
      ...row,
      facility_name: match.name,
      facility_code: row.facility_code || match.code.replace(/_/g, "-"),
      facility_type: match.facility_type,
      master_facility_id: match.id,
    };
  };

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
          {/* Datalist global untuk semua input nama fasilitas di bawah.
              Browser akan tampil dropdown otomatis saat user fokus input
              yang list="master-facility-options". Tetap allow ketik
              manual jika tidak ada yang cocok (hybrid mode). */}
          <datalist id="master-facility-options">
            {masterFacilities.map((m) => (
              <option key={m.id} value={m.name}>
                {m.code} · {m.typical_unit || ""}
              </option>
            ))}
          </datalist>

          {masterFacilities.length > 0 && (
            <p className="text-[11px] text-ink-500 mb-2 px-1">
              💡 Klik kolom nama → muncul dropdown {masterFacilities.length} master
              fasilitas, atau ketik bebas untuk fasilitas custom.
            </p>
          )}

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
                  list="master-facility-options"
                  placeholder="Pilih dari master atau ketik bebas..."
                  value={r.facility_name}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((x, idx) =>
                        idx === i ? applyMasterMatch(x, e.target.value) : x
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


// ════════════════════════════════════════════════════════════════════════════
// Location Rollup Panel — consolidated BOQ view across all facilities
// at a location (catatan #9c)
// ════════════════════════════════════════════════════════════════════════════

function LocationRollupPanel({ contract }) {
  // Default: "__all__" = rekap semua lokasi. User bisa pilih lokasi spesifik
  // kalau mau fokus. Menghemat klik untuk kontrak yang punya banyak lokasi.
  const [locationId, setLocationId] = useState("__all__");
  const [rollup, setRollup] = useState(null);
  const [allRollups, setAllRollups] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!locationId) return;
    setLoading(true);
    if (locationId === "__all__") {
      setRollup(null);
      Promise.all(
        (contract.locations || []).map((loc) =>
          boqAPI
            .locationRollup(loc.id)
            .then(({ data }) => ({ location: loc, rollup: data }))
            .catch(() => ({ location: loc, rollup: null }))
        )
      )
        .then((results) => setAllRollups(results))
        .finally(() => setLoading(false));
    } else {
      setAllRollups(null);
      boqAPI
        .locationRollup(locationId)
        .then(({ data }) => setRollup(data))
        .catch((e) => toast.error(parseApiError(e)))
        .finally(() => setLoading(false));
    }
  }, [locationId, contract.locations?.length]);

  const grandTotalAll = allRollups
    ? allRollups.reduce((a, r) => a + (r.rollup?.grand_total || 0), 0)
    : 0;
  const totalFacilitiesAll = allRollups
    ? allRollups.reduce((a, r) => a + (r.rollup?.groups.length || 0), 0)
    : 0;
  const totalLeavesAll = allRollups
    ? allRollups.reduce((a, r) => a + (r.rollup?.total_leaves || 0), 0)
    : 0;

  if (!contract.locations?.length) {
    return (
      <Empty
        icon={MapPin}
        title="Belum ada lokasi"
        description="Tambah lokasi dan fasilitas terlebih dahulu di tab Lokasi & Fasilitas."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <label className="text-xs text-ink-600 font-medium">Pilih Lokasi:</label>
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="select max-w-md"
        >
          <option value="__all__">🌐 Semua Lokasi (rekap gabungan)</option>
          {contract.locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              [{loc.location_code}] {loc.name}
            </option>
          ))}
        </select>
        {locationId === "__all__" && allRollups && (
          <div className="ml-auto text-xs text-ink-500">
            {contract.locations.length} lokasi · {totalFacilitiesAll} fasilitas ·{" "}
            {totalLeavesAll} item leaf ·{" "}
            <span className="font-semibold text-ink-800">
              Total: {fmtCurrency(grandTotalAll)}
            </span>
          </div>
        )}
        {locationId !== "__all__" && rollup && (
          <div className="ml-auto text-xs text-ink-500">
            {rollup.groups.length} fasilitas · {rollup.total_leaves} item leaf ·{" "}
            <span className="font-semibold text-ink-800">
              Total: {fmtCurrency(rollup.grand_total)}
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <PageLoader />
      ) : locationId === "__all__" ? (
        !allRollups ? null : allRollups.length === 0 ? (
          <Empty icon={MapPin} title="Belum ada lokasi di kontrak ini" />
        ) : (
          <div className="space-y-6">
            {allRollups.map(({ location, rollup: r }) => (
              <div key={location.id}>
                <div className="flex items-center gap-2 mb-2">
                  <MapPin size={14} className="text-brand-600" />
                  <span className="font-mono text-[11px] text-brand-600">
                    {location.location_code}
                  </span>
                  <span className="font-semibold text-ink-900 text-sm">
                    {location.name}
                  </span>
                  <span className="ml-auto text-xs text-ink-500">
                    {r ? (
                      <>
                        {r.groups.length} fasilitas ·{" "}
                        <span className="font-semibold text-ink-800">
                          {fmtCurrency(r.grand_total)}
                        </span>
                      </>
                    ) : (
                      <span className="text-red-600">gagal memuat</span>
                    )}
                  </span>
                </div>
                {!r || r.groups.length === 0 ? (
                  <div className="card px-5 py-3 text-xs text-ink-500">
                    Tidak ada fasilitas / item BOQ di lokasi ini.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {r.groups.map((g) => (
                      <RollupFacilityCard key={g.facility.id} group={g} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : !rollup ? null : rollup.groups.length === 0 ? (
        <Empty
          icon={Layers}
          title="Belum ada fasilitas di lokasi ini"
        />
      ) : (
        <div className="space-y-4">
          {rollup.groups.map((g) => (
            <RollupFacilityCard key={g.facility.id} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}


function RollupFacilityCard({ group: g }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 bg-ink-50 border-b border-ink-200 flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] text-brand-600">
            {g.facility.facility_code}
          </p>
          <p className="font-display font-semibold text-ink-900 text-sm">
            {g.facility.facility_name}
          </p>
        </div>
        <div className="text-right text-xs">
          <p className="text-ink-500">
            {g.item_count} item · {g.leaf_count} leaf
          </p>
          <p className="font-semibold text-ink-800">
            {fmtCurrency(g.facility_total)}
          </p>
        </div>
      </div>
      {g.items.length === 0 ? (
        <div className="px-5 py-4 text-xs text-ink-500">
          Fasilitas ini belum memiliki item BOQ.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Kode</th>
                <th className="table-th">Uraian</th>
                <th className="table-th">Satuan</th>
                <th className="table-th text-right">Volume</th>
                <th className="table-th text-right">Harga</th>
                <th className="table-th text-right">Total</th>
                <th className="table-th text-right">Bobot %</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((it) => (
                <tr key={it.id}>
                  <td
                    className="table-td font-mono text-[11px]"
                    style={{ paddingLeft: 12 + (it.level || 0) * 14 }}
                  >
                    {it.original_code}
                  </td>
                  <td
                    className="table-td"
                    style={{ fontWeight: (it.level ?? 0) <= 1 ? 600 : 400 }}
                  >
                    {it.description}
                  </td>
                  <td className="table-td text-xs">{it.unit}</td>
                  <td className="table-td text-right text-xs font-mono">
                    {fmtNum(it.volume, 2)}
                  </td>
                  <td className="table-td text-right text-xs font-mono">
                    {fmtNum(it.unit_price, 0)}
                  </td>
                  <td className="table-td text-right text-xs font-mono font-semibold">
                    {fmtNum(it.total_price, 0)}
                  </td>
                  <td className="table-td text-right text-[11px] text-ink-500">
                    {((it.weight_pct || 0) * 100).toFixed(3)}%
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
// Revisions Panel — list BOQ revisions (CCO), show status, approve drafts
// ════════════════════════════════════════════════════════════════════════════

function RevisionsPanel({ contract, onChange }) {
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(null);
  const [diffFor, setDiffFor] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await boqAPI.listRevisions(contract.id);
      setRevisions(data || []);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [contract.id]);

  const approve = async (rev) => {
    if (
      !confirm(
        `Approve ${rev.revision_code}?\n\n` +
          `Revisi lama akan di-set SUPERSEDED dan progres existing akan di-migrate otomatis.`
      )
    )
      return;
    setApproving(rev.id);
    try {
      await boqAPI.approveRevision(rev.id);
      toast.success(`${rev.revision_code} disetujui & aktif`);
      await load();
      onChange?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setApproving(null);
    }
  };

  if (loading) return <PageLoader />;

  if (revisions.length === 0) {
    return (
      <Empty
        icon={FileText}
        title="Belum ada BOQ Revision"
        description="BOQ V0 (baseline) otomatis dibuat saat kontrak di-create. Coba refresh atau cek data kontrak."
      />
    );
  }

  return (
    <>
      <div className="space-y-3">
        {revisions.map((r) => (
          <div key={r.id} className="card p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-display font-semibold text-ink-900">
                    {r.revision_code}
                  </span>
                  {r.is_active && (
                    <span className="badge-green">Aktif</span>
                  )}
                  {r.status === "draft" && (
                    <span className="badge-yellow">Draft</span>
                  )}
                  {r.status === "approved" && !r.is_active && (
                    <span className="badge-gray">Approved (lama)</span>
                  )}
                  {r.status === "superseded" && (
                    <span className="badge-gray">Superseded</span>
                  )}
                </div>
                {r.name && (
                  <p className="text-sm text-ink-700">{r.name}</p>
                )}
                {r.description && (
                  <p className="text-xs text-ink-500 mt-1 line-clamp-2">
                    {r.description}
                  </p>
                )}
                <p className="text-[11px] text-ink-400 mt-2">
                  {r.item_count} item · Total {fmtCurrency(r.total_value)}
                  {r.approved_at && ` · Approved ${fmtDate(r.approved_at)}`}
                </p>
                {r.status === "draft" && (() => {
                  // Live sync-check: DRAFT hanya bisa di-approve kalau total
                  // BOQ == nilai kontrak saat ini. Kalau beda, tampilkan
                  // peringatan dan disable tombol Approve di bawah.
                  const contractValue = Number(contract.current_value || 0);
                  const boqTotal = Number(r.total_value || 0);
                  const diff = Math.round((boqTotal - contractValue) * 100) / 100;
                  const inSync = Math.abs(diff) < 0.01;
                  return inSync ? (
                    <p className="text-[11px] text-green-700 mt-1 font-medium">
                      ✓ Sinkron dengan nilai kontrak ({fmtCurrency(contractValue)})
                    </p>
                  ) : (
                    <div className="mt-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                      <p className="font-semibold">
                        ⚠ Total BOQ ≠ Nilai Kontrak ({fmtCurrency(contractValue)})
                      </p>
                      <p className="mt-0.5">
                        Selisih: {fmtCurrency(diff)}. Approve akan ditolak
                        sampai BOQ dikoreksi atau nilai kontrak pada Addendum
                        diubah.
                      </p>
                    </div>
                  );
                })()}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {r.cco_number > 0 && (
                  <button
                    className="btn-ghost btn-xs"
                    onClick={() => setDiffFor(r)}
                    title="Bandingkan dengan revisi sebelumnya"
                  >
                    Compare
                  </button>
                )}
                {r.status === "draft" && (() => {
                  const contractValue = Number(contract.current_value || 0);
                  const boqTotal = Number(r.total_value || 0);
                  const inSync =
                    Math.abs(boqTotal - contractValue) < 0.01;
                  return (
                    <button
                      className="btn-primary btn-xs disabled:opacity-50"
                      onClick={() => approve(r)}
                      disabled={approving === r.id || !inSync}
                      title={
                        inSync
                          ? "Approve revisi"
                          : "BOQ belum sinkron dengan nilai kontrak"
                      }
                    >
                      {approving === r.id ? <Spinner size={11} /> : null} Approve
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {diffFor && (
        <RevisionDiffModal
          revision={diffFor}
          onClose={() => setDiffFor(null)}
        />
      )}
    </>
  );
}


function RevisionDiffModal({ revision, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    boqAPI
      .diffRevision(revision.id)
      .then(({ data }) => setRows(data || []))
      .catch((e) => toast.error(parseApiError(e)))
      .finally(() => setLoading(false));
  }, [revision.id]);

  const changeBadge = (ct) =>
    ct === "added"
      ? "badge-green"
      : ct === "removed"
      ? "badge-red"
      : ct === "modified"
      ? "badge-yellow"
      : "badge-gray";

  return (
    <Modal
      open
      onClose={onClose}
      title={`Diff: ${revision.revision_code} vs Revisi Sebelumnya`}
      size="xl"
      footer={
        <button className="btn-secondary" onClick={onClose}>
          Tutup
        </button>
      }
    >
      {loading ? (
        <PageLoader />
      ) : rows.length === 0 ? (
        <Empty
          title="Tidak ada item untuk dibandingkan"
          description="Revisi kosong atau tidak punya pendahulu."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="table-th">Change</th>
                <th className="table-th">Uraian</th>
                <th className="table-th text-right">Vol Lama</th>
                <th className="table-th text-right">Vol Baru</th>
                <th className="table-th text-right">Harga Lama</th>
                <th className="table-th text-right">Harga Baru</th>
                <th className="table-th text-right">Δ Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="table-td">
                    <span className={changeBadge(r.change_type)}>
                      {r.change_type || "-"}
                    </span>
                  </td>
                  <td className="table-td">{r.description}</td>
                  <td className="table-td text-right font-mono">
                    {r.old_volume != null ? fmtNum(r.old_volume, 2) : "—"}
                  </td>
                  <td className="table-td text-right font-mono">
                    {fmtNum(r.new_volume, 2)}
                  </td>
                  <td className="table-td text-right font-mono">
                    {r.old_unit_price != null
                      ? fmtNum(r.old_unit_price, 0)
                      : "—"}
                  </td>
                  <td className="table-td text-right font-mono">
                    {fmtNum(r.new_unit_price, 0)}
                  </td>
                  <td
                    className={`table-td text-right font-mono font-semibold ${
                      r.delta_total > 0
                        ? "text-emerald-700"
                        : r.delta_total < 0
                        ? "text-red-700"
                        : "text-ink-500"
                    }`}
                  >
                    {r.delta_total === 0
                      ? "0"
                      : (r.delta_total > 0 ? "+" : "") +
                        fmtNum(r.delta_total, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// Variation Orders Panel — daftar VO + actions (submit/approve/reject)
// ════════════════════════════════════════════════════════════════════════════
const VO_STATUS_LABEL = {
  draft: "Draft", under_review: "Review",
  approved: "Disetujui", rejected: "Ditolak", bundled: "Ter-bundle",
};
const VO_STATUS_BADGE = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  under_review: "bg-blue-50 text-blue-700 border-blue-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  bundled: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

function VariationOrdersPanel({ contract, onChange }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);
  const [actionModal, setActionModal] = useState(null);

  const refresh = () => {
    setLoading(true);
    voAPI.listByContract(contract.id)
      .then(({ data }) => setList(data.items || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, [contract.id]);

  const doAction = async (vo, action, payload = {}) => {
    try {
      if (action === "submit") await voAPI.submit(vo.id);
      else if (action === "approve") await voAPI.approve(vo.id, payload);
      else if (action === "reject") await voAPI.reject(vo.id, payload);
      else if (action === "delete") await voAPI.remove(vo.id);
      toast.success(`VO ${action} sukses`);
      setActionModal(null);
      refresh();
    } catch (e) { toast.error(parseApiError(e)); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-xs text-ink-500">
          {list.length} VO · <span className="font-medium">Usulan perubahan</span> yang menggantung sampai di-bundle ke Addendum
        </div>
        <button className="btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          <Plus size={13} /> VO Baru
        </button>
      </div>

      {loading ? (
        <PageLoader />
      ) : list.length === 0 ? (
        <Empty icon={ClipboardList} title="Belum ada Variation Order"
          description="VO adalah usulan perubahan pekerjaan (justifikasi teknis). Setelah approved, VO di-bundle ke Addendum untuk legalisasi." />
      ) : (
        <div className="space-y-2">
          {list.map((vo) => (
            <div key={vo.id} className="card p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[10px] text-brand-600">{vo.vo_number}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${VO_STATUS_BADGE[vo.status]}`}>
                      {VO_STATUS_LABEL[vo.status] || vo.status}
                    </span>
                    {vo.god_mode_bypass && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200" title="Dibuat/diubah via God-Mode (Unlock)">
                        ⚡ god-mode
                      </span>
                    )}
                  </div>
                  <p className="font-medium text-ink-900 mt-1">{vo.title}</p>
                  <p className="text-xs text-ink-500 mt-0.5 line-clamp-2">{vo.technical_justification}</p>
                  <div className="flex items-center gap-3 text-[11px] text-ink-500 mt-1.5">
                    <span>Dampak: <span className={`font-semibold ${vo.cost_impact >= 0 ? "text-ink-800" : "text-red-700"}`}>
                      {vo.cost_impact >= 0 ? "+" : ""}{fmtCurrency(vo.cost_impact)}
                    </span></span>
                    <span>Dibuat: {fmtDate(vo.created_at)}</span>
                  </div>
                </div>
                <div className="flex gap-1 flex-wrap">
                  <button className="btn-ghost btn-xs" onClick={() => setDetail(vo)}>Lihat</button>
                  {vo.status === "draft" && (
                    <button className="btn-primary btn-xs" onClick={() => doAction(vo, "submit")}>
                      <Send size={10} /> Submit
                    </button>
                  )}
                  {vo.status === "under_review" && (
                    <>
                      <button className="btn-secondary btn-xs" onClick={() => setActionModal({ vo, action: "approve" })}>
                        <Check size={10} /> Approve
                      </button>
                      <button className="btn-ghost btn-xs text-red-600" onClick={() => setActionModal({ vo, action: "reject" })}>
                        <XIcon size={10} /> Reject
                      </button>
                    </>
                  )}
                  {(vo.status === "draft" || vo.status === "rejected") && (
                    <button className="btn-ghost btn-xs text-red-600" onClick={() => {
                      if (confirm("Hapus VO ini?")) doAction(vo, "delete");
                    }}>
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <VOCreateModal contract={contract} onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); refresh(); }} />
      )}
      {detail && <VODetailModal vo={detail} onClose={() => setDetail(null)} />}
      {actionModal && (
        <VOActionModal vo={actionModal.vo} action={actionModal.action}
          onClose={() => setActionModal(null)}
          onConfirm={(payload) => doAction(actionModal.vo, actionModal.action, payload)} />
      )}
    </div>
  );
}

function VOCreateModal({ contract, onClose, onSuccess }) {
  const [form, setForm] = useState({
    title: "", technical_justification: "", quantity_calculation: "", items: [],
  });
  const [saving, setSaving] = useState(false);
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, {
    action: "increase", boq_item_id: "", facility_id: "",
    description: "", unit: "", volume_delta: 0, unit_price: 0, notes: "",
  }]}));
  const updateItem = (idx, key, val) => setForm((f) => ({
    ...f, items: f.items.map((it, i) => i === idx ? { ...it, [key]: val } : it),
  }));
  const removeItem = (idx) => setForm((f) => ({
    ...f, items: f.items.filter((_, i) => i !== idx),
  }));
  const submit = async () => {
    if (form.technical_justification.length < 50) return toast.error("Justifikasi teknis minimal 50 karakter");
    if (!form.items.length) return toast.error("Tambahkan minimal 1 item perubahan");
    setSaving(true);
    try {
      await voAPI.create(contract.id, form);
      toast.success("VO tersimpan sebagai DRAFT");
      onSuccess?.();
    } catch (e) { toast.error(parseApiError(e)); }
    finally { setSaving(false); }
  };
  const locations = contract.locations || [];
  const allFacilities = locations.flatMap((l) => (l.facilities || []).map((f) => ({ ...f, loc: l })));
  return (
    <Modal open onClose={onClose} title="VO Baru · DRAFT" size="xl" footer={
      <>
        <button className="btn-secondary" onClick={onClose}>Batal</button>
        <button className="btn-primary" onClick={submit} disabled={saving}>
          {saving && <Spinner size={12} />} Simpan sebagai DRAFT
        </button>
      </>
    }>
      <div className="space-y-3 text-sm">
        <div>
          <label className="label">Judul *</label>
          <input className="input" value={form.title} maxLength={200}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Contoh: Penambahan revetmen segmen timur akibat abrasi" />
        </div>
        <div>
          <label className="label">Justifikasi Teknis * (min 50 karakter)</label>
          <textarea className="input" rows={4} value={form.technical_justification}
            onChange={(e) => setForm({ ...form, technical_justification: e.target.value })}
            placeholder="Jelaskan latar belakang teknis perubahan ini..." />
          <p className="text-[11px] text-ink-500 mt-0.5">
            {form.technical_justification.length} / 50 karakter minimum
          </p>
        </div>
        <div>
          <label className="label">Perhitungan Volume (opsional)</label>
          <textarea className="input" rows={2} value={form.quantity_calculation}
            onChange={(e) => setForm({ ...form, quantity_calculation: e.target.value })} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Items Perubahan</label>
            <button type="button" className="btn-ghost btn-xs" onClick={addItem}>
              <Plus size={11} /> Tambah Item
            </button>
          </div>
          {form.items.length === 0 ? (
            <p className="text-xs text-ink-500 italic p-3 bg-ink-50 rounded">Belum ada item — klik "Tambah Item"</p>
          ) : (
            <div className="space-y-2">
              {form.items.map((it, idx) => (
                <div key={idx} className="border border-ink-200 rounded-lg p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink-700">Item {idx + 1}</span>
                    <button className="text-red-600" onClick={() => removeItem(idx)}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label text-[10px]">Aksi</label>
                      <select className="select py-1 text-xs" value={it.action}
                        onChange={(e) => updateItem(idx, "action", e.target.value)}>
                        <option value="add">Tambah Item Baru</option>
                        <option value="increase">Tambah Volume</option>
                        <option value="decrease">Kurangi Volume</option>
                        <option value="modify_spec">Ubah Spesifikasi</option>
                        <option value="remove">Hilangkan Item</option>
                      </select>
                    </div>
                    {it.action === "add" ? (
                      <div>
                        <label className="label text-[10px]">Fasilitas Target</label>
                        <select className="select py-1 text-xs" value={it.facility_id}
                          onChange={(e) => updateItem(idx, "facility_id", e.target.value)}>
                          <option value="">— pilih —</option>
                          {allFacilities.map((f) => (
                            <option key={f.id} value={f.id}>[{f.loc.location_code}] {f.facility_code} {f.facility_name}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label className="label text-[10px]">BOQ Item ID</label>
                        <input className="input py-1 text-xs font-mono" value={it.boq_item_id}
                          onChange={(e) => updateItem(idx, "boq_item_id", e.target.value)}
                          placeholder="UUID dari tab BOQ" />
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="label text-[10px]">Deskripsi</label>
                    <input className="input py-1 text-xs" value={it.description}
                      onChange={(e) => updateItem(idx, "description", e.target.value)} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="label text-[10px]">Satuan</label>
                      <input className="input py-1 text-xs" value={it.unit}
                        onChange={(e) => updateItem(idx, "unit", e.target.value)} />
                    </div>
                    <div>
                      <label className="label text-[10px]">Volume Delta</label>
                      <input type="number" step="any" className="input py-1 text-xs" value={it.volume_delta}
                        onChange={(e) => updateItem(idx, "volume_delta", e.target.value)} />
                    </div>
                    <div>
                      <label className="label text-[10px]">Harga Satuan</label>
                      <input type="number" step="any" className="input py-1 text-xs" value={it.unit_price}
                        onChange={(e) => updateItem(idx, "unit_price", e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function VODetailModal({ vo, onClose }) {
  return (
    <Modal open onClose={onClose} title={`Detail ${vo.vo_number}`} size="lg" footer={
      <button className="btn-primary" onClick={onClose}>Tutup</button>
    }>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${VO_STATUS_BADGE[vo.status]}`}>
            {VO_STATUS_LABEL[vo.status] || vo.status}
          </span>
          <span className="font-medium text-ink-900">{vo.title}</span>
        </div>
        <div>
          <p className="text-xs text-ink-500 font-medium mb-0.5">Justifikasi Teknis</p>
          <p className="whitespace-pre-line text-sm">{vo.technical_justification}</p>
        </div>
        {vo.quantity_calculation && (
          <div>
            <p className="text-xs text-ink-500 font-medium mb-0.5">Perhitungan Volume</p>
            <p className="whitespace-pre-line text-sm">{vo.quantity_calculation}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-ink-500">Dampak Biaya</p>
            <p className={`font-semibold ${vo.cost_impact >= 0 ? "text-ink-800" : "text-red-700"}`}>
              {vo.cost_impact >= 0 ? "+" : ""}{fmtCurrency(vo.cost_impact)}
            </p>
          </div>
          <div>
            <p className="text-ink-500">Dibuat</p>
            <p>{fmtDate(vo.created_at)}</p>
          </div>
        </div>
        {vo.rejection_reason && (
          <div className="p-3 rounded bg-red-50 border border-red-200 text-xs text-red-800">
            <p className="font-semibold">Ditolak</p>
            <p className="mt-1">{vo.rejection_reason}</p>
          </div>
        )}
        {vo.items?.length > 0 && (
          <div>
            <p className="text-xs text-ink-500 font-medium mb-1">{vo.items.length} Item Perubahan</p>
            <div className="space-y-1">
              {vo.items.map((it, i) => (
                <div key={it.id || i} className="text-xs border border-ink-200 rounded p-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono uppercase text-[10px] bg-ink-100 px-1.5 py-0.5 rounded">
                      {it.action}
                    </span>
                    <span className="font-medium">{it.description}</span>
                  </div>
                  <div className="text-ink-500 mt-0.5">
                    Δ {it.volume_delta} {it.unit} × {fmtCurrency(it.unit_price)} = <span className="font-semibold">{fmtCurrency(it.cost_impact)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function VOActionModal({ vo, action, onClose, onConfirm }) {
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const isApprove = action === "approve";
  const isReject = action === "reject";
  const canConfirm = isApprove || (isReject && reason.trim().length >= 20);
  return (
    <Modal open onClose={onClose}
      title={isApprove ? `Approve ${vo.vo_number}` : `Reject ${vo.vo_number}`}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button
            className={isReject ? "btn-primary bg-red-600 hover:bg-red-700 border-red-600" : "btn-primary"}
            onClick={() => onConfirm(isReject ? { reason } : { notes })}
            disabled={!canConfirm}>
            {isReject ? "Reject" : "Approve"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-700">{vo.title}</p>
        {isApprove ? (
          <div>
            <label className="label">Catatan (opsional)</label>
            <textarea className="input" rows={3} value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan approval..." />
            <p className="text-[11px] text-amber-700 mt-1">
              ⓘ Approve = VO masuk antrean BUNDLED. Belum mengubah BOQ sampai di-bundle ke Addendum yang ditandatangani.
            </p>
          </div>
        ) : (
          <div>
            <label className="label">Alasan Penolakan * (min 20 karakter)</label>
            <textarea className="input" rows={4} value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Jelaskan alasan teknis/administratif penolakan..." />
            <p className="text-[11px] text-ink-500 mt-0.5">
              {reason.trim().length} / 20 karakter · Penolakan bersifat terminal (tidak bisa di-undo)
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// Field Observations Panel — MC-0 + MC-N
// ════════════════════════════════════════════════════════════════════════════
function FieldObservationsPanel({ contract, onChange }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const refresh = () => {
    setLoading(true);
    fieldObsAPI.listByContract(contract.id)
      .then(({ data }) => setList(data.items || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, [contract.id]);
  const hasMC0 = list.some((o) => o.type === "mc_0");
  const del = async (id) => {
    if (!confirm("Hapus observasi ini?")) return;
    try { await fieldObsAPI.remove(id); toast.success("Terhapus"); refresh(); }
    catch (e) { toast.error(parseApiError(e)); }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-xs text-ink-500">
          {list.length} observasi · <span className="font-medium">Non-legal</span> — hanya identifikasi lapangan, tidak mengubah BOQ
        </div>
        <button className="btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          <Plus size={13} /> {hasMC0 ? "MC Lanjutan" : "MC-0"}
        </button>
      </div>
      {loading ? <PageLoader /> : list.length === 0 ? (
        <Empty icon={ClipboardList} title="Belum ada observasi lapangan"
          description="MC-0 (Mutual Check awal) dilakukan sebelum pelaksanaan untuk validasi volume BOQ vs kondisi lapangan." />
      ) : (
        <div className="space-y-2">
          {list.map((o) => (
            <div key={o.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${
                      o.type === "mc_0" ? "bg-brand-50 text-brand-700 border-brand-200"
                                       : "bg-slate-100 text-slate-700 border-slate-200"
                    }`}>
                      {o.type === "mc_0" ? "MC-0" : "MC Lanjutan"}
                    </span>
                    <span className="text-xs text-ink-500">{fmtDate(o.observation_date)}</span>
                  </div>
                  <p className="font-medium text-ink-900 mt-1">{o.title}</p>
                  <p className="text-xs text-ink-600 mt-1 line-clamp-3 whitespace-pre-line">{o.findings}</p>
                  {o.attendees && (<p className="text-[11px] text-ink-500 mt-1">Hadir: {o.attendees}</p>)}
                </div>
                <button className="btn-ghost btn-xs text-red-600" onClick={() => del(o.id)}>
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showCreate && (
        <FOCreateModal contract={contract} hasMC0={hasMC0}
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); refresh(); }} />
      )}
    </div>
  );
}

function FOCreateModal({ contract, hasMC0, onClose, onSuccess }) {
  const [form, setForm] = useState({
    type: hasMC0 ? "mc_interim" : "mc_0",
    observation_date: new Date().toISOString().slice(0, 10),
    title: "", findings: "", attendees: "",
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (form.findings.length < 10) return toast.error("Temuan minimal 10 karakter");
    setSaving(true);
    try { await fieldObsAPI.create(contract.id, form); toast.success("Observasi tersimpan"); onSuccess?.(); }
    catch (e) { toast.error(parseApiError(e)); }
    finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Observasi Lapangan Baru" size="lg" footer={
      <>
        <button className="btn-secondary" onClick={onClose}>Batal</button>
        <button className="btn-primary" onClick={submit} disabled={saving}>
          {saving && <Spinner size={12} />} Simpan
        </button>
      </>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Jenis</label>
            <select className="select" value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              disabled={!hasMC0}>
              {!hasMC0 && <option value="mc_0">MC-0 (awal pelaksanaan)</option>}
              <option value="mc_interim">MC Lanjutan (interim)</option>
            </select>
            {!hasMC0 && (
              <p className="text-[11px] text-amber-700 mt-0.5">ⓘ MC-0 wajib dibuat sebelum MC lanjutan</p>
            )}
          </div>
          <div>
            <label className="label">Tanggal</label>
            <input type="date" className="input" value={form.observation_date}
              onChange={(e) => setForm({ ...form, observation_date: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label">Judul *</label>
          <input className="input" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Contoh: MC-0 Lokasi Tallo" />
        </div>
        <div>
          <label className="label">Temuan * (min 10 karakter)</label>
          <textarea className="input" rows={5} value={form.findings}
            onChange={(e) => setForm({ ...form, findings: e.target.value })}
            placeholder="Catatan hasil pengukuran vs BOQ kontrak. Item/volume yang beda..." />
        </div>
        <div>
          <label className="label">Daftar Hadir</label>
          <input className="input" value={form.attendees}
            onChange={(e) => setForm({ ...form, attendees: e.target.value })}
            placeholder="PPK: ..., Konsultan: ..., Kontraktor: ..." />
        </div>
        <div className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
          ⓘ Observasi lapangan <strong>tidak</strong> mengubah BOQ. Untuk mengusulkan perubahan, buat VO yang merujuk ke observasi ini.
        </div>
      </div>
    </Modal>
  );
}
