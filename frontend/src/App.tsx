import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '@/pages/Login';
import { ForgotPasswordPage } from '@/pages/ForgotPassword';
import { ResetPasswordPage } from '@/pages/ResetPassword';
import { AcceptInvitePage } from '@/pages/AcceptInvite';
import { DashboardPage } from '@/pages/Dashboard';
import { ListDetailPage } from '@/pages/ListDetail';
import { NotesPage } from '@/pages/Notes';
import { RecipesPage } from '@/pages/Recipes';
import { RecipeDetailPage } from '@/pages/RecipeDetail';
import { RecipeEditPage } from '@/pages/RecipeEdit';
import { MealPlannerPage } from '@/pages/MealPlanner';
import { SettingsPage } from '@/pages/Settings';
import { PublicSharePage } from '@/pages/PublicShare';
import { PublicRecipePage } from '@/pages/PublicRecipe';
import { PublicRecipeBookPage } from '@/pages/PublicRecipeBook';
import { PublicNotePage } from '@/pages/PublicNote';
import { AdminUsersPage } from '@/pages/admin/AdminUsers';
import { AdminSettingsPage } from '@/pages/admin/AdminSettings';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { ToastHost } from '@/components/Toast';
import { InstallPrompt } from '@/components/InstallPrompt';
import { AuthBootstrap } from '@/components/AuthBootstrap';
import { DialogProvider } from '@/components/Dialogs';

export default function App() {
  return (
    <AuthBootstrap>
      <DialogProvider>
      <ToastHost />
      <InstallPrompt />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/s/:token" element={<PublicSharePage />} />
        <Route path="/share/recipe/:token" element={<PublicRecipePage />} />
        <Route path="/share/recipe-book/:token" element={<PublicRecipeBookPage />} />
        <Route path="/share/note/:token" element={<PublicNotePage />} />

        <Route
          element={
            <RequireAuth role="user">
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/lists/:id" element={<ListDetailPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/recipes/new" element={<RecipeEditPage />} />
          <Route path="/recipes/:id" element={<RecipeDetailPage />} />
          <Route path="/recipes/:id/edit" element={<RecipeEditPage />} />
          <Route path="/meal-planner" element={<MealPlannerPage />} />
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
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </DialogProvider>
    </AuthBootstrap>
  );
}
