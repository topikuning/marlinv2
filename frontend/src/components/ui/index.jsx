import { X, ChevronDown, Search, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

export function Modal({ open, onClose, title, children, size = "md", footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = {
    sm: "max-w-md",
    md: "max-w-2xl",
    lg: "max-w-4xl",
    xl: "max-w-6xl",
    full: "max-w-[90vw]",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ink-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`relative bg-white rounded-2xl shadow-hard w-full ${widths[size]} max-h-[90vh] flex flex-col`}
      >
        <div className="px-5 py-4 border-b border-ink-200 flex items-center justify-between flex-shrink-0">
          <h3 className="font-display font-semibold text-ink-900">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-ink-100 text-ink-500"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-ink-200 flex items-center justify-end gap-2 bg-ink-50/60 rounded-b-2xl flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
      <div>
        <h1
          className="font-display tracking-tight text-xl md:text-2xl font-semibold"
          style={{ color: "var(--c-text-1)" }}
        >
          {title}
        </h1>
        {description && (
          <p className="text-sm mt-0.5" style={{ color: "var(--c-text-2)" }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, description, action }) {
  return (
    <div className="text-center py-16">
      {Icon && (
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
          style={{
            background: "var(--c-surface)",
            border: "1px solid var(--c-border)",
            color: "var(--c-text-3)",
          }}
        >
          <Icon size={24} />
        </div>
      )}
      <p className="font-medium" style={{ color: "var(--c-text-1)" }}>
        {title}
      </p>
      {description && (
        <p className="text-sm mt-1" style={{ color: "var(--c-text-2)" }}>
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 18 }) {
  return <Loader2 size={size} className="animate-spin" />;
}

export function PageLoader() {
  return (
    <div
      className="flex items-center justify-center py-20"
      style={{ color: "var(--c-text-3)" }}
    >
      <Spinner size={28} />
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Cari..." }) {
  return (
    <div className="relative">
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2"
        style={{ color: "var(--c-text-3)" }}
      />
      <input
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8 pr-3 py-1.5 w-60 text-xs rounded-lg outline-none transition-colors"
        style={{
          background: "var(--c-input-bg)",
          border: "1px solid var(--c-input-border)",
          color: "var(--c-text-1)",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "rgba(91,139,255,0.6)";
          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(91,139,255,0.15)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--c-input-border)";
          e.currentTarget.style.boxShadow = "none";
        }}
      />
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="border-b border-ink-200 mb-6">
      <div className="flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap
              ${
                active === t.id
                  ? "text-brand-700 border-brand-600"
                  : "text-ink-500 border-transparent hover:text-ink-700"
              }`}
          >
            {t.label}
            {t.count != null && (
              <span className="ml-1.5 text-xs text-ink-400">
                ({t.count})
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StatCard({ label, value, sub, subColor, icon: Icon, iconBg = "bg-brand-50" }) {
  return (
    <div className="card p-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="kpi-label">{label}</p>
        <p className="kpi-value truncate">{value}</p>
        {sub && (
          <p className={`text-xs mt-1.5 ${subColor || "text-ink-500"}`}>
            {sub}
          </p>
        )}
      </div>
      {Icon && (
        <div
          className={`w-11 h-11 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}
        >
          <Icon size={18} className="text-brand-600" />
        </div>
      )}
    </div>
  );
}

export function ConfirmDialog({ open, title, description, onConfirm, onCancel, danger }) {
  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onCancel}>
            Batal
          </button>
          <button
            className={danger ? "btn-danger" : "btn-primary"}
            onClick={onConfirm}
          >
            Konfirmasi
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-600">{description}</p>
    </Modal>
  );
}

/* ─── Marlin Redesign components (glassmorphism, token-aware) ──────────────── */

/**
 * GlassCard — surface card yang adaptif dark/light via CSS custom properties.
 * Pakai ini untuk konten redesign; existing pages tetap pakai .card.
 */
export function GlassCard({ children, className = "", padded = false, ...rest }) {
  return (
    <div
      className={`glass-card ${padded ? "glass-card-pad" : ""} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * GlassStatCard — stat card varian redesign.
 *   accent: hex color (e.g. "#5b8bff" / "#34d399" / "#fbbf24" / "#f87171")
 *   icon:   Lucide icon component
 */
export function GlassStatCard({ label, value, sub, subColor, icon: Icon, accent = "#5b8bff" }) {
  return (
    <div className="glass-card p-5 flex items-center gap-4">
      {Icon && (
        <div
          className="w-[46px] h-[46px] flex items-center justify-center flex-shrink-0"
          style={{
            borderRadius: 13,
            background: `${accent}33`,           /* ~20% alpha */
            border: `1px solid ${accent}61`,    /* ~38% alpha */
            color: accent,
          }}
        >
          <Icon size={20} strokeWidth={2.2} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p
          className="uppercase"
          style={{
            fontSize: 10,
            letterSpacing: "0.1em",
            fontWeight: 700,
            color: "var(--c-text-3)",
            marginBottom: 4,
          }}
        >
          {label}
        </p>
        <p
          className="font-display truncate"
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: "var(--c-text-1)",
            lineHeight: 1.1,
          }}
        >
          {value}
        </p>
        {sub && (
          <p
            className="mt-1.5 truncate"
            style={{
              fontSize: 11,
              color: subColor || "var(--c-text-2)",
            }}
          >
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

