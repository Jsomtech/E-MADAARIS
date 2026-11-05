import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, tokens } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(Boolean(tokens.access));
  const [error, setError] = useState(null);

  const loadSession = useCallback(async () => {
    if (!tokens.access) { setLoading(false); return null; }
    try {
      const { data } = await apiGet('/auth/me');
      setProfile(data);
      return data;
    } catch (e) {
      if (e.status === 401 || e.status === 403) { tokens.clear(); setProfile(null); }
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);

  useEffect(() => {
    const onSignedOut = () => setProfile(null);
    window.addEventListener('emadaaris:signed-out', onSignedOut);
    return () => window.removeEventListener('emadaaris:signed-out', onSignedOut);
  }, []);

  // A push token identifies the browser, not the person, so every sign-in moves this device onto the
  // account now holding the keyboard. Without it, a shared staff tablet keeps alerting the last user.
  useEffect(() => {
    if (!profile?.userId) return undefined;
    let alive = true;
    import('../services/push.js')
      .then((service) => { if (alive) service.resyncPushToken(); })
      .catch(() => {});
    return () => { alive = false; };
  }, [profile?.userId]);

  const login = useCallback(async (email, password, { remember = false } = {}) => {
    const { data } = await apiPost('/auth/login', { email, password });
    tokens.set(data.tokens, { remember });
    setProfile(data.profile);
    setError(null);
    return data.profile;
  }, []);

  const loginStudent = useCallback(async (studentId, password, { remember = false } = {}) => {
    const { data } = await apiPost('/auth/student-login', { student_id: studentId, password });
    tokens.set(data.tokens, { remember });
    setProfile(data.profile);
    setError(null);
    return data.profile;
  }, []);

  const adoptSession = useCallback(async ({ accessToken, refreshToken }) => {
    tokens.set({ accessToken, refreshToken }, { remember: true });
    const { data } = await apiGet('/auth/me');
    setProfile(data);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try { await apiPost('/auth/logout', {}); } catch { /* session is dropped regardless */ }
    tokens.clear();
    setProfile(null);
  }, []);

  const value = useMemo(() => {
    const permissions = new Set(profile?.permissions || []);
    return {
      profile,
      loading,
      error,
      isAuthenticated: Boolean(profile),
      login,
      loginStudent,
      logout,
      adoptSession,
      refresh: loadSession,
      can: (key) => permissions.has(key) || profile?.primaryRole === 'super_admin',
      canAny: (keys) => keys.some((k) => permissions.has(k)) || profile?.primaryRole === 'super_admin',
      hasRole: (role) => (profile?.roles || []).includes(role) || profile?.primaryRole === role,
    };
  }, [profile, loading, error, login, loginStudent, logout, adoptSession, loadSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
