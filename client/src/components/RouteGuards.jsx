import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from './ui/Basics.jsx';

function redirectAfterAuth(profile) {
  return profile?.dashboardRoute || '/login';
}

/** Blocks the app until the session is resolved; sends anonymous users to /login. */
export function RequireAuth({ children }) {
  const { profile, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-5"><Spinner label="Loading session" /></div>;
  if (!profile) {
    // The query string travels with the path: a notification tapped on a locked screen arrives as
    // /notifications?open=<id>, and signing in has to land on that message rather than on the list.
    return <Navigate to="/login" state={{ from: `${location.pathname}${location.search}` }} replace />;
  }
  return children;
}

/** Platform staff only (Super Admin / Platform Support). */
export function RequirePlatform({ children }) {
  const { profile } = useAuth();
  if (profile?.type !== 'platform') return <Navigate to={redirectAfterAuth(profile)} replace />;
  return children;
}

/** School tenant users only. */
export function RequireSchool({ children }) {
  const { profile } = useAuth();
  if (profile?.type !== 'school') return <Navigate to={redirectAfterAuth(profile)} replace />;
  return children;
}

/** Requires at least one of these permission keys. */
export function RequirePermission({ keys = [], children }) {
  const { profile, canAny } = useAuth();
  const isPlatform = profile?.type === 'platform';
  if (!isPlatform && keys.length && !canAny(keys)) return <Navigate to={redirectAfterAuth(profile)} replace />;
  return children;
}

/** Signed-in users never see the public login screens twice. */
export function RedirectIfAuthed({ children }) {
  const { profile, loading } = useAuth();
  if (!loading && profile) return <Navigate to={redirectAfterAuth(profile)} replace />;
  return children;
}
