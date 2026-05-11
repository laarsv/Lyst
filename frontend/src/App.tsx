import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '@/pages/Login';
import { ForgotPasswordPage } from '@/pages/ForgotPassword';
import { ResetPasswordPage } from '@/pages/ResetPassword';
import { AcceptInvitePage } from '@/pages/AcceptInvite';
import { DashboardPage } from '@/pages/Dashboard';
import { ListDetailPage } from '@/pages/ListDetail';
import { TemplatesPage } from '@/pages/Templates';
import { NotesPage } from '@/pages/Notes';
import { SettingsPage } from '@/pages/Settings';
import { PublicSharePage } from '@/pages/PublicShare';
import { AdminUsersPage } from '@/pages/admin/AdminUsers';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { ToastHost } from '@/components/Toast';
import { OfflineBadge } from '@/components/OfflineBadge';
import { InstallPrompt } from '@/components/InstallPrompt';
import { AuthBootstrap } from '@/components/AuthBootstrap';

export default function App() {
  return (
    <AuthBootstrap>
      <ToastHost />
      <OfflineBadge />
      <InstallPrompt />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/s/:token" element={<PublicSharePage />} />

        <Route
          element={
            <RequireAuth role="user">
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/lists/:id" element={<ListDetailPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        <Route
          element={
            <RequireAuth role="admin">
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/admin" element={<AdminUsersPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthBootstrap>
  );
}
