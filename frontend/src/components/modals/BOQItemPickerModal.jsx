import { useState, useEffect, useRef, useMemo } from "react";
import { Search, Tag, Pencil, ChevronRight, X } from "lucide-react";
import { masterAPI, boqAPI } from "@/api";
import { Modal, Spinner } from "@/components/ui";

/**
 * Modal untuk menambah satu item BOQ.
 *
 * Dua jalur:
 *   1. Cari dari Master Kode Pekerjaan — uraian & satuan auto-terisi,
 *      harga & volume tetap input manual.
 *   2. Input manual — ketik bebas semua field, tidak diarahkan ke master.
 *
 * Hierarchy: user pilih PARENT (opsional). Level auto-derived dari parent
 * chain. Konsisten dengan konvensi import Excel & VO grid.
 *
 * Setelah user konfirmasi, memanggil onAdd({ ...itemData }) dan menutup
 * diri sendiri. Caller (BOQGrid) yang bertanggung jawab menyimpan ke API.
 */
export default function BOQItemPickerModal({ open, facilityId, onAdd, onClose }) {
  const [mode, setMode] = useState(null); // null | "master" | "manual"
  const [parentOptions, setParentOptions] = useState([]);

  // Load existing BOQ items dalam facility ini sebagai kandidat parent.
  // Dipakai oleh dua jalur (master & manual).
  useEffect(() => {
    if (!open || !facilityId) return;
    boqAPI.listByFacility(facilityId)
      .then(({ data }) => {
        const opts = (data || [])
          .map((b) => ({
            id: b.id,
            level: b.level || 0,
            full_code: b.full_code || b.original_code || "",
            description: b.description || "",
            label: `${"··".repeat(b.level || 0)} ${b.full_code || b.original_code || "?"} — ${(b.description || "").slice(0, 50)}`,
          }))
          .sort((a, b) => (a.full_code || "").localeCompare(b.full_code || ""));
        setParentOptions(opts);
      })
      .catch(() => setParentOptions([]));
  }, [open, facilityId]);

  const handleAdd = (item) => {
    onAdd(item);
    onClose();
  };

  const handleClose = () => {
    setMode(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Tambah Item BOQ"
      size={mode ? "lg" : "sm"}
      footer={
        mode ? null : (
          <button className="btn-secondary" onClick={handleClose}>
            Batal
          </button>
        )
      }
    >
      {!mode && <ModeSelector onSelect={setMode} />}
      {mode === "master" && (
        <MasterPicker
          facilityId={facilityId}
          parentOptions={parentOptions}
          onAdd={handleAdd}
          onBack={() => setMode(null)}
        />
      )}
      {mode === "manual" && (
        <ManualForm
          facilityId={facilityId}
          parentOptions={parentOptions}
          onAdd={handleAdd}
          onBack={() => setMode(null)}
        />
      )}
    </Modal>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Pilih mode
// ─────────────────────────────────────────────────────────────────────────────
function ModeSelector({ onSelect }) {
  return (
    <div className="grid grid-cols-1 gap-3 py-2">
      <button
        onClick={() => onSelect("master")}
        className="flex items-start gap-4 p-4 rounded-xl border-2 border-brand-200 bg-brand-50 hover:bg-brand-100 hover:border-brand-400 transition-colors text-left group"
      >
        <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Tag size={18} className="text-white" />
        </div>
        <div className="flex-1">
          <p className="font-display font-semibold text-ink-900 flex items-center gap-2">
            Pilih dari Master Kode Pekerjaan
            <ChevronRight size={14} className="text-brand-600 group-hover:translate-x-0.5 transition-transform" />
          </p>
          <p className="text-xs text-ink-500 mt-1">
            Cari dari {" "}
            <span className="font-medium text-ink-700">70+ kode standar</span>
            {" "}— uraian & satuan otomatis terisi, kode tercatat untuk pelaporan agregat.
          </p>
        </div>
      </button>

      <button
        onClick={() => onSelect("manual")}
        className="flex items-start gap-4 p-4 rounded-xl border-2 border-ink-200 hover:bg-ink-50 hover:border-ink-300 transition-colors text-left group"
      >
        <div className="w-10 h-10 rounded-lg bg-ink-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Pencil size={18} className="text-ink-600" />
        </div>
        <div className="flex-1">
          <p className="font-display font-semibold text-ink-900 flex items-center gap-2">
            Input Manual
            <ChevronRight size={14} className="text-ink-400 group-hover:translate-x-0.5 transition-transform" />
          </p>
          <p className="text-xs text-ink-500 mt-1">
            Ketik uraian pekerjaan sendiri — untuk item spesifik yang tidak ada
            di master (fender karet, bollard, item lokal, dll).
          </p>
        </div>
      </button>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Master picker — search + hasil + form volume & harga
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { value: "",            label: "Semua Kategori" },
  { value: "persiapan",   label: "Persiapan" },
  { value: "struktural",  label: "Struktural" },
  { value: "arsitektural",label: "Arsitektural" },
  { value: "mep",         label: "MEP" },
  { value: "site_work",   label: "Site Work" },
  { value: "khusus",      label: "Khusus Perikanan" },
];

function MasterPicker({ facilityId, parentOptions, onAdd, onBack }) {
  const [q, setQ]             = useState("");
  const [category, setCat]    = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [volume, setVolume]   = useState("");
  const [unitPrice, setUP]    = useState("");
  const [parentId, setParentId] = useState("");  // "" = root
  const inputRef = useRef();

  // Level auto-derive dari parent chain. Kalau pilih parent dengan level=2,
  // child = level 3. Konsisten dengan import Excel & VO grid.
  const derivedLevel = useMemo(() => {
    if (!parentId) return 0;
    const p = parentOptions.find((o) => o.id === parentId);
    return p ? (p.level || 0) + 1 : 0;
  }, [parentId, parentOptions]);

  // Load semua kode saat pertama buka
  useEffect(() => {
    fetch_codes("", "");
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const fetch_codes = async (term, cat) => {
    setLoading(true);
    try {
      const { data } = await masterAPI.workCodes({
        q: term || undefined,
        category: cat || undefined,
        page_size: 60,
      });
      setResults(data || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleQ = (val) => {
    setQ(val);
    fetch_codes(val, category);
  };

  const handleCat = (val) => {
    setCat(val);
    fetch_codes(q, val);
  };

  const confirm = () => {
    if (!selected) return;
    const vol = parseFloat(volume) || 0;
    const up  = parseFloat(unitPrice) || 0;
    const parent = parentOptions.find((o) => o.id === parentId);
    const fullCode = parent
      ? `${parent.full_code}.${selected.code}`
      : selected.code;
    onAdd({
      facility_id:       facilityId,
      parent_id:         parentId || null,
      master_work_code:  selected.code,
      original_code:     selected.code,
      full_code:         fullCode,
      description:       selected.description,
      unit:              selected.default_unit || "",
      volume:            vol,
      unit_price:        up,
      total_price:       vol * up,
      level:             derivedLevel,
      display_order:     0,
      is_leaf:           true,  // backend _recompute_is_leaf akan flip kalau ada child
      _new:              true,
      id:                `new-${Date.now()}`,
    });
  };

  // Category badge color
  const catColor = (cat) => {
    const map = {
      persiapan:    "bg-slate-100 text-slate-700",
      struktural:   "bg-blue-100 text-blue-700",
      arsitektural: "bg-purple-100 text-purple-700",
      mep:          "bg-amber-100 text-amber-700",
      site_work:    "bg-green-100 text-green-700",
      khusus:       "bg-cyan-100 text-cyan-700",
    };
    return map[cat] || "bg-gray-100 text-gray-600";
  };

  return (
    <div className="space-y-4">
      {/* Back + search bar */}
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="btn-ghost btn-xs p-1.5 rounded-lg">
          <X size={14} />
        </button>
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            ref={inputRef}
            className="input pl-8 text-sm"
            placeholder="Cari kode / uraian (contoh: tiang pancang, revetmen, keramik...)"
            value={q}
            onChange={(e) => handleQ(e.target.value)}
          />
        </div>
        <select
          className="select text-sm w-44"
          value={category}
          onChange={(e) => handleCat(e.target.value)}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* Dua panel: kiri=hasil, kanan=form */}
      <div className="grid grid-cols-5 gap-4" style={{ minHeight: 340 }}>

        {/* Panel kiri — hasil pencarian */}
        <div className="col-span-3 border border-ink-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-ink-50 border-b border-ink-200 text-[11px] text-ink-500 font-medium">
            {loading ? "Mencari..." : `${results.length} kode ditemukan`}
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 310 }}>
            {loading ? (
              <div className="flex justify-center py-8">
                <Spinner size={20} />
              </div>
            ) : results.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-500">
                Tidak ada kode yang cocok.
              </div>
            ) : (
              results.map((item) => (
                <button
                  key={item.code}
                  onClick={() => setSelected(item)}
                  className={`w-full text-left px-3 py-2.5 border-b border-ink-100 last:border-0 transition-colors ${
                    selected?.code === item.code
                      ? "bg-brand-50 border-l-2 border-l-brand-500"
                      : "hover:bg-ink-50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[11px] font-semibold text-brand-700">
                      {item.code}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${catColor(item.category)}`}>
                      {item.sub_category || item.category}
                    </span>
                  </div>
                  <p className="text-xs text-ink-800 leading-snug">{item.description}</p>
                  <p className="text-[10px] text-ink-400 mt-0.5">Satuan: {item.default_unit || "—"}</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Panel kanan — form volume & harga */}
        <div className="col-span-2 border border-ink-200 rounded-xl p-4">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-center">
              <div>
                <Tag size={28} className="text-ink-300 mx-auto mb-2" />
                <p className="text-xs text-ink-400">
                  Pilih kode dari daftar kiri untuk mengisi detail
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-brand-50 rounded-lg border border-brand-200">
                <p className="font-mono text-xs font-bold text-brand-700">{selected.code}</p>
                <p className="text-sm font-medium text-ink-900 mt-0.5">{selected.description}</p>
                <p className="text-[11px] text-ink-500 mt-1">Satuan baku: {selected.default_unit || "—"}</p>
              </div>

              <div>
                <label className="label text-xs">Parent (Hierarki)</label>
                <select
                  className="select text-sm"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">— Root (level 0) —</option>
                  {parentOptions.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                <p className="text-[10px] text-ink-500 mt-0.5">
                  Level auto: <b>{derivedLevel}</b> {parentId ? "(anak dari parent)" : "(top-level)"}
                </p>
              </div>

              <div>
                <label className="label text-xs">
                  Volume <span className="text-ink-400 font-normal">({selected.default_unit || "satuan"})</span>
                </label>
                <input
                  type="number"
                  className="input text-sm"
                  placeholder="0"
                  value={volume}
                  onChange={(e) => setVolume(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <label className="label text-xs">Harga Satuan (Rp)</label>
                <input
                  type="number"
                  className="input text-sm"
                  placeholder="0"
                  value={unitPrice}
                  onChange={(e) => setUP(e.target.value)}
                />
              </div>

              {volume && unitPrice && (
                <div className="p-2 bg-ink-50 rounded-lg text-xs text-ink-600">
                  Total: <span className="font-semibold text-ink-900">
                    Rp {(parseFloat(volume) * parseFloat(unitPrice)).toLocaleString("id-ID")}
                  </span>
                </div>
              )}

              <button
                className="btn-primary w-full"
                onClick={confirm}
                disabled={!volume}
              >
                Tambah ke BOQ
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Manual form — input bebas
// ─────────────────────────────────────────────────────────────────────────────
function ManualForm({ facilityId, parentOptions, onAdd, onBack }) {
  const [form, setForm] = useState({
    description: "",
    unit: "",
    volume: "",
    unit_price: "",
    parent_id: "",
    original_code: "",
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const vol = parseFloat(form.volume) || 0;
  const up  = parseFloat(form.unit_price) || 0;

  // Level auto-derive dari parent
  const derivedLevel = useMemo(() => {
    if (!form.parent_id) return 0;
    const p = parentOptions.find((o) => o.id === form.parent_id);
    return p ? (p.level || 0) + 1 : 0;
  }, [form.parent_id, parentOptions]);

  const confirm = () => {
    if (!form.description.trim()) return;
    const code = form.original_code.trim() || null;
    const parent = parentOptions.find((o) => o.id === form.parent_id);
    const fullCode = parent && code
      ? `${parent.full_code}.${code}`
      : code || "";
    onAdd({
      facility_id:      facilityId,
      parent_id:        form.parent_id || null,
      master_work_code: null,  // custom item — tidak punya kode master
      original_code:    code,
      full_code:        fullCode,
      description:      form.description.trim(),
      unit:             form.unit.trim(),
      volume:           vol,
      unit_price:       up,
      total_price:      vol * up,
      level:            derivedLevel,
      display_order:    0,
      is_leaf:          true,
      _new:             true,
      id:               `new-${Date.now()}`,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <button onClick={onBack} className="btn-ghost btn-xs p-1.5 rounded-lg">
          <X size={14} />
        </button>
        <span className="text-sm font-medium text-ink-700">Input Manual</span>
        <span className="ml-auto text-[11px] text-ink-400 bg-ink-100 px-2 py-0.5 rounded-full">
          Item custom (tidak ada di master)
        </span>
      </div>

      <div>
        <label className="label">Uraian Pekerjaan <span className="text-red-500">*</span></label>
        <input
          className="input"
          placeholder="contoh: Fender Karet Tipe V 150×150 mm"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Kode (opsional)</label>
          <input
            className="input font-mono"
            placeholder="misal: A, 1, a"
            value={form.original_code}
            onChange={(e) => set("original_code", e.target.value)}
          />
          <p className="text-[10px] text-ink-500 mt-0.5">Kosong = auto-generate R{`{n}`}</p>
        </div>
        <div>
          <label className="label">Parent (Hierarki)</label>
          <select
            className="select"
            value={form.parent_id}
            onChange={(e) => set("parent_id", e.target.value)}
          >
            <option value="">— Root (level 0) —</option>
            {parentOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-ink-500 mt-0.5">Level auto: <b>{derivedLevel}</b></p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Satuan</label>
          <input
            className="input"
            placeholder="m³, unit, ls..."
            value={form.unit}
            onChange={(e) => set("unit", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Volume</label>
          <input
            type="number"
            className="input"
            placeholder="0"
            value={form.volume}
            onChange={(e) => set("volume", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Harga Satuan (Rp)</label>
          <input
            type="number"
            className="input"
            placeholder="0"
            value={form.unit_price}
            onChange={(e) => set("unit_price", e.target.value)}
          />
        </div>
      </div>

      {vol > 0 && up > 0 && (
        <div className="p-3 bg-ink-50 rounded-lg text-sm text-ink-600">
          Total: <span className="font-semibold text-ink-900">
            Rp {(vol * up).toLocaleString("id-ID")}
          </span>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button className="btn-secondary flex-1" onClick={onBack}>
          Batal
        </button>
        <button
          className="btn-primary flex-1"
          onClick={confirm}
          disabled={!form.description.trim()}
        >
          Tambah ke BOQ
        </button>
      </div>
    </div>
  );
}
