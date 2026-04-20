import { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { Plus, Save, Trash2 } from "lucide-react";
import { boqAPI } from "../../api";
import toast from "react-hot-toast";
import { parseApiError, fmtNum } from "../../utils/format";
import { Spinner } from "../ui";

/**
 * Editable grid for BOQ items inside a single facility.
 * Supports: add/delete/update rows inline, hierarchical level, auto calc total_price.
 */
export default function BOQGrid({ facilityId, items, onChange }) {
  const gridRef = useRef();
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState(items);

  const columns = useMemo(
    () => [
      {
        headerName: "Level",
        field: "level",
        width: 75,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: [0, 1, 2, 3] },
        cellStyle: (p) => ({
          paddingLeft: `${8 + (p.value || 0) * 12}px`,
          fontFamily: "JetBrains Mono",
          color: "#64748b",
        }),
      },
      {
        headerName: "Kode",
        field: "original_code",
        width: 90,
        editable: true,
        cellStyle: { fontFamily: "JetBrains Mono", fontSize: "12px" },
      },
      {
        headerName: "Uraian Pekerjaan",
        field: "description",
        flex: 2,
        minWidth: 260,
        editable: true,
        cellStyle: (p) => ({
          fontWeight: (p.data?.level ?? 0) <= 1 ? 600 : 400,
        }),
      },
      { headerName: "Satuan", field: "unit", width: 80, editable: true },
      {
        headerName: "Volume",
        field: "volume",
        width: 100,
        editable: true,
        type: "numericColumn",
        valueFormatter: (p) => fmtNum(p.value, 2),
      },
      {
        headerName: "Harga Satuan",
        field: "unit_price",
        width: 130,
        editable: true,
        type: "numericColumn",
        valueFormatter: (p) => fmtNum(p.value, 0),
      },
      {
        headerName: "Total",
        field: "total_price",
        width: 140,
        editable: true,
        type: "numericColumn",
        valueFormatter: (p) => fmtNum(p.value, 0),
        cellStyle: { fontWeight: 500 },
      },
      {
        headerName: "Bobot %",
        field: "weight_pct",
        width: 100,
        editable: false,
        valueFormatter: (p) => ((p.value || 0) * 100).toFixed(3) + "%",
        cellStyle: { color: "#64748b", fontSize: "11px" },
      },
      {
        headerName: "M. Mulai",
        field: "planned_start_week",
        width: 90,
        editable: true,
        type: "numericColumn",
      },
      {
        headerName: "Durasi",
        field: "planned_duration_weeks",
        width: 90,
        editable: true,
        type: "numericColumn",
      },
      {
        headerName: "Leaf",
        field: "is_leaf",
        width: 70,
        editable: true,
        cellEditor: "agCheckboxCellEditor",
        cellRenderer: "agCheckboxCellRenderer",
      },
    ],
    []
  );

  const addRow = () => {
    const newRow = {
      id: `new-${Date.now()}`,
      facility_id: facilityId,
      _new: true,
      level: 2,
      original_code: "",
      description: "",
      unit: "",
      volume: 0,
      unit_price: 0,
      total_price: 0,
      weight_pct: 0,
      planned_start_week: null,
      planned_duration_weeks: null,
      is_leaf: true,
    };
    setRows((r) => [...r, newRow]);
  };

  const deleteSelected = async () => {
    const selected = gridRef.current?.api.getSelectedRows();
    if (!selected?.length) return toast.error("Pilih baris dulu");
    if (!confirm(`Hapus ${selected.length} item BOQ?`)) return;
    try {
      for (const row of selected) {
        if (!row._new) await boqAPI.remove(row.id);
      }
      setRows((r) => r.filter((x) => !selected.some((s) => s.id === x.id)));
      toast.success("Item dihapus");
      onChange?.();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const newOnes = rows
        .filter((r) => r._new && r.description)
        .map((r) => ({
          facility_id: facilityId,
          parent_id: null,
          original_code: r.original_code,
          level: parseInt(r.level) || 0,
          display_order: 0,
          description: r.description,
          unit: r.unit,
          volume: parseFloat(r.volume) || 0,
          unit_price: parseFloat(r.unit_price) || 0,
          total_price:
            parseFloat(r.total_price) ||
            (parseFloat(r.volume) || 0) * (parseFloat(r.unit_price) || 0),
          weight_pct: 0,
          planned_start_week: r.planned_start_week
            ? parseInt(r.planned_start_week) : null,
          planned_duration_weeks: r.planned_duration_weeks
            ? parseInt(r.planned_duration_weeks) : null,
          is_leaf: !!r.is_leaf,
        }));
      if (newOnes.length) {
        await boqAPI.bulk(newOnes);
      }
      for (const r of rows) {
        if (!r._new && r._dirty) {
          await boqAPI.update(r.id, {
            description: r.description,
            unit: r.unit,
            volume: parseFloat(r.volume) || 0,
            unit_price: parseFloat(r.unit_price) || 0,
            total_price: parseFloat(r.total_price) || 0,
            planned_start_week: r.planned_start_week
              ? parseInt(r.planned_start_week) : null,
            planned_duration_weeks: r.planned_duration_weeks
              ? parseInt(r.planned_duration_weeks) : null,
          });
        }
      }
      toast.success("Tersimpan");
      onChange?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const onCellValueChanged = (e) => {
    const row = e.data;
    if (
      (e.colDef.field === "volume" || e.colDef.field === "unit_price") &&
      !row._manualTotal
    ) {
      row.total_price = (parseFloat(row.volume) || 0) * (parseFloat(row.unit_price) || 0);
    }
    if (e.colDef.field === "total_price") row._manualTotal = true;
    row._dirty = !row._new;
    e.api.refreshCells({ rowNodes: [e.node], force: true });
  };

  const total = rows.reduce((a, r) => a + (parseFloat(r.total_price) || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-ink-500">
          {rows.length} item · Total{" "}
          <span className="font-semibold text-ink-800">{fmtNum(total)}</span>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-xs" onClick={addRow}>
            <Plus size={11} /> Baris
          </button>
          <button className="btn-ghost btn-xs text-red-600" onClick={deleteSelected}>
            <Trash2 size={11} /> Hapus
          </button>
          <button className="btn-primary btn-xs" onClick={saveAll} disabled={saving}>
            {saving ? <Spinner size={11} /> : <Save size={11} />} Simpan
          </button>
        </div>
      </div>
      <div className="ag-theme-quartz" style={{ height: 520 }}>
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={columns}
          rowSelection="multiple"
          suppressRowClickSelection={true}
          stopEditingWhenCellsLoseFocus={true}
          singleClickEdit={true}
          onCellValueChanged={onCellValueChanged}
          getRowId={(p) => p.data.id}
          defaultColDef={{ resizable: true, sortable: false }}
        />
      </div>
    </div>
  );
}
