import { useMemo, useRef, useState, useCallback } from "react";
import { AgGridReact } from "ag-grid-react";
import { Plus, Save, Trash2 } from "lucide-react";
import { boqAPI } from "@/api";
import toast from "react-hot-toast";
import { parseApiError, fmtNum } from "@/utils/format";
import { Spinner } from "@/components/ui";

/**
 * Editable BOQ grid for a single Facility.
 *
 * Fixes applied (catatan #9):
 *   - AUTO-CALC: total_price = volume × unit_price, always, real-time.
 *     The column is NOT editable anymore (read-only derived value) so the
 *     old "_manualTotal" escape hatch is gone. If an engineer needs a
 *     different total they have to adjust volume or unit_price — that is
 *     the honest input anyway.
 *   - DELETE BUG: row selection was not working because the grid ran with
 *     suppressRowClickSelection=true AND had no checkbox column, so there
 *     was literally no UI to select a row. Added a checkbox as the first
 *     column + header-checkbox for "select all". Delete now reads
 *     selectedNodes directly (not getSelectedRows which can silently
 *     return []).
 */
export default function BOQGrid({ facilityId, items, onChange, readonly = false }) {
  const gridRef = useRef();
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState(items);
  const [selectedCount, setSelectedCount] = useState(0);

  // Derived total always equals volume * unit_price. Called from the
  // column's valueGetter AND from onCellValueChanged so the cached
  // `total_price` on the row stays consistent for save payloads.
  const computeTotal = (row) => {
    const v = parseFloat(row.volume) || 0;
    const p = parseFloat(row.unit_price) || 0;
    return v * p;
  };

  const columns = useMemo(
    () => [
      {
        // Selection checkbox column (fixes delete bug).
        headerName: "",
        field: "__select",
        width: 40,
        pinned: "left",
        checkboxSelection: !readonly,
        headerCheckboxSelection: !readonly,
        headerCheckboxSelectionFilteredOnly: true,
        resizable: false,
        sortable: false,
        suppressMovable: true,
        editable: false,
      },
      {
        headerName: "Level",
        field: "level",
        width: 75,
        editable: !readonly,
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
        editable: !readonly,
        cellStyle: { fontFamily: "JetBrains Mono", fontSize: "12px" },
      },
      {
        headerName: "Uraian Pekerjaan",
        field: "description",
        flex: 2,
        minWidth: 260,
        editable: !readonly,
        cellStyle: (p) => ({
          fontWeight: (p.data?.level ?? 0) <= 1 ? 600 : 400,
        }),
      },
      { headerName: "Satuan", field: "unit", width: 80, editable: !readonly },
      {
        headerName: "Volume",
        field: "volume",
        width: 100,
        editable: !readonly,
        type: "numericColumn",
        valueParser: (p) => parseFloat(p.newValue) || 0,
        valueFormatter: (p) => fmtNum(p.value, 2),
      },
      {
        headerName: "Harga Satuan",
        field: "unit_price",
        width: 130,
        editable: !readonly,
        type: "numericColumn",
        valueParser: (p) => parseFloat(p.newValue) || 0,
        valueFormatter: (p) => fmtNum(p.value, 0),
      },
      {
        // READ-ONLY DERIVED. Always volume * unit_price, live.
        headerName: "Total",
        field: "total_price",
        width: 140,
        editable: false,
        type: "numericColumn",
        valueGetter: (p) => computeTotal(p.data),
        valueFormatter: (p) => fmtNum(p.value, 0),
        cellStyle: {
          fontWeight: 600,
          backgroundColor: "#f8fafc",
          color: "#0f172a",
        },
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
        editable: !readonly,
        type: "numericColumn",
      },
      {
        headerName: "Durasi",
        field: "planned_duration_weeks",
        width: 90,
        editable: !readonly,
        type: "numericColumn",
      },
      {
        headerName: "Leaf",
        field: "is_leaf",
        width: 70,
        editable: !readonly,
        cellEditor: "agCheckboxCellEditor",
        cellRenderer: "agCheckboxCellRenderer",
      },
    ],
    [readonly]
  );

  const addRow = () => {
    const newRow = {
      id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  const deleteSelected = useCallback(async () => {
    const api = gridRef.current?.api;
    if (!api) return;

    // Read from selectedNodes so the selection truth is always accurate
    // even mid-edit. .getSelectedRows() returns the row DATA which can be
    // stale; selectedNodes gives us live references plus the id (handy
    // for new-but-unsaved rows that share "new-*" ids).
    const nodes = api.getSelectedNodes();
    if (!nodes.length) {
      toast.error(
        "Pilih baris terlebih dahulu (centang kotak di kolom pertama)."
      );
      return;
    }
    const selectedIds = new Set(nodes.map((n) => n.data.id));
    const toDelete = nodes.map((n) => n.data);

    if (!confirm(`Hapus ${toDelete.length} item BOQ?`)) return;

    try {
      // Unsaved rows: just drop from local state. Saved rows: hit API.
      for (const row of toDelete) {
        if (!row._new) await boqAPI.remove(row.id);
      }
      setRows((rs) => rs.filter((r) => !selectedIds.has(r.id)));
      toast.success(`${toDelete.length} item dihapus`);
      onChange?.();
    } catch (e) {
      toast.error(parseApiError(e));
    }
  }, [onChange]);

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
          total_price: computeTotal(r),
          weight_pct: 0,
          planned_start_week: r.planned_start_week
            ? parseInt(r.planned_start_week)
            : null,
          planned_duration_weeks: r.planned_duration_weeks
            ? parseInt(r.planned_duration_weeks)
            : null,
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
            planned_start_week: r.planned_start_week
              ? parseInt(r.planned_start_week)
              : null,
            planned_duration_weeks: r.planned_duration_weeks
              ? parseInt(r.planned_duration_weeks)
              : null,
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
    if (e.colDef.field === "volume" || e.colDef.field === "unit_price") {
      row.total_price = computeTotal(row);
    }
    row._dirty = !row._new;
    e.api.refreshCells({ rowNodes: [e.node], force: true });
  };

  const total = rows.reduce((a, r) => a + computeTotal(r), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-ink-500">
          {rows.length} item ·{" "}
          {selectedCount > 0 && (
            <span className="text-brand-600 font-medium">
              {selectedCount} dipilih ·{" "}
            </span>
          )}
          Total <span className="font-semibold text-ink-800">{fmtNum(total)}</span>
        </div>
        {!readonly && (
          <div className="flex gap-2">
            <button className="btn-secondary btn-xs" onClick={addRow}>
              <Plus size={11} /> Baris
            </button>
            <button
              className="btn-ghost btn-xs text-red-600 disabled:opacity-40"
              onClick={deleteSelected}
              disabled={selectedCount === 0}
            >
              <Trash2 size={11} /> Hapus {selectedCount > 0 ? `(${selectedCount})` : ""}
            </button>
            <button className="btn-primary btn-xs" onClick={saveAll} disabled={saving}>
              {saving ? <Spinner size={11} /> : <Save size={11} />} Simpan
            </button>
          </div>
        )}
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
          onSelectionChanged={() => {
            const n = gridRef.current?.api.getSelectedNodes().length || 0;
            setSelectedCount(n);
          }}
          getRowId={(p) => p.data.id}
          defaultColDef={{ resizable: true, sortable: false }}
        />
      </div>
    </div>
  );
}
