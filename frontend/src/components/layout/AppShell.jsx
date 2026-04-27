import { useState, useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import {
  Menu, LogOut, Bell, User,
  LayoutDashboard, FileText, CalendarDays, CalendarRange,
  TrendingUp, Wallet, ClipboardCheck, AlertTriangle, Database,
  Building2, UserCog, Tags, Settings, Users, ShieldCheck, History,
  Layers, Map,
} from "lucide-react";

const ICONS = {
  LayoutDashboard, FileText, CalendarDays, CalendarRange, TrendingUp,
  Wallet, ClipboardCheck, AlertTriangle, Database, Building2,
  UserCog, Tags, Settings, Users, ShieldCheck, Bell, History, Layers, Map,
};

export default function AppShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, menus, logout } = useAuthStore();
  const navigate = useNavigate();

  // Build tree from flat menus
  const tree = useMemo(() => {
    const parents = menus.filter((m) => !m.parent_id);
    return parents
      .sort((a, b) => a.order_index - b.order_index)
      .map((p) => ({
        ...p,
        children: menus
          .filter((c) => c.parent_id === p.id)
          .sort((a, b) => a.order_index - b.order_index),
      }));
  }, [menus]);

  const Sidebar = ({ mobile }) => (
    <aside
      className={`${mobile ? "w-72" : "w-64"} bg-gradient-to-b from-ink-950 via-ink-900 to-ink-900 text-ink-300 flex flex-col h-full`}
    >
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-white/5 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>
          <div className="text-white font-display font-semibold text-sm leading-none">
            Marlin
          </div>
          <div className="text-[10px] text-ink-500 mt-0.5">
            Monitoring, Analysis, Reporting & Learning
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {tree.map((m) =>
          m.children.length === 0 ? (
            <NavLink
              key={m.id}
              to={m.path || "#"}
              end={m.path === "/"}
              className={({ isActive }) =>
                `menu-link ${isActive ? "active" : ""}`
              }
              onClick={() => setMobileOpen(false)}
            >
              {ICONS[m.icon] && iconOf(m.icon)}
              <span>{m.label}</span>
            </NavLink>
          ) : (
            <div key={m.id}>
              <div className="menu-group-label">{m.label}</div>
              {m.children.map((c) => (
                <NavLink
                  key={c.id}
                  to={c.path}
                  className={({ isActive }) =>
                    `menu-link ${isActive ? "active" : ""}`
                  }
                  onClick={() => setMobileOpen(false)}
                >
                  {ICONS[c.icon] && iconOf(c.icon)}
                  <span>{c.label}</span>
                </NavLink>
              ))}
            </div>
          )
        )}
      </nav>

      <div className="border-t border-white/5 p-3 bg-black/10">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-brand-600/30 flex items-center justify-center flex-shrink-0">
            <User size={14} className="text-brand-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-ink-100 truncate">
              {user?.full_name}
            </p>
            <p className="text-[10px] text-ink-500 truncate">
              {user?.role?.name}
            </p>
          </div>
          <button
            onClick={logout}
            className="p-1.5 rounded-lg hover:bg-white/5 text-ink-400 hover:text-white"
            title="Keluar"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-ink-50 via-slate-50 to-brand-50/20">
      <div className="hidden md:flex flex-shrink-0">
        <Sidebar />
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-ink-900/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full">
            <Sidebar mobile />
          </div>
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white/80 backdrop-blur border-b border-ink-200 flex items-center px-4 md:px-6 gap-4 flex-shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 rounded-lg hover:bg-ink-100 text-ink-500"
          >
            <Menu size={18} />
          </button>
          <div className="flex-1" />
          <button
            className="p-2 rounded-lg hover:bg-ink-100 text-ink-500 relative"
            onClick={() => navigate("/warnings")}
          >
            <Bell size={16} />
          </button>
          <div className="h-6 w-px bg-ink-200" />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center">
              <span className="text-xs font-semibold text-white">
                {user?.full_name?.[0]?.toUpperCase() || "U"}
              </span>
            </div>
            <span className="text-sm font-medium text-ink-700 hidden sm:block">
              {user?.full_name}
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="page-enter pb-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

function iconOf(name) {
  const Icon = ICONS[name];
  return Icon ? <Icon size={15} /> : null;
}
