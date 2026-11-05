import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { KeyRound, Mail, ShieldCheck, Ticket, ArrowLeft, UserPlus } from 'lucide-react';
import { apiPost } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Spinner } from '../../components/ui/Basics.jsx';

const BRAND = '#6027ff';

/** Invitation acceptance: redeems the emailed token, adopts the session and captures a password. */
export default function AcceptInvite() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { adoptSession, profile } = useAuth();

  const token = (params.get('token') || '').trim();
  const [manual, setManual] = useState('');
  const [phase, setPhase] = useState(token ? 'verifying' : 'need-token');
  const [message, setMessage] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const redeemed = useRef('');

  /* Step 1 — the backend redeems the GoTrue invite token and hands us a session. */
  useEffect(() => {
    if (!token || redeemed.current === token) return;
    redeemed.current = token;
    setPhase('verifying');
    setMessage(null);
    // Not cancelled on cleanup, because StrictMode runs this effect twice in development and the
    // second run skips the work — cancelling would leave the page turning "Checking your invitation…"
    // forever. The redeemed guard keeps the redemption itself to a single call.
    apiPost('/auth/verify-invitation', { token })
      .then(async ({ data }) => {
        await adoptSession(data.tokens);
        setPhase('set-password');
      })
      .catch((error) => {
        redeemed.current = '';
        setPhase('invalid-token');
        setMessage(error.message);
      });
  }, [token, adoptSession]);

  const useManualToken = (e) => {
    e.preventDefault();
    const value = manual.trim();
    if (value.length < 10) {
      setMessage(t('invite.errToken', { defaultValue: 'Paste the full invitation token from the link.' }));
      return;
    }
    setParams({ token: value });
  };

  /* Step 2 — invited accounts have no password yet, so capture one before the dashboard. */
  const setPasswordNow = async (e) => {
    e.preventDefault();
    const errs = {};
    if (password.length < 8) errs.password = t('invite.errShort', { defaultValue: 'At least 8 characters.' });
    if (password.length > 128) errs.password = t('invite.errLong', { defaultValue: 'Maximum 128 characters.' });
    if (password !== confirm) errs.confirm = t('invite.errMatch', { defaultValue: 'The two passwords do not match.' });
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await apiPost('/auth/update-password', { password });
      toast.success(t('invite.passwordSet', { defaultValue: 'Password saved. Welcome to E-MADAARIS.' }));
      setPhase('done');
      setTimeout(() => navigate(profile?.dashboardRoute || '/dashboard', { replace: true }), 900);
    } catch (error) {
      setMessage(error.message);
      toast.error(error.message);
    } finally { setSaving(false); }
  };

  const route = profile?.dashboardRoute || '/dashboard';

  return (
    <section className="public-section">
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-12 col-md-8 col-lg-6 col-xl-5">
            <div className="card-soft p-4 p-lg-5">
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="stat-icon" style={{ background: BRAND, color: '#fff' }}><UserPlus size={18} /></span>
                <div className="fw-bold" style={{ color: '#130c2d' }}>{t('auth.acceptInvite')}</div>
              </div>

              {/* ── token needed / token rejected ── */}
              {phase === 'need-token' || phase === 'invalid-token' ? (
                <>
                  <h1 className="h5 fw-bold mb-2">{t('invite.title', { defaultValue: 'Activate your account' })}</h1>
                  <p className="small text-muted">
                    {phase === 'invalid-token'
                      ? t('invite.invalidBody', { defaultValue: 'That invitation link could not be redeemed. Invitation tokens are single-use and expire, so this usually means the link was already opened or has aged out.' })
                      : t('invite.needTokenBody', { defaultValue: 'Open the invitation link your school sent — it carries a token that activates your account. If your mail app shows the link but drops the token, paste it here instead.' })}
                  </p>

                  {phase === 'invalid-token' ? (
                    <div className="alert alert-danger py-2 small">
                      <div className="fw-semibold">{t('invite.invalidTitle', { defaultValue: 'Invitation not valid' })}</div>
                      <div>{message || t('invite.invalidDefault', { defaultValue: 'The invitation link is invalid or has expired.' })}</div>
                    </div>
                  ) : null}

                  <form onSubmit={useManualToken} className="mt-2">
                    <div className="mb-3">
                      <label className="form-label small fw-semibold" htmlFor="ai-token">{t('invite.pasteToken', { defaultValue: 'Paste invitation token' })}</label>
                      <div className="input-group">
                        <span className="input-group-text bg-white"><Ticket size={15} /></span>
                        <input id="ai-token" className="form-control" value={manual} onChange={(e) => setManual(e.target.value)}
                          placeholder={t('invite.tokenPlaceholder', { defaultValue: 'token from the end of the invitation link' })} autoComplete="off" />
                      </div>
                      {phase === 'need-token' && message ? <div className="form-text text-danger small">{message}</div> : null}
                    </div>
                    <button type="submit" className="btn btn-primary w-100 d-flex align-items-center justify-content-center gap-2">
                      <ShieldCheck size={16} /> {t('invite.activate', { defaultValue: 'Activate my account' })}
                    </button>
                  </form>

                  <div className="alert alert-secondary small mt-4 mb-0 d-flex align-items-start gap-2">
                    <Mail size={15} className="mt-1 flex-shrink-0" />
                    <div>
                      <div className="fw-semibold">{t('invite.resendTitle', { defaultValue: 'Need a new invitation?' })}</div>
                      <div>{t('invite.resendBody', { defaultValue: 'Ask your school administrator to re-send it from Users & invitations — only the school can issue the token. Once it arrives, open the link on the device you will use to work.' })}</div>
                    </div>
                  </div>

                  <div className="border-top mt-4 pt-3 d-flex justify-content-between flex-wrap gap-2">
                    <Link to="/login" className="small d-inline-flex align-items-center gap-1"><ArrowLeft size={13} /> {t('common.login')}</Link>
                    <Link to="/faq" className="small">{t('public.faq', { defaultValue: 'FAQ' })}</Link>
                  </div>
                </>
              ) : null}

              {/* ── redeeming ── */}
              {phase === 'verifying' ? (
                <div className="text-center py-4">
                  <Spinner label={t('invite.verifying', { defaultValue: 'Checking your invitation…' })} />
                  <p className="small text-muted mt-3 mb-0">{t('invite.verifyingBody', { defaultValue: 'The platform redeems the token and links it to your school account.' })}</p>
                </div>
              ) : null}

              {/* ── password capture ── */}
              {phase === 'set-password' ? (
                <>
                  <div className="alert alert-success py-2 small d-flex align-items-center gap-2">
                    <ShieldCheck size={15} />
                    {t('invite.welcome', { defaultValue: 'Invitation accepted — you are signed in' })}
                  </div>
                  <div className="small text-muted mb-3">
                    <div className="mb-1"><b>{profile?.fullName}</b> · {profile?.email}</div>
                    <div>{t('invite.school', { defaultValue: 'School' })}: {profile?.school?.school_name || '—'}</div>
                  </div>

                  <p className="small text-muted">
                    {t('invite.setPasswordBody', { defaultValue: 'An invitation creates your account without a password. Set one now (8 characters or more) so you can sign in from any device after this session ends.' })}
                  </p>

                  {message ? <div className="alert alert-danger py-2 small">{message}</div> : null}

                  <form onSubmit={setPasswordNow} noValidate>
                    <div className="mb-3">
                      <label className="form-label small fw-semibold" htmlFor="ai-pass">{t('account.newPassword', { defaultValue: 'New password' })}</label>
                      <input id="ai-pass" type="password" className={`form-control${errors.password ? ' is-invalid' : ''}`}
                        value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
                      {errors.password ? <div className="form-text text-danger small">{errors.password}</div> : null}
                    </div>
                    <div className="mb-3">
                      <label className="form-label small fw-semibold" htmlFor="ai-confirm">{t('account.confirmPassword', { defaultValue: 'Confirm password' })}</label>
                      <input id="ai-confirm" type="password" className={`form-control${errors.confirm ? ' is-invalid' : ''}`}
                        value={confirm} autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
                      {errors.confirm ? <div className="form-text text-danger small">{errors.confirm}</div> : null}
                    </div>
                    <button type="submit" className="btn btn-primary w-100 d-flex align-items-center justify-content-center gap-2" disabled={saving}>
                      {saving ? <Spinner label={t('common.loading')} /> : <><KeyRound size={16} /> {t('invite.saveAndContinue', { defaultValue: 'Save password and continue' })}</>}
                    </button>
                  </form>

                  <div className="d-flex justify-content-between mt-3 flex-wrap gap-2">
                    <Link to={route} className="small">{t('invite.skipPassword', { defaultValue: 'Skip for now and open my dashboard' })}</Link>
                    <Link to="/login" className="small">{t('common.logout')}</Link>
                  </div>
                </>
              ) : null}

              {/* ── finished ── */}
              {phase === 'done' ? (
                <div className="text-center">
                  <span className="stat-icon mx-auto mb-3" style={{ width: 56, height: 56, background: '#d1e7dd', color: '#0f5132' }}>
                    <ShieldCheck size={26} />
                  </span>
                  <h2 className="h5 fw-bold">{t('invite.doneTitle', { defaultValue: 'Account ready' })}</h2>
                  <p className="small text-muted">{t('invite.doneBody', { defaultValue: 'Taking you to your dashboard…' })}</p>
                  <Link to={route} className="btn btn-sm btn-primary">{t('public.openDashboard', { defaultValue: 'Open dashboard' })}</Link>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
