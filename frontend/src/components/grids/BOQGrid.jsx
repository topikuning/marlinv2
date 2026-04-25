import {
  useMemo, useRef, useState, useCallback, useEffect,
} from "react";
import { createPortal } from "react-dom";
import { AgGridReact } from "ag-grid-react";
import { Plus, Save, Trash2, Tag, Lock, Search, X } from "lucide-react";
import { boqAPI, masterAPI } from "@/api";
import toast from "react-hot-toast";
import { parseApiError, fmtNum, fmtVolume } from "@/utils/format";
import { Spinner } from "@/components/ui";
import BOQItemPickerModal from "@/components/modals/BOQItemPickerModal";


/**
 * WorkCodePickerPopover — popup pencarian kode pekerjaan untuk kolom
 * Uraian BOQ, dirender via React Portal ke document.body, DI LUAR
 * siklus cell editor AG Grid sepenuhnya.
 *
 * Iterasi sebelumnya memakai popup cell editor AG Grid dan gagal:
 * cascade refreshCells/setDataValue meng-unmount editor di tengah
 * commit → description tetap kosong walau sibling (master_work_code,
 * unit, original_code) sudah terisi. Battle yang tidak bisa dimenangkan
 * dari dalam lifecycle cell editor.
 *
 * Dengan Portal, popup sepenuhnya independen. Saat user memilih:
 *   - Popup ditutup dulu (tidak ada lagi lifecycle editor di-trigger).
 *   - Via queueMicrotask, rowNode.setDataValue dipanggil untuk SEMUA
 *     kolom (description + master_work_code + original_code + unit).
 *     setDataValue di luar edit-mode = langsung masuk ke row data.
 *   - Parent onCellValueChanged akan fire, _dirty ter-set, save ke
 *     backend bekerja.
 */
function WorkCodePickerPopover({
  open, anchorRect, rowNode, workCodes, initialValue, onClose,
}) {
  const [query, setQuery] = useState(initialValue || "");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initialValue || "");
    setActiveIdx(0);
    setTimeout(() => {
      const el = inputRef.current;
      if (el) { el.focus(); el.select(); }
    }, 10);
  }, [open, initialValue]);

  const filtered = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return workCodes.slice(0, 200);
    return workCodes
      .filter((w) =>
        w.description?.toLowerCase().includes(q) ||
        w.code?.toLowerCase().includes(q) ||
        w.keywords?.toLowerCase()?.includes(q) ||
        w.sub_category?.toLowerCase()?.includes(q)
      )
      .slice(0, 200);
  }, [workCodes, query]);

  useEffect(() => {
    if (activeIdx >= filtered.length) {
      setActiveIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIdx]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector(`[data-idx="${activeIdx}"]`);
    if (active) active.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // Tutup pada klik di luar popup. Capture-phase supaya kita dapat
  // event sebelum handler lain menelannya.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (ev) => {
      const pop = document.getElementById("boq-workcode-popover");
      if (pop && !pop.contains(ev.target)) onClose?.();
    };
    document.addEventListener("mousedown", onDocDown, true);
    return () => document.removeEventListener("mousedown", onDocDown, true);
  }, [open, onClose]);

  const commitPick = (w) => {
    // Tutup popup DULU, commit nanti via microtask — ini penting agar
    // React selesai unmount popup sebelum setDataValue men-trigger
    // kaskade refresh AG Grid.
    onClose?.();
    queueMicrotask(() => {
      rowNode.setDataValue("description", w.description);
      rowNode.setDataValue("master_work_code", w.code);
      rowNode.setDataValue("original_code", w.code);
      if (w.default_unit) rowNode.setDataValue("unit", w.default_unit);
    });
  };

  const commitFreeText = () => {
    const q = query.trim();
    if (!q) { onClose?.(); return; }
    onClose?.();
    queueMicrotask(() => {
      rowNode.setDataValue("description", q);
      rowNode.setDataValue("master_work_code", null);
    });
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = filtered[activeIdx];
      if (picked) commitPick(picked);
      else commitFreeText();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    }
  };

  if (!open || !anchorRect) return null;

  const popWidth = 520;
  const popHeight = 380;
  let top = anchorRect.bottom + 4;
  let left = anchorRect.left;
  if (top + popHeight > window.innerHeight) {
    top = Math.max(8, anchorRect.top - popHeight - 4);
  }
  if (left + popWidth > window.innerWidth) {
    left = Math.max(8, window.innerWidth - popWidth - 8);
  }

  return createPortal(
    <div
      id="boq-workcode-popover"
      style={{
        position: "fixed",
        top, left, width: popWidth, maxHeight: popHeight,
        zIndex: 10000,
        background: "#fff", borderRadius: 10,
        boxShadow: "0 20px 40px rgba(15,23,42,.22)",
        border: "1px solid #e2e8f0",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      <div style={{
        padding: 8, borderBottom: "1px solid #eef2f6",
        display: "flex", gap: 6, alignItems: "center",
      }}>
        <Search size={14} style={{ color: "#64748b", marginLeft: 6 }} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
          onKeyDown={onKeyDown}
          placeholder="Cari uraian atau kode…"
          style={{
            flex: 1, padding: "7px 8px",
            border: "1px solid #cbd5e1", borderRadius: 6,
            outline: "none", fontSize: 13,
          }}
        />
        <button
          onClick={onClose}
          title="Tutup (Esc)"
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            padding: 4, color: "#64748b", display: "flex",
          }}
        >
          <X size={14} />
        </button>
      </div>
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", fontSize: 12 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
            Tidak ada yang cocok.<br />
            Tekan <kbd style={kbdStyle}>Enter</kbd> untuk menyimpan{" "}
            <em>"{query.trim()}"</em> sebagai uraian custom.
          </div>
        ) : (
          filtered.map((w, idx) => (
            <div
              key={w.code}
              data-idx={idx}
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                commitPick(w);
              }}
              style={{
                padding: "8px 12px",
                background: idx === activeIdx ? "#eff6ff" : "transparent",
                borderLeft: `3px solid ${idx === activeIdx ? "#2563eb" : "transparent"}`,
                cursor: "pointer",
                display: "flex", flexDirection: "column", gap: 2,
              }}
            >
              <div style={{ color: "#0f172a", lineHeight: 1.3 }}>
                {w.description}
              </div>
              <div style={{
                fontSize: 10, color: "#64748b",
                display: "flex", gap: 8, fontFamily: "monospace",
              }}>
                <span style={{ fontWeight: 600, color: "#1d4ed8" }}>{w.code}</span>
                <span>·</span>
                <span>{w.category}</span>
                {w.sub_category && <><span>·</span><span>{w.sub_category}</span></>}
                {w.default_unit && <><span>·</span><span>{w.default_unit}</span></>}
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{
        padding: "6px 10px",
        borderTop: "1px solid #eef2f6", background: "#f8fafc",
        fontSize: 10, color: "#64748b",
        display: "flex", justifyContent: "space-between",
      }}>
        <span>↑/↓ navigasi · Enter pilih · Esc batal</span>
        <span>{filtered.length} dari {workCodes.length}</span>
      </div>
    </div>,
    document.body,
  );
}

const kbdStyle = {
  background: "#f1f5f9", border: "1px solid #cbd5e1",
  borderRadius: 3, padding: "0 5px", fontSize: 10,
  fontFamily: "monospace",
};

/**
 * ParentPickerPopover — searchable picker untuk kolom Parent.
 * Sama pola dengan WorkCodePickerPopover: trigger via onCellClicked,
 * render via portal, set value via rowNode.setDataValue("parent_id").
 */
function ParentPickerPopover({ open, anchorRect, rowNode, rows, onClose }) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIdx(0);
    setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  // Daftar parent kandidat: SEMUA item lain di facility (kecuali baris ini),
  // sort by full_code untuk hirarki visual.
  const candidates = useMemo(() => {
    const own = rowNode?.data?.id;
    return (rows || [])
      .filter((r) => r.id !== own && (r.description || r.original_code))
      .sort((a, b) => (a.full_code || "").localeCompare(b.full_code || ""));
  }, [rows, rowNode]);

  const filtered = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) =>
      (c.description || "").toLowerCase().includes(q) ||
      (c.full_code || "").toLowerCase().includes(q) ||
      (c.original_code || "").toLowerCase().includes(q)
    );
  }, [candidates, query]);

  const total = filtered.length + 1; // +1 for "(root)" option
  const isRootActive = activeIdx === 0;

  const select = (parentId) => {
    if (rowNode) {
      queueMicrotask(() => {
        rowNode.setDataValue("parent_id", parentId || null);
        // Re-derive level di FE supaya display indent ikut: parent.level + 1
        if (parentId) {
          const parent = (rows || []).find((r) => r.id === parentId);
          if (parent) rowNode.setDataValue("level", (parent.level || 0) + 1);
        } else {
          rowNode.setDataValue("level", 0);
        }
      });
    }
    onClose?.();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose?.(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, total - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (isRootActive) select(null);
      else select(filtered[activeIdx - 1]?.id);
    }
  };

  if (!open || !anchorRect) return null;
  const top = (anchorRect.bottom || 0) + 2;
  const left = Math.min((anchorRect.left || 0), window.innerWidth - 460);

  return createPortal(
    <div
      style={{
        position: "fixed", top, left, width: 440, zIndex: 1000,
        background: "white", border: "1px solid #cbd5e1", borderRadius: 8,
        boxShadow: "0 10px 30px rgba(15,23,42,0.18)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ padding: 8, borderBottom: "1px solid #e2e8f0" }}>
        <input
          ref={inputRef}
          type="text"
          placeholder={`Cari parent (${candidates.length} item)...`}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
          onKeyDown={onKeyDown}
          style={{
            width: "100%", padding: "6px 8px", fontSize: 12,
            border: "1px solid #cbd5e1", borderRadius: 4, outline: "none",
          }}
        />
      </div>
      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        <button
          type="button"
          onClick={() => select(null)}
          onKeyDown={onKeyDown}
          style={{
            display: "block", width: "100%", textAlign: "left",
            padding: "6px 10px", fontSize: 11, fontStyle: "italic",
            background: isRootActive ? "#dbeafe" : "transparent",
            color: "#475569", border: "none", cursor: "pointer",
          }}
        >
          — (root) tanpa parent —
        </button>
        {filtered.length === 0 ? (
          <p style={{ padding: 12, fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
            Tidak ada match.
          </p>
        ) : filtered.slice(0, 200).map((c, i) => {
          const active = activeIdx === i + 1;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => select(c.id)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "6px 10px", fontSize: 11, fontFamily: "monospace",
                background: active ? "#dbeafe" : "transparent",
                border: "none", cursor: "pointer", whiteSpace: "nowrap",
                overflow: "hidden", textOverflow: "ellipsis",
              }}
            >
              <span style={{ paddingLeft: (c.level || 0) * 12 }}>
                {c.full_code || c.original_code || "?"} — {(c.description || "").slice(0, 50)}
              </span>
            </button>
          );
        })}
        {filtered.length > 200 && (
          <p style={{ padding: 6, fontSize: 9, color: "#94a3b8", fontStyle: "italic", textAlign: "center" }}>
            {filtered.length - 200} lainnya — perketat pencarian
          </p>
        )}
      </div>
      <div style={{
        padding: "4px 10px", fontSize: 10, color: "#64748b",
        background: "#f8fafc", borderTop: "1px solid #e2e8f0",
        display: "flex", justifyContent: "space-between",
      }}>
        <span>↑/↓ nav · Enter pilih · Esc batal</span>
        <span>{filtered.length} dari {candidates.length}</span>
      </div>
    </div>,
    document.body
  );
}

/**
 * BOQ editor grid.
 *
 * Mode:
 *   - readonly=true        → hanya baca (viewer / kontrak completed)
 *   - revisionLocked=true  → revisi APPROVED di kontrak aktif; grid
 *                            tetap tampil, banner "harus via Addendum"
 *                            muncul, edit/add/delete di-disable di UI
 *                            (server tetap memvalidasi)
 *   - default              → editable penuh (revisi DRAFT)
 *
 * Input item ada dua jalur:
 *   1. Inline edit di grid (satuan / volume / harga) — cepat
 *   2. Tombol "+ Tambah Item" → modal picker (master atau manual)
 *
 * Kolom Uraian NON-editable dari sudut pandang AG Grid. Saat diklik,
 * WorkCodePickerPopover (rendered via React Portal) muncul di bawah
 * cell — search, navigasi keyboard, Enter untuk pilih/commit custom.
 * setDataValue untuk description + master + unit + original_code
 * dilakukan SETELAH popup ditutup (via queueMicrotask), di luar
 * siklus cell editor AG Grid — pasti apply ke row data.
 *
 * Kolom Satuan pakai agSelectCellEditor biasa (list of units).
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
  // Popover pencarian kode di kolom Uraian.
  const [codePicker, setCodePicker] = useState(null); // { node, rect, initial }
  // Popover pencarian parent di kolom Parent.
  const [parentPicker, setParentPicker] = useState(null); // { node, rect }

  const canEdit = !readonly && !revisionLocked;

  // Load work codes untuk autocomplete inline
  useEffect(() => {
    if (!canEdit) return;
    masterAPI.workCodes({ page_size: 500 })
      .then(({ data }) => setWorkCodes(data || []))
      .catch(() => setWorkCodes([]));
  }, [canEdit]);

  // Daftar unit unik dari master (buat dropdown Satuan). Fallback ke set
  // standar kalau master belum loaded, supaya dropdown tetap berguna
  // pada kontrak pertama yang seed belum tersinkron.
  const unitOptions = useMemo(() => {
    const set = new Set();
    workCodes.forEach((w) => { if (w.default_unit) set.add(w.default_unit); });
    const fallback = ["m", "m2", "m3", "kg", "ton", "unit", "bh", "set", "ls", "hari"];
    fallback.forEach((u) => set.add(u));
    return Array.from(set).sort();
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
      headerName: "Parent",
      field: "parent_id",
      width: 180,
      // Non-editable di AG Grid — buka custom popover via onCellClicked.
      editable: false,
      onCellClicked: (p) => {
        if (!canEdit) return;
        const r = p.event?.target?.getBoundingClientRect?.() ||
                  p.eventPath?.[0]?.getBoundingClientRect?.();
        setParentPicker({
          node: p.node,
          rect: r || { left: 0, top: 0, bottom: 0, width: 240 },
        });
      },
      valueFormatter: (p) => {
        if (!p.value) return canEdit ? "Klik untuk pilih…" : "(root)";
        const parent = (rows || []).find((r) => r.id === p.value);
        if (!parent) return "(invalid)";
        const code = parent.full_code || parent.original_code || "";
        const desc = (parent.description || "").slice(0, 30);
        return `${code} — ${desc}`;
      },
      cellStyle: (p) => ({
        fontSize: 11,
        color: !p.value ? "#94a3b8" : "#475569",
        fontFamily: "monospace",
        fontStyle: !p.value ? "italic" : undefined,
        cursor: canEdit ? "pointer" : "default",
      }),
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
      // Non-editable dari sudut AG Grid — klik cell membuka
      // WorkCodePickerPopover via state, bukan cell editor.
      editable: false,
      cellStyle: (p) => {
        const empty = canEdit && !p.data?.description;
        const lvl = p.data?.level ?? 0;
        const isParent = p.data?.is_leaf === false;
        return {
          fontWeight: lvl <= 1 || isParent ? 700 : 400,
          // Indent lebih tegas (20px per level) supaya hirarki kelihatan
          paddingLeft: `${8 + lvl * 20}px`,
          cursor: canEdit ? "pointer" : "default",
          color: empty ? "#94a3b8" : isParent ? "#1e3a8a" : undefined,
          fontStyle: empty ? "italic" : undefined,
          backgroundColor: isParent ? "#eff6ff" : undefined,
        };
      },
      // Prefix 📁 untuk parent rows supaya hirarki visible sekilas.
      // Placeholder visible bila description masih kosong.
      valueFormatter: (p) => {
        if (!p.value) return canEdit ? "Klik untuk pilih…" : "";
        return p.data?.is_leaf === false ? `📁 ${p.value}` : p.value;
      },
    },
    {
      headerName: "Satuan",
      field: "unit",
      width: 90,
      editable: canEdit,
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: unitOptions },
    },
    {
      headerName: "Volume",
      field: "volume",
      width: 100,
      editable: canEdit,
      type: "numericColumn",
      valueParser: (p) => parseFloat(p.newValue) || 0,
      valueFormatter: (p) => fmtVolume(p.value),
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
  ], [canEdit, unitOptions, workCodes]);

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
      const newRowsToCreate = rows.filter((r) => r._new && r.description);
      const rowsToUpdate = rows.filter((r) => !r._new && r._dirty);

      // Toast jujur: kalau tidak ada yang diubah, bilang apa adanya
      // daripada menampilkan "tersimpan" palsu yang menyesatkan user.
      if (newRowsToCreate.length === 0 && rowsToUpdate.length === 0) {
        toast("Tidak ada perubahan yang perlu disimpan.", { icon: "ℹ️" });
        return;
      }

      if (newRowsToCreate.length) {
        await boqAPI.bulk(newRowsToCreate.map((r) => ({
          facility_id: facilityId,
          master_work_code: r.master_work_code || null,
          parent_id: r.parent_id || null,
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
        })));
      }

      for (const r of rowsToUpdate) {
        await boqAPI.update(r.id, {
          description: r.description,
          unit: r.unit,
          volume: parseFloat(r.volume) || 0,
          unit_price: parseFloat(r.unit_price) || 0,
          total_price: computeTotal(r),
          master_work_code: r.master_work_code || null,
          parent_id: r.parent_id || null,
          level: parseInt(r.level) || 0,
        });
        r._dirty = false;
      }

      const parts = [];
      if (newRowsToCreate.length) parts.push(`${newRowsToCreate.length} baru`);
      if (rowsToUpdate.length) parts.push(`${rowsToUpdate.length} diubah`);
      toast.success(`Tersimpan: ${parts.join(", ")}.`);
      onChange?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  // Handler tunggal untuk perubahan cell apapun:
  // - Tandai row sebagai _dirty supaya saveAll() mengirimkan update ke
  //   backend. Tanpa flag ini, edit tidak pernah sampai ke server
  //   meskipun toast "tersimpan" muncul.
  // - Volume / harga berubah → re-compute total_price di cache.
  // - Description/master_work_code/unit/original_code yang diisi lewat
  //   WorkCodePickerPopover di-set via node.setDataValue (empat panggilan
  //   berurutan), jadi handler ini di-trigger empat kali per pick —
  //   setiap kali cukup memastikan _dirty ter-flag.
  const onCellValueChanged = (e) => {
    const row = e.data;
    const field = e.colDef.field;

    if (field === "volume" || field === "unit_price") {
      row.total_price = computeTotal(row);
    }

    row._dirty = !row._new;
    e.api.refreshCells({ rowNodes: [e.node], force: true });
  };

  const total = rows.reduce((a, r) => a + computeTotal(r), 0);
  const masterCount = rows.filter((r) => r.master_work_code).length;
  const customCount = rows.filter((r) => !r.master_work_code && r.description).length;

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
          onCellClicked={(ev) => {
            if (!canEdit) return;
            if (ev.colDef.field !== "description") return;
            // Ambil bounding rect cell sebagai anchor untuk popup.
            const el = ev.event?.target?.closest?.(".ag-cell")
              || ev.event?.currentTarget;
            const rect = el?.getBoundingClientRect?.();
            if (!rect) return;
            setCodePicker({
              node: ev.node,
              rect,
              initial: ev.data?.description || "",
            });
          }}
          onSelectionChanged={() => {
            setSelectedCount(gridRef.current?.api.getSelectedNodes().length || 0);
          }}
          getRowId={(p) => p.data.id}
          defaultColDef={{ resizable: true, sortable: false }}
        />
      </div>

      <WorkCodePickerPopover
        open={!!codePicker}
        anchorRect={codePicker?.rect}
        rowNode={codePicker?.node}
        initialValue={codePicker?.initial}
        workCodes={workCodes}
        onClose={() => setCodePicker(null)}
      />
      <ParentPickerPopover
        open={!!parentPicker}
        anchorRect={parentPicker?.rect}
        rowNode={parentPicker?.node}
        rows={rows}
        onClose={() => setParentPicker(null)}
      />

      {canEdit && workCodes.length > 0 && (
        <div className="text-[11px] text-ink-400 px-1">
          Tip: klik cell <em>Uraian</em> → popup pencarian muncul dengan
          {" "}{workCodes.length} kode standar. Ketik untuk memfilter,
          ↑/↓ untuk navigasi, Enter untuk pilih. Begitu dipilih,
          {" "}<em>Kode Master</em>, <em>Kode Item</em>, dan <em>Satuan</em>{" "}
          terisi otomatis.
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
