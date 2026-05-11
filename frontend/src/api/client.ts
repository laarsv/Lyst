import axios, { AxiosError, type AxiosInstance } from 'axios';
import { useAuthStore } from '@/store/auth';

const API_BASE = '/api';

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const r = await axios.post<{ data: { access_token: string }; error: string | null }>(
        `${API_BASE}/auth/refresh`,
        {},
        { withCredentials: true },
      );
      const token = r.data.data?.access_token ?? null;
      if (token) useAuthStore.getState().setAccessToken(token);
      return token;
    } catch {
      useAuthStore.getState().clear();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const cfg: any = error.config;
    if (
      error.response?.status === 401 &&
      cfg &&
      !cfg._retry &&
      !cfg.url?.includes('/auth/login') &&
      !cfg.url?.includes('/auth/refresh')
    ) {
      cfg._retry = true;
      const token = await tryRefresh();
      if (token) {
        cfg.headers = cfg.headers ?? {};
        cfg.headers.Authorization = `Bearer ${token}`;
        return api.request(cfg);
      }
    }
    return Promise.reject(error);
  },
);

export function getApiError(e: unknown, fallback = 'Etwas ist schiefgelaufen'): string {
  if (axios.isAxiosError(e)) {
    const detail = e.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    const err = e.response?.data?.error;
    if (typeof err === 'string') return err;
    return e.message || fallback;
  }
  return fallback;
}
