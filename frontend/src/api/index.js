import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("knmp_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      const rt = localStorage.getItem("knmp_refresh");
      if (rt) {
        original._retry = true;
        try {
          const { data } = await axios.post(
            (import.meta.env.VITE_API_URL || "/api") + "/auth/refresh",
            { refresh_token: rt }
          );
          localStorage.setItem("knmp_token", data.access_token);
          localStorage.setItem("knmp_refresh", data.refresh_token);
          original.headers.Authorization = `Bearer ${data.access_token}`;
          return api(original);
        } catch {
          localStorage.clear();
          window.location.href = "/login";
        }
      } else {
        localStorage.clear();
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

// ─── Endpoints ───────────────────────────────────────────────────────────────
export const authAPI = {
  login: (email, password) => api.post("/auth/login", { email, password }),
  me: () => api.get("/auth/me"),
  changePassword: (current_password, new_password) =>
    api.post("/auth/change-password", { current_password, new_password }),
};

export const rbacAPI = {
  permissions: () => api.get("/rbac/permissions"),
  menus: () => api.get("/rbac/menus"),
  myMenus: () => api.get("/rbac/my-menus"),
  roles: () => api.get("/rbac/roles"),
  role: (id) => api.get(`/rbac/roles/${id}`),
  createRole: (data) => api.post("/rbac/roles", data),
  updateRole: (id, data) => api.put(`/rbac/roles/${id}`, data),
  deleteRole: (id) => api.delete(`/rbac/roles/${id}`),
};

export const usersAPI = {
  list: (params) => api.get("/users", { params }),
  get: (id) => api.get(`/users/${id}`),
  create: (data) => api.post("/users", data),
  update: (id, data) => api.put(`/users/${id}`, data),
  remove: (id) => api.delete(`/users/${id}`),
  resetPassword: (id, new_password) =>
    api.post(`/users/${id}/reset-password`, { new_password }),
};

export const masterAPI = {
  companies: (params) => api.get("/master/companies", { params }),
  createCompany: (data) => api.post("/master/companies", data),
  updateCompany: (id, data) => api.put(`/master/companies/${id}`, data),
  deleteCompany: (id) => api.delete(`/master/companies/${id}`),
  ppk: (params) => api.get("/master/ppk", { params }),
  createPPK: (data) => api.post("/master/ppk", data),
  updatePPK: (id, data) => api.put(`/master/ppk/${id}`, data),
  deletePPK: (id) => api.delete(`/master/ppk/${id}`),
  workCodes: (params) => api.get("/master/work-codes", { params }),
  createWorkCode: (data) => api.post("/master/work-codes", data),
  updateWorkCode: (code, data) => api.put(`/master/work-codes/${code}`, data),
  deleteWorkCode: (code) => api.delete(`/master/work-codes/${code}`),
  workCodeTemplate: () =>
    api.get("/master/work-codes/template", { responseType: "blob" }),
  importWorkCodes: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/master/work-codes/import-excel", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  // Tahap 2: Master facilities (catalog)
  facilities: (params) => api.get("/master/facilities", { params }),
  createFacility: (data) => api.post("/master/facilities", data),
  updateFacility: (id, data) => api.put(`/master/facilities/${id}`, data),
  deleteFacility: (id) => api.delete(`/master/facilities/${id}`),
};

export const contractsAPI = {
  list: (params) => api.get("/contracts", { params }),
  get: (id) => api.get(`/contracts/${id}`),
  create: (data) => api.post("/contracts", data),
  update: (id, data) => api.put(`/contracts/${id}`, data),
  remove: (id) => api.delete(`/contracts/${id}`),
  listAddenda: (id) => api.get(`/contracts/${id}/addenda`),
  createAddendum: (id, data) => api.post(`/contracts/${id}/addenda`, data),
  deleteAddendum: (cId, aId) => api.delete(`/contracts/${cId}/addenda/${aId}`),

  // Tahap 2: activation / lifecycle
  readiness: (id) => api.get(`/contracts/${id}/readiness`),
  activate: (id) => api.post(`/contracts/${id}/activate`),
  complete: (id) => api.post(`/contracts/${id}/complete`),

  // Unlock Mode (safety valve superadmin)
  unlock: (id, reason, duration_minutes = 30) =>
    api.post(`/contracts/${id}/unlock`, { reason, duration_minutes }),
  lock: (id) => api.post(`/contracts/${id}/lock`),
  syncStatus: (id) => api.get(`/contracts/${id}/sync-status`),
};

export const locationsAPI = {
  listByContract: (cid) => api.get(`/locations/by-contract/${cid}`),
  create: (cid, data) => api.post(`/locations/by-contract/${cid}`, data),
  bulk: (cid, items) => api.post(`/locations/by-contract/${cid}/bulk`, items),
  importExcel: (cid, file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/locations/by-contract/${cid}/import-excel`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  update: (id, data) => api.put(`/locations/${id}`, data),
  remove: (id) => api.delete(`/locations/${id}`),
};

export const facilitiesAPI = {
  listByLocation: (lid) => api.get(`/facilities/by-location/${lid}`),
  create: (data) => api.post("/facilities", data),
  bulk: (location_id, facilities) =>
    api.post("/facilities/bulk", { location_id, facilities }),
  importExcel: (lid, file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/facilities/by-location/${lid}/import-excel`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  update: (id, data) => api.put(`/facilities/${id}`, data),
  remove: (id) => api.delete(`/facilities/${id}`),
};

export const boqAPI = {
  listByFacility: (fid, params) =>
    api.get(`/boq/by-facility/${fid}`, { params }),
  listByContractFlat: (cid, leafOnly = true) =>
    api.get(`/boq/by-contract/${cid}/flat`, { params: { leaf_only: leafOnly } }),
  create: (data) => api.post("/boq", data),
  bulk: (items) => api.post("/boq/bulk", items),
  update: (id, data) => api.put(`/boq/${id}`, data),
  remove: (id) => api.delete(`/boq/${id}`),
  template: () =>
    api.get("/boq/template/download", { responseType: "blob" }),
  previewExcel: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/boq/preview-excel", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  importExcel: (locationId, file, params = {}) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/boq/import-excel/${locationId}`, form, {
      headers: { "Content-Type": "multipart/form-data" },
      params,
    });
  },

  // Tahap 2: BOQ revisions (CCO)
  listRevisions: (contractId) =>
    api.get(`/boq/revisions/by-contract/${contractId}`),
  approveRevision: (revisionId) =>
    api.post(`/boq/revisions/${revisionId}/approve`),
  diffRevision: (revisionId) =>
    api.get(`/boq/revisions/${revisionId}/diff`),

  // Tahap 2: Location-level rollup (catatan #9)
  locationRollup: (locationId, revisionId) =>
    api.get(`/boq/by-location/${locationId}/rollup`, {
      params: revisionId ? { revision_id: revisionId } : {},
    }),
};

export const weeklyAPI = {
  listByContract: (cid) => api.get(`/reports/weekly/by-contract/${cid}`),
  get: (id) => api.get(`/reports/weekly/${id}`),
  create: (cid, data) => api.post(`/reports/weekly/by-contract/${cid}`, data),
  update: (id, data) => api.put(`/reports/weekly/${id}`, data),
  remove: (id) => api.delete(`/reports/weekly/${id}`),
  upsertProgress: (id, items) =>
    api.put(`/reports/weekly/${id}/progress-items`, items),
  uploadPhoto: (id, file, caption, facilityId) => {
    const form = new FormData();
    form.append("file", file);
    if (caption) form.append("caption", caption);
    if (facilityId) form.append("facility_id", facilityId);
    return api.post(`/reports/weekly/${id}/photos`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deletePhoto: (id, photoId) =>
    api.delete(`/reports/weekly/${id}/photos/${photoId}`),
  template: (cid) =>
    api.get(`/reports/weekly/template/${cid}`, { responseType: "blob" }),
  exportExcel: (id) =>
    api.get(`/reports/weekly/${id}/export-excel`, { responseType: "blob" }),
  importExcel: (id, file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/reports/weekly/${id}/import-excel`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};

export const dailyAPI = {
  listByContract: (cid, params) =>
    api.get(`/reports/daily/by-contract/${cid}`, { params }),
  get: (id) => api.get(`/reports/daily/${id}`),
  create: (data) => api.post("/reports/daily", data),
  update: (id, data) => api.put(`/reports/daily/${id}`, data),
  remove: (id) => api.delete(`/reports/daily/${id}`),
  uploadPhoto: (id, file, caption) => {
    const form = new FormData();
    form.append("file", file);
    if (caption) form.append("caption", caption);
    return api.post(`/reports/daily/${id}/photos`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deletePhoto: (id, pid) => api.delete(`/reports/daily/${id}/photos/${pid}`),
};

export const paymentsAPI = {
  listByContract: (cid) => api.get(`/payments/by-contract/${cid}`),
  get: (id) => api.get(`/payments/${id}`),
  create: (cid, data) => api.post(`/payments/by-contract/${cid}`, data),
  update: (id, data) => api.put(`/payments/${id}`, data),
  remove: (id) => api.delete(`/payments/${id}`),
  uploadDoc: (id, file, doc_type, caption) => {
    const form = new FormData();
    form.append("file", file);
    form.append("doc_type", doc_type || "invoice");
    if (caption) form.append("caption", caption);
    return api.post(`/payments/${id}/documents`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deleteDoc: (id, did) => api.delete(`/payments/${id}/documents/${did}`),
};

export const reviewsAPI = {
  listByContract: (cid) => api.get(`/reviews/by-contract/${cid}`),
  get: (id) => api.get(`/reviews/${id}`),
  create: (data) => api.post("/reviews", data),
  update: (id, data) => api.put(`/reviews/${id}`, data),
  remove: (id) => api.delete(`/reviews/${id}`),
  createFinding: (reviewId, data) =>
    api.post(`/reviews/${reviewId}/findings`, data),
  updateFinding: (fid, data) => api.put(`/reviews/findings/${fid}`, data),
  deleteFinding: (fid) => api.delete(`/reviews/findings/${fid}`),
  uploadFindingPhoto: (fid, file, caption) => {
    const form = new FormData();
    form.append("file", file);
    if (caption) form.append("caption", caption);
    return api.post(`/reviews/findings/${fid}/photos`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deleteFindingPhoto: (fid, pid) =>
    api.delete(`/reviews/findings/${fid}/photos/${pid}`),
};

export const notificationsAPI = {
  rules: () => api.get("/notifications/rules"),
  createRule: (data) => api.post("/notifications/rules", data),
  updateRule: (id, data) => api.put(`/notifications/rules/${id}`, data),
  deleteRule: (id) => api.delete(`/notifications/rules/${id}`),
  queue: (params) => api.get("/notifications/queue", { params }),
  processQueue: () => api.post("/notifications/process"),
  runChecks: () => api.post("/notifications/run-checks"),
  testSend: (phone, message) =>
    api.post("/notifications/test-send", { phone, message }),
  warnings: (params) => api.get("/notifications/warnings", { params }),
  resolveWarning: (id) => api.post(`/notifications/warnings/${id}/resolve`),
};

export const analyticsAPI = {
  dashboard: () => api.get("/analytics/dashboard"),
  contractsSummary: () => api.get("/analytics/contracts-summary"),
  scurve: (cid) => api.get(`/analytics/scurve/${cid}`),
  mapLocations: () => api.get("/analytics/map-locations"),
  facilityPhotos: (fid) => api.get(`/analytics/facility-photos/${fid}`),
  facilityProgress: (fid) => api.get(`/analytics/facility-progress/${fid}`),
};

export const templatesAPI = {
  boq: () => api.get("/templates/boq", { responseType: "blob" }),
  facilities: () => api.get("/templates/facilities", { responseType: "blob" }),
  locations: () => api.get("/templates/locations", { responseType: "blob" }),
};

export const auditAPI = {
  list: (params) => api.get("/audit/logs", { params }),
  facets: () => api.get("/audit/facets"),
};

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default api;
