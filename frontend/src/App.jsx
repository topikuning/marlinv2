import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { PageLoader } from "@/components/ui";
import AppShell from "@/components/layout/AppShell";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import ContractsPage from "@/pages/ContractsPage";
import ContractDetailPage from "@/pages/ContractDetailPage";
import WeeklyReportsPage from "@/pages/WeeklyReportsPage";
import WeeklyReportDetailPage from "@/pages/WeeklyReportDetailPage";
import DailyReportsPage from "@/pages/DailyReportsPage";
import ScurvePage from "@/pages/ScurvePage";
import PaymentsPage from "@/pages/PaymentsPage";
import ReviewsPage from "@/pages/ReviewsPage";
import WarningsPage from "@/pages/WarningsPage";
import { CompaniesPage, PPKPage, WorkCodesPage } from "@/pages/MasterPages";
import UsersPage from "@/pages/UsersPage";
import RolesPage from "@/pages/RolesPage";
import NotificationsPage from "@/pages/NotificationsPage";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  const { init, loading } = useAuthStore();
  useEffect(() => {
    init();
  }, []);

  if (loading) return <PageLoader />;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/contracts" element={<ProtectedRoute><ContractsPage /></ProtectedRoute>} />
      <Route path="/contracts/:id" element={<ProtectedRoute><ContractDetailPage /></ProtectedRoute>} />
      <Route path="/reports/weekly" element={<ProtectedRoute><WeeklyReportsPage /></ProtectedRoute>} />
      <Route path="/reports/weekly/:id" element={<ProtectedRoute><WeeklyReportDetailPage /></ProtectedRoute>} />
      <Route path="/reports/daily" element={<ProtectedRoute><DailyReportsPage /></ProtectedRoute>} />
      <Route path="/scurve" element={<ProtectedRoute><ScurvePage /></ProtectedRoute>} />
      <Route path="/payments" element={<ProtectedRoute><PaymentsPage /></ProtectedRoute>} />
      <Route path="/reviews" element={<ProtectedRoute><ReviewsPage /></ProtectedRoute>} />
      <Route path="/warnings" element={<ProtectedRoute><WarningsPage /></ProtectedRoute>} />
      <Route path="/master/companies" element={<ProtectedRoute><CompaniesPage /></ProtectedRoute>} />
      <Route path="/master/ppk" element={<ProtectedRoute><PPKPage /></ProtectedRoute>} />
      <Route path="/master/work-codes" element={<ProtectedRoute><WorkCodesPage /></ProtectedRoute>} />
      <Route path="/admin/users" element={<ProtectedRoute><UsersPage /></ProtectedRoute>} />
      <Route path="/admin/roles" element={<ProtectedRoute><RolesPage /></ProtectedRoute>} />
      <Route path="/admin/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
