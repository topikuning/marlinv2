import { useState, useMemo, useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useThemeStore } from "@/store/theme";
import {
  Menu, X, LogOut, Bell, User, Sun, Moon,
  ChevronLeft, ChevronRight,
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

// Mobile bottom tab bar — top 5 most-used routes per design
const MOBILE_TABS = [
  { path: "/",          label: "Beranda",  icon: LayoutDashboard },
  { path: "/contracts", label: "Kontrak",  icon: Building2 },
  { path: "/warnings",  label: "Warning",  icon: AlertTriangle },
  { path: "/eksekutif", label: "Peta",     icon: Map },
  { path: "/admin/users", label: "Akun",   icon: User },
];

function NavItem({ menu, collapsed, onClick }) {
  const Icon = ICONS[menu.icon];
  return (
    <NavLink
      to={menu.path || "#"}
      end={menu.path === "/"}
      title={collapsed ? menu.label : undefined}
      onClick={onClick}
      className={({ isActive }) =>
        `relative flex items-center rounded-[10px] transition-all duration-150 mb-px ` +
        (collapsed ? "justify-center py-2.5 px-0 " : "gap-2.5 py-2 px-3 ") +
        (isActive
          ? "bg-brand-400/[0.18] text-brand-300 font-semibold"
          : "text-white/50 hover:bg-white/[0.05] hover:text-white")
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              className="absolute left-0 top-[18%] h-[64%] w-[3px] rounded-r"
              style={{
                background: "#5b8bff",
                boxShadow: "0 0 10px rgba(91,139,255,0.8)",
              }}
            />
          )}
          {Icon && <Icon size={16} />}
          {!collapsed && (
            <span className="text-[13px] flex-1 text-left whitespace-nowrap overflow-hidden text-ellipsis">
              {menu.label}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function Sidebar({ tree, collapsed, onToggleCollapse, isMobile, onClose }) {
  const { user, logout } = useAuthStore();
  const width = isMobile ? 280 : collapsed ? 64 : 240;

  return (
    <aside
      className="flex flex-col h-full overflow-hidden flex-shrink-0 transition-[width,min-width] duration-[250ms]"
      style={{
        width,
        minWidth: width,
        background: "var(--c-sidebar-bg, rgba(5,10,24,0.88))",
        backdropFilter: "blur(32px)",
        WebkitBackdropFilter: "blur(32px)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        transitionTimingFunction: "cubic-bezier(.4,0,.2,1)",
      }}
    >
      {/* Logo */}
      <div
        className="h-[60px] flex items-center gap-2.5 border-b border-white/[0.05] flex-shrink-0"
        style={{
          padding: collapsed && !isMobile ? "0 14px" : "0 16px",
          justifyContent: collapsed && !isMobile ? "center" : "flex-start",
        }}
      >
        <div
          className="w-[34px] h-[34px] rounded-[10px] flex-shrink-0 flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, #5b8bff 0%, #2d54e0 100%)",
            boxShadow: "0 4px 18px rgba(79,124,255,0.55)",
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        {(!collapsed || isMobile) && (
          <div className="overflow-hidden">
            <div className="font-display font-bold text-[15px] text-white leading-none">
              Marlin
            </div>
            <div className="text-[9px] text-white/30 mt-[3px] tracking-[0.05em] whitespace-nowrap">
              KKP Monitor v2
            </div>
          </div>
        )}
        {isMobile && (
          <button
            onClick={onClose}
            className="ml-auto p-1 leading-none text-white/45 hover:text-white"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2.5">
        {tree.map((m) => {
          // Top-level link (no children)
          if (!m.children || m.children.length === 0) {
            return (
              <NavItem
                key={m.id}
                menu={m}
                collapsed={collapsed && !isMobile}
                onClick={isMobile ? onClose : undefined}
              />
            );
          }
          // Group
          return (
            <div key={m.id}>
              {collapsed && !isMobile ? (
                <div className="h-px my-2.5 mx-2 bg-white/[0.06]" />
              ) : (
                <div className="text-[9px] font-bold text-white/[0.22] uppercase tracking-[0.13em] px-3 pt-3.5 pb-1.5">
                  {m.label}
                </div>
              )}
              {m.children.map((c) => (
                <NavItem
                  key={c.id}
                  menu={c}
                  collapsed={collapsed && !isMobile}
                  onClick={isMobile ? onClose : undefined}
                />
              ))}
            </div>
          );
        })}
      </nav>

      {/* User + collapse */}
      <div className="border-t border-white/[0.05] p-2.5 flex-shrink-0">
        {(!collapsed || isMobile) && (
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] mb-2">
            <div
              className="w-[34px] h-[34px] rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, #5b8bff, #2d54e0)",
                boxShadow: "0 2px 10px rgba(79,124,255,0.4)",
              }}
            >
              <span className="text-[13px] font-bold text-white">
                {user?.full_name?.[0]?.toUpperCase() || "U"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">
                {user?.full_name || "—"}
              </p>
              <p className="text-[10px] text-white/30 truncate">
                {user?.role?.name || user?.role?.code || ""}
              </p>
            </div>
            <button
              onClick={logout}
              className="p-1.5 rounded text-white/30 hover:text-white hover:bg-white/5"
              title="Keluar"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
        {!isMobile && (
          <button
            onClick={onToggleCollapse}
            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-[9px] bg-white/[0.04] hover:bg-white/[0.08] text-white/30 hover:text-white/60 text-[11px] transition-colors"
          >
            {collapsed ? (
              <ChevronRight size={14} />
            ) : (
              <>
                <ChevronLeft size={14} />
                <span>Collapse</span>
              </>
            )}
          </button>
        )}
      </div>
    </aside>
  );
}

export default function AppShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  const { user, menus } = useAuthStore();
  const { theme, toggleTheme, sidebarCollapsed, toggleSidebar } = useThemeStore();
  const navigate = useNavigate();
  const location = useLocation();

  // Build tree from flat menus (preserve existing data shape)
  const tree = useMemo(() => {
    const parents = (menus || []).filter((m) => !m.parent_id);
    return parents
      .sort((a, b) => a.order_index - b.order_index)
      .map((p) => ({
        ...p,
        children: (menus || [])
          .filter((c) => c.parent_id === p.id)
          .sort((a, b) => a.order_index - b.order_index),
      }));
  }, [menus]);

  // Track viewport
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const isDark = theme === "dark";

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-ink-50">
      {/* Desktop sidebar */}
      {!isMobile && (
        <Sidebar
          tree={tree}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          isMobile={false}
        />
      )}

      {/* Mobile drawer */}
      {isMobile && mobileOpen && (
        <div className="fixed inset-0 z-[300]">
          <div
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
          />
          <div className="relative h-full">
            <Sidebar
              tree={tree}
              isMobile={true}
              onClose={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <header
          className="h-[60px] flex items-center px-5 gap-3.5 flex-shrink-0 z-10"
          style={{
            background: "var(--c-header-bg)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderBottom: "1px solid var(--c-divider)",
          }}
        >
          {isMobile && (
            <button
              onClick={() => setMobileOpen(true)}
              className="p-1.5 leading-none text-white/65 hover:text-white"
            >
              <Menu size={20} />
            </button>
          )}

          <div className="flex-1" />

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="p-2 rounded-[10px] transition-colors"
            style={{
              background: "var(--c-surface)",
              border: "1px solid var(--c-border)",
              color: "var(--c-text-2)",
            }}
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {/* Bell */}
          <button
            onClick={() => navigate("/warnings")}
            className="relative p-2 rounded-[10px] transition-colors"
            style={{
              background: "var(--c-surface)",
              border: "1px solid var(--c-border)",
              color: "var(--c-text-2)",
            }}
          >
            <Bell size={15} />
            <span
              className="absolute top-[5px] right-[5px] w-[7px] h-[7px] rounded-full"
              style={{
                background: "#f87171",
                border: isDark
                  ? "1.5px solid #060d1e"
                  : "1.5px solid white",
              }}
            />
          </button>

          {/* Avatar */}
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, #5b8bff, #2d54e0)",
              boxShadow: "0 2px 14px rgba(79,124,255,0.45)",
            }}
            title={user?.full_name}
          >
            <span className="text-sm font-bold text-white">
              {user?.full_name?.[0]?.toUpperCase() || "U"}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden relative">
          <div className="animate-page-in">{children}</div>
        </main>

        {/* Mobile bottom tab bar */}
        {isMobile && (
          <nav
            className="flex items-stretch flex-shrink-0 z-10"
            style={{
              background: "rgba(5,10,24,0.92)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              paddingBottom: "env(safe-area-inset-bottom, 0)",
            }}
          >
            {MOBILE_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive =
                tab.path === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(tab.path);
              return (
                <button
                  key={tab.path}
                  onClick={() => navigate(tab.path)}
                  className="relative flex-1 flex flex-col items-center justify-center gap-[3px] py-2.5 transition-colors"
                  style={{
                    color: isActive ? "#5b8bff" : "rgba(255,255,255,0.32)",
                  }}
                >
                  {tab.path === "/warnings" && (
                    <span
                      className="absolute top-2 w-[7px] h-[7px] rounded-full"
                      style={{
                        left: "50%",
                        marginLeft: 6,
                        background: "#f87171",
                        border: "1.5px solid #050a18",
                      }}
                    />
                  )}
                  <Icon size={21} />
                  <span
                    className="text-[9px] tracking-[0.02em]"
                    style={{ fontWeight: isActive ? 700 : 400 }}
                  >
                    {tab.label}
                  </span>
                  {isActive && (
                    <span
                      className="absolute top-0 w-6 h-0.5 rounded-b"
                      style={{
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "#5b8bff",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
