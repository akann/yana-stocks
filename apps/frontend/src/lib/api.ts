import axios from 'axios';

// Always same-origin — the BFF (this app's own /api/[...path] route handler)
// attaches Authorization from the httpOnly access_token cookie and retries
// once transparently on a 401 server-side, so no client-side token handling
// or retry logic is needed here anymore.
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (error: unknown) => {
    // The BFF already attempted a refresh server-side — a 401 reaching here
    // means genuinely logged out.
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      typeof window !== 'undefined'
    ) {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
