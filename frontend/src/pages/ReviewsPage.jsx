import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Plus, ClipboardCheck, AlertCircle, CheckCircle, Clock, Edit2, Trash2, Upload, Image,
} from "lucide-react";
import { contractsAPI, reviewsAPI } from "../api";
import {
  PageHeader, PageLoader, Modal, Empty, Spinner, ConfirmDialog,
} from "../components/ui";
import { fmtDate, parseApiError, assetUrl } from "../utils/format";

const SEVERITY_BADGE = {
  low: "badge-gray",
  medium: "badge-blue",
  high: "badge-yellow",
  critical: "badge-red",
};

const FINDING_STATUS_BADGE = {
  open: "badge-red",
  responded: "badge-yellow",
  accepted: "badge-blue",
  rejected: "badge-gray",
  closed: "badge-green",
};

export default function ReviewsPage() {
  const [contracts, setContracts] = useState([]);
  const [selected, setSelected] = useState("");
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showReview, setShowReview] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    contractsAPI.list({ page_size: 500 }).then(({ data }) => setContracts(data.items || []));
  }, []);

  useEffect(() => {
    if (!selected) return setReviews([]);
    refresh();
  }, [selected]);

  const refresh = () => {
    setLoading(true);
    reviewsAPI.listByContract(selected).then(({ data }) => setReviews(data.items || [])).finally(() => setLoading(false));
  };

  const openDetail = async (r) => {
    const { data } = await reviewsAPI.get(r.id);
    setDetail(data);
  };

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Review Lapangan"
        description="Inspeksi & temuan lapangan (Itjen, MK, dll)"
        actions={
          selected && (
            <button className="btn-primary" onClick={() => setShowReview({})}>
              <Plus size={14} /> Review Baru
            </button>
          )
        }
      />

      <div className="card p-4 mb-6">
        <label className="label">Pilih Kontrak</label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="select max-w-2xl"
        >
          <option value="">-- Pilih kontrak --</option>
          {contracts.map((c) => (
            <option key={c.id} value={c.id}>
              [{c.contract_number}] {c.contract_name}
            </option>
          ))}
        </select>
      </div>

      {!selected ? (
        <Empty icon={ClipboardCheck} title="Pilih kontrak" />
      ) : loading ? (
        <PageLoader />
      ) : reviews.length === 0 ? (
        <Empty icon={ClipboardCheck} title="Belum ada review" />
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <div
              key={r.id}
              onClick={() => openDetail(r)}
              className="card p-5 cursor-pointer hover:border-brand-400"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-display font-semibold text-ink-900">
                      {r.review_number || "Review"} · {fmtDate(r.review_date)}
                    </p>
                    <span
                      className={
                        r.status === "closed"
                          ? "badge-green"
                          : r.status === "in_progress"
                          ? "badge-yellow"
                          : "badge-red"
                      }
                    >
                      {r.status}
                    </span>
                  </div>
                  <p className="text-sm text-ink-600">
                    {r.reviewer_name}
                    {r.reviewer_institution && ` · ${r.reviewer_institution}`}
                  </p>
                  {r.summary && (
                    <p className="text-xs text-ink-500 mt-2 line-clamp-2">
                      {r.summary}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showReview && (
        <ReviewModal
          contractId={selected}
          initial={showReview.id ? showReview : null}
          onClose={() => setShowReview(null)}
          onSuccess={() => {
            setShowReview(null);
            refresh();
          }}
        />
      )}

      {detail && (
        <ReviewDetail
          review={detail}
          onClose={() => setDetail(null)}
          onChange={(r) => setDetail(r)}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}

function ReviewModal({ contractId, initial, onClose, onSuccess }) {
  const [form, setForm] = useState(
    initial || {
      contract_id: contractId,
      review_number: "",
      review_date: new Date().toISOString().slice(0, 10),
      reviewer_name: "",
      reviewer_institution: "",
      summary: "",
      recommendations: "",
    }
  );
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      if (initial) await reviewsAPI.update(initial.id, form);
      else await reviewsAPI.create(form);
      toast.success("Tersimpan");
      onSuccess?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? "Edit Review" : "Review Baru"}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading && <Spinner size={14} />} Simpan
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Nomor Review</label>
          <input
            className="input"
            value={form.review_number || ""}
            onChange={(e) => setForm({ ...form, review_number: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Tanggal *</label>
          <input
            type="date"
            className="input"
            value={form.review_date}
            onChange={(e) => setForm({ ...form, review_date: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Nama Reviewer *</label>
          <input
            className="input"
            value={form.reviewer_name}
            onChange={(e) => setForm({ ...form, reviewer_name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Instansi</label>
          <input
            className="input"
            value={form.reviewer_institution || ""}
            onChange={(e) =>
              setForm({ ...form, reviewer_institution: e.target.value })
            }
            placeholder="Itjen / Inspektorat / MK"
          />
        </div>
      </div>
      <div className="mt-3">
        <label className="label">Ringkasan Temuan</label>
        <textarea
          className="textarea h-20 resize-none"
          value={form.summary || ""}
          onChange={(e) => setForm({ ...form, summary: e.target.value })}
        />
      </div>
      <div className="mt-3">
        <label className="label">Rekomendasi Umum</label>
        <textarea
          className="textarea h-20 resize-none"
          value={form.recommendations || ""}
          onChange={(e) =>
            setForm({ ...form, recommendations: e.target.value })
          }
        />
      </div>
    </Modal>
  );
}

function ReviewDetail({ review, onClose, onChange, onRefresh }) {
  const [addingFinding, setAddingFinding] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Review ${review.review_number || ""} · ${fmtDate(review.review_date)}`}
      size="xl"
      footer={
        <button className="btn-secondary" onClick={onClose}>Tutup</button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-ink-500">Reviewer</p>
            <p className="font-medium">
              {review.reviewer_name}
              {review.reviewer_institution && ` · ${review.reviewer_institution}`}
            </p>
          </div>
          <div>
            <p className="text-xs text-ink-500">Status</p>
            <p>{review.status}</p>
          </div>
        </div>
        {review.summary && (
          <div>
            <p className="text-xs text-ink-500 mb-1">Ringkasan</p>
            <p className="text-sm whitespace-pre-line">{review.summary}</p>
          </div>
        )}

        <div className="pt-4 border-t border-ink-200">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium">
              Temuan ({review.findings?.length || 0})
            </h4>
            <button
              className="btn-primary btn-xs"
              onClick={() => setAddingFinding(true)}
            >
              <Plus size={11} /> Temuan
            </button>
          </div>
          {!review.findings?.length ? (
            <p className="text-xs text-ink-500">Belum ada temuan</p>
          ) : (
            <div className="space-y-2">
              {review.findings.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  reviewId={review.id}
                  onRefresh={async () => {
                    const { data } = await reviewsAPI.get(review.id);
                    onChange(data);
                    onRefresh?.();
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {addingFinding && (
        <FindingModal
          reviewId={review.id}
          onClose={() => setAddingFinding(false)}
          onSuccess={async () => {
            setAddingFinding(false);
            const { data } = await reviewsAPI.get(review.id);
            onChange(data);
          }}
        />
      )}
    </Modal>
  );
}

function FindingCard({ finding, reviewId, onRefresh }) {
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const onFile = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files)
        await reviewsAPI.uploadFindingPhoto(finding.id, f);
      toast.success("Upload selesai");
      await onRefresh?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-3 bg-ink-50/60 rounded-lg border border-ink-200">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-mono text-ink-500">
              #{finding.finding_number}
            </span>
            <span className={SEVERITY_BADGE[finding.severity]}>
              {finding.severity}
            </span>
            <span className={FINDING_STATUS_BADGE[finding.status]}>
              {finding.status}
            </span>
            <span className="text-sm font-medium text-ink-800">
              {finding.title}
            </span>
          </div>
          <p className="text-xs text-ink-600 leading-snug">{finding.description}</p>
          {finding.recommendation && (
            <p className="text-xs text-ink-500 mt-1">
              <b>Rekomendasi:</b> {finding.recommendation}
            </p>
          )}
          {finding.response && (
            <p className="text-xs text-emerald-700 mt-1">
              <b>Jawaban:</b> {finding.response}
            </p>
          )}
          {finding.photos?.length > 0 && (
            <div className="flex gap-2 mt-2">
              {finding.photos.map((p) => (
                <img
                  key={p.id}
                  src={assetUrl(p.thumbnail_path || p.file_path)}
                  className="w-14 h-14 rounded-md object-cover"
                  alt=""
                />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button className="btn-ghost btn-xs" onClick={() => setEditing(true)}>
            <Edit2 size={11} />
          </button>
          <label className="btn-ghost btn-xs cursor-pointer">
            <Upload size={11} />
            <input type="file" hidden multiple accept="image/*" onChange={onFile} />
          </label>
          <button
            className="btn-ghost btn-xs text-red-600"
            onClick={async () => {
              if (!confirm("Hapus temuan?")) return;
              await reviewsAPI.deleteFinding(finding.id);
              await onRefresh?.();
            }}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {editing && (
        <FindingModal
          reviewId={reviewId}
          initial={finding}
          onClose={() => setEditing(false)}
          onSuccess={async () => {
            setEditing(false);
            await onRefresh?.();
          }}
        />
      )}
    </div>
  );
}

function FindingModal({ reviewId, initial, onClose, onSuccess }) {
  const [form, setForm] = useState(
    initial || {
      title: "",
      description: "",
      severity: "medium",
      status: "open",
      recommendation: "",
      response: "",
      due_date: "",
    }
  );
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      if (initial) await reviewsAPI.updateFinding(initial.id, form);
      else await reviewsAPI.createFinding(reviewId, form);
      toast.success("Tersimpan");
      onSuccess?.();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? "Edit Temuan" : "Temuan Baru"}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading && <Spinner size={14} />} Simpan
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Judul *</label>
          <input
            className="input"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Severity</label>
          <select
            className="select"
            value={form.severity}
            onChange={(e) => setForm({ ...form, severity: e.target.value })}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select
            className="select"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            <option value="open">Open</option>
            <option value="responded">Dijawab</option>
            <option value="accepted">Diterima</option>
            <option value="rejected">Ditolak</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Deskripsi *</label>
          <textarea
            className="textarea h-24 resize-none"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="col-span-2">
          <label className="label">Rekomendasi</label>
          <textarea
            className="textarea h-16 resize-none"
            value={form.recommendation || ""}
            onChange={(e) =>
              setForm({ ...form, recommendation: e.target.value })
            }
          />
        </div>
        <div className="col-span-2">
          <label className="label">Jawaban / Tindak Lanjut</label>
          <textarea
            className="textarea h-16 resize-none"
            value={form.response || ""}
            onChange={(e) => setForm({ ...form, response: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Deadline</label>
          <input
            type="date"
            className="input"
            value={form.due_date || ""}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
}
