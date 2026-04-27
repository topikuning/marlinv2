import { create } from "zustand";

const STORAGE_THEME = "marlin-theme";
const STORAGE_SIDEBAR = "marlin-sidebar-collapsed";

// Read initial values from localStorage so first paint matches user pref
function initialTheme() {
  try {
    const v = localStorage.getItem(STORAGE_THEME);
    return v === "dark" ? "dark" : "light"; // default light (preserve existing pages)
  } catch {
    return "light";
  }
}

function initialCollapsed() {
  try {
    return localStorage.getItem(STORAGE_SIDEBAR) === "1";
  } catch {
    return false;
  }
}

// Apply class to <body> so CSS custom properties switch globally
function applyBodyClass(theme) {
  if (typeof document === "undefined") return;
  document.body.classList.remove("light", "dark");
  document.body.classList.add(theme);
}

export const useThemeStore = create((set, get) => ({
  theme: initialTheme(),
  sidebarCollapsed: initialCollapsed(),

  // Hydrate body class on app boot (call once from App.jsx)
  init: () => {
    applyBodyClass(get().theme);
  },

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    applyBodyClass(next);
    try {
      localStorage.setItem(STORAGE_THEME, next);
    } catch {
      /* ignore quota / private mode */
    }
    set({ theme: next });
  },

  setTheme: (theme) => {
    if (theme !== "dark" && theme !== "light") return;
    applyBodyClass(theme);
    try {
      localStorage.setItem(STORAGE_THEME, theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    try {
      localStorage.setItem(STORAGE_SIDEBAR, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ sidebarCollapsed: next });
  },

  setSidebarCollapsed: (v) => {
    try {
      localStorage.setItem(STORAGE_SIDEBAR, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ sidebarCollapsed: !!v });
  },
}));
