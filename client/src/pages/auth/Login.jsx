import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  BarChart3, CheckCircle2, Eye, EyeOff, GraduationCap, Loader2, LockKeyhole, LogIn,
  Mail, ShieldAlert, ShieldCheck, Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import BrandLogo from '../../components/brand/BrandLogo.jsx';

/** Public sign-in: authenticates through the API and routes the user to its own dashboard. */
export default function Login() {
  const { t } = useTranslation();
  const { login, loginStudent, logout, isAuthenticated, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from || profile?.dashboardRoute || '/dashboard';
  const [mode, setMode] = useState('staff');
  const [email, setEmail] = useState('');
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const identifier = mode === 'student' ? studentId.trim() : email.trim();
    if (!identifier || !password) {
      setError({
        status: 0,
        message: mode === 'student'
          ? t('auth.needStudentId', { defaultValue: 'Enter your student ID and password.' })
          : t('auth.needBoth', { defaultValue: 'Enter your email and password.' }),
      });
      return;
    }
    setBusy(true);
    try {
      const signedIn = mode === 'student'
        ? await loginStudent(identifier, password, { remember })
        : await login(identifier, password, { remember });
      toast.success(t('auth.welcome', { defaultValue: 'Welcome back' }));
      // A deep link the tab was blocked on wins over the role's own dashboard,
      // so signing in from a new tab lands where the user actually meant to go.
      navigate(location.state?.from || signedIn?.dashboardRoute || from, { replace: true });
    } catch (err) {
      const status = err.status;
      if (status === 403) {
        setError({ status, message: err.message || t('auth.notActivated', { defaultValue: 'This account is not activated yet. Ask your school administrator to activate it.' }) });
      } else if (status === 401) {
        setError({ status, message: mode === 'student'
          ? t('auth.badStudentCredentials', { defaultValue: 'Invalid student ID or password. Your first password is your student ID.' })
          : t('auth.badCredentials', { defaultValue: 'Invalid email or password.' }) });
      } else if (status === 429) {
        setError({ status, message: t('auth.tooMany', { defaultValue: 'Too many attempts. Please wait a minute and try again.' }) });
      } else {
        setError({ status, message: err.message });
      }
    } finally { setBusy(false); }
  };

  /** Drops this browser's session so a different account can sign in here. */
  const switchAccount = async () => {
    await logout();
    setPassword('');
    setError(null);
  };

  return (
    <section className="login-page">
      <div className="login-card">
        <aside className="login-hero">
          <div className="login-hero-top">
            <BrandLogo tile className="login-hero-logo" />
            <div className="login-eyebrow">E-MADAARIS</div>
            <h2 className="login-hero-title">
              {t('login.heroTitle', { defaultValue: 'One secure workspace for your whole school.' })}
            </h2>
            <p className="login-hero-copy">
              {t('login.heroCopy', {
                defaultValue: 'Students, staff, parents, attendance, results and fees — connected in one tenant-isolated platform.',
              })}
            </p>
            <ul className="login-points">
              <li><ShieldCheck size={17} /> {t('login.pointIsolation', { defaultValue: 'Every school’s data stays fully separate' })}</li>
              <li><Users size={17} /> {t('login.pointPortals', { defaultValue: 'Portal accounts for staff, students and parents' })}</li>
              <li><BarChart3 size={17} /> {t('login.pointInsight', { defaultValue: 'Attendance, results and fees in one place' })}</li>
            </ul>
          </div>
          <div className="login-hero-foot">
            <CheckCircle2 size={15} />
            {t('login.heroFoot', { defaultValue: 'Safe sign-in · Role-aware access · Recoverable data' })}
          </div>
        </aside>

        <div className="login-panel">
          <div className="login-panel-head">
            <div className="login-badge">{t('login.secureBadge', { defaultValue: 'Secure sign-in' })}</div>
            <h1>{t('auth.loginTitle', { defaultValue: 'Welcome back' })}</h1>
            <p>{t('auth.loginSubtitle', { defaultValue: 'Sign in with the account your school created for you.' })}</p>
          </div>

          <div className="login-tabs" role="tablist" aria-label={t('auth.loginMode', { defaultValue: 'Sign-in type' })}>
            <button type="button" role="tab" aria-selected={mode === 'staff'}
              className={mode === 'staff' ? 'active' : ''}
              onClick={() => { setMode('staff'); setError(null); }}>
              <Mail size={15} /> {t('auth.modeStaff', { defaultValue: 'Staff & parents' })}
            </button>
            <button type="button" role="tab" aria-selected={mode === 'student'}
              className={mode === 'student' ? 'active' : ''}
              onClick={() => { setMode('student'); setError(null); }}>
              <GraduationCap size={16} /> {t('auth.modeStudent', { defaultValue: 'Student' })}
            </button>
          </div>

          {error ? (
            <div className={`login-alert ${error.status === 403 ? 'warn' : 'danger'}`} role="alert">
              <ShieldAlert size={17} className="flex-shrink-0" />
              <div className="small">
                <div>{error.message}</div>
                {error.status === 403 ? (
                  <div className="mt-1 opacity-75">
                    {t('auth.inactiveHint', { defaultValue: 'Ask your school administrator to activate the account — once it is active you can sign in here with the password they give you.' })}
                  </div>
                ) : null}
                {error.status === 401 ? (
                  <div className="mt-1 opacity-75">
                    {t('auth.forgotHint', { defaultValue: 'Forgot your password? Ask your school administrator — they can hand you a temporary password from the Users page.' })}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <form onSubmit={submit} noValidate className="login-form">
            {mode === 'staff' ? (
              <div className="login-field">
                <label className="form-label" htmlFor="l-email">{t('auth.email', { defaultValue: 'Email address' })}</label>
                <div className="login-input">
                  <Mail size={16} />
                  <input id="l-email" type="email" value={email} autoComplete="username"
                    onChange={(e) => setEmail(e.target.value)} placeholder="name@school.edu" required />
                </div>
              </div>
            ) : (
              <div className="login-field">
                <label className="form-label" htmlFor="l-student-id">{t('auth.studentId', { defaultValue: 'Student ID' })}</label>
                <div className="login-input">
                  <GraduationCap size={16} />
                  <input id="l-student-id" type="text" value={studentId} autoComplete="username"
                    onChange={(e) => setStudentId(e.target.value)} placeholder="e.g. AQ260001" required />
                </div>
                <div className="form-text small">
                  {t('auth.studentIdHint', { defaultValue: 'Use the ID printed on your student card. Your first password is the same ID; you can change it after signing in.' })}
                </div>
              </div>
            )}

            <div className="login-field">
              <label className="form-label" htmlFor="l-password">{t('auth.password', { defaultValue: 'Password' })}</label>
              <div className="login-input">
                <LockKeyhole size={16} />
                <input id="l-password" type={show ? 'text' : 'password'} value={password}
                  autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" className="reveal" onClick={() => setShow((s) => !s)}
                  aria-label={show ? t('login.hidePassword', { defaultValue: 'Hide password' }) : t('login.showPassword', { defaultValue: 'Show password' })}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <label className="login-remember">
              <input className="form-check-input" type="checkbox" checked={remember}
                onChange={(e) => setRemember(e.target.checked)} />
              <span>
                {t('auth.rememberMe', { defaultValue: 'Keep me signed in on this computer' })}
                <em>{t('auth.rememberMeHint', { defaultValue: 'Unchecked: only this tab stays signed in, so another tab can open a different account.' })}</em>
              </span>
            </label>

            <button type="submit" className="login-submit" disabled={busy}>
              {busy
                ? <><Loader2 size={17} className="animate-spin" /> {t('common.loading', { defaultValue: 'Signing in…' })}</>
                : <><LogIn size={17} /> {t('auth.signIn', { defaultValue: 'Sign in' })}</>}
            </button>
          </form>

          {isAuthenticated ? (
            <div className="login-alert info mt-3">
              <CheckCircle2 size={17} className="flex-shrink-0" />
              <div className="small">
                {t('auth.alreadySignedIn', { defaultValue: 'You are already signed in as' })} <b>{profile?.fullName || profile?.email}</b>{t('auth.inThisTab', { defaultValue: ' in this tab' })}.{' '}
                <Link to={location.state?.from || profile?.dashboardRoute || '/dashboard'} className="login-inline-link">
                  {t('public.openDashboard', { defaultValue: 'Open dashboard' })} →
                </Link>{' '}
                <button type="button" className="login-inline-link border-0 bg-transparent p-0" onClick={switchAccount}>
                  {t('auth.useAnotherAccount', { defaultValue: 'or sign in as another account' })}
                </button>
              </div>
            </div>
          ) : null}

          <div className="login-meta">
            {t('login.studentNote', { defaultValue: 'Students sign in with their Student ID; the first password is the same ID. Staff and parents use the email account their school created.' })}
          </div>

          <p className="login-terms">
            {t('login.termsNote', { defaultValue: 'By signing in you accept the' })}{' '}
            <Link to="/terms">{t('public.terms', { defaultValue: 'terms of service' })}</Link>{' '}
            {t('register.and', { defaultValue: 'and' })}{' '}
            <Link to="/privacy">{t('public.privacy', { defaultValue: 'privacy policy' })}</Link>.
          </p>
        </div>
      </div>
    </section>
  );
}
