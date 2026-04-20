import { create } from "zustand";
import { authAPI, rbacAPI } from "../api";

export const useAuthStore = create((set, get) => ({
  user: null,
  menus: [],
  loading: true,

  init: async () => {
    const token = localStorage.getItem("knmp_token");
    if (!token) {
      set({ loading: false });
      return;
    }
    try {
      const [{ data: user }, { data: menus }] = await Promise.all([
        authAPI.me(),
        rbacAPI.myMenus(),
      ]);
      set({ user, menus, loading: false });
    } catch {
      localStorage.clear();
      set({ user: null, menus: [], loading: false });
    }
  },

  login: async (email, password) => {
    const { data } = await authAPI.login(email, password);
    localStorage.setItem("knmp_token", data.access_token);
    localStorage.setItem("knmp_refresh", data.refresh_token);
    const { data: menus } = await rbacAPI.myMenus();
    set({ user: data.user, menus });
  },

  logout: () => {
    localStorage.clear();
    set({ user: null, menus: [] });
    window.location.href = "/login";
  },

  hasPermission: (code) => {
    const u = get().user;
    if (!u) return false;
    if (u.role?.code === "superadmin") return true;
    return (u.permissions || []).includes(code);
  },
}));
