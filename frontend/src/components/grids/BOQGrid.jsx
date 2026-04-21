import { useMemo, useRef, useState, useCallback } from "react";
import { AgGridReact } from "ag-grid-react";
import { Plus, Save, Trash2, Tag } from "lucide-react";
import { boqAPI } from "@/api";
import toast from "react-hot-toast";
import { parseApiError, fmtNum } from "@/utils/format";
import { Spinner } from "@/components/ui";
import BOQItemPickerModal from "@/components/modals/BOQItemPickerModal";

export default function BOQGrid({ facilityId, items, onChange, readonly = false }) {
  const gridRef = useRef();
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState(items);
  const [selectedCount, setSelectedCount] = useState(0);
  const [showPicker, setShowPicker] = useState(false);

  const computeTotal = (row) => {
    const v = parseFloat(row.volume) || 0;
    const p = parseFloat(row.unit_price) || 0;
    return v * p;
  };

  // Badge: kode master (brand) atau "custom" (abu)
  const MasterCodeRenderer = ({ value, data }) => {
    if (value) {
      return (
        <span style={{
          display:"inline-flex", alignItems:"center", gap:3,
          padding:"1px 6px", borderRadius:4, fontSize:10,
          fontFamily:"monospace", fontWeight:700,
          background:"#eff6ff", color:"#1d4ed8", border:"1px solid #bfdbfe"
        }}>
          {value}
        </span>
      );
    }
    if (data?.description) {
      return (
        <span style={{
          padding:"1px 6px", borderRadius:4, fontSize:10,
          background:"#f1f5f9", color:"#64748b"
        }}>
          custom
        </span>
      );
    }
    return null;
  };

  const columns = useMemo(() => [
    {
      headerName: "", field: "__select", width: 40, pinned: "left",
      checkboxSelection: !readonly, headerCheckboxSelection: !readonly,
      headerCheckboxSelectionFilteredOnly: true,
      resizable: false, sortable: false, suppressMovable: true, editable: false,
    },
    {
      headerName: "Kode Master", field: "master_work_code", width: 130,
      editable: false, cellRenderer: MasterCodeRenderer,
    },
    {
      headerName: "Level", field: "level", width: 68, editable: !readonly,
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: [0, 1, 2, 3] },
      cellStyle: { fontFamily: "monospace", color: "#64748b", fontSize: 12 },
    },
    {
      headerName: "Kode Item", field: "original_code", width: 88, editable: !readonly,
      cellStyle: { fontFamily: "monospace", fontSize: 12 },
    },
    {
      headerName: "Uraian Pekerjaan", field: "description", flex: 2, minWidth: 230,
      editable: !readonly,
      cellStyle: (p) => ({
        fontWeight: (p.data?.level ?? 0) <= 1 ? 600 : 400,
        paddingLeft: `${8 + (p.data?.level ?? 0) * 10}px`,
      }),
    },
    { headerName: "Satuan", field: "unit", width: 72, editable: !readonly },
    {
      headerName: "Volume", field: "volume", width: 90, editable: !readonly,
      type: "numericColumn",
      valueParser: (p) => parseFloat(p.newValue) || 0,
      valueFormatter: (p) => fmtNum(p.value, 2),
    },
    {
      headerName: "Harga Satuan", field: "unit_price", width: 122, editable: !readonly,
      type: "numericColumn",
      valueParser: (p) => parseFloat(p.newValue) || 0,
      valueFormatter: (p) => fmtNum(p.value, 0),
    },
    {
      headerName: "Total", field: "total_price", width: 130, editable: false,
      type: "numericColumn",
      valueGetter: (p) => computeTotal(p.data),
      valueFormatter: (p) => fmtNum(p.value, 0),
      cellStyle: { fontWeight: 600, backgroundColor: "#f8fafc", color: "#0f172a" },
    },
    {
      headerName: "Bobot %", field: "weight_pct", width: 88, editable: false,
      valueFormatter: (p) => ((p.value || 0) * 100).toFixed(3) + "%",
      cellStyle: { color: "#64748b", fontSize: 11 },
    },
  ], [readonly]);

  // Dipanggil oleh modal (kedua jalur: master & manual)
  const handlePickerAdd = useCallback((newRow) => {
    setRows((r) => [...r, newRow]);
  }, []);

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
        facility_id:      facilityId,
        master_work_code: r.master_work_code || null,
        parent_id:        null,
        original_code:    r.original_code || null,
        level:            parseInt(r.level) || 0,
        display_order:    0,
        description:      r.description,
        unit:             r.unit,
        volume:           parseFloat(r.volume) || 0,
        unit_price:       parseFloat(r.unit_price) || 0,
        total_price:      computeTotal(r),
        weight_pct:       0,
        is_leaf:          !!r.is_leaf,
      }));
      if (newOnes.length) await boqAPI.bulk(newOnes);

      for (const r of rows) {
        if (!r._new && r._dirty) {
          await boqAPI.update(r.id, {
            description: r.description, unit: r.unit,
            volume: parseFloat(r.volume) || 0,
            unit_price: parseFloat(r.unit_price) || 0,
            total_price: computeTotal(r),
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

  const onCellValueChanged = (e) => {
    const row = e.data;
    if (e.colDef.field === "volume" || e.colDef.field === "unit_price") {
      row.total_price = computeTotal(row);
    }
    row._dirty = !row._new;
    e.api.refreshCells({ rowNodes: [e.node], force: true });
  };

  const total       = rows.reduce((a, r) => a + computeTotal(r), 0);
  const masterCount = rows.filter((r) => r.master_work_code).length;
  const customCount = rows.filter((r) => !r.master_work_code && r.description).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-ink-500 flex items-center gap-3">
          <span>
            {rows.length} item ·{" "}
            {selectedCount > 0 && (
              <span className="text-brand-600 font-medium">{selectedCount} dipilih · </span>
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
        {!readonly && (
          <div className="flex gap-2">
            <button className="btn-primary btn-xs" onClick={() => setShowPicker(true)}>
              <Plus size={11} /> Tambah Item
            </button>
            <button
              className="btn-ghost btn-xs text-red-600 disabled:opacity-40"
              onClick={deleteSelected}
              disabled={selectedCount === 0}
            >
              <Trash2 size={11} /> Hapus{selectedCount > 0 ? ` (${selectedCount})` : ""}
            </button>
            <button className="btn-secondary btn-xs" onClick={saveAll} disabled={saving}>
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

      <BOQItemPickerModal
        open={showPicker}
        facilityId={facilityId}
        onAdd={handlePickerAdd}
        onClose={() => setShowPicker(false)}
      />
    </div>
  );
}
