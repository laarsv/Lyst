import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { consumeStartRedirect } from '@/store/startPage';
import { LoginPage } from '@/pages/Login';
import { ForgotPasswordPage } from '@/pages/ForgotPassword';
import { ResetPasswordPage } from '@/pages/ResetPassword';
import { AcceptInvitePage } from '@/pages/AcceptInvite';
import { DashboardPage } from '@/pages/Dashboard';
import { TodayPage } from '@/pages/Today';
import { ListDetailPage } from '@/pages/ListDetail';
import { NotesPage } from '@/pages/Notes';
import { RecipesPage } from '@/pages/Recipes';
import { RecipeDetailPage } from '@/pages/RecipeDetail';
import { RecipeEditPage } from '@/pages/RecipeEdit';
import { PlantsPage } from '@/pages/Plants';
import { PlantDetailPage } from '@/pages/PlantDetail';
import { PlantEditPage } from '@/pages/PlantEdit';
import { FitnessPage } from '@/pages/Fitness';
import { ExerciseLibraryPage } from '@/pages/ExerciseLibrary';
import { ExerciseDetailPage } from '@/pages/ExerciseDetail';
import { ExerciseEditPage } from '@/pages/ExerciseEdit';
import { WorkoutDetailPage } from '@/pages/WorkoutDetail';
import { WorkoutEditPage } from '@/pages/WorkoutEdit';
import { SessionLogPage } from '@/pages/SessionLog';
import { MealPlannerPage } from '@/pages/MealPlanner';
import { TasksPage } from '@/pages/Tasks';
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

/**
 * `/` is the Listen view. On a FRESH app start we honour the user's chosen
 * start page instead (see store/startPage.ts) — the flag is consumed once per
 * session, so clicking "Listen" in the nav afterwards works normally.
 * useState's initialiser makes sure we consume the flag exactly once, not on
 * every re-render.
 */
function StartGate() {
  const [dest] = useState(consumeStartRedirect);
  if (dest) return <Navigate to={dest} replace />;
  return <DashboardPage />;
}

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
          <Route path="/" element={<StartGate />} />
          <Route path="/heute" element={<TodayPage />} />
          <Route path="/lists/:id" element={<ListDetailPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/recipes/new" element={<RecipeEditPage />} />
          <Route path="/recipes/:id" element={<RecipeDetailPage />} />
          <Route path="/recipes/:id/edit" element={<RecipeEditPage />} />
          <Route path="/plants" element={<PlantsPage />} />
          <Route path="/plants/new" element={<PlantEditPage />} />
          <Route path="/plants/:id" element={<PlantDetailPage />} />
          <Route path="/plants/:id/edit" element={<PlantEditPage />} />
          <Route path="/fitness" element={<FitnessPage />} />
          <Route path="/fitness/exercises" element={<ExerciseLibraryPage />} />
          <Route path="/fitness/exercises/new" element={<ExerciseEditPage />} />
          <Route path="/fitness/exercises/:id" element={<ExerciseDetailPage />} />
          <Route path="/fitness/exercises/:id/edit" element={<ExerciseEditPage />} />
          <Route path="/fitness/workouts/new" element={<WorkoutEditPage />} />
          <Route path="/fitness/workouts/:id" element={<WorkoutDetailPage />} />
          <Route path="/fitness/workouts/:id/edit" element={<WorkoutEditPage />} />
          <Route path="/fitness/session/:id" element={<SessionLogPage />} />
          <Route path="/meal-planner" element={<MealPlannerPage />} />
          <Route path="/tasks" element={<TasksPage />} />
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
