import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { AgGridReact } from "ag-grid-react";
import { Plus, Save, Trash2, Tag, Lock } from "lucide-react";
import { boqAPI, masterAPI } from "@/api";
import toast from "react-hot-toast";
import { parseApiError, fmtNum } from "@/utils/format";
import { Spinner } from "@/components/ui";
import BOQItemPickerModal from "@/components/modals/BOQItemPickerModal";

/**
 * BOQ editor grid.
 *
 * Modes:
 *   - readonly=true                → read-only (viewer / completed contract)
 *   - revisionLocked=true          → APPROVED revision di kontrak aktif;
 *                                    grid render, banner "harus via Addendum"
 *                                    muncul di atas, semua edit/add/delete
 *                                    di-disable di UI (guard server tetap)
 *   - default                      → full editable (DRAFT revision)
 *
 * Input item punya dua jalur:
 *   1. Inline edit di grid (kolom uraian/satuan/volume/harga) — cepat
 *   2. Tombol "+ Tambah Item" buka modal picker — master atau manual
 *
 * Kolom "Uraian" sekarang jadi dropdown master work-code (datalist HTML
 * native) saat edit inline — ketik sebagian nama → muncul saran. Tidak
 * pilih master pun OK, tinggal ketik manual → tetap tersimpan sebagai
 * custom item.
 */
export default function BOQGrid({
  facilityId,
  items,
  onChange,
  readonly = false,
  revisionLocked = false,
}) {
  const gridRef = useRef();
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState(items);
  const [selectedCount, setSelectedCount] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [workCodes, setWorkCodes] = useState([]);

  const canEdit = !readonly && !revisionLocked;

  // Load work codes untuk autocomplete inline
  useEffect(() => {
    if (!canEdit) return;
    masterAPI.workCodes({ page_size: 500 })
      .then(({ data }) => setWorkCodes(data || []))
      .catch(() => setWorkCodes([]));
  }, [canEdit]);

  // Quick-lookup map: description → MasterWorkCode
  const descToCode = useMemo(() => {
    const m = new Map();
    workCodes.forEach((w) => m.set(w.description, w));
    return m;
  }, [workCodes]);

  const computeTotal = (row) => {
    const v = parseFloat(row.volume) || 0;
    const p = parseFloat(row.unit_price) || 0;
    return v * p;
  };

  // Badge: kode master (biru) atau "custom" (abu)
  const MasterCodeRenderer = ({ value, data }) => {
    if (value) {
      return (
        <span style={{
          display: "inline-flex", alignItems: "center",
          padding: "1px 6px", borderRadius: 4, fontSize: 10,
          fontFamily: "monospace", fontWeight: 700,
          background: "#eff6ff", color: "#1d4ed8",
          border: "1px solid #bfdbfe",
        }}>
          {value}
        </span>
      );
    }
    if (data?.description) {
      return (
        <span style={{
          padding: "1px 6px", borderRadius: 4, fontSize: 10,
          background: "#f1f5f9", color: "#64748b",
        }}>
          custom
        </span>
      );
    }
    return null;
  };

  // Cell editor pakai datalist HTML native untuk autocomplete ringan
  // Mengetik uraian → lihat saran master → pilih → kolom master_work_code
  // otomatis ter-set di onCellValueChanged.
  const descriptionEditor = {
    cellEditor: "agTextCellEditor",
    cellEditorParams: {
      useFormatter: false,
    },
  };

  const columns = useMemo(() => [
    {
      headerName: "",
      field: "__select",
      width: 40,
      pinned: "left",
      checkboxSelection: canEdit,
      headerCheckboxSelection: canEdit,
      headerCheckboxSelectionFilteredOnly: true,
      resizable: false,
      sortable: false,
      suppressMovable: true,
      editable: false,
    },
    {
      headerName: "Kode Master",
      field: "master_work_code",
      width: 128,
      editable: false,
      cellRenderer: MasterCodeRenderer,
    },
    {
      headerName: "Lvl",
      field: "level",
      width: 62,
      editable: canEdit,
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: [0, 1, 2, 3] },
      cellStyle: { fontFamily: "monospace", color: "#64748b", fontSize: 12 },
    },
    {
      headerName: "Kode Item",
      field: "original_code",
      width: 92,
      editable: canEdit,
      cellStyle: { fontFamily: "monospace", fontSize: 12 },
    },
    {
      headerName: "Uraian Pekerjaan",
      field: "description",
      flex: 2,
      minWidth: 240,
      editable: canEdit,
      ...descriptionEditor,
      cellStyle: (p) => ({
        fontWeight: (p.data?.level ?? 0) <= 1 ? 600 : 400,
        paddingLeft: `${8 + (p.data?.level ?? 0) * 10}px`,
      }),
    },
    { headerName: "Satuan", field: "unit", width: 72, editable: canEdit },
    {
      headerName: "Volume",
      field: "volume",
      width: 92,
      editable: canEdit,
      type: "numericColumn",
      valueParser: (p) => parseFloat(p.newValue) || 0,
      valueFormatter: (p) => fmtNum(p.value, 2),
    },
    {
      headerName: "Harga Satuan",
      field: "unit_price",
      width: 124,
      editable: canEdit,
      type: "numericColumn",
      valueParser: (p) => parseFloat(p.newValue) || 0,
      valueFormatter: (p) => fmtNum(p.value, 0),
    },
    {
      headerName: "Total",
      field: "total_price",
      width: 130,
      editable: false,
      type: "numericColumn",
      valueGetter: (p) => computeTotal(p.data),
      valueFormatter: (p) => fmtNum(p.value, 0),
      cellStyle: {
        fontWeight: 600, backgroundColor: "#f8fafc", color: "#0f172a",
      },
    },
    {
      headerName: "Bobot %",
      field: "weight_pct",
      width: 86,
      editable: false,
      valueFormatter: (p) => ((p.value || 0) * 100).toFixed(3) + "%",
      cellStyle: { color: "#64748b", fontSize: 11 },
    },
  ], [canEdit]);

  // Dipanggil oleh picker modal (both master & manual path)
  const handlePickerAdd = useCallback((newRow) => {
    setRows((r) => [...r, newRow]);
  }, []);

  // Quick-add inline: satu baris kosong untuk inline typing
  const addBlankRow = () => {
    setRows((r) => [...r, {
      id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      facility_id: facilityId,
      _new: true,
      level: 2,
      original_code: "",
      master_work_code: null,
      description: "",
      unit: "",
      volume: 0,
      unit_price: 0,
      total_price: 0,
      weight_pct: 0,
      is_leaf: true,
    }]);
  };

  const deleteSelected = useCallback(async () => {
    const api = gridRef.current?.api;
    if (!api) return;
    const nodes = api.getSelectedNodes();
    if (!nodes.length) {
      toast.error("Centang baris yang ingin dihapus terlebih dahulu.");
      return;
    }
    const selectedIds = new Set(nodes.map((n) => n.data.id));
    if (!confirm(`Hapus ${nodes.length} item BOQ?`)) return;
    try {
      for (const node of nodes) {
        if (!node.data._new) await boqAPI.remove(node.data.id);
      }
      setRows((rs) => rs.filter((r) => !selectedIds.has(r.id)));
      toast.success(`${nodes.length} item dihapus`);
      onChange?.();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  }, [onChange]);

  const saveAll = async () => {
    setSaving(true);
    try {
      const newOnes = rows.filter((r) => r._new && r.description).map((r) => ({
        facility_id: facilityId,
        master_work_code: r.master_work_code || null,
        parent_id: null,
        original_code: r.original_code || null,
        level: parseInt(r.level) || 0,
        display_order: 0,
        description: r.description,
        unit: r.unit,
        volume: parseFloat(r.volume) || 0,
        unit_price: parseFloat(r.unit_price) || 0,
        total_price: computeTotal(r),
        weight_pct: 0,
        is_leaf: !!r.is_leaf,
      }));
      if (newOnes.length) await boqAPI.bulk(newOnes);

      for (const r of rows) {
        if (!r._new && r._dirty) {
          await boqAPI.update(r.id, {
            description: r.description,
            unit: r.unit,
            volume: parseFloat(r.volume) || 0,
            unit_price: parseFloat(r.unit_price) || 0,
            total_price: computeTotal(r),
            master_work_code: r.master_work_code || null,
          });
        }
      }
      toast.success("BOQ tersimpan");
      onChange?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  // Saat user edit inline:
  // - volume / unit_price changed → re-compute total cache
  // - description changed → cek apakah match salah satu master work code;
  //   kalau ya, set master_work_code + unit + original_code otomatis
  const onCellValueChanged = (e) => {
    const row = e.data;
    const field = e.colDef.field;

    if (field === "volume" || field === "unit_price") {
      row.total_price = computeTotal(row);
    }

    if (field === "description") {
      const match = descToCode.get(row.description);
      if (match) {
        row.master_work_code = match.code;
        if (!row.unit) row.unit = match.default_unit || row.unit;
        if (!row.original_code) row.original_code = match.code;
      } else {
        // Kalau sebelumnya ada master tapi uraian diedit jadi beda → drop
        // flag master. User jadi explicit custom item.
        if (row.master_work_code) {
          const prevDesc = descToCode.get(
            workCodes.find((w) => w.code === row.master_work_code)?.description
          );
          if (!prevDesc || prevDesc.description !== row.description) {
            row.master_work_code = null;
          }
        }
      }
      e.api.refreshCells({ rowNodes: [e.node], force: true });
    }

    row._dirty = !row._new;
    e.api.refreshCells({ rowNodes: [e.node], force: true });
  };

  const total = rows.reduce((a, r) => a + computeTotal(r), 0);
  const masterCount = rows.filter((r) => r.master_work_code).length;
  const customCount = rows.filter((r) => !r.master_work_code && r.description).length;

  // Datalist HTML: ditaruh di atas grid supaya <input list=...> di cell
  // editor bisa pakai saran — AG Grid's text editor otomatis pakai
  // datalist kalau ada input list matching attribute, tapi karena itu
  // rumit, kita pakai approach lain: help user dengan showing code list
  // di footer + rely on picker modal untuk pilih yang eksplisit.

  return (
    <div className="space-y-3">
      {/* Banner untuk APPROVED revision (kontrak aktif) */}
      {revisionLocked && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <Lock size={14} className="text-amber-700 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-900">
            <p className="font-semibold">BOQ terkunci — kontrak sudah aktif.</p>
            <p className="mt-0.5 text-amber-800">
              Revisi BOQ yang aktif sudah disetujui (APPROVED). Untuk mengubah,
              menambah, atau menghapus item BOQ, buat <strong>Addendum</strong>
              {" "}baru yang akan menghasilkan revisi CCO berikutnya. Setelah
              Addendum dibuat, BOQ draft CCO yang baru bisa diedit bebas.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-ink-500 flex items-center gap-3 flex-wrap">
          <span>
            {rows.length} item ·{" "}
            {selectedCount > 0 && (
              <span className="text-brand-600 font-medium">
                {selectedCount} dipilih ·{" "}
              </span>
            )}
            Total <span className="font-semibold text-ink-800">{fmtNum(total)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            {masterCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                <Tag size={8} className="inline mr-0.5" />{masterCount} master
              </span>
            )}
            {customCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                {customCount} custom
              </span>
            )}
          </span>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button
              className="btn-secondary btn-xs"
              onClick={addBlankRow}
              title="Tambah baris kosong untuk diketik langsung di grid"
            >
              <Plus size={11} /> Baris
            </button>
            <button
              className="btn-primary btn-xs"
              onClick={() => setShowPicker(true)}
              title="Buka modal picker master kode atau input terstruktur"
            >
              <Plus size={11} /> Tambah Item
            </button>
            <button
              className="btn-ghost btn-xs text-red-600 disabled:opacity-40"
              onClick={deleteSelected}
              disabled={selectedCount === 0}
            >
              <Trash2 size={11} /> Hapus{selectedCount > 0 ? ` (${selectedCount})` : ""}
            </button>
            <button
              className="btn-secondary btn-xs"
              onClick={saveAll}
              disabled={saving}
            >
              {saving ? <Spinner size={11} /> : <Save size={11} />} Simpan
            </button>
          </div>
        )}
      </div>

      <div className="ag-theme-quartz" style={{ height: 460 }}>
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={columns}
          rowSelection="multiple"
          suppressRowClickSelection={true}
          stopEditingWhenCellsLoseFocus={true}
          singleClickEdit={true}
          onCellValueChanged={onCellValueChanged}
          onSelectionChanged={() => {
            setSelectedCount(gridRef.current?.api.getSelectedNodes().length || 0);
          }}
          getRowId={(p) => p.data.id}
          defaultColDef={{ resizable: true, sortable: false }}
        />
      </div>

      {canEdit && workCodes.length > 0 && (
        <div className="text-[11px] text-ink-400 px-1">
          💡 Tip: saat mengetik di kolom <em>Uraian</em>, jika cocok dengan salah
          satu {workCodes.length} kode standar, kolom <em>Kode Master</em> akan
          otomatis terisi. Atau klik <em>Tambah Item</em> untuk pencarian
          terstruktur.
        </div>
      )}

      <BOQItemPickerModal
        open={showPicker}
        facilityId={facilityId}
        onAdd={handlePickerAdd}
        onClose={() => setShowPicker(false)}
      />
    </div>
  );
}
