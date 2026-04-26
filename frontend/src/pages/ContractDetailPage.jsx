import React, { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ChevronRight, Plus, MapPin, Layers, FileText, Upload,
  Trash2, Edit2, Download, Building2, GitBranch, ClipboardList,
  Check, X as XIcon, Send, RotateCcw, AlertTriangle, Search, Lock,
} from "lucide-react";
import {
  contractsAPI, locationsAPI, facilitiesAPI, boqAPI, masterAPI,
  templatesAPI, downloadBlob, voAPI, fieldObsAPI,
} from "@/api";
import { useAuthStore } from "@/store/auth";
import {
  PageLoader, Modal, Tabs, Empty, Spinner, ConfirmDialog,
} from "@/components/ui";
import {
  fmtCurrency, fmtDate, contractStatusBadge, parseApiError, fmtNum, fmtVolume,
} from "@/utils/format";
import BOQGrid from "@/components/grids/BOQGrid";
import BOQImportWizard from "@/components/modals/BOQImportWizard";
import EditContractModal from "@/components/modals/EditContractModal";
import ContractActivationPanel from "@/components/ContractActivationPanel";
import UnlockModePanel from "@/components/UnlockModePanel";

export default function ContractDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  // Role kontraktor di-batasi: TIDAK boleh edit field admin kontrak,
  // tidak boleh approve/reject VO. Bisa view semua, bisa create VO +
  // MC-0 (kontraktor yang mengajukan). Lihat backend guard assert_role_in.
  const role = user?.role?.code;
  const isContractor = role === "kontraktor";
  const canEditContract = !isContractor;   // superadmin/ppk/admin_pusat/kpa
  const canApproveVO = role === "ppk" || role === "admin_pusat" || role === "superadmin";
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [editLocation, setEditLocation] = useState(null); // location obj untuk edit
  const [showAddFacility, setShowAddFacility] = useState(null); // location obj
  const [showAddendum, setShowAddendum] = useState(false);
  const [editAddendum, setEditAddendum] = useState(null); // addendum DRAFT yg di-edit
  const [signAddendum, setSignAddendum] = useState(null); // addendum DRAFT yg mau di-sign
  const [boqFacility, setBoqFacility] = useState(null);
  const [boqItems, setBoqItems] = useState([]);
  const [boqLocation, setBoqLocation] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  // Cross-tab handoff: MC-0 → VO shortcut. Saat user simpan observasi dan
  // confirm "buat VO sekarang", kita switch ke tab VO dan set prefill ini.
  // VariationOrdersPanel akan auto-buka VOCreateModal dengan source_observation_id
  // ter-isi sehingga koneksi MC ↔ VO eksplisit.
  const [pendingVOFromObs, setPendingVOFromObs] = useState(null);

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

  // BOQ lock: revisi aktif sudah APPROVED dan tidak ada DRAFT pending.
  // Unlock Mode bypass.
  const boqLocked =
    !isUnlocked && contract.working_revision?.status === "approved";

  // SCOPE kontrak (Lokasi, Fasilitas, rollback Addendum) editable saat:
  // - Unlock Mode (superadmin override), ATAU
  // - status DRAFT / ADDENDUM **DAN** BOQ belum locked (= ada revisi DRAFT
  //   pending yang masih bisa di-edit). Kalau revisi sudah APPROVED meski
  //   status masih ADDENDUM, scope otomatis locked — tambah/hapus fasilitas
  //   akan affect BOQ yang sudah final.
  const scopeEditable = isUnlocked ||
    ((contract.status === "draft" || contract.status === "addendum") && !boqLocked);
  const facilitiesEditable = scopeEditable;
  const locationsEditable = scopeEditable;
  const scopeLockReason = scopeEditable
    ? null
    : boqLocked
      ? `Lokasi & Fasilitas dikunci karena revisi BOQ aktif sudah APPROVED. Buat Addendum baru untuk mengubah scope.`
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
            {canEditContract && (
              <button
                className="btn-secondary"
                onClick={() => setShowEdit(true)}
                title="Edit detail kontrak"
              >
                <Edit2 size={14} /> Edit
              </button>
            )}
            <button
              className="btn-secondary"
              onClick={() => navigate(`/scurve?contract=${id}`)}
            >
              <FileText size={14} /> Kurva S
            </button>
          </div>
        </div>

        {/* Activation panel — renders only for DRAFT / ACTIVE / ADDENDUM */}
        <div className="mt-5">
          <ContractActivationPanel contract={contract} onChange={load} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 border-t border-ink-100">
          {(() => {
            // Konvensi: Nilai Kontrak (current_value) sudah termasuk PPN.
            // Validasi: BOQ + (BOQ × PPN%) = Nilai Kontrak.
            const ppnPct = parseFloat(contract.ppn_pct || 0);
            const contractValue = parseFloat(contract.current_value || 0);
            const boqTotal = parseFloat(contract.boq_total || 0);
            const ppnAmount = boqTotal * (ppnPct / 100);
            const boqWithPpn = boqTotal + ppnAmount;
            const diff = boqWithPpn - contractValue;
            // Tolerance 1 Rp — absorb floating-point error dari kalkulasi
            // PPN, sambil tetap detect mismatch nyata (selisih ≥ 1 Rp).
            const TOL = 1;
            const inSync = boqTotal > 0 && Math.abs(diff) < TOL;
            const exceeds = boqTotal > 0 && diff >= TOL; // BOQ+PPN > kontrak
            const money = (n) => [fmtCurrency(n, false), fmtCurrency(n, true)];
            // Hint Total BOQ
            const boqHint = boqTotal > 0
              ? exceeds
                ? `+ PPN ${fmtCurrency(ppnAmount)} = ${fmtCurrency(boqWithPpn)} MELEBIHI Nilai Kontrak (Δ +${fmtCurrency(diff)})`
                : inSync
                  ? `+ PPN ${fmtCurrency(ppnAmount)} = ${fmtCurrency(boqWithPpn)} ✓ sinkron`
                  : `+ PPN ${fmtCurrency(ppnAmount)} = ${fmtCurrency(boqWithPpn)} (buffer ${fmtCurrency(-diff)})`
              : null;
            // Hint Nilai Kontrak — tampilkan status sinkron juga
            const contractHint = boqTotal > 0
              ? exceeds
                ? `≠ BOQ+PPN — BOQ ${fmtCurrency(boqTotal)} + PPN ${ppnPct}% melebihi`
                : inSync
                  ? `Sudah termasuk PPN ${ppnPct}% ✓ sinkron dgn BOQ`
                  : `Sudah termasuk PPN ${ppnPct}%`
              : `Sudah termasuk PPN ${ppnPct}%`;
            return [
              ["Nilai Kontrak", money(contractValue), contractHint, exceeds ? "exceed" : inSync ? "ok" : "neutral"],
              ["Total BOQ", money(boqTotal), boqHint, exceeds ? "exceed" : inSync ? "ok" : "neutral"],
              ["PPN", [`${ppnPct}% · ${fmtCurrency(ppnAmount, false)}`, `${ppnPct}% · ${fmtCurrency(ppnAmount, true)}`], "Pajak Pertambahan Nilai", "neutral"],
              ["Perusahaan", contract.company_name, null, null],
              ["PPK", contract.ppk_name, null, null],
              ["Konsultan", contract.konsultan_name || "—", null, null],
              ["Durasi", `${contract.duration_days} hari`, null, null],
              ["Mulai", fmtDate(contract.start_date), null, null],
              ["Selesai", fmtDate(contract.end_date), null, null],
              ["Tahun Anggaran", contract.fiscal_year, null, null],
              ["Lokasi", `${contract.locations?.length || 0}`, null, null],
            ];
          })().map(([label, val, hint, state]) => {
            const isResponsive = Array.isArray(val);
            const valColor =
              state === "exceed" ? "text-red-700"
              : state === "ok" ? "text-emerald-700"
              : "text-ink-800";
            const hintColor =
              state === "exceed" ? "text-red-700 font-medium"
              : state === "ok" ? "text-emerald-700"
              : "text-amber-700";
            const hintIcon =
              state === "exceed" ? "⚠"
              : state === "ok" ? "✓"
              : "⚠";
            return (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-wider text-ink-400 font-medium">
                  {label}
                </p>
                <p
                  className={`text-sm font-medium ${valColor} mt-0.5 truncate`}
                  title={isResponsive ? val[0] : undefined}
                >
                  {isResponsive ? (
                    <>
                      <span className="hidden lg:inline">{val[0]}</span>
                      <span className="lg:hidden">{val[1]}</span>
                    </>
                  ) : val}
                </p>
                {hint && (
                  <p className={`text-[10px] ${hintColor} mt-0.5 truncate`} title={hint}>
                    {hintIcon} {hint}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {/* Overview */}
      {tab === "overview" && (
        <div className="space-y-4">
          <ContractChainStatusPanel contract={contract} onGoTab={setTab} />
          <ContractChainTimeline contract={contract} onGoTab={setTab} />
          <div className="card p-6 text-sm text-ink-600">
            <p className="font-medium text-ink-800 mb-2">Deskripsi Kontrak</p>
            <p className="whitespace-pre-line">
              {contract.description || "Tidak ada deskripsi."}
            </p>
          </div>
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
          {boqLocked && (
            <div className="mb-4 px-3 py-2 rounded-md bg-indigo-50 border border-indigo-200 text-xs text-indigo-800 flex items-start gap-2">
              <Lock size={13} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">BOQ read-only — revisi aktif {contract.working_revision?.revision_code || "V0"} sudah APPROVED.</p>
                <p className="mt-0.5">
                  Klik fasilitas masih bisa untuk <span className="font-medium">melihat</span> BOQ,
                  tapi item tidak bisa diubah. Untuk mengubah: buat VO, setujui PPK, lalu bundle ke Adendum.
                </p>
              </div>
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
                          .join(", ") || <span className="italic text-ink-400">alamat belum diisi</span>}
                      </p>
                      <p className="text-[10px] text-ink-500 mt-0.5 font-mono">
                        {loc.latitude != null && loc.longitude != null ? (
                          <span className="text-emerald-700">
                            📍 {Number(loc.latitude).toFixed(6)}, {Number(loc.longitude).toFixed(6)}
                          </span>
                        ) : (
                          <span className="text-amber-700">⚠ koordinat belum diisi — klik Edit untuk menambahkan</span>
                        )}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        className="btn-ghost btn-xs"
                        onClick={() => setEditLocation(loc)}
                        title="Edit lokasi (termasuk koordinat)"
                      >
                        <Edit2 size={11} /> Edit
                      </button>
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
                        disabled={boqLocked}
                        title={boqLocked ? "Import BOQ dikunci — revisi APPROVED. Buat Adendum untuk revisi baru, lalu import ke revisi DRAFT itu." : "Import BOQ dari Excel"}
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
                      {loc.facilities.map((f) =>
                        f.is_removed_in_active_rev ? (
                          <div
                            key={f.id}
                            className="flex items-center gap-2 px-3 py-2 bg-red-50 rounded-lg border border-red-200 opacity-60"
                            title="Fasilitas ini dihapus via Adendum (REMOVE_FACILITY)"
                          >
                            <XIcon size={12} className="text-red-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-ink-500 truncate line-through">
                                {f.facility_name}
                              </p>
                              <p className="text-[10px] text-red-400 font-mono">
                                {f.facility_code} · <span className="italic">Dihapus via Adendum</span>
                              </p>
                            </div>
                          </div>
                        ) : (
                        <div
                          key={f.id}
                          className="group flex items-center gap-2 px-3 py-2 bg-ink-50 hover:bg-brand-50 rounded-lg border border-ink-200 hover:border-brand-300 transition"
                          title={boqLocked ? "BOQ read-only — revisi APPROVED, buat Adendum untuk mengubah" : "Klik untuk edit BOQ"}
                        >
                          {boqLocked ? (
                            <Lock size={12} className="text-indigo-600 flex-shrink-0" />
                          ) : (
                            <Layers size={12} className="text-brand-600 flex-shrink-0" />
                          )}
                          <button
                            onClick={() => openBOQ(f, loc)}
                            className="flex-1 text-left min-w-0"
                          >
                            <p className="text-xs font-medium text-ink-800 truncate">
                              {f.facility_name}
                            </p>
                            <p className="text-[10px] text-ink-400 font-mono">
                              {f.facility_code} · {fmtNum(f.total_value)}
                              {boqLocked && <span className="ml-1 text-indigo-600">· read-only</span>}
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
                        )
                      )}
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
        <VariationOrdersPanel
          contract={contract}
          onChange={load}
          canApprove={canApproveVO}
          pendingFromObs={pendingVOFromObs}
          onConsumePendingFromObs={() => setPendingVOFromObs(null)}
        />
      )}

      {/* Field Observations (MC-0 / MC-N) */}
      {tab === "field_observations" && (
        <FieldObservationsPanel
          contract={contract}
          onChange={load}
          onCreateVOFromObservation={(obs) => {
            setPendingVOFromObs(obs);
            setTab("variation_orders");
          }}
        />
      )}

      {/* Addenda */}
      {tab === "addenda" && (
        <div>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="text-xs text-ink-500">
              {contract.addenda?.length || 0} addendum ·{" "}
              <span className="font-medium">Legal</span> — titik perubahan BOQ yang ter-bundle dari VO APPROVED
            </div>
            {canEditContract && (
              <button className="btn-primary btn-sm" onClick={() => setShowAddendum(true)}>
                <Plus size={13} /> Addendum Baru
              </button>
            )}
          </div>
          {!contract.addenda?.length ? (
            <Empty
              icon={FileText}
              title="Belum ada addendum"
              description="Buat addendum ketika ada VO APPROVED yang mau di-bundle, atau perpanjangan waktu / perubahan nilai"
            />
          ) : (
            <div className="space-y-3">
              {contract.addenda.map((a) => {
                const isDraft = !a.signed_at;
                return (
                <div key={a.id} className="card p-4 flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    isDraft ? "bg-slate-100" : "bg-amber-50"
                  }`}>
                    <FileText size={16} className={isDraft ? "text-slate-500" : "text-amber-600"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-ink-900">{a.number}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${
                        isDraft
                          ? "bg-slate-100 text-slate-700 border-slate-300"
                          : "bg-emerald-50 text-emerald-700 border-emerald-300"
                      }`}>
                        {isDraft ? "DRAFT" : "SIGNED"}
                      </span>
                      <span className="badge-gray text-[10px]">{a.addendum_type?.toUpperCase()}</span>
                      {a.extension_days > 0 && (
                        <span className="badge-yellow">+{a.extension_days} hari</span>
                      )}
                      {a.new_contract_value && (
                        <span className="text-xs font-medium text-ink-700">
                          {fmtCurrency(a.new_contract_value)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-500 mt-0.5">
                      Berlaku: {fmtDate(a.effective_date)}
                      {a.bundled_vos?.length > 0 && (
                        <span className="ml-2">· {a.bundled_vos.length} VO ter-link</span>
                      )}
                      {!isDraft && a.signed_at && (
                        <span className="ml-2">· Ditandatangani {fmtDate(a.signed_at)}</span>
                      )}
                    </p>
                    {a.description && (
                      <p className="text-xs text-ink-600 mt-1">{a.description}</p>
                    )}
                    {a.bundled_vos?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {a.bundled_vos.map((v) => (
                          <span key={v.id} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
                            {v.vo_number}
                          </span>
                        ))}
                      </div>
                    )}
                    {isDraft && (
                      <p className="text-[11px] text-amber-700 mt-2">
                        ℹ Addendum DRAFT belum mengubah kontrak. Klik "Tanda Tangan" untuk apply.
                      </p>
                    )}
                  </div>
                  {canEditContract && (
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      {isDraft && (
                        <>
                          <button
                            className="btn-ghost btn-xs"
                            onClick={() => setEditAddendum(a)}
                            title="Edit metadata + VO yang di-link"
                          >
                            <Edit2 size={10} /> Edit
                          </button>
                          <button
                            className="btn-primary btn-xs"
                            onClick={() => setSignAddendum(a)}
                            title="Tanda tangani & apply ke kontrak"
                          >
                            <Check size={10} /> Tanda Tangan
                          </button>
                        </>
                      )}
                      <button
                        className="btn-ghost btn-xs text-red-600 hover:bg-red-50"
                        onClick={async () => {
                          const consequence = isDraft
                            ? `Konsekuensi:\n- VO ter-link kembali tidak ter-link\n- Tidak ada perubahan ke kontrak (DRAFT belum apply)`
                            : `Konsekuensi:\n- Revisi BOQ yang dihasilkan akan ikut terhapus (kalau masih DRAFT)\n- VO ter-bundle kembali ke APPROVED` +
                              (a.old_contract_value ? `\n- Nilai kontrak dikembalikan ke ${fmtCurrency(a.old_contract_value)}` : "") +
                              (a.old_end_date ? `\n- Tanggal selesai dikembalikan ke ${fmtDate(a.old_end_date)}` : "");
                          if (!confirm(`Hapus Addendum ${a.number} (${isDraft ? "DRAFT" : "SIGNED"})?\n\n${consequence}`)) return;
                          try {
                            const { data } = await contractsAPI.deleteAddendum(contract.id, a.id);
                            toast.success(
                              `Addendum dihapus` +
                              (data?.unlinked_vos ? ` — ${data.unlinked_vos} VO di-unlink` : "")
                            );
                            window.location.reload();
                          } catch (e) { toast.error(parseApiError(e)); }
                        }}
                      >
                        <Trash2 size={10} /> Hapus
                      </button>
                    </div>
                  )}
                </div>
                );
              })}
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
      <AddLocationModal
        open={!!editLocation}
        onClose={() => setEditLocation(null)}
        contractId={id}
        initial={editLocation}
        onSuccess={() => {
          setEditLocation(null);
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
      <AddAddendumModal
        open={!!editAddendum}
        onClose={() => setEditAddendum(null)}
        contract={contract}
        initial={editAddendum}
        onSuccess={() => {
          setEditAddendum(null);
          load();
        }}
      />
      {signAddendum && (
        <SignAddendumModal
          contract={contract}
          addendum={signAddendum}
          onClose={() => setSignAddendum(null)}
          onSuccess={() => { setSignAddendum(null); load(); }}
        />
      )}
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

function AddLocationModal({ open, onClose, contractId, initial, onSuccess }) {
  const isEdit = !!initial;
  const [mode, setMode] = useState("single");
  const [form, setForm] = useState({
    location_code: "", name: "", village: "", district: "", city: "", province: "",
    latitude: "", longitude: "",
  });
  const [bulk, setBulk] = useState([{ location_code: "", name: "" }]);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  // Prefill saat mode edit
  useEffect(() => {
    if (isEdit && initial) {
      setMode("single");
      setForm({
        location_code: initial.location_code || "",
        name: initial.name || "",
        village: initial.village || "",
        district: initial.district || "",
        city: initial.city || "",
        province: initial.province || "",
        latitude: initial.latitude != null ? String(initial.latitude) : "",
        longitude: initial.longitude != null ? String(initial.longitude) : "",
      });
    }
  }, [isEdit, initial]);

  const submit = async () => {
    setLoading(true);
    try {
      if (isEdit) {
        const payload = {
          ...form,
          latitude: form.latitude !== "" ? parseFloat(form.latitude) : null,
          longitude: form.longitude !== "" ? parseFloat(form.longitude) : null,
        };
        await locationsAPI.update(initial.id, payload);
        toast.success("Lokasi diperbarui");
      } else if (mode === "single") {
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
      title={isEdit ? `Edit Lokasi · ${initial?.location_code || ""}` : "Tambah Lokasi"}
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
      {!isEdit && (
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
      )}

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

// ════════════════════════════════════════════════════════════════════════════
// SignAddendumModal — confirm tanda-tangan addendum DRAFT
// Apply: bundle VO, clone BOQ revision, update contract status/value/end_date
// ════════════════════════════════════════════════════════════════════════════
function SignAddendumModal({ contract, addendum, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const baseValue = parseFloat(contract.original_value || 0);
  const newValue = parseFloat(addendum.new_contract_value || 0);
  const deltaPct = baseValue > 0 ? ((newValue - baseValue) / baseValue) * 100 : 0;
  const needsKpa = Math.abs(deltaPct) > 10;
  const kpaMissing = needsKpa && !addendum.kpa_approved_by_id;

  const submit = async () => {
    if (kpaMissing) {
      toast.error("KPA approval wajib untuk Δ > 10%. Edit addendum dan isi kpa_approved_by_id dulu.");
      return;
    }
    setLoading(true);
    try {
      const { data } = await contractsAPI.signAddendum(contract.id, addendum.id);
      toast.success(
        `Addendum di-sign. Revisi BOQ baru dibuat (DRAFT) — approve di tab BOQ Versions.` +
        (data?.bundled_vos?.length ? ` ${data.bundled_vos.length} VO ter-bundle.` : "")
      );
      onSuccess?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally { setLoading(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Tanda Tangan ${addendum.number}`}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={loading || kpaMissing}>
            {loading && <Spinner size={14} />} <Check size={12} /> Tanda Tangan & Apply
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
          <p className="font-semibold mb-1">⚠ Aksi LEGAL — tidak bisa di-undo dengan mudah.</p>
          <p>Setelah tanda tangan, sistem akan:</p>
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            <li>Mengubah status VO ter-link dari APPROVED → BUNDLED</li>
            <li>Membuat revisi BOQ V-baru (DRAFT) dari revisi aktif + apply perubahan VO</li>
            <li>Mengubah nilai kontrak ke <b>{fmtCurrency(addendum.new_contract_value)}</b></li>
            {addendum.new_end_date && (
              <li>Mengubah tanggal selesai ke <b>{fmtDate(addendum.new_end_date)}</b></li>
            )}
            {addendum.extension_days > 0 && (
              <li>Memperpanjang durasi <b>{addendum.extension_days} hari</b></li>
            )}
            <li>Mengubah status kontrak ke ADDENDUM</li>
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-ink-500">Nilai Awal</p>
            <p className="font-semibold">{fmtCurrency(baseValue)}</p>
          </div>
          <div>
            <p className="text-ink-500">Nilai Baru</p>
            <p className="font-semibold">{fmtCurrency(newValue)}</p>
          </div>
          <div>
            <p className="text-ink-500">Δ Nilai</p>
            <p className={`font-semibold ${(newValue - baseValue) >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {(newValue - baseValue) >= 0 ? "+" : ""}{fmtCurrency(newValue - baseValue)}
            </p>
          </div>
          <div>
            <p className="text-ink-500">Δ %</p>
            <p className={`font-semibold ${Math.abs(deltaPct) > 10 ? "text-red-700" : ""}`}>
              {deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(2)}%
            </p>
          </div>
        </div>

        {needsKpa && (
          <div className={`p-3 rounded text-xs ${kpaMissing ? "bg-red-50 border border-red-200 text-red-900" : "bg-emerald-50 border border-emerald-200 text-emerald-900"}`}>
            <p className="font-semibold">
              {kpaMissing ? "✗ KPA approval BELUM diisi" : "✓ KPA approval ter-isi"}
            </p>
            <p className="mt-1">
              Perpres 16/2018 ps. 54: Δ Nilai &gt; 10% wajib persetujuan KPA.
              {kpaMissing && " Edit Addendum dan isi field 'kpa_approved_by_id' sebelum sign."}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}


function AddAddendumModal({ open, onClose, contract, initial, onSuccess }) {
  const isEdit = !!initial;
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
  const [approvedVOs, setApprovedVOs] = useState([]);
  const [selectedVoIds, setSelectedVoIds] = useState([]);
  const [loadingVOs, setLoadingVOs] = useState(false);

  useEffect(() => {
    if (!open || !contract) return;
    if (isEdit && initial) {
      setForm({
        number: initial.number || "",
        addendum_type: initial.addendum_type || "cco",
        effective_date: initial.effective_date || new Date().toISOString().slice(0, 10),
        extension_days: initial.extension_days || 0,
        new_end_date: initial.new_end_date || contract.end_date || "",
        new_contract_value: initial.new_contract_value || contract.current_value || "",
        description: initial.description || "",
      });
    } else {
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
    // Fetch VO APPROVED — saat edit, include juga VO yang sudah ter-link ke
    // addendum ini supaya checkbox-nya tampil.
    setLoadingVOs(true);
    voAPI.listByContract(contract.id, { status: "approved" })
      .then(({ data }) => {
        const all = data?.items || [];
        const available = all.filter(
          (v) => !v.bundled_addendum_id || (isEdit && v.bundled_addendum_id === initial.id)
        );
        setApprovedVOs(available);
        if (isEdit) {
          // Edit mode: pilih VO yang sudah ter-link ke addendum ini
          setSelectedVoIds(available.filter((v) => v.bundled_addendum_id === initial.id).map((v) => v.id));
        } else {
          setSelectedVoIds(available.map((v) => v.id));
        }
      })
      .catch(() => setApprovedVOs([]))
      .finally(() => setLoadingVOs(false));
  }, [open, contract, isEdit, initial?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const toggleVO = (id) => {
    setSelectedVoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const totalCostImpact = approvedVOs
    .filter((v) => selectedVoIds.includes(v.id))
    .reduce((sum, v) => sum + (v.cost_impact || 0), 0);

  const submit = async () => {
    setLoading(true);
    try {
      const payload = {
        ...form,
        extension_days: parseInt(form.extension_days) || 0,
        new_contract_value: form.new_contract_value
          ? parseFloat(form.new_contract_value)
          : null,
        vo_ids: selectedVoIds,
      };
      if (isEdit) {
        await contractsAPI.updateAddendum(contract.id, initial.id, payload);
        toast.success("Addendum DRAFT diperbarui");
      } else {
        await contractsAPI.createAddendum(contract.id, payload);
        toast.success(
          selectedVoIds.length > 0
            ? `Addendum DRAFT tersimpan — ${selectedVoIds.length} VO ter-link. Klik 'Tanda Tangan' di tab Addendum untuk apply.`
            : "Addendum DRAFT tersimpan"
        );
      }
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
      title={isEdit ? `Edit Addendum DRAFT · ${initial?.number || ""}` : "Tambah Addendum (DRAFT)"}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading && <Spinner size={14} />} {isEdit ? "Simpan Perubahan" : "Simpan sebagai DRAFT"}
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
            {selectedVoIds.length > 0 && (() => {
              // VO cost_impact = pre-PPN (delta BOQ).
              // Nilai Kontrak = sudah termasuk PPN.
              // Saran = current + delta_BOQ + (delta_BOQ × PPN%)
              const ppnPct = parseFloat(contract.ppn_pct || 0);
              const baseValue = parseFloat(contract.current_value || 0);
              const deltaPpnAmount = totalCostImpact * (ppnPct / 100);
              const deltaWithPpn = totalCostImpact + deltaPpnAmount;
              const suggested = baseValue + deltaWithPpn;
              const currentInput = parseFloat(form.new_contract_value) || 0;
              const matchesSuggestion = Math.abs(currentInput - suggested) < 1;
              return (
                <div className="mt-1 text-[11px] flex items-center gap-2 flex-wrap">
                  <span className="text-ink-500">
                    💡 Saran: {fmtCurrency(baseValue)}{" "}
                    <span className={totalCostImpact >= 0 ? "text-emerald-700" : "text-red-700"}>
                      {totalCostImpact >= 0 ? "+" : ""}{fmtCurrency(deltaWithPpn)}
                    </span>
                    {" = "}
                    <span className="font-semibold font-mono text-ink-800">{fmtCurrency(suggested)}</span>
                    <span className="text-ink-400 ml-1">
                      (Δ BOQ {fmtCurrency(totalCostImpact)} + PPN {fmtCurrency(deltaPpnAmount)}, {selectedVoIds.length} VO)
                    </span>
                  </span>
                  {!matchesSuggestion && (
                    <button
                      type="button"
                      className="text-brand-600 hover:underline font-medium"
                      onClick={() => setForm({ ...form, new_contract_value: String(suggested) })}
                    >
                      Pakai saran →
                    </button>
                  )}
                  {matchesSuggestion && (
                    <span className="text-emerald-700 font-medium">✓ sesuai saran</span>
                  )}
                </div>
              );
            })()}
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

        {/* VO Bundling — wajib untuk CCO supaya perubahan BOQ diterapkan */}
        <div className="border-t border-ink-200 pt-3">
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">
              VO yang Di-bundle ke Addendum ini
              <span className="text-[11px] text-ink-500 font-normal ml-1">
                (perubahan BOQ hanya diterapkan kalau VO di-centang di sini)
              </span>
            </label>
            {selectedVoIds.length > 0 && (
              <span className="text-xs text-ink-600">
                {selectedVoIds.length} dipilih · Total Δ{" "}
                <span className={totalCostImpact >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
                  {totalCostImpact >= 0 ? "+" : ""}{fmtCurrency(totalCostImpact)}
                </span>
              </span>
            )}
          </div>
          {loadingVOs ? (
            <p className="text-xs text-ink-500">Memuat VO...</p>
          ) : approvedVOs.length === 0 ? (
            <div className="p-3 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <p className="font-semibold">⚠ Belum ada VO APPROVED yang siap di-bundle</p>
              <p className="mt-1">
                Tanpa VO yang di-bundle, addendum ini hanya akan mengubah header kontrak
                (durasi / nilai), BOQ V1 akan identik dengan V0. Pastikan VO sudah di-submit
                dan di-approve PPK sebelum membuat addendum.
              </p>
            </div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto border border-ink-200 rounded p-2">
              {approvedVOs.map((vo) => (
                <label key={vo.id} className="flex items-start gap-2 p-2 hover:bg-ink-50 rounded cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedVoIds.includes(vo.id)}
                    onChange={() => toggleVO(vo.id)}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">{vo.vo_number}</span>
                      <span className="text-ink-700">{vo.title}</span>
                    </div>
                    <div className="text-[11px] text-ink-500 mt-0.5">
                      Δ Biaya:{" "}
                      <span className={vo.cost_impact >= 0 ? "text-emerald-700 font-medium" : "text-red-700 font-medium"}>
                        {vo.cost_impact >= 0 ? "+" : ""}{fmtCurrency(vo.cost_impact)}
                      </span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
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
                    {fmtVolume(it.volume)}
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
                  // Validasi: BOQ + (BOQ × PPN%) = Nilai Kontrak.
                  const ppnPct = Number(contract.ppn_pct || 0);
                  const contractValue = Number(contract.current_value || 0);
                  const boqPre = Number(r.total_value || 0);
                  const ppnAmount = boqPre * (ppnPct / 100);
                  const boqWithPpn = boqPre + ppnAmount;
                  const diff = Math.round((boqWithPpn - contractValue) * 100) / 100;
                  // Tolerance 1 Rp untuk absorb floating-point error PPN
                  const inSync = Math.abs(diff) < 1;
                  const exceeds = diff >= 1;
                  if (inSync) {
                    return (
                      <p className="text-[11px] text-green-700 mt-1 font-medium">
                        ✓ BOQ {fmtCurrency(boqPre)} + PPN {fmtCurrency(ppnAmount)} ({ppnPct}%) = Nilai Kontrak {fmtCurrency(contractValue)}
                      </p>
                    );
                  }
                  if (exceeds) {
                    return (
                      <div className="mt-2 p-2 rounded-md bg-red-50 border border-red-200 text-[11px] text-red-900">
                        <p className="font-semibold">
                          ⚠ BOQ + PPN MELEBIHI Nilai Kontrak
                        </p>
                        <p className="mt-0.5">
                          BOQ {fmtCurrency(boqPre)} + PPN {ppnPct}% ({fmtCurrency(ppnAmount)}) = <b>{fmtCurrency(boqWithPpn)}</b>,
                          {" "}Nilai Kontrak {fmtCurrency(contractValue)}. Selisih +{fmtCurrency(diff)}.
                          {" "}<b>Approve akan ditolak</b>.
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div className="mt-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                      <p className="font-semibold">
                        ℹ Nilai Kontrak lebih besar {fmtCurrency(-diff)} dari (BOQ + PPN)
                      </p>
                      <p className="mt-0.5">
                        BOQ {fmtCurrency(boqPre)} + PPN {ppnPct}% ({fmtCurrency(ppnAmount)}) = {fmtCurrency(boqWithPpn)}.
                        {" "}Wajar bila ada buffer/contingency. Approve tetap diizinkan.
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
                  // Validasi: BOQ + (BOQ × PPN%) ≤ Nilai Kontrak.
                  const boqPre = Number(r.total_value || 0);
                  const ppnAmount = boqPre * (Number(contract.ppn_pct || 0) / 100);
                  const boqWithPpn = boqPre + ppnAmount;
                  const contractValue = Number(contract.current_value || 0);
                  // Tolerance 1 Rp absorb floating-point error
                  const exceeds = boqWithPpn - contractValue >= 1;
                  return (
                    <button
                      className="btn-primary btn-xs disabled:opacity-50"
                      onClick={() => approve(r)}
                      disabled={approving === r.id || exceeds}
                      title={
                        exceeds
                          ? "BOQ + PPN melebihi Nilai Kontrak"
                          : "Approve revisi"
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
  const [filter, setFilter] = useState("all"); // all / added / modified / removed

  useEffect(() => {
    boqAPI
      .diffRevision(revision.id)
      .then(({ data }) => setRows(data || []))
      .catch((e) => toast.error(parseApiError(e)))
      .finally(() => setLoading(false));
  }, [revision.id]);

  // Summary counts + cost impact per change_type
  const summary = useMemo(() => {
    const s = {
      added: { count: 0, total: 0 },
      modified: { count: 0, total: 0 },
      removed: { count: 0, total: 0 },
      unchanged: { count: 0, total: 0 },
      grand_delta: 0,
    };
    rows.forEach((r) => {
      const ct = r.change_type || "unchanged";
      if (s[ct]) {
        s[ct].count += 1;
        s[ct].total += r.delta_total || 0;
      }
      s.grand_delta += r.delta_total || 0;
    });
    return s;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows.filter((r) => r.change_type !== "unchanged");
    return rows.filter((r) => r.change_type === filter);
  }, [rows, filter]);

  const changeBadge = (ct) => {
    const base = "text-[10px] px-2 py-0.5 rounded border font-semibold uppercase";
    if (ct === "added") return `${base} bg-emerald-50 text-emerald-700 border-emerald-200`;
    if (ct === "removed") return `${base} bg-red-50 text-red-700 border-red-200`;
    if (ct === "modified") return `${base} bg-amber-50 text-amber-800 border-amber-200`;
    return `${base} bg-slate-100 text-slate-600 border-slate-200`;
  };

  const changeLabel = (ct) => ({
    added: "+ Ditambah",
    removed: "− Dihapus",
    modified: "~ Diubah",
    unchanged: "= Tetap",
  })[ct] || ct;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Perbandingan BOQ · ${revision.revision_code}`}
      size="xl"
      footer={
        <button className="btn-primary" onClick={onClose}>Tutup</button>
      }
    >
      {loading ? (
        <PageLoader />
      ) : rows.length === 0 ? (
        <Empty
          title="Tidak ada perbandingan"
          description="Revisi kosong atau tidak punya pendahulu untuk diperbandingkan."
        />
      ) : (
        <div className="space-y-3">
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-2">
            {["added", "modified", "removed", "unchanged"].map((ct) => (
              <button
                key={ct}
                onClick={() => setFilter(filter === ct ? "all" : ct)}
                className={`p-2 rounded-lg border text-left transition ${
                  filter === ct
                    ? "border-brand-400 bg-brand-50"
                    : "border-ink-200 bg-white hover:border-brand-300"
                }`}
              >
                <span className={changeBadge(ct)}>{changeLabel(ct)}</span>
                <p className="text-lg font-semibold text-ink-900 mt-1">
                  {summary[ct]?.count || 0}
                </p>
                <p className="text-[10px] text-ink-500">
                  item {ct !== "unchanged" && (summary[ct]?.total || 0) !== 0 && (
                    <span className={summary[ct].total >= 0 ? "text-emerald-700" : "text-red-700"}>
                      {" · "}{summary[ct].total >= 0 ? "+" : ""}{fmtCurrency(summary[ct].total)}
                    </span>
                  )}
                </p>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between text-xs py-2 border-y border-ink-200 bg-ink-50 px-3 rounded">
            <div className="text-ink-600">
              <span className="font-medium">Total Δ Nilai:</span>{" "}
              <span className={`font-semibold ${
                summary.grand_delta > 0 ? "text-emerald-700"
                : summary.grand_delta < 0 ? "text-red-700"
                : "text-ink-600"
              }`}>
                {summary.grand_delta >= 0 ? "+" : ""}{fmtCurrency(summary.grand_delta)}
              </span>
            </div>
            <div className="text-ink-500">
              Menampilkan {filteredRows.length} item
              {filter !== "all" && (
                <button onClick={() => setFilter("all")} className="ml-2 text-brand-600 hover:underline">
                  Reset filter
                </button>
              )}
            </div>
          </div>

          {/* Diff table */}
          <div className="overflow-x-auto max-h-[55vh]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white z-10 border-b-2 border-ink-200">
                <tr>
                  <th className="table-th">Status</th>
                  <th className="table-th">Lokasi / Fasilitas</th>
                  <th className="table-th">Uraian</th>
                  <th className="table-th">Satuan</th>
                  <th className="table-th text-right">Vol Lama</th>
                  <th className="table-th text-right">Vol Baru</th>
                  <th className="table-th text-right">Δ Vol</th>
                  <th className="table-th text-right">Harga Lama</th>
                  <th className="table-th text-right">Harga Baru</th>
                  <th className="table-th text-right">Δ Nilai</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, i) => {
                  const ct = r.change_type;
                  const rowBg =
                    ct === "added" ? "bg-emerald-50/40"
                    : ct === "removed" ? "bg-red-50/40"
                    : ct === "modified" ? "bg-amber-50/40"
                    : "";
                  return (
                    <tr key={i} className={`${rowBg} hover:bg-ink-50`}>
                      <td className="table-td">
                        <span className={changeBadge(ct)}>{changeLabel(ct)}</span>
                      </td>
                      <td className="table-td text-[10px] font-mono text-ink-500">
                        {r.location_code || "—"} / {r.facility_code || "—"}
                      </td>
                      <td className="table-td max-w-sm">
                        <div className={`${ct === "removed" ? "line-through text-ink-500" : ""}`}>
                          {r.description}
                        </div>
                        {r.master_work_code && (
                          <div className="font-mono text-[10px] text-brand-600 mt-0.5">
                            {r.master_work_code}
                          </div>
                        )}
                      </td>
                      <td className="table-td text-xs">{r.unit}</td>
                      <td className="table-td text-right font-mono text-ink-500">
                        {r.old_volume != null ? fmtVolume(r.old_volume) : "—"}
                      </td>
                      <td className="table-td text-right font-mono">
                        {r.new_volume != null ? fmtVolume(r.new_volume) : "—"}
                      </td>
                      <td className={`table-td text-right font-mono text-[11px] ${
                        (r.delta_volume || 0) > 0 ? "text-emerald-700"
                        : (r.delta_volume || 0) < 0 ? "text-red-700"
                        : "text-ink-400"
                      }`}>
                        {(r.delta_volume || 0) === 0 ? "—"
                          : ((r.delta_volume > 0 ? "+" : "") + fmtVolume(r.delta_volume))}
                      </td>
                      <td className="table-td text-right font-mono text-ink-500">
                        {r.old_unit_price != null ? fmtNum(r.old_unit_price, 0) : "—"}
                      </td>
                      <td className="table-td text-right font-mono">
                        {r.new_unit_price != null ? fmtNum(r.new_unit_price, 0) : "—"}
                      </td>
                      <td className={`table-td text-right font-mono font-semibold ${
                        (r.delta_total || 0) > 0 ? "text-emerald-700"
                        : (r.delta_total || 0) < 0 ? "text-red-700"
                        : "text-ink-500"
                      }`}>
                        {(r.delta_total || 0) === 0 ? "0"
                          : (r.delta_total > 0 ? "+" : "") + fmtCurrency(r.delta_total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// Contract Chain Timeline & Status Panel
// Visualisasi rantai kronologis MC → VO → Adendum → Revisi BOQ.
// ════════════════════════════════════════════════════════════════════════════

const CHAIN_EVENT_META = {
  contract_signed: { icon: "📝", color: "slate", tab: null },
  boq_revision:    { icon: "📋", color: "blue",  tab: "revisions" },
  mc:              { icon: "🔍", color: "brand", tab: "field_observations" },
  vo:              { icon: "📑", color: "amber", tab: "variation_orders" },
  addendum:        { icon: "📎", color: "indigo", tab: "addenda" },
};

const CHAIN_STATUS_COLOR = {
  done:         "bg-emerald-100 text-emerald-700 border-emerald-300",
  approved:     "bg-emerald-100 text-emerald-700 border-emerald-300",
  draft:        "bg-slate-100 text-slate-600 border-slate-300",
  under_review: "bg-blue-100 text-blue-700 border-blue-300",
  rejected:     "bg-red-100 text-red-700 border-red-300",
  bundled:      "bg-indigo-100 text-indigo-700 border-indigo-300",
};

const ACTION_TAB_LABEL = {
  approve_revision: "BOQ Versions",
  create_addendum:  "Addendum",
  approve_vo:       "Variation Orders",
  create_mc0:       "Observasi Lapangan",
};

function ContractChainTimeline({ contract, onGoTab }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    setLoading(true);
    setError(null);
    contractsAPI.chainStatus(contract.id)
      .then(({ data }) => setData(data))
      .catch((e) => setError(parseApiError(e)))
      .finally(() => setLoading(false));
  }, [contract.id]);

  if (loading) return <div className="card p-4 text-xs text-ink-500">Memuat timeline rantai...</div>;
  if (error) return (
    <div className="card p-4 text-xs text-red-700 bg-red-50 border-red-200">
      Timeline tidak tersedia: {error}. Kemungkinan backend belum restart setelah update (endpoint /chain-status baru).
    </div>
  );
  if (!data?.timeline?.length) return (
    <div className="card p-4 text-xs text-ink-500">
      Belum ada event untuk ditampilkan.
    </div>
  );

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold text-ink-800 text-sm">Rantai Perubahan Kontrak</p>
        <p className="text-[11px] text-ink-500">{data.timeline.length} event kronologis</p>
      </div>
      <div className="relative overflow-x-auto pb-2">
        <div className="flex items-stretch gap-2 min-w-max">
          {data.timeline.map((e, i) => {
            const meta = CHAIN_EVENT_META[e.type] || { icon: "•", color: "slate" };
            const statusCls = CHAIN_STATUS_COLOR[e.status] || CHAIN_STATUS_COLOR.draft;
            const clickable = !!meta.tab;
            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  <div className="flex items-center self-center">
                    <div className="w-6 h-0.5 bg-ink-200"></div>
                  </div>
                )}
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onGoTab?.(meta.tab)}
                  className={`flex flex-col items-center px-3 py-2 rounded-lg border ${statusCls} ${
                    clickable ? "hover:scale-[1.02] hover:shadow-sm cursor-pointer transition" : "cursor-default"
                  } min-w-[100px]`}
                  title={e.title || e.label}
                >
                  <span className="text-base leading-none">{meta.icon}</span>
                  <span className="text-[11px] font-semibold mt-1 text-center">{e.label}</span>
                  {e.date && (
                    <span className="text-[9px] opacity-75 mt-0.5">{fmtDate(e.date)}</span>
                  )}
                  {e.type === "vo" && (
                    <span className={`text-[9px] font-mono mt-0.5 ${
                      (e.cost_impact || 0) > 0 ? "text-emerald-700"
                      : (e.cost_impact || 0) < 0 ? "text-red-700" : ""
                    }`}>
                      {e.cost_impact >= 0 ? "+" : ""}{fmtCurrency(e.cost_impact)}
                    </span>
                  )}
                  {e.type === "addendum" && e.bundled_vo_count > 0 && (
                    <span className="text-[9px] opacity-75 mt-0.5">{e.bundled_vo_count} VO</span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
      <p className="text-[10px] text-ink-400 mt-2 italic">
        Klik node untuk loncat ke tab terkait. Warna = status.
      </p>
    </div>
  );
}

function ContractChainStatusPanel({ contract, onGoTab }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    contractsAPI.chainStatus(contract.id)
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [contract.id]);

  if (loading) return <div className="card p-4 text-xs text-ink-500">Memuat status rantai...</div>;
  if (!data?.summary) return null;
  const s = data.summary;
  const actionTab = {
    approve_revision: "revisions",
    create_addendum: "addenda",
    approve_vo: "variation_orders",
    create_mc0: "field_observations",
  }[s.next_action];

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <p className="font-semibold text-ink-800 text-sm mb-2">Status Rantai</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <StatChip
              label="MC / Observasi"
              value={s.mc_total}
              sub={s.mc_0_done ? "MC-0 ✓" : "MC-0 belum"}
              ok={s.mc_0_done}
              onClick={() => onGoTab?.("field_observations")}
            />
            <StatChip
              label="VO"
              value={s.vo_total}
              sub={`${s.vo_draft} draft · ${s.vo_under_review} review · ${s.vo_approved_unbundled} approved`}
              onClick={() => onGoTab?.("variation_orders")}
            />
            <StatChip
              label="Adendum"
              value={s.addenda_count}
              sub={s.active_revision_code ? `BOQ aktif: ${s.active_revision_code}` : "BOQ belum aktif"}
              onClick={() => onGoTab?.("addenda")}
            />
            <StatChip
              label="Revisi BOQ"
              value={s.revisions_count}
              sub={s.pending_revisions > 0 ? `${s.pending_revisions} DRAFT menunggu` : "semua ter-approve"}
              warn={s.pending_revisions > 0}
              onClick={() => onGoTab?.("revisions")}
            />
          </div>
        </div>
        {s.next_action && s.next_action_message && (
          <div className="flex-shrink-0 min-w-[240px] max-w-sm p-3 rounded-lg bg-amber-50 border border-amber-200">
            <p className="text-[11px] font-semibold text-amber-800 uppercase flex items-center gap-1">
              ⚠ Aksi Selanjutnya
            </p>
            <p className="text-xs text-amber-900 mt-1">{s.next_action_message}</p>
            {actionTab && (
              <button
                className="btn-primary btn-xs mt-2"
                onClick={() => onGoTab?.(actionTab)}
              >
                Buka {ACTION_TAB_LABEL[s.next_action] || "tab"} →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatChip({ label, value, sub, ok, warn, onClick }) {
  const ring = warn ? "border-amber-300 bg-amber-50" : ok ? "border-emerald-300 bg-emerald-50" : "border-ink-200 bg-white";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-2 rounded-lg border text-left hover:shadow-sm transition ${ring}`}
    >
      <p className="text-[10px] text-ink-500 uppercase">{label}</p>
      <p className="text-xl font-bold text-ink-800 leading-tight">{value}</p>
      <p className="text-[10px] text-ink-500 mt-0.5 line-clamp-2">{sub}</p>
    </button>
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

function VariationOrdersPanel({ contract, onChange, canApprove = false, pendingFromObs, onConsumePendingFromObs }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [prefillFromObs, setPrefillFromObs] = useState(null);
  const [editing, setEditing] = useState(null); // full VO data saat edit
  const [detail, setDetail] = useState(null);
  const [actionModal, setActionModal] = useState(null);

  const refresh = () => {
    setLoading(true);
    voAPI.listByContract(contract.id)
      .then(({ data }) => setList(data.items || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, [contract.id]);

  // Saat parent kirim observasi pending (handoff MC → VO), buka modal create
  // dengan prefill source_observation_id. Sekali consumed, parent reset state.
  useEffect(() => {
    if (pendingFromObs) {
      setPrefillFromObs(pendingFromObs);
      setShowCreate(true);
      onConsumePendingFromObs?.();
    }
  }, [pendingFromObs]);  // eslint-disable-line react-hooks/exhaustive-deps

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
                    {vo.source_observation && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200"
                        title={`Dipicu dari ${vo.source_observation.type === "mc_0" ? "MC-0" : "MC"}: ${vo.source_observation.title}`}>
                        ↖ {vo.source_observation.type === "mc_0" ? "MC-0" : "MC"} · {fmtDate(vo.source_observation.observation_date)}
                      </span>
                    )}
                    {vo.bundled_addendum_id && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200"
                        title="VO ini sudah ter-bundle ke addendum">
                        📎 ter-bundle
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
                  <button className="btn-ghost btn-xs" onClick={async () => {
                    try {
                      const { data } = await voAPI.get(vo.id);
                      setDetail(data);
                    } catch (e) { toast.error(parseApiError(e)); }
                  }}>Lihat</button>
                  {vo.status === "draft" && (
                    <>
                      <button className="btn-ghost btn-xs" onClick={async () => {
                        const { data } = await voAPI.get(vo.id);
                        setEditing(data);
                      }}>
                        <Edit2 size={10} /> Edit
                      </button>
                      <button className="btn-primary btn-xs" onClick={() => doAction(vo, "submit")}>
                        <Send size={10} /> Submit
                      </button>
                    </>
                  )}
                  {vo.status === "under_review" && canApprove && (
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
        <VOCreateModal
          contract={contract}
          prefillFromObs={prefillFromObs}
          onClose={() => { setShowCreate(false); setPrefillFromObs(null); }}
          onSuccess={() => { setShowCreate(false); setPrefillFromObs(null); refresh(); }}
        />
      )}
      {editing && (
        <VOCreateModal
          contract={contract}
          initial={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => { setEditing(null); refresh(); }}
        />
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

function VOCreateModal({ contract, initial, prefillFromObs, onClose, onSuccess }) {
  const { user } = useAuthStore();
  const role = user?.role?.code;
  const isEdit = !!initial;
  const [form, setForm] = useState(() =>
    initial
      ? {
          title: initial.title || "",
          technical_justification: initial.technical_justification || "",
          quantity_calculation: initial.quantity_calculation || "",
          source_observation_id: initial.source_observation_id || null,
          items: (initial.items || []).map((it) => ({
            action: it.action,
            boq_item_id: it.boq_item_id || null,
            facility_id: it.facility_id || null,
            parent_boq_item_id: it.parent_boq_item_id || null,
            master_work_code: it.master_work_code || null,
            description: it.description || "",
            unit: it.unit || "",
            volume_delta: it.volume_delta != null ? String(it.volume_delta) : "",
            unit_price: it.unit_price != null ? String(it.unit_price) : "",
            notes: it.notes || "",
          })),
        }
      : {
          title: prefillFromObs ? `Tindak lanjut ${prefillFromObs.type === "mc_0" ? "MC-0" : "MC"}: ${prefillFromObs.title || ""}`.trim() : "",
          technical_justification: prefillFromObs
            ? `Berdasarkan temuan observasi lapangan "${prefillFromObs.title}" tanggal ${prefillFromObs.observation_date || "-"}: ${prefillFromObs.findings || ""}`
            : "",
          quantity_calculation: "",
          source_observation_id: prefillFromObs?.id || null,
          items: [],
        }
  );
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (form.technical_justification.length < 50) return toast.error("Justifikasi teknis minimal 50 karakter");
    if (!form.items.length) return toast.error("Edit minimal 1 item perubahan di grid");
    // Validasi field wajib per action + nilai
    for (const [idx, it] of form.items.entries()) {
      const needFac = it.action === "add" || it.action === "remove_facility";
      const needBoq = !needFac;
      if (needBoq && !it.boq_item_id) {
        return toast.error(`Item ${idx + 1}: boq_item_id hilang`);
      }
      if (needFac && !it.facility_id) {
        return toast.error(`Item ${idx + 1}: facility_id hilang`);
      }
      if (it.action === "add") {
        const itemLabel = it.description?.trim() ? `"${it.description.trim()}"` : `#${idx + 1}`;
        const ZERO_PRICE_BYPASS = ["PARENT", "INFO", "OWNER", "TITIPAN"];
        const hasBypass = ZERO_PRICE_BYPASS.some((kw) => (it.notes || "").trim().toUpperCase().startsWith(kw));
        if (!it.description?.trim()) return toast.error(`Item baru #${idx + 1}: deskripsi wajib`);
        if (parseFloat(it.volume_delta) <= 0) return toast.error(`Item baru ${itemLabel}: volume harus > 0`);
        if (parseFloat(it.unit_price) <= 0 && !hasBypass)
          return toast.error(`Item baru ${itemLabel}: harga satuan harus > 0 (atau isi catatan dengan PARENT/INFO/OWNER/TITIPAN untuk bypass)`);
      }
    }
    setSaving(true);
    try {
      // Normalisasi payload:
      // - volume_delta / unit_price parseFloat supaya decimal dikirim benar
      // - UUID kosong ("") harus dikirim null, kalau tidak Pydantic UUID reject
      const payload = {
        ...form,
        items: form.items.map((it) => ({
          ...it,
          boq_item_id: it.boq_item_id || null,
          facility_id: it.facility_id || null,
          volume_delta: parseFloat(it.volume_delta) || 0,
          unit_price: parseFloat(it.unit_price) || 0,
        })),
      };
      if (isEdit) {
        await voAPI.update(initial.id, payload);
        toast.success("VO diperbarui");
      } else {
        await voAPI.create(contract.id, payload);
        toast.success("VO tersimpan sebagai DRAFT");
      }
      onSuccess?.();
    } catch (e) { toast.error(parseApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${initial.vo_number}` : "VO Baru · DRAFT"} size="xl" footer={
      <>
        <button className="btn-secondary" onClick={onClose}>Batal</button>
        <button className="btn-primary" onClick={submit} disabled={saving}>
          {saving && <Spinner size={12} />} {isEdit ? "Simpan Perubahan" : "Simpan sebagai DRAFT"}
        </button>
      </>
    }>
      <div className="space-y-3 text-sm">
        {prefillFromObs && !isEdit && (
          <div className="p-2.5 rounded-md bg-brand-50 border border-brand-200 text-xs text-brand-800 flex items-start gap-2">
            <span className="font-bold flex-shrink-0">↖</span>
            <div className="flex-1">
              <p className="font-semibold">
                Dari {prefillFromObs.type === "mc_0" ? "MC-0" : "MC Lanjutan"}: {prefillFromObs.title}
              </p>
              <p className="text-[11px] mt-0.5 text-brand-700">
                VO ini akan otomatis ter-link ke observasi tanggal {fmtDate(prefillFromObs.observation_date)}.
                Judul & justifikasi sudah di-pre-fill dari temuan — silakan edit sesuai kebutuhan, lalu tambah item perubahan BOQ.
              </p>
            </div>
          </div>
        )}
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
            <label className="label mb-0">Item Perubahan BOQ</label>
            <p className="text-[11px] text-ink-500">
              Pilih fasilitas → edit Vol Baru langsung di tabel. Action auto-detected dari perubahan volume.
            </p>
          </div>
          <VOItemsGrid
            contract={contract}
            items={form.items}
            onChange={(newItems) => setForm({ ...form, items: newItems })}
            isAdmin={role === "superadmin" || role === "admin_pusat"}
            voId={isEdit ? initial.id : null}
          />
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ParentPicker — searchable dropdown untuk pilih parent BOQ item.
// Daftar bisa ratusan item, native select tidak praktis.
// ════════════════════════════════════════════════════════════════════════════
function ParentPicker({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState(null); // {top, left, width}
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const selected = options.find((o) => o.id === value);

  // Posisi popover dihitung dari button rect (viewport-aware) supaya tidak
  // pernah keluar batas viewport.
  const computePos = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const PANEL_W = 380;
    const PANEL_H = 320;
    let left = r.left;
    if (left + PANEL_W > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - PANEL_W - 8);
    }
    let top = r.bottom + 4;
    if (top + PANEL_H > window.innerHeight - 8) {
      top = Math.max(8, r.top - PANEL_H - 4);
    }
    setPos({ top, left, width: PANEL_W });
  };

  useEffect(() => {
    if (!open) return;
    computePos();
    const onScroll = () => computePos();
    const onDocClick = (e) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        popRef.current && !popRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const filtered = !search.trim() ? options : options.filter((o) =>
    (o.label || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="input py-0.5 text-[10px] text-left w-full mt-1 flex items-center justify-between gap-1"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate flex-1">
          {selected ? selected.label : <span className="text-ink-400">— Root (tanpa parent) —</span>}
        </span>
        <span className="text-ink-400">▾</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: 1000,
            background: "white",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(15,23,42,0.18)",
          }}
        >
          <div className="p-1.5 border-b border-ink-100">
            <input
              type="text"
              autoFocus
              className="input py-1 text-xs w-full"
              placeholder={`Cari (${options.length} item)...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            <button
              type="button"
              className={`w-full text-left px-2 py-1 text-[11px] italic hover:bg-brand-50 ${!value ? "bg-brand-100 font-semibold" : "text-ink-500"}`}
              onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
            >
              — Root (tanpa parent) —
            </button>
            {filtered.length === 0 ? (
              <p className="text-[10px] text-ink-400 italic p-2">Tidak ada match.</p>
            ) : filtered.slice(0, 200).map((o) => (
              <button
                key={o.id}
                type="button"
                className={`w-full text-left px-2 py-1 text-[10px] hover:bg-brand-50 font-mono whitespace-nowrap overflow-hidden text-ellipsis ${
                  o.id === value ? "bg-brand-100 text-brand-800 font-semibold" : ""
                }`}
                onClick={() => { onChange(o.id); setOpen(false); setSearch(""); }}
              >
                {o.label}
              </button>
            ))}
            {filtered.length > 200 && (
              <p className="text-[9px] text-ink-400 italic p-1.5 text-center">
                {filtered.length - 200} lainnya — perketat pencarian
              </p>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// FacilityPicker — searchable dropdown fasilitas. Untuk kontrak banyak
// fasilitas, native <select> jadi lambat & susah navigasi.
// ════════════════════════════════════════════════════════════════════════════
function FacilityPicker({ facilities, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const selected = facilities.find((f) => f.id === value);

  useEffect(() => {
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = !search.trim() ? facilities : facilities.filter((f) => {
    const t = search.toLowerCase();
    return (f.facility_code || "").toLowerCase().includes(t) ||
           (f.facility_name || "").toLowerCase().includes(t) ||
           (f.location_code || "").toLowerCase().includes(t) ||
           (f.location_name || "").toLowerCase().includes(t);
  });

  return (
    <div ref={ref} className="relative flex-1 min-w-[260px] max-w-md">
      <button
        type="button"
        className="input py-1 text-xs text-left flex items-center justify-between gap-2 w-full"
        onClick={() => setOpen((v) => !v)}
      >
        {selected ? (
          <span className="truncate">
            <span className="text-ink-500 font-mono mr-1">[{selected.location_code}] {selected.facility_code}</span>
            {selected.facility_name}
          </span>
        ) : (
          <span className="text-ink-400">— pilih fasilitas —</span>
        )}
        <span className="text-ink-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-[420px] max-w-[80vw] bg-white border border-ink-300 rounded-lg shadow-lg">
          <div className="p-2 border-b border-ink-100">
            <input
              type="text"
              autoFocus
              className="input py-1 text-xs w-full"
              placeholder={`Cari (${facilities.length} fasilitas)...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-ink-400 italic p-3">Tidak ada yang cocok.</p>
            ) : filtered.slice(0, 200).map((f) => (
              <button
                key={f.id}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-brand-50 ${
                  f.id === value ? "bg-brand-100 text-brand-800 font-semibold" : ""
                }`}
                onClick={() => { onChange(f.id); setOpen(false); setSearch(""); }}
              >
                <div className="font-mono text-[10px] text-ink-500">
                  [{f.location_code}] {f.facility_code}
                </div>
                <div>
                  {f.facility_name}
                  {f.total_value ? <span className="text-[10px] text-ink-500 ml-1">— {fmtCurrency(f.total_value)}</span> : null}
                </div>
              </button>
            ))}
            {filtered.length > 200 && (
              <p className="text-[10px] text-ink-400 italic p-2 text-center">
                {filtered.length - 200} lainnya — perketat pencarian
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// VOItemsGrid — grid editor untuk item VO per fasilitas.
// User edit Vol Baru langsung; action (INCREASE/DECREASE/REMOVE/ADD) di-infer
// dari selisih ke Vol Awal. Harga Satuan read-only by default (kontrak →
// harga tidak boleh diubah); admin/superadmin bisa toggle override.
// ════════════════════════════════════════════════════════════════════════════
function VOItemsGrid({ contract, items, onChange, isAdmin = false, voId = null }) {
  const [showExcelPicker, setShowExcelPicker] = useState(null); // 'export' | 'import' | null
  const allFacilities = useMemo(() =>
    (contract.locations || []).flatMap((l) =>
      (l.facilities || []).map((f) => ({
        ...f,
        location_code: l.location_code,
        location_name: l.name,
      }))
    ), [contract.locations]
  );
  const [facilityId, setFacilityId] = useState(allFacilities[0]?.id || "");
  const [boqItems, setBoqItems] = useState([]);
  const [loadingBoq, setLoadingBoq] = useState(false);
  const [allowPriceEdit, setAllowPriceEdit] = useState(false);

  // Cache BOQ per facility (avoid re-fetch saat pindah-pindah facility)
  const [boqCache, setBoqCache] = useState({});

  useEffect(() => {
    if (!facilityId) return;
    if (boqCache[facilityId]) {
      setBoqItems(boqCache[facilityId]);
      return;
    }
    setLoadingBoq(true);
    boqAPI.listByFacility(facilityId)
      .then(({ data }) => {
        setBoqItems(data || []);
        setBoqCache((prev) => ({ ...prev, [facilityId]: data || [] }));
      })
      .catch(() => setBoqItems([]))
      .finally(() => setLoadingBoq(false));
  }, [facilityId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const facility = allFacilities.find((f) => f.id === facilityId);
  const facilityRemoved = items.some(
    (it) => it.action === "remove_facility" && it.facility_id === facilityId
  );

  // Filter & sort BOQ items: respect display_order untuk preserve hirarki visual
  const sortedBoq = useMemo(() => {
    return [...boqItems].sort((a, b) => {
      // Sort by display_order kalau ada, fallback ke full_code lexicographic
      const oa = a.display_order ?? 0;
      const ob = b.display_order ?? 0;
      if (oa !== ob) return oa - ob;
      return (a.full_code || "").localeCompare(b.full_code || "");
    });
  }, [boqItems]);

  // Search filter — filter rows by description / code
  const [searchTerm, setSearchTerm] = useState("");
  const matchesSearch = (b) => {
    if (!searchTerm.trim()) return true;
    const t = searchTerm.toLowerCase().trim();
    return (b.description || "").toLowerCase().includes(t) ||
           (b.original_code || "").toLowerCase().includes(t) ||
           (b.full_code || "").toLowerCase().includes(t);
  };

  // Build rows untuk SEMUA item (leaf + non-leaf) supaya hirarki kelihatan.
  // Non-leaf rows hanya display (Vol Awal sum dari children, tidak editable).
  const rows = useMemo(() => {
    return sortedBoq.map((b) => {
      const isLeaf = b.is_leaf !== false;
      const existing = isLeaf ? items.find(
        (it) => it.boq_item_id === b.id &&
          ["increase", "decrease", "remove", "modify_spec"].includes(it.action)
      ) : null;
      const origVol = parseFloat(b.volume || 0);
      const origPrice = parseFloat(b.unit_price || 0);
      let newVolume = origVol;
      let unitPrice = origPrice;
      if (existing) {
        const delta = parseFloat(existing.volume_delta || 0);
        newVolume = existing.action === "remove" ? 0 : origVol + delta;
        if (existing.unit_price && parseFloat(existing.unit_price) > 0) {
          unitPrice = parseFloat(existing.unit_price);
        }
      }
      const delta = newVolume - origVol;
      let action = null;
      if (isLeaf) {
        if (newVolume === 0 && origVol > 0) action = "remove";
        else if (delta > 0) action = "increase";
        else if (delta < 0) action = "decrease";
        else if (unitPrice !== origPrice) action = "modify_spec";
      }
      return {
        boq_item_id: b.id,
        original_code: b.original_code || b.full_code || "",
        full_code: b.full_code || "",
        description: b.description,
        unit: b.unit,
        level: b.level || 0,
        is_leaf: isLeaf,
        parent_id: b.parent_id,
        original_volume: origVol,
        original_unit_price: origPrice,
        new_volume: newVolume,
        unit_price: unitPrice,
        delta,
        action,
        delta_value: newVolume * unitPrice - origVol * origPrice,
        invalid: newVolume < 0,
        visible: matchesSearch(b),
      };
    });
  }, [sortedBoq, items, searchTerm]);

  // Daftar untuk dropdown Parent saat ADD: SEMUA item di facility (bukan
  // hanya non-leaf). Backend secara otomatis flip parent.is_leaf=False
  // saat addendum di-bundle, jadi user bisa konversi item leaf jadi
  // parent dengan menambah child di bawahnya.
  const parentOptions = useMemo(() =>
    sortedBoq.map((b) => ({
      id: b.id,
      level: b.level || 0,
      is_leaf: b.is_leaf !== false,
      label: `${"··".repeat(b.level || 0)} ${b.full_code || b.original_code || ""} — ${b.description}`,
    })),
    [sortedBoq]
  );

  // ADD rows: items dengan action=add dan facility_id sama
  const addRows = useMemo(() =>
    items
      .map((it, i) => ({ ...it, _idx: i }))
      .filter((it) => it.action === "add" && it.facility_id === facilityId),
    [items, facilityId]
  );

  // Helpers untuk modify items[]
  const replaceItem = (predicate, newItem) => {
    const filtered = items.filter((it) => !predicate(it));
    if (newItem) filtered.push(newItem);
    onChange(filtered);
  };

  const updateRowVolume = (boq_item_id, newVolStr) => {
    const newVol = newVolStr === "" ? 0 : parseFloat(newVolStr);
    const row = rows.find((r) => r.boq_item_id === boq_item_id);
    if (!row) return;
    const orig = row.original_volume;
    const delta = newVol - orig;
    const priceChanged = row.unit_price !== row.original_unit_price;

    if (newVol === orig && !priceChanged) {
      // tidak ada perubahan → hapus dari items
      replaceItem((it) => it.boq_item_id === boq_item_id, null);
      return;
    }
    let action;
    if (newVol === 0 && orig > 0) action = "remove";
    else if (delta > 0) action = "increase";
    else if (delta < 0) action = "decrease";
    else if (priceChanged) action = "modify_spec";
    else return;

    replaceItem((it) => it.boq_item_id === boq_item_id, {
      action,
      boq_item_id,
      facility_id: facilityId,
      description: row.description,
      unit: row.unit,
      volume_delta: delta,
      unit_price: row.unit_price,
    });
  };

  const updateRowPrice = (boq_item_id, newPriceStr) => {
    const newPrice = newPriceStr === "" ? 0 : parseFloat(newPriceStr);
    const row = rows.find((r) => r.boq_item_id === boq_item_id);
    if (!row) return;
    if (newPrice === row.original_unit_price && row.new_volume === row.original_volume) {
      replaceItem((it) => it.boq_item_id === boq_item_id, null);
      return;
    }
    const delta = row.new_volume - row.original_volume;
    let action;
    if (row.new_volume === 0 && row.original_volume > 0) action = "remove";
    else if (delta > 0) action = "increase";
    else if (delta < 0) action = "decrease";
    else action = "modify_spec";
    replaceItem((it) => it.boq_item_id === boq_item_id, {
      action,
      boq_item_id,
      facility_id: facilityId,
      description: row.description,
      unit: row.unit,
      volume_delta: delta,
      unit_price: newPrice,
    });
  };

  const resetRow = (boq_item_id) => {
    replaceItem((it) => it.boq_item_id === boq_item_id, null);
  };

  const addNewItem = () => {
    onChange([
      ...items,
      {
        action: "add",
        boq_item_id: null,
        facility_id: facilityId,
        description: "",
        unit: "",
        volume_delta: "",
        unit_price: "",
      },
    ]);
  };

  const updateAddRow = (idx, key, val) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, [key]: val } : it)));
  };
  const removeAddRow = (idx) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const removeFacility = () => {
    if (!facility) return;
    if (!confirm(
      `Hapus seluruh fasilitas "${facility.facility_name}"?\n\n` +
      `Semua perubahan item lain di fasilitas ini akan ditimpa dengan satu aksi REMOVE_FACILITY.`
    )) return;
    const filtered = items.filter((it) => it.facility_id !== facilityId);
    filtered.push({
      action: "remove_facility",
      boq_item_id: null,
      facility_id: facilityId,
      description: `Hilangkan seluruh fasilitas ${facility.facility_code} ${facility.facility_name}`,
      unit: "",
      volume_delta: 0,
      unit_price: 0,
    });
    onChange(filtered);
  };

  const cancelRemoveFacility = () => {
    onChange(items.filter(
      (it) => !(it.action === "remove_facility" && it.facility_id === facilityId)
    ));
  };

  // Aggregates
  const facilityChangeCount = items.filter(
    (it) => it.facility_id === facilityId ||
      (it.boq_item_id && rows.some((r) => r.boq_item_id === it.boq_item_id))
  ).length;
  const totalDelta = items.reduce((sum, it) => sum + (parseFloat(it.cost_impact) || (parseFloat(it.volume_delta || 0) * parseFloat(it.unit_price || 0))), 0);
  const hasInvalid = rows.some((r) => r.invalid);

  if (!allFacilities.length) {
    return (
      <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
        Kontrak ini belum punya fasilitas. Tambah lokasi & fasilitas dulu sebelum membuat VO.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap p-2 bg-ink-50 rounded border border-ink-200">
        <label className="text-xs font-medium text-ink-700">Fasilitas:</label>
        <FacilityPicker
          facilities={allFacilities}
          value={facilityId}
          onChange={setFacilityId}
        />
        {!facilityRemoved && (
          <>
            <button type="button" className="btn-ghost btn-xs" onClick={addNewItem}>
              <Plus size={11} /> Item Baru
            </button>
            <button
              type="button"
              className="btn-ghost btn-xs text-red-600"
              onClick={removeFacility}
              title="Tandai seluruh fasilitas untuk dihapus"
            >
              <Trash2 size={11} /> Hapus Fasilitas
            </button>
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => setShowExcelPicker("export")}
              title="Download snapshot BOQ untuk edit massal di Excel"
            >
              <Download size={11} /> Export Excel
            </button>
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => setShowExcelPicker("import")}
              title="Upload Excel hasil edit untuk apply perubahan massal"
            >
              <Upload size={11} /> Import Excel
            </button>
          </>
        )}
        {isAdmin && !facilityRemoved && (
          <label className="text-[11px] text-ink-600 ml-auto flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={allowPriceEdit}
              onChange={(e) => setAllowPriceEdit(e.target.checked)}
            />
            Override harga satuan
          </label>
        )}
      </div>

      {facilityRemoved ? (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
          <span className="text-base">✕✕</span>
          <div className="flex-1">
            <p className="font-semibold">Seluruh fasilitas ini ditandai untuk DIHAPUS.</p>
            <p className="mt-0.5">
              Saat addendum dibuat dengan VO ini di-bundle, semua item BOQ di fasilitas
              "{facility?.facility_name}" akan di-non-aktifkan (cascade ke children).
            </p>
            <button
              type="button"
              className="btn-secondary btn-xs mt-2"
              onClick={cancelRemoveFacility}
            >
              Batalkan Hapus Fasilitas
            </button>
          </div>
        </div>
      ) : loadingBoq ? (
        <p className="text-xs text-ink-500 p-3">Memuat BOQ fasilitas...</p>
      ) : rows.length === 0 && addRows.length === 0 ? (
        <div className="p-3 rounded bg-ink-50 border border-ink-200 text-xs text-ink-600">
          Fasilitas ini belum punya item BOQ. Klik "+ Item Baru" untuk menambah, atau pilih fasilitas lain.
        </div>
      ) : (
        <>
          {/* Search filter */}
          <div className="flex items-center gap-2 px-1">
            <Search size={13} className="text-ink-400" />
            <input
              type="text"
              className="input py-1 text-xs flex-1"
              placeholder="Cari item: kode atau uraian..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button type="button" className="text-xs text-ink-500 hover:text-ink-800" onClick={() => setSearchTerm("")}>
                ✕
              </button>
            )}
            <span className="text-[10px] text-ink-500">
              {rows.filter((r) => r.visible).length} / {rows.length} item
            </span>
          </div>
        <div className="overflow-x-auto border border-ink-200 rounded max-h-[55vh]">
          <table className="w-full text-xs">
            <thead className="bg-ink-100 sticky top-0 z-10">
              <tr>
                <th className="table-th text-left w-32">Kode</th>
                <th className="table-th text-left">Uraian</th>
                <th className="table-th text-left w-16">Satuan</th>
                <th className="table-th text-right w-24">Vol Awal</th>
                <th className="table-th text-right w-28">Vol Baru *</th>
                <th className="table-th text-right w-24">Δ Vol</th>
                <th className="table-th text-right w-32">Harga {allowPriceEdit ? "*" : "(RO)"}</th>
                <th className="table-th text-right w-28">Δ Nilai</th>
                <th className="table-th text-center w-24">Status</th>
                <th className="table-th text-center w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.filter((r) => r.visible).map((r) => {
                const indent = r.level * 14;
                if (!r.is_leaf) {
                  // Parent / group row — RO, hanya display struktur
                  return (
                    <tr key={r.boq_item_id} className="bg-ink-50/60">
                      <td className="table-td font-mono text-[10px] text-ink-600">
                        <span style={{ paddingLeft: `${indent}px` }}>📁 {r.original_code}</span>
                      </td>
                      <td className="table-td font-semibold text-ink-700" colSpan={8}>
                        {r.description}
                      </td>
                      <td className="table-td"></td>
                    </tr>
                  );
                }
                const rowBg =
                  r.invalid ? "bg-red-100"
                  : r.action === "add" || r.action === "increase" ? "bg-emerald-50/50"
                  : r.action === "decrease" ? "bg-amber-50/50"
                  : r.action === "remove" ? "bg-red-50/50 line-through"
                  : r.action === "modify_spec" ? "bg-blue-50/50"
                  : "";
                return (
                  <tr key={r.boq_item_id} className={rowBg}>
                    <td className="table-td font-mono text-[10px] text-ink-500">
                      <span style={{ paddingLeft: `${indent}px` }}>{r.original_code}</span>
                    </td>
                    <td className="table-td">{r.description}</td>
                    <td className="table-td">{r.unit}</td>
                    <td className="table-td text-right font-mono text-ink-500">{fmtVolume(r.original_volume)}</td>
                    <td className="table-td text-right">
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        className={`input py-0.5 text-xs font-mono w-24 text-right ${r.invalid ? "border-red-400 bg-red-50" : ""}`}
                        value={r.new_volume}
                        onChange={(e) => updateRowVolume(r.boq_item_id, e.target.value)}
                        title={r.invalid ? "Vol Baru tidak boleh negatif" : ""}
                      />
                    </td>
                    <td className={`table-td text-right font-mono text-[11px] ${
                      r.delta > 0 ? "text-emerald-700" : r.delta < 0 ? "text-red-700" : "text-ink-400"
                    }`}>
                      {r.delta === 0 ? "—" : (r.delta > 0 ? "+" : "") + fmtVolume(r.delta)}
                    </td>
                    <td className="table-td text-right">
                      {allowPriceEdit ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="input py-0.5 text-xs font-mono w-28 text-right"
                          value={r.unit_price}
                          onChange={(e) => updateRowPrice(r.boq_item_id, e.target.value)}
                        />
                      ) : (
                        <span className="font-mono text-ink-500">{fmtCurrency(r.original_unit_price)}</span>
                      )}
                    </td>
                    <td className={`table-td text-right font-mono text-[11px] font-semibold ${
                      r.delta_value > 0 ? "text-emerald-700" : r.delta_value < 0 ? "text-red-700" : "text-ink-400"
                    }`}>
                      {r.delta_value === 0 ? "—" : (r.delta_value > 0 ? "+" : "") + fmtCurrency(r.delta_value)}
                    </td>
                    <td className="table-td text-center">
                      {r.action ? <VOActionBadge action={r.action} /> : <span className="text-ink-400 text-[10px]">tetap</span>}
                    </td>
                    <td className="table-td text-center">
                      {r.action && (
                        <button
                          type="button"
                          className="text-ink-400 hover:text-ink-700 text-[10px]"
                          onClick={() => resetRow(r.boq_item_id)}
                          title="Kembalikan ke vol awal"
                        >
                          ↺
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* ADD rows (item baru di facility ini) */}
              {addRows.map((r) => {
                const newVol = parseFloat(r.volume_delta) || 0;
                const newPrice = parseFloat(r.unit_price) || 0;
                const value = newVol * newPrice;
                const parentRow = rows.find((rr) => rr.boq_item_id === r.parent_boq_item_id);
                const parentIndent = parentRow ? (parentRow.level + 1) * 14 : 0;
                return (
                  <tr key={`add-${r._idx}`} className="bg-emerald-100/40">
                    <td className="table-td">
                      <div style={{ paddingLeft: `${parentIndent}px` }}>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">BARU</span>
                      </div>
                    </td>
                    <td className="table-td">
                      <input
                        className="input py-0.5 text-xs"
                        value={r.description || ""}
                        onChange={(e) => updateAddRow(r._idx, "description", e.target.value)}
                        placeholder="Uraian item baru"
                      />
                      <ParentPicker
                        options={parentOptions}
                        value={r.parent_boq_item_id || ""}
                        onChange={(id) => updateAddRow(r._idx, "parent_boq_item_id", id || null)}
                      />
                    </td>
                    <td className="table-td">
                      <input
                        className="input py-0.5 text-xs w-14"
                        value={r.unit || ""}
                        onChange={(e) => updateAddRow(r._idx, "unit", e.target.value)}
                        placeholder="m³"
                      />
                    </td>
                    <td className="table-td text-ink-400">—</td>
                    <td className="table-td text-right">
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        className="input py-0.5 text-xs font-mono w-24 text-right"
                        value={r.volume_delta}
                        onChange={(e) => updateAddRow(r._idx, "volume_delta", e.target.value)}
                      />
                    </td>
                    <td className="table-td text-right text-emerald-700 font-mono text-[11px]">
                      +{fmtVolume(newVol)}
                    </td>
                    <td className="table-td text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input py-0.5 text-xs font-mono w-28 text-right"
                        value={r.unit_price}
                        onChange={(e) => updateAddRow(r._idx, "unit_price", e.target.value)}
                        placeholder="0"
                      />
                    </td>
                    <td className="table-td text-right text-emerald-700 font-mono text-[11px] font-semibold">
                      +{fmtCurrency(value)}
                    </td>
                    <td className="table-td text-center">
                      <VOActionBadge action="add" />
                    </td>
                    <td className="table-td text-center">
                      <button
                        type="button"
                        className="text-red-600 hover:text-red-800"
                        onClick={() => removeAddRow(r._idx)}
                        title="Hapus baris ini"
                      >
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Footer summary */}
      <div className="flex items-center justify-between p-2 bg-ink-50 rounded text-xs">
        <div className="text-ink-600">
          <span className="font-semibold">{items.length}</span> item perubahan total di VO ini
          {hasInvalid && (
            <span className="ml-2 text-red-700 font-semibold">⚠ ada Vol Baru negatif — tidak bisa simpan</span>
          )}
        </div>
        <div className="text-ink-600">
          Total Δ Nilai:{" "}
          <span className={`font-bold ${
            totalDelta > 0 ? "text-emerald-700" : totalDelta < 0 ? "text-red-700" : ""
          }`}>
            {totalDelta >= 0 ? "+" : ""}{fmtCurrency(totalDelta)}
          </span>
        </div>
      </div>
      <p className="text-[10px] text-ink-500">
        💡 Edit Vol Baru → action auto (naik=Tambah Vol, turun=Kurang Vol, 0=Hapus Item).
        {!allowPriceEdit && " Harga satuan kontrak tidak boleh diubah secara default."}
      </p>

      {showExcelPicker && (
        <VOExcelDialog
          mode={showExcelPicker}
          contract={contract}
          allFacilities={allFacilities}
          currentFacilityId={facilityId}
          voId={voId}
          items={items}
          onClose={() => setShowExcelPicker(null)}
          onImported={(parsedItems, facilityIds) => {
            // Replace items utk facility_codes yang ada di file, preserve sisanya
            const facIdSet = new Set(facilityIds);
            const kept = items.filter((it) =>
              !it.facility_id || !facIdSet.has(it.facility_id)
            );
            // Plus untuk INCREASE/DECREASE/REMOVE/MODIFY: filter via boq_item_id
            const boqIdsNew = new Set(
              parsedItems.filter((p) => p.boq_item_id).map((p) => p.boq_item_id)
            );
            const finalKept = kept.filter((it) =>
              !it.boq_item_id || !boqIdsNew.has(it.boq_item_id)
            );
            onChange([...finalKept, ...parsedItems]);
            setShowExcelPicker(null);
          }}
        />
      )}
    </div>
  );
}

function VOExcelDialog({ mode, contract, allFacilities, currentFacilityId, voId, items, onClose, onImported }) {
  const [scope, setScope] = useState("current"); // 'current' | 'all' | 'multi'
  const [selectedFacIds, setSelectedFacIds] = useState([currentFacilityId].filter(Boolean));
  const [sheetMode, setSheetMode] = useState("flat"); // 'flat' | 'per_facility'
  const [busy, setBusy] = useState(false);
  const [parseResult, setParseResult] = useState(null);
  const fileInputRef = useRef(null);

  const facIdsForRequest = scope === "current"
    ? [currentFacilityId]
    : scope === "all"
    ? null  // backend resolves: null = all facilities
    : selectedFacIds;

  // per_facility hanya relevan saat scope all/multi (>1 fasilitas)
  const showSheetModeOption = scope === "all" || scope === "multi";

  const doExport = async () => {
    setBusy(true);
    try {
      const params = { vo_id: voId || undefined, mode: showSheetModeOption ? sheetMode : "flat" };
      if (facIdsForRequest && facIdsForRequest.length > 0) {
        params.facility_ids = facIdsForRequest.join(",");
      }
      const { data } = await voAPI.exportExcelSnapshot(contract.id, params);
      const fname = `vo_snapshot_${contract.contract_number || contract.id.slice(0, 8)}.xlsx`;
      downloadBlob(data, fname);
      toast.success("Snapshot ter-download. Edit kolom 'vol_baru' lalu Import lagi.");
      onClose();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally { setBusy(false); }
  };

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setParseResult(null);
    try {
      const params = { vo_id: voId || undefined };
      const { data } = await voAPI.parseExcelSnapshot(contract.id, file, params);
      setParseResult(data);
    } catch (err) {
      toast.error(parseApiError(err));
    } finally { setBusy(false); }
  };

  const applyParsed = () => {
    if (!parseResult?.items?.length) return;
    // Resolve facility_ids dari facility_codes_in_file
    const codeToId = {};
    allFacilities.forEach((f) => { codeToId[f.facility_code] = f.id; });
    const facIds = (parseResult.facility_codes_in_file || []).map((c) => codeToId[c]).filter(Boolean);
    onImported(parseResult.items, facIds);
    toast.success(`${parseResult.items.length} item ter-apply ke form.`);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "export" ? "Export BOQ Snapshot" : "Import dari Excel"}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Tutup</button>
          {mode === "export" && (
            <button className="btn-primary" onClick={doExport} disabled={busy}>
              {busy && <Spinner size={12} />} Download Snapshot
            </button>
          )}
          {mode === "import" && parseResult?.items?.length > 0 && (
            <button className="btn-primary" onClick={applyParsed} disabled={busy}>
              Terapkan {parseResult.items.length} Perubahan ke Form
            </button>
          )}
        </>
      }
    >
      {mode === "export" ? (
        <div className="space-y-3 text-sm">
          <p className="text-ink-700">Pilih scope fasilitas:</p>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={scope === "current"} onChange={() => setScope("current")} />
              <span>Hanya fasilitas saat ini</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />
              <span>Semua fasilitas di kontrak ({allFacilities.length})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={scope === "multi"} onChange={() => setScope("multi")} />
              <span>Pilih beberapa</span>
            </label>
            {scope === "multi" && (
              <div className="ml-5 max-h-48 overflow-y-auto border border-ink-200 rounded p-2 space-y-1">
                {allFacilities.map((f) => (
                  <label key={f.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedFacIds.includes(f.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedFacIds([...selectedFacIds, f.id]);
                        else setSelectedFacIds(selectedFacIds.filter((id) => id !== f.id));
                      }}
                    />
                    <span className="font-mono text-ink-500">[{f.location_code}] {f.facility_code}</span>
                    <span>{f.facility_name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {showSheetModeOption && (
            <div>
              <p className="text-ink-700 mb-1">Format sheet:</p>
              <div className="space-y-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={sheetMode === "flat"} onChange={() => setSheetMode("flat")} />
                  <span>Satu sheet (semua fasilitas digabung)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={sheetMode === "per_facility"} onChange={() => setSheetMode("per_facility")} />
                  <span>Sheet terpisah per fasilitas <span className="text-ink-400 text-[11px]">(+ sheet REKAP)</span></span>
                </label>
              </div>
              {sheetMode === "per_facility" && (
                <p className="mt-1 text-[11px] text-indigo-600">
                  Import akan auto-detect format ini — sheet <code className="bg-indigo-50 px-1 rounded">FAC_*</code> dibaca semua sekaligus.
                  Anda bisa hapus sheet fasilitas yang tidak perlu diedit sebelum upload.
                </p>
              )}
            </div>
          )}

          <div className="p-2 bg-ink-50 rounded text-[11px] text-ink-700">
            <p className="font-medium">Yang akan ada di file:</p>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>BOQ aktif fasilitas terpilih (kode, parent_code, vol_awal, harga)</li>
              <li>Info VO APPROVED-pending lain (kolom vol_pending_vo_lain, nilai_pending, catatan_vo_lain)</li>
              <li>vol_efektif = vol_awal + vol_pending (proyeksi kalau VO lain di-bundle)</li>
              <li><b>vol_baru</b> editable — default = vol_efektif</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-ink-700">
            Upload Excel hasil edit (kolom <code className="bg-ink-100 px-1 rounded">vol_baru</code> yang anda ubah).
            Sistem akan auto-detect action per row.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={onFileChange}
            disabled={busy}
            className="block w-full text-xs"
          />
          {busy && <p className="text-xs text-ink-500">Memproses...</p>}
          {parseResult && (
            <div className="space-y-2">
              <div className="p-2 rounded bg-ink-50 text-xs">
                <p className="font-semibold">Hasil parse:</p>
                <p>{parseResult.items.length} item akan diterapkan</p>
                <p className="text-ink-500">
                  Facility ter-pengaruh: {(parseResult.facility_codes_in_file || []).join(", ") || "—"}
                </p>
              </div>
              {parseResult.errors?.length > 0 && (
                <div className="p-2 rounded bg-red-50 border border-red-200 text-xs text-red-800">
                  <p className="font-semibold">{parseResult.errors.length} error — perbaiki dulu:</p>
                  <ul className="list-disc list-inside mt-1 max-h-32 overflow-y-auto">
                    {parseResult.errors.slice(0, 30).map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
              {parseResult.warnings?.length > 0 && (
                <div className="p-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  <p className="font-semibold">{parseResult.warnings.length} warning:</p>
                  <ul className="list-disc list-inside mt-1 max-h-32 overflow-y-auto">
                    {parseResult.warnings.slice(0, 30).map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
              {parseResult.items.length > 0 && (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-xs">
                  Klik tombol "Terapkan" di bawah untuk replace items existing form
                  dengan hasil parse. Perubahan baru ter-commit ke DB saat anda klik
                  "Simpan VO" di modal utama.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

const VO_ACTION_META = {
  add: { label: "+ Tambah Item", color: "emerald", sign: "+" },
  increase: { label: "↑ Tambah Volume", color: "emerald", sign: "+" },
  decrease: { label: "↓ Kurang Volume", color: "amber", sign: "−" },
  modify_spec: { label: "~ Ubah Spek", color: "blue", sign: "" },
  remove: { label: "✕ Hapus Item", color: "red", sign: "−" },
  remove_facility: { label: "✕✕ Hapus Fasilitas", color: "red", sign: "−" },
};

function VOActionBadge({ action }) {
  const m = VO_ACTION_META[action] || { label: action, color: "slate" };
  const cls = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
  }[m.color];
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${cls}`}>
      {m.label}
    </span>
  );
}

function VOItemCard({ it }) {
  const action = it.action;
  const meta = VO_ACTION_META[action] || {};
  const rowBg =
    meta.color === "emerald" ? "bg-emerald-50/30 border-emerald-200"
    : meta.color === "red" ? "bg-red-50/30 border-red-200"
    : meta.color === "amber" ? "bg-amber-50/30 border-amber-200"
    : meta.color === "blue" ? "bg-blue-50/30 border-blue-200"
    : "bg-white border-ink-200";
  const impactCls = it.cost_impact > 0 ? "text-emerald-700"
    : it.cost_impact < 0 ? "text-red-700" : "text-ink-700";

  // Build Before / After based on action type
  let before = null, after = null;

  if (action === "add") {
    const fac = it.target_facility;
    before = <span className="text-ink-400 italic">(item belum ada)</span>;
    after = (
      <div className="space-y-0.5">
        <div>{it.description}</div>
        {fac && <div className="text-[10px] text-ink-500 font-mono">pada {fac.location_code}/{fac.code} — {fac.name}</div>}
        <div className="text-[11px] text-ink-600 font-mono">
          Vol: <b>{fmtVolume(it.volume_delta)}</b> {it.unit} × {fmtCurrency(it.unit_price)}
        </div>
      </div>
    );
  } else if (action === "increase" || action === "decrease") {
    const tgt = it.target_boq;
    const oldVol = tgt?.volume ?? 0;
    const newVol = oldVol + (it.volume_delta || 0);
    before = tgt ? (
      <div className="space-y-0.5">
        <div>{tgt.description}</div>
        <div className="text-[10px] text-ink-500 font-mono">{tgt.location_code}/{tgt.facility_code} · {tgt.full_code}</div>
        <div className="text-[11px] font-mono">Vol: <b>{fmtVolume(tgt.volume)}</b> {tgt.unit} × {fmtCurrency(tgt.unit_price)}</div>
      </div>
    ) : <span className="text-ink-400">— target tidak ditemukan —</span>;
    after = (
      <div className="space-y-0.5">
        <div className="text-[11px] font-mono">
          Vol: <b>{fmtVolume(newVol)}</b> {tgt?.unit || it.unit}
          <span className={`ml-2 ${action === "increase" ? "text-emerald-700" : "text-red-700"}`}>
            ({action === "increase" ? "+" : ""}{fmtVolume(it.volume_delta)})
          </span>
        </div>
        <div className="text-[11px] font-mono text-ink-600">
          Harga: {fmtCurrency(it.unit_price || tgt?.unit_price || 0)}
        </div>
      </div>
    );
  } else if (action === "modify_spec") {
    const tgt = it.target_boq;
    before = tgt ? (
      <div className="space-y-0.5">
        <div>{it.old_description || tgt.description}</div>
        <div className="text-[10px] text-ink-500 font-mono">
          {tgt.location_code}/{tgt.facility_code} · Satuan: {it.old_unit || tgt.unit}
        </div>
      </div>
    ) : <span className="text-ink-400">— target tidak ditemukan —</span>;
    after = (
      <div className="space-y-0.5">
        <div>{it.description}</div>
        <div className="text-[10px] text-ink-500 font-mono">Satuan: {it.unit}</div>
      </div>
    );
  } else if (action === "remove") {
    const tgt = it.target_boq;
    before = tgt ? (
      <div className="space-y-0.5">
        <div>{tgt.description}</div>
        <div className="text-[10px] text-ink-500 font-mono">{tgt.location_code}/{tgt.facility_code} · {tgt.full_code}</div>
        <div className="text-[11px] font-mono">Vol: <b>{fmtVolume(tgt.volume)}</b> {tgt.unit} × {fmtCurrency(tgt.unit_price)} = {fmtCurrency(tgt.total_price)}</div>
      </div>
    ) : <span className="text-ink-400">— target tidak ditemukan —</span>;
    after = <span className="text-red-600 font-semibold line-through">DIHAPUS (cascade ke children)</span>;
  } else if (action === "remove_facility") {
    const fac = it.target_facility;
    before = fac ? (
      <div className="space-y-0.5">
        <div className="font-semibold">{fac.name}</div>
        <div className="text-[10px] text-ink-500 font-mono">{fac.location_code}/{fac.code}</div>
        <div className="text-[11px]">{fac.item_count} item · Nilai: <b>{fmtCurrency(fac.total_value)}</b></div>
      </div>
    ) : <span className="text-ink-400">— fasilitas tidak ditemukan —</span>;
    after = <span className="text-red-600 font-semibold">SELURUH FASILITAS & SEMUA ITEM DIHAPUS</span>;
  }

  return (
    <div className={`border rounded-lg p-3 text-xs ${rowBg}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <VOActionBadge action={action} />
        <div className={`font-mono font-semibold ${impactCls}`}>
          Δ Biaya: {it.cost_impact >= 0 ? "+" : ""}{fmtCurrency(it.cost_impact)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-semibold text-ink-500 uppercase mb-1">⬅ Sebelum</p>
          <div className="p-2 bg-white/60 border border-ink-100 rounded text-[11px] leading-relaxed">
            {before}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-ink-500 uppercase mb-1">Sesudah ➡</p>
          <div className="p-2 bg-white/60 border border-ink-100 rounded text-[11px] leading-relaxed">
            {after}
          </div>
        </div>
      </div>
      {it.notes && (
        <div className="mt-2 text-[11px] text-ink-600 italic border-t border-ink-100 pt-1">
          Catatan: {it.notes}
        </div>
      )}
    </div>
  );
}

function VODetailModal({ vo, onClose }) {
  // Summary per action
  const summary = useMemo(() => {
    const s = { add: 0, increase: 0, decrease: 0, modify_spec: 0, remove: 0, remove_facility: 0 };
    (vo.items || []).forEach((it) => { if (s[it.action] != null) s[it.action] += 1; });
    return s;
  }, [vo.items]);

  return (
    <Modal open onClose={onClose} title={`Detail ${vo.vo_number}`} size="xl" footer={
      <button className="btn-primary" onClick={onClose}>Tutup</button>
    }>
      <div className="space-y-4 text-sm">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-ink-200">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${VO_STATUS_BADGE[vo.status]}`}>
                {VO_STATUS_LABEL[vo.status] || vo.status}
              </span>
              <span className="font-semibold text-ink-900">{vo.title}</span>
            </div>
            <p className="text-[11px] text-ink-500">Dibuat {fmtDate(vo.created_at)}</p>
            {vo.source_observation && (
              <p className="text-[11px] mt-1">
                <span className="text-ink-500">↖ Asal:</span>{" "}
                <span className="font-medium text-brand-700">
                  {vo.source_observation.type === "mc_0" ? "MC-0" : "MC Lanjutan"}
                </span>
                <span className="text-ink-600"> · {vo.source_observation.title}</span>
                <span className="text-ink-500"> · {fmtDate(vo.source_observation.observation_date)}</span>
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] text-ink-500 uppercase">Total Δ Biaya</p>
            <p className={`text-lg font-bold ${
              vo.cost_impact > 0 ? "text-emerald-700"
              : vo.cost_impact < 0 ? "text-red-700" : "text-ink-700"
            }`}>
              {vo.cost_impact >= 0 ? "+" : ""}{fmtCurrency(vo.cost_impact)}
            </p>
          </div>
        </div>

        {/* Summary chips */}
        {(vo.items?.length || 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(summary).filter(([, n]) => n > 0).map(([act, n]) => (
              <div key={act} className="flex items-center gap-1">
                <VOActionBadge action={act} />
                <span className="text-xs font-semibold text-ink-700">{n}</span>
              </div>
            ))}
          </div>
        )}

        {/* Justifikasi */}
        <div>
          <p className="text-xs text-ink-500 font-medium mb-0.5">Justifikasi Teknis</p>
          <p className="whitespace-pre-line text-[13px] p-2 bg-ink-50 rounded">{vo.technical_justification}</p>
        </div>
        {vo.quantity_calculation && (
          <div>
            <p className="text-xs text-ink-500 font-medium mb-0.5">Perhitungan Volume</p>
            <p className="whitespace-pre-line text-[13px] p-2 bg-ink-50 rounded">{vo.quantity_calculation}</p>
          </div>
        )}

        {vo.rejection_reason && (
          <div className="p-3 rounded bg-red-50 border border-red-200 text-xs text-red-800">
            <p className="font-semibold">Ditolak</p>
            <p className="mt-1">{vo.rejection_reason}</p>
          </div>
        )}

        {/* Items Before/After */}
        {(vo.items?.length || 0) > 0 ? (
          <div>
            <p className="text-xs font-semibold text-ink-700 mb-2">
              Rincian Perubahan ({vo.items.length} item) — Sebelum vs Sesudah
            </p>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {vo.items.map((it, i) => <VOItemCard key={it.id || i} it={it} />)}
            </div>
          </div>
        ) : (
          <p className="text-xs text-ink-500 italic text-center py-4">
            Belum ada item perubahan. Edit VO untuk menambah item.
          </p>
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
function FieldObservationsPanel({ contract, onChange, onCreateVOFromObservation }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [postSaveObs, setPostSaveObs] = useState(null); // obs yang baru disimpan → tawarkan buat VO
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
                  {o.triggered_vos?.length > 0 && (
                    <div className="mt-2 flex items-center flex-wrap gap-1 text-[11px]">
                      <span className="text-ink-500">↗ memicu</span>
                      {o.triggered_vos.map((v) => (
                        <span
                          key={v.id}
                          className={`font-mono px-1.5 py-0.5 rounded border ${VO_STATUS_BADGE[v.status] || "bg-slate-100 border-slate-200"}`}
                          title={`${v.vo_number} · ${VO_STATUS_LABEL[v.status] || v.status}`}
                        >
                          {v.vo_number}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button className="btn-ghost btn-xs" onClick={() => setEditing(o)} title="Edit">
                    <Edit2 size={11} />
                  </button>
                  <button className="btn-ghost btn-xs text-red-600" onClick={() => del(o.id)} title="Hapus">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {showCreate && (
        <FOCreateModal contract={contract} hasMC0={hasMC0}
          onClose={() => setShowCreate(false)}
          onSuccess={(saved) => {
            setShowCreate(false);
            refresh();
            if (saved) setPostSaveObs(saved); // trigger tawaran buat VO
          }} />
      )}
      {editing && (
        <FOCreateModal contract={contract} hasMC0={hasMC0} initial={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => { setEditing(null); refresh(); }} />
      )}
      {postSaveObs && (
        <Modal
          open
          onClose={() => setPostSaveObs(null)}
          title="Buat VO dari observasi ini?"
          size="md"
          footer={
            <>
              <button className="btn-secondary" onClick={() => setPostSaveObs(null)}>
                Tidak, cukup BA
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  const obs = postSaveObs;
                  setPostSaveObs(null);
                  onCreateVOFromObservation?.(obs);
                }}
              >
                <Plus size={12} /> Ya, buat VO sekarang
              </button>
            </>
          }
        >
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-semibold">{postSaveObs.type === "mc_0" ? "MC-0" : "MC Lanjutan"}</span>{" "}
              <span className="text-ink-600">· {postSaveObs.title}</span>
            </p>
            <p className="text-ink-600">
              MC/observasi bersifat non-legal — BOQ tidak berubah hanya dari BA. Kalau ada
              temuan yang memerlukan penyesuaian volume, tambahan item, atau penghapusan
              fasilitas, buat VO sekarang supaya ada jejak usulan yang bisa di-review PPK.
            </p>
            <p className="text-xs text-ink-500">
              VO yang dibuat akan otomatis punya referensi ke observasi ini.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function FOCreateModal({ contract, hasMC0, initial, onClose, onSuccess }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(() => initial
    ? {
        type: initial.type,
        observation_date: initial.observation_date || new Date().toISOString().slice(0, 10),
        title: initial.title || "",
        findings: initial.findings || "",
        attendees: initial.attendees || "",
      }
    : {
        type: hasMC0 ? "mc_interim" : "mc_0",
        observation_date: new Date().toISOString().slice(0, 10),
        title: "", findings: "", attendees: "",
      });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (form.findings.length < 10) return toast.error("Temuan minimal 10 karakter");
    setSaving(true);
    try {
      let saved = null;
      if (isEdit) {
        const { data } = await fieldObsAPI.update(initial.id, form);
        saved = data;
        toast.success("Observasi diperbarui");
      } else {
        const { data } = await fieldObsAPI.create(contract.id, form);
        saved = data;
        toast.success("Observasi tersimpan");
      }
      // Hanya tawarkan VO-shortcut pada create (bukan edit)
      onSuccess?.(isEdit ? null : saved);
    }
    catch (e) { toast.error(parseApiError(e)); }
    finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit Observasi Lapangan" : "Observasi Lapangan Baru"} size="lg" footer={
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


// ════════════════════════════════════════════════════════════════════════════
// BoqItemPicker — searchable picker pengganti dropdown biasa
// Untuk kontrak yang punya 500+ BOQ item, dropdown plain tidak manusiawi.
// Komponen ini:
//   - tombol ringkas menampilkan item terpilih (atau "Pilih BOQ Item…")
//   - klik → popover dengan search box + list scrollable
//   - query filter match: kode lokasi/fasilitas, deskripsi, satuan, kode BOQ
//   - groupable by lokasi → fasilitas supaya list terstruktur saat di-scroll
//   - keyboard: Esc tutup, ↑/↓ navigasi, Enter pilih
// ════════════════════════════════════════════════════════════════════════════
function BoqItemPicker({ items, loading, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const rootRef = useRef(null);
  const searchInputRef = useRef(null);

  const selected = useMemo(
    () => items.find((b) => b.id === value) || null,
    [items, value]
  );

  // Filter items berdasarkan query. Multi-term: split by space, semua kata
  // harus match (AND) di salah satu field. Case-insensitive.
  const filtered = useMemo(() => {
    if (!items?.length) return [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const terms = q.split(/\s+/).filter(Boolean);
    return items.filter((b) => {
      const hay = [
        b.description, b.unit, b.original_code, b.full_code,
        b.location_code, b.location_name,
        b.facility_code, b.facility_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [items, query]);

  // Close saat klik outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Auto-focus search saat open + reset highlight
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightIdx(0);
      setTimeout(() => searchInputRef.current?.focus(), 30);
    }
  }, [open]);

  // Reset highlight saat filter berubah supaya tidak index out-of-bound
  useEffect(() => {
    setHighlightIdx(0);
  }, [query]);

  const choose = (b) => {
    onChange(b.id);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlightIdx]) choose(filtered[highlightIdx]);
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => !loading && setOpen((o) => !o)}
        disabled={loading}
        className="input py-1 text-xs w-full text-left flex items-center gap-2 justify-between"
      >
        <span className="truncate flex-1">
          {loading ? (
            <span className="text-ink-400">memuat BOQ…</span>
          ) : selected ? (
            <>
              <span className="font-mono text-[10px] text-brand-600 mr-1">
                [{selected.location_code}/{selected.facility_code}]
              </span>
              {selected.description}
            </>
          ) : (
            <span className="text-ink-400">Pilih BOQ Item… ({items.length} tersedia)</span>
          )}
        </span>
        <ChevronRight size={11} className={`flex-shrink-0 text-ink-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 right-0 bg-white border border-ink-300 rounded-lg shadow-xl overflow-hidden">
          <div className="border-b border-ink-200 p-2 flex items-center gap-2 bg-ink-50">
            <Search size={13} className="text-ink-400 ml-1" />
            <input
              ref={searchInputRef}
              type="text"
              className="flex-1 bg-transparent text-xs outline-none py-0.5"
              placeholder="Cari kode, deskripsi, lokasi, fasilitas… (multi-kata dipisah spasi)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-ink-400 hover:text-ink-700 p-0.5"
              >
                <XIcon size={12} />
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-xs text-ink-500 italic text-center">
                {items.length === 0
                  ? "Tidak ada BOQ item. Import BOQ dulu di tab BOQ."
                  : "Tidak ada hasil. Coba kata kunci lain."}
              </p>
            ) : (
              filtered.slice(0, 200).map((b, i) => {
                const active = i === highlightIdx;
                const isSelected = b.id === value;
                return (
                  <button
                    type="button"
                    key={b.id}
                    onClick={() => choose(b)}
                    onMouseEnter={() => setHighlightIdx(i)}
                    className={`w-full text-left px-3 py-2 text-xs border-b border-ink-100 last:border-0 ${
                      active ? "bg-brand-50" : "bg-white hover:bg-ink-50"
                    } ${isSelected ? "ring-1 ring-brand-400" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          <span className="font-mono text-[10px] text-brand-600 font-semibold">
                            [{b.location_code}/{b.facility_code}]
                          </span>
                          {b.original_code && (
                            <span className="font-mono text-[10px] text-ink-500">{b.original_code}</span>
                          )}
                        </div>
                        <p className="font-medium text-ink-800 line-clamp-2">
                          {b.description}
                        </p>
                        <p className="text-[10px] text-ink-500 mt-0.5">
                          {b.unit} · vol {fmtVolume(b.volume)} · Rp {Number(b.unit_price || 0).toLocaleString("id-ID")}
                        </p>
                      </div>
                      {isSelected && (
                        <Check size={14} className="text-brand-600 flex-shrink-0 mt-1" />
                      )}
                    </div>
                  </button>
                );
              })
            )}
            {filtered.length > 200 && (
              <p className="px-3 py-2 text-[11px] text-ink-500 italic text-center border-t border-ink-100 bg-ink-50">
                Menampilkan 200 dari {filtered.length} hasil — persempit kata kunci untuk lebih spesifik.
              </p>
            )}
          </div>

          <div className="border-t border-ink-200 px-3 py-1.5 bg-ink-50 text-[10px] text-ink-500 flex items-center justify-between">
            <span>
              ↑↓ navigasi · Enter pilih · Esc tutup
            </span>
            <span>{filtered.length} / {items.length} item</span>
          </div>
        </div>
      )}
    </div>
  );
}
