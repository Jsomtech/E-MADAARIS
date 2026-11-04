import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client.js';

/** GET a resource with server-side params; refetches when params change. */
export function useApi(path, params, enabled = true) {
  const [state, setState] = useState({ data: null, total: null, loading: enabled, error: null });
  const fingerprint = JSON.stringify(params || {});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!enabled || !path) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const body = await apiGet(path, params || undefined);
      if (mounted.current) setState({ data: body.data, total: body.total ?? null, page: body.page, loading: false, error: null });
    } catch (error) {
      if (mounted.current) setState({ data: null, total: null, loading: false, error });
    }
  }, [path, fingerprint, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  return { ...state, refetch: load, reload: load };
}

/** One-shot mutations keep the button state honest without a global store. */
export function useAction(fn) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (...args) => {
    setBusy(true);
    try { return await fn(...args); } finally { setBusy(false); }
  }, [fn]);
  return { run, busy };
}

export const httpMethods = { get: apiGet, post: apiPost, patch: apiPatch, delete: apiDelete };
