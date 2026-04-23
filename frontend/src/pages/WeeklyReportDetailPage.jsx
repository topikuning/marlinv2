import { useEffect, useState, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AgGridReact } from "ag-grid-react";
import toast from "react-hot-toast";
import {
  ChevronRight, Save, Image, Upload, Trash2, X, Lock, Unlock,
  Download, Filter, MapPin,
} from "lucide-react";
import { weeklyAPI, boqAPI, downloadBlob } from "@/api";
import {
  PageLoader, Modal, Spinner, Tabs, Empty,
} from "@/components/ui";
import {
  fmtPct, fmtDate, deviationBadge, parseApiError, fmtNum, assetUrl,
} from "@/utils/format";

export default function WeeklyReportDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [boqItems, setBoqItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("progress");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await weeklyAPI.get(id);
        setReport(data);
        const { data: boq } = await boqAPI.listByContractFlat(data.contract_id, true);
        setBoqItems(boq);
      } catch (e) {
        toast.error(parseApiError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <PageLoader />;
  if (!report) return <div className="p-6 text-ink-500">Tidak ditemukan</div>;

  const tabs = [
    { id: "progress", label: "Progress per Item BOQ", count: boqItems.length },
    { id: "narrative", label: "Narasi & Tenaga Kerja" },
    { id: "photos", label: "Foto Progres", count: report.photos?.length || 0 },
  ];

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-ink-500 mb-5">
        <button onClick={() => navigate("/reports/weekly")} className="hover:text-ink-900">
          Laporan Mingguan
        </button>
        <ChevronRight size={12} />
        <span className="text-ink-900 font-medium">
          Minggu ke-{report.week_number}
        </span>
      </div>

      <HeaderCard report={report} onChange={setReport} />

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "progress" && (
        <ProgressGrid
          report={report}
          boqItems={boqItems}
          onSaved={(r) => setReport(r)}
        />
      )}
      {tab === "narrative" && (
        <NarrativeTab report={report} onChange={setReport} />
      )}
      {tab === "photos" && (
        <PhotosTab report={report} boqItems={boqItems} onChange={setReport} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════

function HeaderCard({ report, onChange }) {
  const toggleLock = async () => {
    try {
      await weeklyAPI.update(report.id, { is_locked: !report.is_locked });
      onChange({ ...report, is_locked: !report.is_locked });
      toast.success(report.is_locked ? "Dikunci dibuka" : "Laporan dikunci");
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  return (
    <div className="card p-6 mb-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-display font-semibold text-ink-900">
            Minggu ke-{report.week_number}
          </h1>
          <p className="text-sm text-ink-500">
            {fmtDate(report.period_start)} – {fmtDate(report.period_end)} ·{" "}
            oleh {report.submitted_by || "—"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-secondary btn-xs" onClick={toggleLock}>
            {report.is_locked ? (
              <>
                <Unlock size={11} /> Buka Kunci
              </>
            ) : (
              <>
                <Lock size={11} /> Kunci
              </>
            )}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-5 pt-5 border-t border-ink-100">
        <KPI label="Rencana" value={fmtPct(report.planned_cumulative_pct * 100, 2)} />
        <KPI label="Aktual" value={fmtPct(report.actual_cumulative_pct * 100, 2)} highlight />
        <KPI
          label="Deviasi"
          value={(
            <span className={deviationBadge(report.deviation_status)}>
              {report.deviation_pct > 0 ? "+" : ""}
              {fmtPct(report.deviation_pct * 100, 2)}
            </span>
          )}
        />
        <KPI label="SPI" value={report.spi ? Number(report.spi).toFixed(3) : "—"} />
        <KPI
          label="Tenaga Kerja / Hari Hujan"
          value={`${report.manpower_count} / ${report.rain_days}`}
        />
      </div>
    </div>
  );
}

function KPI({ label, value, highlight }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-400 font-medium">
        {label}
      </p>
      <p
        className={`mt-1 ${
          highlight ? "text-lg font-display font-semibold text-ink-900" : "text-sm text-ink-800"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// AG Grid Progress Editor — per-item input, replaces "global %" input
// ════════════════════════════════════════════════════════════════════════════

function ProgressGrid({ report, boqItems, onSaved }) {
  const gridRef = useRef();
  const [saving, setSaving] = useState(false);
  const [filterLocation, setFilterLocation] = useState("");
  const [filterFacility, setFilterFacility] = useState("");
  const [importing, setImporting] = useState(false);

  // Merge BOQ items with existing progress entries
  const allRows = useMemo(() => {
    const progressMap = new Map(
      (report.progress_items || []).map((p) => [p.boq_item_id, p])
    );
    return boqItems.map((b) => {
      const p = progressMap.get(b.id) || {};
      return {
        boq_item_id: b.id,
        location_id: b.location_id,
        location_code: b.location_code,
        location_name: b.location_name,
        facility_id: b.facility_id,
        facility_code: b.facility_code,
        facility_name: b.facility_name,
        full_code: b.full_code || b.original_code,
        description: b.description,
        unit: b.unit,
        volume_boq: parseFloat(b.volume || 0),
        weight_pct: parseFloat(b.weight_pct || 0),
        volume_this_week: parseFloat(p.volume_this_week || 0),
        volume_cumulative: parseFloat(p.volume_cumulative || 0),
        progress_cumulative_pct: parseFloat(p.progress_cumulative_pct || 0),
        weighted_progress_pct: parseFloat(p.weighted_progress_pct || 0),
        notes: p.notes || "",
        _dirty: false,
      };
    });
  }, [report, boqItems]);

  // Rollup per-lokasi: list unik lokasi + target (sum weight_pct) + realisasi
  // (sum weighted_progress_pct) untuk ditampilkan sebagai summary card.
  const locationSummary = useMemo(() => {
    const map = new Map();
    allRows.forEach((r) => {
      if (!r.location_id) return;
      const cur = map.get(r.location_id) || {
        id: r.location_id,
        code: r.location_code,
        name: r.location_name,
        target_weight: 0,
        actual_weight: 0,
        item_count: 0,
      };
      cur.target_weight += r.weight_pct || 0;
      cur.actual_weight += r.weighted_progress_pct || 0;
      cur.item_count += 1;
      map.set(r.location_id, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [allRows]);

  const facilityOptions = useMemo(() => {
    const seen = new Map();
    allRows.forEach((r) => {
      if (filterLocation && r.location_id !== filterLocation) return;
      if (r.facility_id && !seen.has(r.facility_id)) {
        seen.set(r.facility_id, { id: r.facility_id, code: r.facility_code, name: r.facility_name });
      }
    });
    return Array.from(seen.values());
  }, [allRows, filterLocation]);

  // Filter rowData berdasar lokasi/fasilitas dipilih
  const rowData = useMemo(() => {
    return allRows.filter((r) => {
      if (filterLocation && r.location_id !== filterLocation) return false;
      if (filterFacility && r.facility_id !== filterFacility) return false;
      return true;
    });
  }, [allRows, filterLocation, filterFacility]);

  const downloadExcel = async () => {
    try {
      const { data } = await weeklyAPI.exportExcel(report.id);
      downloadBlob(data, `progress_W${report.week_number}.xlsx`);
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  const uploadExcel = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const { data } = await weeklyAPI.importExcel(report.id, file);
      if (data.success) {
        toast.success(`Import sukses: ${data.updated} diubah, ${data.created} baru${data.skipped ? `, ${data.skipped} dilewati` : ""}`);
        onSaved?.();
      } else {
        toast.error(data.errors?.[0] || "Import gagal");
      }
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const columns = useMemo(
    () => [
      {
        headerName: "Lokasi",
        field: "location_code",
        width: 95,
        pinned: "left",
        cellStyle: { fontFamily: "JetBrains Mono", fontSize: "11px", color: "#64748b" },
      },
      {
        headerName: "Fasilitas",
        field: "facility_name",
        width: 160,
        pinned: "left",
        cellStyle: { fontSize: "12px" },
      },
      {
        headerName: "Kode",
        field: "full_code",
        width: 90,
        cellStyle: { fontFamily: "JetBrains Mono", fontSize: "11px" },
      },
      {
        headerName: "Uraian",
        field: "description",
        flex: 2,
        minWidth: 260,
        cellStyle: { fontSize: "12px" },
      },
      { headerName: "Satuan", field: "unit", width: 75 },
      {
        headerName: "Vol BOQ",
        field: "volume_boq",
        width: 95,
        type: "numericColumn",
        valueFormatter: (p) => fmtNum(p.value, 2),
      },
      {
        headerName: "Bobot %",
        field: "weight_pct",
        width: 90,
        valueFormatter: (p) => ((p.value || 0) * 100).toFixed(4) + "%",
        cellStyle: { color: "#64748b", fontSize: "11px" },
      },
      {
        headerName: "Vol Minggu Ini",
        field: "volume_this_week",
        width: 130,
        editable: !report.is_locked,
        type: "numericColumn",
        valueFormatter: (p) => fmtNum(p.value, 2),
        cellStyle: {
          backgroundColor: "#fefce8",
          fontWeight: 500,
          color: "#713f12",
        },
      },
      {
        headerName: "Vol Kumulatif",
        field: "volume_cumulative",
        width: 130,
        editable: !report.is_locked,
        type: "numericColumn",
        valueFormatter: (p) => fmtNum(p.value, 2),
        cellStyle: {
          backgroundColor: "#eff6ff",
          fontWeight: 500,
          color: "#1e3a8a",
        },
      },
      {
        headerName: "% Progres",
        field: "progress_cumulative_pct",
        width: 100,
        valueFormatter: (p) => ((p.value || 0) * 100).toFixed(1) + "%",
        cellStyle: (p) => ({
          color: (p.value || 0) >= 1 ? "#059669" : "#374151",
          fontWeight: 600,
        }),
      },
      {
        headerName: "Kontribusi",
        field: "weighted_progress_pct",
        width: 110,
        valueFormatter: (p) => ((p.value || 0) * 100).toFixed(4) + "%",
        cellStyle: { color: "#64748b", fontSize: "11px" },
      },
      {
        headerName: "Catatan",
        field: "notes",
        flex: 1,
        minWidth: 140,
        editable: !report.is_locked,
        cellStyle: { fontSize: "11px" },
      },
    ],
    [report.is_locked]
  );

  const onCellValueChanged = (e) => {
    const row = e.data;
    if (e.colDef.field === "volume_cumulative" && row.volume_boq > 0) {
      row.progress_cumulative_pct = row.volume_cumulative / row.volume_boq;
      row.weighted_progress_pct = row.progress_cumulative_pct * row.weight_pct;
    }
    row._dirty = true;
    e.api.refreshCells({ rowNodes: [e.node], force: true });
  };

  const save = async () => {
    const dirty = (gridRef.current?.api.getModel().rowsToDisplay || [])
      .map((n) => n.data)
      .filter((r) => r._dirty);
    if (!dirty.length) return toast("Tidak ada perubahan");
    setSaving(true);
    try {
      const payload = dirty.map((r) => ({
        boq_item_id: r.boq_item_id,
        volume_this_week: parseFloat(r.volume_this_week) || 0,
        volume_cumulative: parseFloat(r.volume_cumulative) || 0,
        notes: r.notes || null,
      }));
      const { data } = await weeklyAPI.upsertProgress(report.id, payload);
      toast.success(
        `${data.touched} item tersimpan. Kumulatif: ${(data.actual_cumulative_pct * 100).toFixed(2)}%`
      );
      // refresh
      const { data: fresh } = await weeklyAPI.get(report.id);
      onSaved(fresh);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!boqItems.length) {
    return (
      <Empty
        title="Kontrak ini belum punya item BOQ"
        description="Input BOQ terlebih dahulu di menu Kontrak > Lokasi > BOQ"
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Per-lokasi summary — target vs realisasi */}
      {locationSummary.length > 0 && (
        <div className="card p-4">
          <p className="text-[10px] uppercase tracking-wider text-ink-400 font-medium mb-2 flex items-center gap-1.5">
            <MapPin size={10} /> Ringkasan per Lokasi
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {locationSummary.map((l) => {
              const targetPct = (l.target_weight || 0) * 100;
              const actualPct = (l.actual_weight || 0) * 100;
              const pctOfTarget = l.target_weight > 0
                ? (l.actual_weight / l.target_weight) * 100
                : 0;
              return (
                <button
                  key={l.id}
                  onClick={() => {
                    setFilterLocation(filterLocation === l.id ? "" : l.id);
                    setFilterFacility("");
                  }}
                  className={`text-left p-2 rounded-lg border transition ${
                    filterLocation === l.id
                      ? "bg-brand-50 border-brand-400"
                      : "bg-white border-ink-200 hover:border-brand-300"
                  }`}
                >
                  <p className="font-mono text-[10px] text-brand-600">{l.code}</p>
                  <p className="text-xs font-medium text-ink-800 truncate">{l.name}</p>
                  <div className="mt-1.5">
                    <div className="flex justify-between text-[10px] text-ink-500 mb-0.5">
                      <span>Realisasi vs Target</span>
                      <span className="font-semibold text-ink-800">
                        {actualPct.toFixed(2)}% / {targetPct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-ink-100 rounded overflow-hidden">
                      <div
                        className={`h-full ${pctOfTarget >= 95 ? "bg-green-500" : pctOfTarget >= 70 ? "bg-brand-500" : "bg-amber-500"}`}
                        style={{ width: `${Math.min(100, pctOfTarget)}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-ink-400 mt-1">{l.item_count} item BOQ</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card p-4">
        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <Filter size={13} className="text-ink-500" />
          <select
            className="select py-1 text-xs"
            value={filterLocation}
            onChange={(e) => { setFilterLocation(e.target.value); setFilterFacility(""); }}
          >
            <option value="">Semua Lokasi</option>
            {locationSummary.map((l) => (
              <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>
            ))}
          </select>
          <select
            className="select py-1 text-xs"
            value={filterFacility}
            onChange={(e) => setFilterFacility(e.target.value)}
            disabled={!filterLocation}
          >
            <option value="">Semua Fasilitas</option>
            {facilityOptions.map((f) => (
              <option key={f.id} value={f.id}>[{f.code}] {f.name}</option>
            ))}
          </select>
          {(filterLocation || filterFacility) && (
            <button
              className="btn-ghost btn-xs"
              onClick={() => { setFilterLocation(""); setFilterFacility(""); }}
            >
              <X size={11} /> Reset
            </button>
          )}
          <span className="text-[11px] text-ink-500 ml-auto">
            {rowData.length} / {allRows.length} item
          </span>
          <button className="btn-ghost btn-xs" onClick={downloadExcel} title="Download progress ke Excel untuk diedit offline">
            <Download size={11} /> Export
          </button>
          <label className="btn-ghost btn-xs cursor-pointer" title="Upload file hasil edit untuk bulk-update">
            {importing ? <Spinner size={11} /> : <Upload size={11} />} Import
            <input type="file" hidden accept=".xlsx" onChange={uploadExcel} disabled={importing || report.is_locked} />
          </label>
          <button
            className="btn-primary btn-xs"
            onClick={save}
            disabled={saving || report.is_locked}
          >
            {saving ? <Spinner size={12} /> : <Save size={12} />} Simpan
          </button>
        </div>
        <div className="text-[11px] text-ink-500 mb-2">
          Kuning = vol minggu ini · Biru = vol kumulatif · Klik kartu lokasi di atas untuk memfilter cepat
        </div>
        <div className="ag-theme-quartz" style={{ height: 520 }}>
          <AgGridReact
            ref={gridRef}
            rowData={rowData}
            columnDefs={columns}
            stopEditingWhenCellsLoseFocus={true}
            singleClickEdit={true}
            onCellValueChanged={onCellValueChanged}
            getRowId={(p) => p.data.boq_item_id}
            defaultColDef={{ resizable: true, sortable: true, filter: true }}
          />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Narrative tab
// ════════════════════════════════════════════════════════════════════════════

function NarrativeTab({ report, onChange }) {
  const [form, setForm] = useState({
    manpower_count: report.manpower_count,
    manpower_skilled: report.manpower_skilled,
    manpower_unskilled: report.manpower_unskilled,
    rain_days: report.rain_days,
    obstacles: report.obstacles || "",
    solutions: report.solutions || "",
    executive_summary: report.executive_summary || "",
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await weeklyAPI.update(report.id, {
        manpower_count: parseInt(form.manpower_count) || 0,
        manpower_skilled: parseInt(form.manpower_skilled) || 0,
        manpower_unskilled: parseInt(form.manpower_unskilled) || 0,
        rain_days: parseInt(form.rain_days) || 0,
        obstacles: form.obstacles,
        solutions: form.solutions,
        executive_summary: form.executive_summary,
      });
      toast.success("Tersimpan");
      onChange({ ...report, ...form });
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-6 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Tenaga Kerja", "manpower_count"],
          ["Skilled", "manpower_skilled"],
          ["Unskilled", "manpower_unskilled"],
          ["Hari Hujan", "rain_days"],
        ].map(([label, key]) => (
          <div key={key}>
            <label className="label">{label}</label>
            <input
              type="number"
              className="input"
              value={form[key] || 0}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              disabled={report.is_locked}
            />
          </div>
        ))}
      </div>
      <div>
        <label className="label">Ringkasan Eksekutif</label>
        <textarea
          className="textarea h-24 resize-none"
          value={form.executive_summary}
          onChange={(e) => setForm({ ...form, executive_summary: e.target.value })}
          disabled={report.is_locked}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Hambatan / Masalah</label>
          <textarea
            className="textarea h-32 resize-none"
            value={form.obstacles}
            onChange={(e) => setForm({ ...form, obstacles: e.target.value })}
            disabled={report.is_locked}
          />
        </div>
        <div>
          <label className="label">Solusi / Tindak Lanjut</label>
          <textarea
            className="textarea h-32 resize-none"
            value={form.solutions}
            onChange={(e) => setForm({ ...form, solutions: e.target.value })}
            disabled={report.is_locked}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button className="btn-primary" onClick={save} disabled={saving || report.is_locked}>
          {saving && <Spinner size={14} />} Simpan Narasi
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Photos tab
// ════════════════════════════════════════════════════════════════════════════

function PhotosTab({ report, boqItems, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [tagFacilityId, setTagFacilityId] = useState("");

  // Derive list fasilitas unik dari BOQ items agar user bisa tag foto ke
  // fasilitas spesifik sebelum upload. Foto tanpa tag masih disimpan tapi
  // tidak muncul di galeri Dashboard Eksekutif.
  const facilityOptions = (() => {
    const seen = new Map();
    (boqItems || []).forEach((b) => {
      if (b.facility_id && !seen.has(b.facility_id)) {
        seen.set(b.facility_id, {
          id: b.facility_id,
          code: b.facility_code,
          name: b.facility_name,
          location: b.location_name,
        });
      }
    });
    return Array.from(seen.values());
  })();

  const onFile = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        await weeklyAPI.uploadPhoto(report.id, f, null, tagFacilityId || null);
      }
      toast.success(`${files.length} foto di-upload`);
      const { data } = await weeklyAPI.get(report.id);
      onChange(data);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (pid) => {
    if (!confirm("Hapus foto ini?")) return;
    try {
      await weeklyAPI.deletePhoto(report.id, pid);
      toast.success("Foto dihapus");
      const { data } = await weeklyAPI.get(report.id);
      onChange(data);
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="font-display font-semibold text-ink-800">
          Foto Progres Minggu Ini
        </h3>
        {!report.is_locked && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="select text-xs py-1"
              value={tagFacilityId}
              onChange={(e) => setTagFacilityId(e.target.value)}
              title="Foto akan di-tag ke fasilitas ini. Kosongkan untuk foto umum."
            >
              <option value="">Tag fasilitas: (umum, tanpa tag)</option>
              {facilityOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  [{f.code}] {f.name}
                </option>
              ))}
            </select>
            <label className="btn-primary btn-xs cursor-pointer">
              <Upload size={11} /> Upload Foto
              <input
                type="file"
                hidden
                multiple
                accept="image/*"
                onChange={onFile}
              />
            </label>
          </div>
        )}
      </div>
      {!report.is_locked && (
        <p className="text-[11px] text-ink-500 mb-3">
          💡 Pilih fasilitas terkait sebelum upload agar foto muncul di
          galeri Dashboard Eksekutif untuk fasilitas tersebut.
        </p>
      )}
      {uploading && (
        <div className="text-xs text-ink-500 mb-2 flex items-center gap-2">
          <Spinner size={12} /> Mengunggah...
        </div>
      )}
      {(() => {
        const photos = report.photos || [];
        if (!photos.length) return <Empty icon={Image} title="Belum ada foto" />;
        // Group foto per fasilitas. Pakai facilityOptions (dari BOQ items) untuk
        // resolve nama fasilitas. Foto tanpa facility_id masuk grup "Belum di-tag".
        const nameById = new Map(facilityOptions.map((f) => [f.id, f]));
        const buckets = new Map();
        photos.forEach((p) => {
          const key = p.facility_id || "_untagged";
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(p);
        });
        const entries = Array.from(buckets.entries());
        return (
          <div className="space-y-4">
            {entries.map(([key, list]) => {
              const f = key !== "_untagged" ? nameById.get(key) : null;
              return (
                <div key={key}>
                  <p className="text-xs font-semibold text-ink-700 mb-2 flex items-center gap-1.5">
                    {f ? (
                      <>
                        <span className="font-mono text-[10px] text-brand-600">[{f.code}]</span>
                        <span>{f.name}</span>
                        <span className="text-ink-400 font-normal">
                          · {f.location || "lokasi"}
                        </span>
                      </>
                    ) : (
                      <span className="text-amber-700">⚠ Belum di-tag fasilitas (tidak muncul di Dashboard Eksekutif)</span>
                    )}
                    <span className="text-ink-400 font-normal ml-auto">{list.length} foto</span>
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {list.map((p) => (
                      <div
                        key={p.id}
                        className="relative group aspect-square rounded-xl overflow-hidden bg-ink-100"
                      >
                        <img
                          src={assetUrl(p.thumbnail_path || p.file_path)}
                          alt={p.caption || ""}
                          className="w-full h-full object-cover"
                        />
                        {p.caption && (
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                            <p className="text-[11px] text-white truncate">{p.caption}</p>
                          </div>
                        )}
                        {!report.is_locked && (
                          <button
                            onClick={() => remove(p.id)}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-red-600 text-white p-1.5 rounded-lg"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
