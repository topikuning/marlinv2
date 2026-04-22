import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Unlock, Lock, AlertTriangle, CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { contractsAPI } from "@/api";
import { Modal, Spinner } from "@/components/ui";
import { fmtCurrency, fmtDate, parseApiError } from "@/utils/format";
import { useAuthStore } from "@/store/auth";

/**
 * UnlockModePanel — safety-valve edit-mode superadmin.
 *
 * Dua state visual:
 *   1. Kontrak TERKUNCI (unlocked_at null) → hanya menampilkan tombol kecil
 *      "Buka Unlock Mode" di header (superadmin only). Non-superadmin
 *      tidak melihat apa-apa.
 *   2. Kontrak TERBUKA (unlocked_at truthy) → banner merah di atas halaman
 *      kontrak, berisi info siapa/kapan/alasan + tombol "Kunci Kembali"
 *      yang memunculkan modal sync-check.
 *
 * Filosofi: tetap memberi user ruang untuk membuat kesalahan dan
 * memperbaikinya di level sistem, tanpa memaksa jalur administratif
 * (Addendum). Sync BOQ↔Nilai Kontrak hanya diverifikasi saat lock — di
 * tengah editing, user bebas "berantakan".
 */
export default function UnlockModePanel({ contract, onChange }) {
  const { user } = useAuthStore();
  const [showUnlock, setShowUnlock] = useState(false);
  const [showLock, setShowLock] = useState(false);

  const isSuperadmin = user?.role?.code === "superadmin";
  const isUnlocked =
    !!contract?.unlock_until && new Date() < new Date(contract.unlock_until);
  const canUnlockFromStatus =
    contract?.status === "active" ||
    contract?.status === "addendum" ||
    contract?.status === "completed" ||
    contract?.status === "terminated";

  if (!contract) return null;

  return (
    <>
      {isUnlocked && (
        <UnlockedBanner
          contract={contract}
          isSuperadmin={isSuperadmin}
          onLockClick={() => setShowLock(true)}
        />
      )}

      {!isUnlocked && isSuperadmin && canUnlockFromStatus && (
        <button
          className="btn-secondary btn-xs"
          onClick={() => setShowUnlock(true)}
          title="Buka edit-mode (safety valve) untuk koreksi kesalahan input tanpa Addendum"
        >
          <Unlock size={12} /> Unlock Mode
        </button>
      )}

      <UnlockModal
        open={showUnlock}
        contract={contract}
        onClose={() => setShowUnlock(false)}
        onDone={() => {
          setShowUnlock(false);
          onChange?.();
        }}
      />

      <LockModal
        open={showLock}
        contract={contract}
        onClose={() => setShowLock(false)}
        onDone={() => {
          setShowLock(false);
          onChange?.();
        }}
      />
    </>
  );
}

function UnlockedBanner({ contract, isSuperadmin, onLockClick }) {
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 p-4 mb-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
          <Unlock size={18} className="text-red-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-red-900 text-sm">
            Mode Edit Terbuka — bypass Addendum
          </p>
          <p className="text-xs text-red-800 mt-1">
            Kontrak sementara dibuka oleh superadmin untuk koreksi kesalahan
            input. Semua guard normal (BOQ terkunci, field kontrak terkunci,
            penambahan fasilitas) dinonaktifkan. Segera tutup kembali setelah
            perbaikan selesai — sistem akan memvalidasi total BOQ = nilai
            kontrak sebelum mengunci.
          </p>
          <div className="text-[11px] text-red-700 mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {contract.unlocked_at && (
              <span>Dibuka: {fmtDate(contract.unlocked_at)}</span>
            )}
            {contract.unlock_until && (
              <span className="font-semibold">
                Habis: {new Date(contract.unlock_until).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {contract.unlock_reason && (
              <span className="truncate">
                Alasan: <em>{contract.unlock_reason}</em>
              </span>
            )}
          </div>
        </div>
        {isSuperadmin && (
          <button
            className="btn-primary btn-xs bg-red-600 hover:bg-red-700 border-red-600 flex-shrink-0"
            onClick={onLockClick}
          >
            <Lock size={12} /> Kunci Kembali
          </button>
        )}
      </div>
    </div>
  );
}

function UnlockModal({ open, contract, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(30);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) { setReason(""); setDuration(30); }
  }, [open]);

  const submit = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < 10) {
      toast.error("Alasan wajib ≥ 10 karakter.");
      return;
    }
    const mins = Math.max(1, Math.min(1440, parseInt(duration) || 30));
    setLoading(true);
    try {
      await contractsAPI.unlock(contract.id, trimmed, mins);
      toast.success(`Kontrak dibuka untuk edit bebas selama ${mins} menit`);
      onDone?.();
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
      title="Buka Unlock Mode"
      size="md"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={loading}>
            Batal
          </button>
          <button
            className="btn-primary bg-red-600 hover:bg-red-700 border-red-600"
            onClick={submit}
            disabled={loading || reason.trim().length < 10}
          >
            {loading ? <Spinner size={12} /> : <Unlock size={14} />}
            Buka Edit-Mode
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Unlock bukan pengganti Addendum.</p>
            <p className="mt-1">
              Gunakan fitur ini hanya untuk memperbaiki kesalahan input (salah
              ketik nilai, tanggal, atau fasilitas). Perubahan scope tetap
              harus lewat Addendum. Semua perubahan terekam di audit log.
            </p>
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-ink-800">
            Durasi unlock
          </span>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="number"
              className="input w-24 text-center"
              min={1}
              max={1440}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
            <span className="text-sm text-ink-600">menit</span>
            <div className="flex gap-1 ml-2">
              {[15, 30, 60, 120].map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`text-[11px] px-2 py-1 rounded border transition ${
                    parseInt(duration) === m
                      ? "bg-brand-600 text-white border-brand-600"
                      : "bg-white text-ink-600 border-ink-200 hover:border-brand-400"
                  }`}
                  onClick={() => setDuration(m)}
                >
                  {m < 60 ? `${m}m` : `${m / 60}j`}
                </button>
              ))}
            </div>
          </div>
          <span className="text-[11px] text-ink-500">
            Window akan otomatis ditutup setelah waktu habis (maks 24 jam).
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink-800">
            Alasan membuka edit-mode <span className="text-red-600">*</span>
          </span>
          <textarea
            className="input mt-1 w-full"
            rows={4}
            placeholder="Contoh: koreksi harga satuan tiang pancang yang salah input saat bulk upload BOQ awal."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <span className="text-[11px] text-ink-500">
            Minimum 10 karakter. Akan tampil di banner halaman kontrak.
          </span>
        </label>
      </div>
    </Modal>
  );
}

function LockModal({ open, contract, onClose, onDone }) {
  const [sync, setSync] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locking, setLocking] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, contract?.id]);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await contractsAPI.syncStatus(contract.id);
      setSync(data);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const samakan = async () => {
    // Shortcut "samakan otomatis": set current_value ke total BOQ aktif,
    // mengandalkan endpoint update_contract yang menghormati unlock mode.
    if (!sync) return;
    if (!confirm(`Atur Nilai Kontrak ke ${fmtCurrency(sync.boq_total)}? Ini akan menggantikan nilai kontrak saat ini (${fmtCurrency(sync.contract_value)}).`)) return;
    setSyncing(true);
    try {
      await contractsAPI.update(contract.id, {
        current_value: sync.boq_total,
      });
      toast.success("Nilai kontrak disesuaikan ke total BOQ");
      await refresh();
      onDone?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setSyncing(false);
    }
  };

  const doLock = async () => {
    setLocking(true);
    try {
      await contractsAPI.lock(contract.id);
      toast.success("Kontrak dikunci kembali");
      onDone?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLocking(false);
    }
  };

  const inSync = !!sync?.in_sync;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Kunci Kembali Kontrak"
      size="md"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={locking}>
            Batal
          </button>
          <button
            className="btn-primary"
            onClick={doLock}
            disabled={locking || loading || !inSync}
            title={
              inSync
                ? "Kunci kontrak"
                : "Total BOQ harus sama dengan nilai kontrak sebelum bisa dikunci"
            }
          >
            {locking ? <Spinner size={12} /> : <Lock size={14} />}
            Kunci
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-ink-400" />
        </div>
      ) : sync ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-ink-200 p-4 bg-ink-50/60">
            <SyncRow label="Nilai Kontrak" value={sync.contract_value} />
            <SyncRow label="Total BOQ Aktif" value={sync.boq_total} />
            <div className="border-t border-ink-200 mt-2 pt-2 flex items-center justify-between">
              <span className="text-sm text-ink-600">Selisih</span>
              <span
                className={`text-sm font-semibold ${
                  inSync ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {fmtCurrency(sync.diff)}
              </span>
            </div>
          </div>

          {inSync ? (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
              <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Total BOQ sudah sama dengan nilai kontrak. Kontrak aman untuk
                dikunci kembali.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900">
                <XCircle size={14} className="mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Belum sinkron.</p>
                  <p className="mt-1">
                    Tutup modal ini untuk menyesuaikan volume/harga BOQ di
                    grid, atau klik tombol di bawah untuk menyamakan nilai
                    kontrak dengan total BOQ secara otomatis.
                  </p>
                </div>
              </div>
              <button
                className="btn-secondary btn-xs"
                onClick={samakan}
                disabled={syncing}
              >
                {syncing ? <Spinner size={11} /> : null}
                Samakan otomatis: set Nilai Kontrak = {fmtCurrency(sync.boq_total)}
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-500 text-center py-6">
          Tidak bisa memuat status sinkronisasi.
        </p>
      )}
    </Modal>
  );
}

function SyncRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-ink-600">{label}</span>
      <span className="text-sm font-medium text-ink-900">
        {fmtCurrency(value)}
      </span>
    </div>
  );
}
