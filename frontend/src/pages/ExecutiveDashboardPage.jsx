import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  MapPin, Layers, ChevronLeft, Calendar, Image as ImageIcon, X,
  ChevronRight, ChevronLeft as ChevLeft, Search, Maximize2, Minimize2,
} from "lucide-react";
import { analyticsAPI } from "@/api";
import { PageLoader, Empty } from "@/components/ui";
import {
  fmtCurrency, fmtDate, contractStatusBadge, assetUrl,
} from "@/utils/format";
import toast from "react-hot-toast";

// Leaflet default marker icon fix untuk bundler
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const STATUS_COLOR = {
  draft: "#94a3b8",
  active: "#2563eb",
  addendum: "#f59e0b",
  on_hold: "#dc2626",
  completed: "#10b981",
  terminated: "#6b7280",
};

function statusMarker(status, highlighted = false) {
  const color = STATUS_COLOR[status] || "#2563eb";
  const size = highlighted ? 32 : 24;
  const inner = highlighted ? 10 : 6;
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      background:${color};
      width:${size}px;height:${size}px;border-radius:50%;
      border:3px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,0.5);
      display:flex;align-items:center;justify-content:center;
      ${highlighted ? "animation:pulse 1.5s infinite;" : ""}
    "><div style="background:#fff;width:${inner}px;height:${inner}px;border-radius:50%"></div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const INDONESIA_CENTER = [-2.5, 118.0];
const INDONESIA_ZOOM = 5;

function FlyTo({ position, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      map.flyTo(position, zoom ?? Math.max(map.getZoom(), 11), { duration: 0.8 });
    }
  }, [position]);
  return null;
}


export default function ExecutiveDashboardPage() {
  const [mapItems, setMapItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [selectedFacility, setSelectedFacility] = useState(null);
  const [search, setSearch] = useState("");
  const [showPanel, setShowPanel] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    analyticsAPI.mapLocations()
      .then(({ data }) => setMapItems(data.items || []))
      .catch(() => toast.error("Gagal memuat peta"))
      .finally(() => setLoading(false));
  }, []);

  // Search: filter markers by q yang match nama kontrak, PPK, perusahaan,
  // lokasi, kota, atau kode lokasi.
  const filteredItems = useMemo(() => {
    if (!search.trim()) return mapItems;
    const q = search.toLowerCase();
    return mapItems.filter((it) =>
      (it.contract_name || "").toLowerCase().includes(q) ||
      (it.contract_number || "").toLowerCase().includes(q) ||
      (it.ppk_name || "").toLowerCase().includes(q) ||
      (it.company_name || "").toLowerCase().includes(q) ||
      (it.location_name || "").toLowerCase().includes(q) ||
      (it.location_code || "").toLowerCase().includes(q) ||
      (it.city || "").toLowerCase().includes(q) ||
      (it.province || "").toLowerCase().includes(q)
    );
  }, [mapItems, search]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const closePanel = () => {
    setSelected(null);
    setSelectedFacility(null);
    setShowPanel(true);
  };

  if (loading) return <PageLoader />;

  return (
    <div className="-m-4 sm:-m-6 lg:-m-6 relative h-[calc(100vh-4rem)]">
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
      `}</style>

      {/* Map fullscreen */}
      <MapContainer
        center={INDONESIA_CENTER}
        zoom={INDONESIA_ZOOM}
        style={{ width: "100%", height: "100%" }}
        scrollWheelZoom
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {selected && (
          <FlyTo position={[selected.latitude, selected.longitude]} />
        )}
        {filteredItems.map((loc) => (
          <Marker
            key={loc.location_id}
            position={[loc.latitude, loc.longitude]}
            icon={statusMarker(loc.contract_status, selected?.location_id === loc.location_id)}
            eventHandlers={{
              click: () => {
                setSelected(loc);
                setSelectedFacility(null);
                setShowPanel(true);
              },
            }}
          >
            <Popup>
              <div className="text-xs">
                <p className="font-semibold">{loc.location_name}</p>
                <p className="text-gray-500 font-mono">{loc.location_code}</p>
                <p className="mt-1">{loc.contract_number}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Search overlay — top left */}
      <div className="absolute top-4 left-4 z-[1000] w-[360px] max-w-[calc(100vw-2rem)]">
        <div className="bg-white rounded-xl shadow-lg border border-ink-200 p-2 flex items-center gap-2">
          <Search size={16} className="text-ink-400 ml-2" />
          <input
            type="text"
            placeholder="Cari PPK, perusahaan, kontrak, lokasi..."
            className="flex-1 bg-transparent text-sm outline-none py-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")} className="p-1 text-ink-400 hover:text-ink-700">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="mt-1 text-[11px] text-ink-600 bg-white/90 px-3 py-1 rounded-full inline-block shadow">
          {filteredItems.length} / {mapItems.length} lokasi
          {search && ` · memfilter "${search}"`}
        </div>
      </div>

      {/* Fullscreen toggle — top right */}
      <button
        onClick={toggleFullscreen}
        className="absolute top-4 right-4 z-[1000] bg-white rounded-xl shadow-lg border border-ink-200 p-2.5 hover:bg-ink-50"
        title="Full-screen (F11 juga bisa)"
      >
        {document.fullscreenElement ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>

      {/* Empty state hint — center bottom */}
      {filteredItems.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-white/95 rounded-xl shadow-lg border border-amber-200 p-4 max-w-md text-center pointer-events-auto">
            <MapPin size={32} className="mx-auto text-amber-500 mb-2" />
            <p className="font-semibold text-ink-800">Tidak ada lokasi ditemukan</p>
            <p className="text-xs text-ink-600 mt-1">
              {search
                ? "Coba kata kunci lain atau bersihkan filter."
                : "Belum ada lokasi dengan koordinat. Lengkapi Latitude & Longitude di form Tambah Lokasi."}
            </p>
          </div>
        </div>
      )}

      {/* Info panel — slide in from left when location selected */}
      {selected && showPanel && (
        <div className="absolute top-0 left-0 bottom-0 w-full sm:w-[420px] bg-white shadow-2xl z-[999] overflow-y-auto border-r border-ink-200">
          <ProjectSummary
            location={selected}
            onClose={closePanel}
            onOpenContract={() => navigate(`/contracts/${selected.contract_id}`)}
            onSelectFacility={setSelectedFacility}
          />
        </div>
      )}

      {/* Collapse/expand panel toggle (mini) when panel hidden */}
      {selected && !showPanel && (
        <button
          onClick={() => setShowPanel(true)}
          className="absolute top-1/2 left-4 -translate-y-1/2 z-[999] bg-white rounded-r-xl shadow-lg border border-ink-200 p-3 hover:bg-ink-50"
          title="Tampilkan panel info"
        >
          <ChevronRight size={18} />
        </button>
      )}

      {/* Photo gallery lightbox/drawer — covers when facility selected */}
      {selectedFacility && (
        <PhotoGalleryDrawer
          facility={selectedFacility}
          onClose={() => setSelectedFacility(null)}
        />
      )}
    </div>
  );
}


// ────────────────────────────────────────────────────────────────────────────
// Project Summary (slide-in left panel)
// ────────────────────────────────────────────────────────────────────────────
function ProjectSummary({ location: loc, onClose, onOpenContract, onSelectFacility }) {
  const [scurve, setScurve] = useState(null);

  useEffect(() => {
    analyticsAPI.scurve(loc.contract_id)
      .then(({ data }) => setScurve(data))
      .catch(() => setScurve(null));
  }, [loc.contract_id]);

  const deviation = loc.deviation_pct;
  const deviationColor =
    deviation == null ? "text-ink-500"
      : deviation >= -0.03 ? "text-green-700"
      : deviation >= -0.10 ? "text-amber-700"
      : "text-red-700";

  return (
    <div>
      {/* Header dengan close */}
      <div className="sticky top-0 bg-white z-10 px-5 pt-4 pb-3 border-b border-ink-100 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <span className={contractStatusBadge(loc.contract_status)}>
            {loc.contract_status}
          </span>
          <p className="font-display font-semibold text-ink-900 mt-2 leading-snug">
            {loc.contract_name}
          </p>
          <p className="text-xs text-ink-500 font-mono mt-0.5 truncate">
            {loc.contract_number}
          </p>
        </div>
        <button onClick={onClose} className="text-ink-400 hover:text-ink-800 p-1" title="Tutup">
          <X size={18} />
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div className="text-xs space-y-1">
          <div className="flex items-center gap-1.5 text-ink-600">
            <MapPin size={12} className="text-brand-600" />
            <span className="font-medium">{loc.location_name}</span>
            <span className="font-mono text-[10px] text-ink-400 ml-auto">
              {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
            </span>
          </div>
          <p className="text-[11px] text-ink-500 pl-4">
            {[loc.village, loc.district, loc.city, loc.province].filter(Boolean).join(", ")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <Cell label="PPK" value={loc.ppk_name || "—"} />
          <Cell label="Kontraktor" value={loc.company_name || "—"} />
          <Cell label="Nilai" value={fmtCurrency(loc.current_value)} />
          <Cell label="Durasi" value={`${loc.duration_days} hari`} />
          <Cell label="Mulai" value={fmtDate(loc.start_date)} />
          <Cell label="Selesai" value={fmtDate(loc.end_date)} />
        </div>

        {/* Progress bar */}
        <div className="border-t border-ink-100 pt-3">
          <p className="text-[10px] uppercase tracking-wider text-ink-400 font-medium mb-2">
            Progress Fisik {loc.latest_week && `· Minggu ${loc.latest_week}`}
          </p>
          {loc.actual_pct != null ? (
            <>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-ink-600">
                  Realisasi:{" "}
                  <span className="font-semibold text-ink-800">
                    {(loc.actual_pct * 100).toFixed(2)}%
                  </span>
                </span>
                <span className="text-ink-500">
                  Rencana: {(loc.planned_pct * 100).toFixed(2)}%
                </span>
              </div>
              <div className="h-2 bg-ink-100 rounded overflow-hidden">
                <div className="h-full bg-brand-500"
                  style={{ width: `${Math.min(100, (loc.actual_pct || 0) * 100)}%` }}
                />
              </div>
              {deviation != null && (
                <p className={`text-[11px] mt-1 ${deviationColor}`}>
                  Deviasi: {(deviation * 100).toFixed(2)}%
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-ink-500 italic">Belum ada laporan mingguan</p>
          )}
        </div>

        {/* S-Curve */}
        <div className="border-t border-ink-100 pt-3">
          <p className="text-[10px] uppercase tracking-wider text-ink-400 font-medium mb-2">
            Kurva S
          </p>
          {!scurve || (scurve.points || []).length === 0 ? (
            <p className="text-xs text-ink-500 italic">Belum ada data</p>
          ) : (
            <div className="h-36">
              <ResponsiveContainer>
                <AreaChart data={scurve.points} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="planG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="actG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="week_number" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} domain={[0, 100]} width={26} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => `${(v || 0).toFixed(2)}%`} />
                  <Area type="monotone" dataKey="planned_cumulative_pct" stroke="#94a3b8" fill="url(#planG)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="actual_cumulative_pct" stroke="#2563eb" fill="url(#actG)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Facilities */}
        <div className="border-t border-ink-100 pt-3">
          <p className="text-[10px] uppercase tracking-wider text-ink-400 font-medium mb-2 flex items-center gap-1.5">
            <Layers size={11} /> Fasilitas ({loc.facilities?.length || 0})
          </p>
          {!loc.facilities?.length ? (
            <p className="text-xs text-ink-500 italic">Belum ada fasilitas</p>
          ) : (
            <div className="space-y-1">
              {loc.facilities.map((f) => (
                <button
                  key={f.id}
                  onClick={() => onSelectFacility(f)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-ink-200 bg-ink-50 hover:bg-brand-50 hover:border-brand-300 transition group flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] text-brand-600">{f.facility_code}</p>
                    <p className="text-xs font-medium text-ink-800 truncate">{f.facility_name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] text-ink-500">{fmtCurrency(f.total_value)}</p>
                    <ChevronRight size={12} className="text-ink-400 group-hover:text-brand-600 ml-auto" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={onOpenContract} className="btn-primary w-full">
          Buka Detail Kontrak →
        </button>
      </div>
    </div>
  );
}

function Cell({ label, value }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className="text-xs font-medium text-ink-800 mt-0.5 truncate" title={value}>{value}</p>
    </div>
  );
}


// ────────────────────────────────────────────────────────────────────────────
// Photo Gallery Drawer (bottom sheet) + embedded Lightbox with nav controls
// ────────────────────────────────────────────────────────────────────────────
function PhotoGalleryDrawer({ facility, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [flatPhotos, setFlatPhotos] = useState([]);
  const [lightboxIdx, setLightboxIdx] = useState(-1);

  useEffect(() => {
    setLoading(true);
    analyticsAPI.facilityPhotos(facility.id)
      .then(({ data }) => {
        setData(data);
        // Flat list untuk navigasi prev/next di lightbox
        const flat = (data.groups || []).flatMap((g) =>
          g.photos.map((p) => ({ ...p, date: g.date }))
        );
        setFlatPhotos(flat);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [facility.id]);

  const openLightbox = useCallback((photo) => {
    const idx = flatPhotos.findIndex((p) => p.id === photo.id);
    setLightboxIdx(idx);
  }, [flatPhotos]);

  const closeLightbox = () => setLightboxIdx(-1);
  const prevPhoto = useCallback(() => {
    setLightboxIdx((i) => (i <= 0 ? flatPhotos.length - 1 : i - 1));
  }, [flatPhotos.length]);
  const nextPhoto = useCallback(() => {
    setLightboxIdx((i) => (i >= flatPhotos.length - 1 ? 0 : i + 1));
  }, [flatPhotos.length]);

  // Keyboard nav saat lightbox terbuka
  useEffect(() => {
    if (lightboxIdx < 0) return;
    const handler = (e) => {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") prevPhoto();
      else if (e.key === "ArrowRight") nextPhoto();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIdx, prevPhoto, nextPhoto]);

  const current = lightboxIdx >= 0 ? flatPhotos[lightboxIdx] : null;

  return (
    <>
      {/* Bottom drawer */}
      <div className="absolute bottom-0 left-0 right-0 bg-white shadow-2xl border-t border-ink-200 z-[998] max-h-[55vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-ink-100 px-5 py-3 flex items-center justify-between gap-3">
          <div>
            <button onClick={onClose} className="btn-ghost btn-xs mb-0.5">
              <ChevLeft size={11} /> Tutup Galeri
            </button>
            <p className="text-sm font-semibold text-ink-800 flex items-center gap-2">
              <ImageIcon size={14} className="text-brand-600" />
              <span className="font-mono text-[11px] text-brand-600">{facility.facility_code}</span>
              {facility.facility_name}
            </p>
          </div>
          {data && (
            <div className="text-xs text-ink-500 text-right">
              <p>{data.total} foto · {data.groups.length} sesi</p>
              {data.sources && (
                <p className="text-[10px] text-ink-400">
                  {data.sources.weekly || 0} mingguan · {data.sources.daily || 0} harian
                </p>
              )}
            </div>
          )}
        </div>

        <div className="p-5">
          {loading ? (
            <p className="text-xs text-ink-500 italic">Memuat foto...</p>
          ) : !data || data.total === 0 ? (
            <Empty
              icon={ImageIcon}
              title="Belum ada foto"
              description="Foto muncul bila laporan harian/mingguan sudah di-tag ke fasilitas ini."
            />
          ) : (
            <div className="space-y-4">
              {data.groups.map((g) => (
                <div key={g.date}>
                  <p className="text-xs font-semibold text-ink-700 flex items-center gap-1.5 mb-2">
                    <Calendar size={11} />
                    {g.date === "unknown" ? "Tanggal tidak diketahui" : fmtDate(g.date)}
                    <span className="text-ink-400 font-normal">· {g.photos.length} foto</span>
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-2">
                    {g.photos.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => openLightbox(p)}
                        className="aspect-square rounded-lg overflow-hidden border border-ink-200 hover:border-brand-400 group relative"
                      >
                        <img
                          src={assetUrl(p.thumbnail_path || p.file_path)}
                          alt={p.caption || ""}
                          className="w-full h-full object-cover group-hover:scale-105 transition"
                          loading="lazy"
                        />
                        {p.source && (
                          <span className={`absolute top-1 right-1 text-[8px] px-1 rounded font-semibold uppercase ${
                            p.source === "daily" ? "bg-teal-600 text-white" : "bg-indigo-600 text-white"
                          }`}>
                            {p.source === "daily" ? "H" : "M"}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox — z-index tinggi agar tidak tumpang-tindih map */}
      {current && (
        <div
          className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center"
          onClick={closeLightbox}
        >
          {/* Top bar */}
          <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between text-white z-10">
            <div className="text-xs">
              <p className="font-semibold">{facility.facility_code} · {facility.facility_name}</p>
              <p className="text-white/70">
                {lightboxIdx + 1} / {flatPhotos.length}
                {current.date && ` · ${current.date !== "unknown" ? fmtDate(current.date) : "Tanggal tidak diketahui"}`}
                {current.source && ` · ${current.source === "daily" ? "Laporan Harian" : "Laporan Mingguan"}`}
              </p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
              className="text-white/80 hover:text-white p-2 rounded hover:bg-white/10"
              title="Tutup (Esc)"
            >
              <X size={22} />
            </button>
          </div>

          {/* Prev button */}
          {flatPhotos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); prevPhoto(); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/25 text-white rounded-full p-3 z-10"
              title="Sebelumnya (←)"
            >
              <ChevLeft size={24} />
            </button>
          )}

          {/* Image */}
          <div className="flex flex-col items-center max-w-6xl max-h-[85vh] px-16" onClick={(e) => e.stopPropagation()}>
            <img
              src={assetUrl(current.file_path)}
              alt={current.caption || ""}
              className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
            />
            {current.caption && (
              <p className="text-white text-sm mt-3 text-center max-w-2xl">{current.caption}</p>
            )}
          </div>

          {/* Next button */}
          {flatPhotos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); nextPhoto(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/25 text-white rounded-full p-3 z-10"
              title="Berikutnya (→)"
            >
              <ChevronRight size={24} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
