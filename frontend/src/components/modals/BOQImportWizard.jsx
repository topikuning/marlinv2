import { useState } from "react";
import toast from "react-hot-toast";
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, Download } from "lucide-react";
import { Modal, Spinner } from "@/components/ui";
import { boqAPI, templatesAPI, downloadBlob } from "@/api";
import { parseApiError, fmtNum } from "@/utils/format";

/**
 * Wizard flow:
 * 1. User picks file → backend preview returns facilities detected + format
 * 2. User reviews mapping: each detected facility shown with option to
 *    map to existing facility in this location OR create new
 * 3. User confirms → import triggered with mapping
 */
export default function BOQImportWizard({ open, onClose, locationId, existingFacilities = [], onDone }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({}); // source_code → "new" | facility_id
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setStep(1);
    setFile(null);
    setPreview(null);
    setMapping({});
  };

  const close = () => {
    reset();
    onClose?.();
  };

  async function downloadTemplate() {
    try {
      const { data } = await templatesAPI.boq();
      downloadBlob(data, "template_boq.xlsx");
    } catch (e) {
      toast.error(parseApiError(e));
    }
  }

  async function handleUpload() {
    if (!file) return toast.error("Pilih file terlebih dahulu");
    setLoading(true);
    try {
      const { data } = await boqAPI.previewExcel(file);
      setPreview(data);
      // default mapping: try match by facility_code
      const m = {};
      (data.facilities || []).forEach((f) => {
        const existing = existingFacilities.find(
          (e) =>
            e.facility_code.toLowerCase() === f.facility_code.toLowerCase() ||
            e.facility_name.toLowerCase() === f.facility_name.toLowerCase()
        );
        m[f.facility_code] = existing ? existing.id : "new";
      });
      setMapping(m);
      setStep(2);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  }

  async function confirmImport() {
    if (!file) return;
    setLoading(true);
    try {
      const mappingJSON = JSON.stringify(
        Object.fromEntries(
          Object.entries(mapping).filter(([, v]) => v && v !== "new")
        )
      );
      const { data } = await boqAPI.importExcel(locationId, file, {
        create_missing_facilities: true,
        mapping: mappingJSON,
      });
      if (data.success) {
        toast.success(
          `Berhasil import ${data.items_imported} item BOQ (${data.facilities_created} fasilitas baru)`
        );
        onDone?.();
        close();
      } else {
        toast.error(data.errors?.[0] || "Import gagal");
      }
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import BOQ dari Excel"
      size="xl"
      footer={
        <>
          <button className="btn-secondary" onClick={close}>Batal</button>
          {step === 1 && (
            <button
              className="btn-primary"
              onClick={handleUpload}
              disabled={!file || loading}
            >
              {loading && <Spinner size={14} />} Analisa File
            </button>
          )}
          {step === 2 && (
            <button
              className="btn-primary"
              onClick={confirmImport}
              disabled={loading}
            >
              {loading && <Spinner size={14} />} Mulai Import
            </button>
          )}
        </>
      }
    >
      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 text-xs text-brand-800 leading-relaxed">
            <p className="font-semibold mb-2">Sistem mendukung dua format file:</p>
            <ol className="list-decimal ml-5 space-y-1">
              <li>
                <b>Template Simple</b> — satu sheet berisi kolom{" "}
                <code className="px-1 bg-white/60 rounded">facility_code, description, volume, ...</code>
              </li>
              <li>
                <b>Format Engineer</b> — multi-sheet seperti BOQ KKP asli (satu sheet per fasilitas seperti "6.Gudang Beku", "7.Pabrik Es", dll)
              </li>
            </ol>
            <button
              type="button"
              onClick={downloadTemplate}
              className="btn-secondary btn-xs mt-3"
            >
              <Download size={11} /> Download Template Simple
            </button>
          </div>

          <div>
            <label className="label">Pilih File Excel (.xlsx)</label>
            <label className="flex items-center gap-3 p-4 border-2 border-dashed border-ink-300 rounded-xl cursor-pointer hover:border-brand-400 hover:bg-brand-50/40 transition">
              <FileSpreadsheet size={22} className="text-brand-600" />
              <div className="flex-1 text-sm">
                {file ? (
                  <>
                    <p className="font-medium text-ink-900">{file.name}</p>
                    <p className="text-xs text-ink-500">
                      {(file.size / 1024).toFixed(1)} KB · klik untuk ganti
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-ink-700">Klik untuk pilih file</p>
                    <p className="text-xs text-ink-500">Maksimal 20 MB</p>
                  </>
                )}
              </div>
              <input
                type="file"
                accept=".xlsx"
                hidden
                onChange={(e) => setFile(e.target.files[0])}
              />
            </label>
          </div>
        </div>
      )}

      {step === 2 && preview && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="badge-blue">Format: {preview.format}</span>
            <span className="text-ink-500">
              {preview.facilities.length} fasilitas terdeteksi
            </span>
          </div>

          {preview.warnings?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              {preview.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-2">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-ink-800 mb-2">
              Mapping Fasilitas — pilih apakah masing-masing akan dibuat baru atau digabung ke fasilitas existing:
            </p>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {preview.facilities.map((f) => (
                <div
                  key={f.facility_code}
                  className="p-3 bg-ink-50/60 rounded-lg border border-ink-200 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink-900 text-sm truncate">
                      {f.facility_name}
                    </p>
                    <p className="text-xs text-ink-500">
                      <span className="font-mono">{f.facility_code}</span>
                      {f.sheet_name && ` · ${f.sheet_name}`} · {f.item_count} item
                      {f.total_value ? ` · ${fmtNum(f.total_value)}` : ""}
                    </p>
                  </div>
                  <select
                    className="select w-56 text-xs"
                    value={mapping[f.facility_code] || "new"}
                    onChange={(e) =>
                      setMapping((m) => ({
                        ...m,
                        [f.facility_code]: e.target.value,
                      }))
                    }
                  >
                    <option value="new">➕ Buat fasilitas baru</option>
                    {existingFacilities.map((ef) => (
                      <option key={ef.id} value={ef.id}>
                        ↪ Gabung ke: {ef.facility_name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800 flex items-start gap-2">
            <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              Total{" "}
              <b>
                {preview.facilities.reduce((a, f) => a + f.item_count, 0)} item
              </b>{" "}
              akan di-import. Sistem akan otomatis membangun hirarki (group &gt;
              subgroup &gt; item) dan menghitung bobot %.
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
