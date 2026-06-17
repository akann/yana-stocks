import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3004/api';

export const api = axios.create({
  baseURL: API_BASE,
});

let isRefreshing = false;
type FailedRequest = { resolve: (token: string) => void; reject: (err: unknown) => void };
let failedQueue: FailedRequest[] = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
}

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = sessionStorage.getItem('access_token');
    if (token) config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const original = error.config as typeof error.config & { _retry?: boolean };
    if (error.response?.status !== 401 || original?._retry) return Promise.reject(error);

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        if (original) original.headers['Authorization'] = `Bearer ${token}`;
        return api(original!);
      });
    }

    if (original) original._retry = true;
    isRefreshing = true;

    const refreshToken =
      typeof window !== 'undefined' ? sessionStorage.getItem('refresh_token') : null;
    if (!refreshToken) {
      isRefreshing = false;
      if (typeof window !== 'undefined') window.location.href = '/login';
      return Promise.reject(error);
    }

    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) throw new Error('Refresh failed');

      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      sessionStorage.setItem('access_token', data.accessToken);
      sessionStorage.setItem('refresh_token', data.refreshToken);

      processQueue(null, data.accessToken);
      if (original) original.headers['Authorization'] = `Bearer ${data.accessToken}`;
      return api(original!);
    } catch (err) {
      processQueue(err, null);
      sessionStorage.removeItem('access_token');
      sessionStorage.removeItem('refresh_token');
      if (typeof window !== 'undefined') window.location.href = '/login';
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);
