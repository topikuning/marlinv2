import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Building2, Wallet, Activity, AlertTriangle, MapPin, Layers,
  ChevronLeft, Calendar, Image as ImageIcon, X,
} from "lucide-react";
import { analyticsAPI, notificationsAPI } from "@/api";
import { PageLoader, StatCard, Empty } from "@/components/ui";
import {
  fmtCurrency, fmtPct, fmtDate, contractStatusBadge, assetUrl,
} from "@/utils/format";
import toast from "react-hot-toast";

// Leaflet default marker icon fix untuk bundler (Vite tidak otomatis copy
// PNG referenced via CSS background-image).
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// Custom marker per status kontrak — warna pin sebagai signal cepat di peta.
const STATUS_COLOR = {
  draft: "#94a3b8",       // slate-400
  active: "#2563eb",      // blue-600
  addendum: "#f59e0b",    // amber-500
  on_hold: "#dc2626",     // red-600
  completed: "#10b981",   // emerald-500
  terminated: "#6b7280",  // gray-500
};

function statusMarker(status) {
  const color = STATUS_COLOR[status] || "#2563eb";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      background:${color};
      width:24px;height:24px;border-radius:50%;
      border:3px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
    "><div style="background:#fff;width:6px;height:6px;border-radius:50%"></div></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Center peta di tengah Indonesia
const INDONESIA_CENTER = [-2.5, 118.0];
const INDONESIA_ZOOM = 5;

function FlyTo({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      map.flyTo(position, Math.max(map.getZoom(), 10), { duration: 0.8 });
    }
  }, [position]);
  return null;
}

export default function ExecutiveDashboardPage() {
  const [stats, setStats] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [mapItems, setMapItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);          // location obj
  const [selectedFacility, setSelectedFacility] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const [{ data: s }, { data: ws }, { data: m }] = await Promise.all([
          analyticsAPI.dashboard(),
          notificationsAPI.warnings({ resolved: false }),
          analyticsAPI.mapLocations(),
        ]);
        setStats(s);
        setWarnings(ws.items || []);
        setMapItems(m.items || []);
      } catch (e) {
        toast.error("Gagal memuat dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <PageLoader />;

  return (
    <div className="p-4 max-w-screen-2xl mx-auto space-y-4">
      {/* Stat row */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Total Kontrak"
            value={stats.total_contracts}
            sub={`${stats.total_locations} lokasi · ${stats.total_facilities} fasilitas`}
            icon={Building2}
          />
          <StatCard
            label="Nilai Kontrak"
            value={fmtCurrency(stats.total_value)}
            sub={`Realisasi ${fmtPct(stats.avg_progress)}`}
            icon={Wallet}
          />
          <StatCard
            label="Aktif"
            value={stats.active_contracts}
            sub={`${stats.completed_contracts || 0} selesai`}
            icon={Activity}
            iconBg="bg-blue-50"
          />
          <StatCard
            label="Peringatan"
            value={warnings.length}
            sub={warnings.length > 0 ? "perlu tindak lanjut" : "tidak ada"}
            icon={AlertTriangle}
            iconBg={warnings.length > 0 ? "bg-amber-50" : "bg-green-50"}
          />
        </div>
      )}

      {/* Spatial section: left summary + map */}
      <div className="grid grid-cols-12 gap-4 h-[640px]">
        {/* Left panel — info kontrak terpilih */}
        <div className="col-span-12 lg:col-span-4 card p-4 overflow-y-auto">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-ink-500">
              <MapPin size={36} className="text-ink-300 mb-3" />
              <p className="font-medium text-ink-700">Belum ada lokasi dipilih</p>
              <p className="text-xs mt-1.5 max-w-[260px]">
                Klik salah satu marker di peta untuk melihat ringkasan proyek
                beserta daftar fasilitasnya.
              </p>
              {mapItems.length === 0 && (
                <p className="text-[11px] text-amber-700 mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
                  ⚠ Belum ada lokasi dengan koordinat. Lengkapi Latitude &
                  Longitude di form Tambah Lokasi agar muncul di peta.
                </p>
              )}
            </div>
          ) : (
            <ProjectSummary
              location={selected}
              onOpenContract={() => navigate(`/contracts/${selected.contract_id}`)}
            />
          )}
        </div>

        {/* Map */}
        <div className="col-span-12 lg:col-span-8 card overflow-hidden">
          <MapContainer
            center={INDONESIA_CENTER}
            zoom={INDONESIA_ZOOM}
            style={{ width: "100%", height: "100%" }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {selected && (
              <FlyTo position={[selected.latitude, selected.longitude]} />
            )}
            {mapItems.map((loc) => (
              <Marker
                key={loc.location_id}
                position={[loc.latitude, loc.longitude]}
                icon={statusMarker(loc.contract_status)}
                eventHandlers={{
                  click: () => {
                    setSelected(loc);
                    setSelectedFacility(null);
                  },
                }}
              >
                <Popup>
                  <div className="text-xs">
                    <p className="font-semibold">{loc.location_name}</p>
                    <p className="text-ink-500 font-mono">{loc.location_code}</p>
                    <p className="mt-1">{loc.contract_number}</p>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>

      {/* Bottom panel — facilities list / photo gallery */}
      {selected && (
        <div className="card p-4">
          {selectedFacility ? (
            <PhotoGallery
              facility={selectedFacility}
              onBack={() => setSelectedFacility(null)}
            />
          ) : (
            <FacilityList
              location={selected}
              onSelectFacility={setSelectedFacility}
            />
          )}
        </div>
      )}
    </div>
  );
}


// ────────────────────────────────────────────────────────────────────────────
// Project Summary (left panel)
// ────────────────────────────────────────────────────────────────────────────
function ProjectSummary({ location: loc, onOpenContract }) {
  const [scurve, setScurve] = useState(null);
  const [loadingS, setLoadingS] = useState(false);

  useEffect(() => {
    setLoadingS(true);
    analyticsAPI
      .scurve(loc.contract_id)
      .then(({ data }) => setScurve(data))
      .catch(() => setScurve(null))
      .finally(() => setLoadingS(false));
  }, [loc.contract_id]);

  const deviation = loc.deviation_pct;
  const deviationColor =
    deviation == null
      ? "text-ink-500"
      : deviation >= -3
      ? "text-green-700"
      : deviation >= -10
      ? "text-amber-700"
      : "text-red-700";

  return (
    <div className="space-y-3">
      <div>
        <span className={contractStatusBadge(loc.contract_status)}>
          {loc.contract_status}
        </span>
        <p className="font-display font-semibold text-ink-900 mt-2 leading-snug">
          {loc.contract_name}
        </p>
        <p className="text-xs text-ink-500 font-mono mt-0.5">
          {loc.contract_number}
        </p>
      </div>

      <div className="text-xs space-y-1 pt-1 border-t border-ink-100">
        <div className="flex items-center gap-1.5 text-ink-600">
          <MapPin size={11} className="text-brand-600" />
          <span className="font-medium">{loc.location_name}</span>
        </div>
        <p className="text-[11px] text-ink-500 pl-4">
          {[loc.village, loc.district, loc.city, loc.province].filter(Boolean).join(", ")}
        </p>
        <p className="text-[11px] text-ink-400 pl-4 font-mono">
          {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Cell label="Nilai" value={fmtCurrency(loc.current_value)} />
        <Cell label="Durasi" value={`${loc.duration_days} hari`} />
        <Cell label="Mulai" value={fmtDate(loc.start_date)} />
        <Cell label="Selesai" value={fmtDate(loc.end_date)} />
      </div>

      {/* Progress fisik */}
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
              <div
                className="h-full bg-brand-500"
                style={{ width: `${Math.min(100, (loc.actual_pct || 0) * 100)}%` }}
              />
            </div>
            {deviation != null && (
              <p className={`text-[11px] mt-1 ${deviationColor}`}>
                Deviasi: {(deviation * 100).toFixed(2)}%
                {deviation < -10 && " · perlu perhatian"}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-ink-500 italic">Belum ada laporan mingguan</p>
        )}
      </div>

      {/* S-Curve mini */}
      <div className="border-t border-ink-100 pt-3">
        <p className="text-[10px] uppercase tracking-wider text-ink-400 font-medium mb-2">
          Kurva S
        </p>
        {loadingS ? (
          <p className="text-xs text-ink-400">Memuat...</p>
        ) : !scurve || (scurve.points || []).length === 0 ? (
          <p className="text-xs text-ink-500 italic">Belum ada data</p>
        ) : (
          <div className="h-32">
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
                <XAxis
                  dataKey="week_number"
                  tick={{ fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, 100]}
                  width={26}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(v) => `${(v || 0).toFixed(2)}%`}
                />
                <Area
                  type="monotone"
                  dataKey="planned_cumulative_pct"
                  stroke="#94a3b8"
                  fill="url(#planG)"
                  strokeWidth={1.5}
                  name="Rencana"
                />
                <Area
                  type="monotone"
                  dataKey="actual_cumulative_pct"
                  stroke="#2563eb"
                  fill="url(#actG)"
                  strokeWidth={2}
                  name="Realisasi"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="pt-2 flex gap-2">
        <button onClick={onOpenContract} className="btn-primary btn-xs flex-1">
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
      <p className="text-xs font-medium text-ink-800 mt-0.5 truncate">{value}</p>
    </div>
  );
}


// ────────────────────────────────────────────────────────────────────────────
// Facility List (bottom panel)
// ────────────────────────────────────────────────────────────────────────────
function FacilityList({ location: loc, onSelectFacility }) {
  if (!loc.facilities || loc.facilities.length === 0) {
    return (
      <Empty
        icon={Layers}
        title="Belum ada fasilitas di lokasi ini"
        description="Tambah fasilitas dari halaman detail kontrak."
      />
    );
  }
  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-ink-800 flex items-center gap-2">
          <Layers size={14} className="text-brand-600" />
          Fasilitas di {loc.location_name}
          <span className="text-xs text-ink-400">({loc.facilities.length})</span>
        </p>
        <p className="text-[11px] text-ink-500">Klik salah satu untuk melihat foto dokumentasi</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {loc.facilities.map((f) => (
          <button
            key={f.id}
            onClick={() => onSelectFacility(f)}
            className="text-left px-3 py-2 rounded-lg border border-ink-200 bg-ink-50 hover:bg-brand-50 hover:border-brand-300 transition group"
          >
            <p className="font-mono text-[10px] text-brand-600 group-hover:text-brand-700">
              {f.facility_code}
            </p>
            <p className="text-xs font-medium text-ink-800 mt-0.5 truncate">
              {f.facility_name}
            </p>
            {f.facility_type && (
              <p className="text-[10px] text-ink-500 mt-0.5">{f.facility_type}</p>
            )}
            <p className="text-[10px] text-ink-600 mt-1 font-medium">
              {fmtCurrency(f.total_value)}
            </p>
          </button>
        ))}
      </div>
    </>
  );
}


// ────────────────────────────────────────────────────────────────────────────
// Photo Gallery (bottom panel saat fasilitas dipilih)
// ────────────────────────────────────────────────────────────────────────────
function PhotoGallery({ facility, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    setLoading(true);
    analyticsAPI
      .facilityPhotos(facility.id)
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [facility.id]);

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div>
          <button onClick={onBack} className="btn-ghost btn-xs mb-1">
            <ChevronLeft size={11} /> Kembali ke Fasilitas
          </button>
          <p className="text-sm font-semibold text-ink-800 flex items-center gap-2">
            <ImageIcon size={14} className="text-brand-600" />
            Foto Dokumentasi: {facility.facility_name}
          </p>
        </div>
        {data && (
          <p className="text-xs text-ink-500">
            {data.total} foto · {data.groups.length} sesi
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-ink-500 italic">Memuat foto...</p>
      ) : !data || data.total === 0 ? (
        <Empty
          icon={ImageIcon}
          title="Belum ada foto"
          description="Foto dokumentasi diambil dari laporan mingguan yang ter-tag fasilitas ini."
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
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {g.photos.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setLightbox(p)}
                    className="aspect-square rounded-lg overflow-hidden border border-ink-200 hover:border-brand-400 group relative"
                  >
                    <img
                      src={assetUrl(p.thumbnail_path || p.file_path)}
                      alt={p.caption || ""}
                      className="w-full h-full object-cover group-hover:scale-105 transition"
                      loading="lazy"
                    />
                    {p.caption && (
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                        <p className="text-[10px] text-white truncate">{p.caption}</p>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            onClick={() => setLightbox(null)}
          >
            <X size={24} />
          </button>
          <div className="max-w-5xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <img
              src={assetUrl(lightbox.file_path)}
              alt={lightbox.caption || ""}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            {lightbox.caption && (
              <p className="text-white text-sm mt-3 text-center max-w-2xl">{lightbox.caption}</p>
            )}
            {lightbox.taken_at && (
              <p className="text-white/60 text-xs mt-1">{fmtDate(lightbox.taken_at)}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
