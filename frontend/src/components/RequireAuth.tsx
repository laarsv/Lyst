import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/store/auth';
import type { Role } from '@/types';

interface Props {
  children: ReactNode;
  role?: Role;
}

export function RequireAuth({ children, role }: Props) {
  const { accessToken, role: actual } = useAuthStore();
  const loc = useLocation();
  if (!accessToken) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (role && actual !== role) {
    return <Navigate to={actual === 'admin' ? '/admin' : '/'} replace />;
  }
  return <>{children}</>;
}
