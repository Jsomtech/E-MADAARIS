import axios from 'axios';

const ACCESS_KEY = 'emadaaris.accessToken';
const REFRESH_KEY = 'emadaaris.refreshToken';

export const tokens = {
  get access() { return localStorage.getItem(ACCESS_KEY); },
  get refresh() { return localStorage.getItem(REFRESH_KEY); },
  set({ accessToken, refreshToken }) {
    if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear() { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(REFRESH_KEY); },
};

export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

// The hosted Supabase project occasionally answers a roster query in 10–20 s; a 20 s ceiling
// turned normal latency into a hard "Request failed" screen.
export const http = axios.create({ baseURL: API_BASE, timeout: 45000 });

http.interceptors.request.use((config) => {
  const token = tokens.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Session refresh happens once per burst of 401s, then the original request is retried.
let refreshing = null;

async function refreshSession() {
  const refresh = tokens.refresh;
  if (!refresh) throw new Error('no refresh token');
  refreshing = refreshing || axios.post(`${API_BASE}/auth/refresh`, { refreshToken: refresh })
    .then((res) => { tokens.set(res.data.data.tokens); return res.data.data; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

http.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { response, config } = error;
    if (response?.status === 401 && !config?._retry && tokens.refresh) {
      config._retry = true;
      try {
        await refreshSession();
        return http(config);
      } catch {
        tokens.clear();
        window.dispatchEvent(new CustomEvent('emadaaris:signed-out'));
      }
    }
    return Promise.reject(error);
  },
);

/** Unwraps the API envelope: every endpoint answers { data } or { data, total, page } */
export async function api(method, path, body, params) {
  try {
    const res = await http({ method, url: path, data: body, params });
    return res.data;
  } catch (error) {
    const payload = error.response?.data;
    const message = payload?.error || error.message || 'Network error';
    const err = new Error(message);
    err.status = error.response?.status;
    err.details = payload?.details;
    throw err;
  }
}

export const apiGet = (p, params) => api('get', p, undefined, params);
export const apiPost = (p, body) => api('post', p, body);
export const apiPatch = (p, body) => api('patch', p, body);
export const apiPut = (p, body) => api('put', p, body);
export const apiDelete = (p) => api('delete', p);

/** Multipart POST (axios sets the boundary when the body is FormData). */
export const apiUpload = (p, formData, onUploadProgress) => http.post(p, formData, { onUploadProgress })
  .then((res) => res.data)
  .catch((error) => {
    const payload = error.response?.data;
    const err = new Error(payload?.error || error.message || 'Upload failed');
    err.status = error.response?.status;
    err.details = payload?.details;
    throw err;
  });

/** Authenticated file download — a plain <a href> would miss the bearer token. */
export async function downloadFile(path, filename) {
  const res = await http.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || path.split('/').pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
