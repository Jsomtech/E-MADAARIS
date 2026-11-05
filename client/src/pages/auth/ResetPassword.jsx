import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { KeyRound, ShieldCheck, ArrowLeft, Ticket, Eye, EyeOff } from 'lucide-react';
import { apiPost } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Spinner } from '../../components/ui/Basics.jsx';

const BRAND = '#6027ff';

/** PKCE password reset: exchange the emailed code for a session, then set a new password. */
export default function ResetPassword() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { adoptSession, profile } = useAuth();

  const code = (params.get('code') || '').trim();
  const [manual, setManual] = useState('');
  const [phase, setPhase] = useState(code ? 'exchanging' : 'need-code');
  const [message, setMessage] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const exchanged = useRef('');

  /* Step 1 — trade the code for a live session. */
  useEffect(() => {
    if (!code || exchanged.current === code) return;
    exchanged.current = code;
    setPhase('exchanging');
    setMessage(null);
    // Not cancelled on cleanup: StrictMode runs this effect twice in development and the second run
    // skips the work, so cancelling the first request would leave "Exchanging…" turning forever. The
    // exchanged guard still keeps the code to a single redemption attempt.
    apiPost('/auth/exchange-code', { code })
      .then(async ({ data }) => {
        await adoptSession(data.tokens);
        setPhase('set-password');
      })
      .catch((error) => {
        exchanged.current = '';
        setPhase('invalid-code');
        setMessage(error.message);
      });
  }, [code, adoptSession]);

  const useManualCode = (e) => {
    e.preventDefault();
    const value = manual.trim();
    if (value.length < 10) {
      setMessage(t('reset.errCode', { defaultValue: 'Paste the full code from the reset link (it is longer than this).' }));
      return;
    }
    setParams({ code: value });
  };

  /* Step 2 — write the new password. */
  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (password.length < 8) errs.password = t('reset.errShort', { defaultValue: 'Use at least 8 characters.' });
    if (password.length > 128) errs.password = t('reset.errLong', { defaultValue: 'Maximum 128 characters.' });
    if (password !== confirm) errs.confirm = t('reset.errMatch', { defaultValue: 'The two passwords do not match.' });
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await apiPost('/auth/update-password', { password });
      toast.success(t('reset.done', { defaultValue: 'Password updated. You are signed in.' }));
      setPhase('done');
      const route = profile?.dashboardRoute || '/dashboard';
      setTimeout(() => navigate(route, { replace: true }), 900);
    } catch (error) {
      setMessage(error.message);
      toast.error(error.message);
    } finally { setSaving(false); }
  };

  return (
    <section className="public-section">
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-12 col-md-8 col-lg-6 col-xl-5">
            <div className="card-soft p-4 p-lg-5">
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="stat-icon" style={{ background: BRAND, color: '#fff' }}><KeyRound size={18} /></span>
                <div className="fw-bold" style={{ color: '#130c2d' }}>{t('auth.reset')}</div>
              </div>

              {phase === 'need-code' || phase === 'invalid-code' ? (
                <>
                  <h1 className="h5 fw-bold mb-2">{t('reset.title', { defaultValue: 'Set a new password' })}</h1>
                  <p className="small text-muted">
                    {t('reset.needCodeBody', { defaultValue: 'Open the reset link on the device you use for E-MADAARIS. It redirects here with a single-use code and the change happens automatically. If your mail client shows the link but does not follow it with the code, copy the code from the end of the link and paste it below.' })}
                  </p>

                  {phase === 'invalid-code' ? <div className="alert alert-danger py-2 small">{message}</div> : null}

                  <form onSubmit={useManualCode} className="mt-3">
                    <div className="mb-3">
                      <label className="form-label small fw-semibold" htmlFor="rp-code">
                        {t('reset.pasteCode', { defaultValue: 'Paste recovery code' })}
                      </label>
                      <div className="input-group">
                        <span className="input-group-text bg-white"><Ticket size={15} /></span>
                        <input id="rp-code" className="form-control" value={manual} onChange={(e) => setManual(e.target.value)}
                          placeholder={t('reset.codePlaceholder', { defaultValue: 'long code from the reset link' })} autoComplete="off" />
                      </div>
                      {phase === 'need-code' && message ? <div className="form-text text-danger small">{message}</div> : null}
                    </div>
                    <button type="submit" className="btn btn-primary w-100 d-flex align-items-center justify-content-center gap-2">
                      <ShieldCheck size={16} /> {t('reset.continue', { defaultValue: 'Continue' })}
                    </button>
                  </form>

                  <ul className="small text-muted ps-3 mt-4 mb-0">
                    <li className="mb-1">{t('reset.tip1', { defaultValue: 'Codes expire quickly and can only be exchanged once.' })}</li>
                    <li className="mb-1">{t('reset.tip2', { defaultValue: 'Did not receive a link? Ask your school administrator for a temporary password.' })}</li>
                    <li>{t('reset.tip3', { defaultValue: 'New staff member instead of a password reset? Use the invitation link in your welcome email.' })}</li>
                  </ul>

                  <div className="border-top mt-4 pt-3 d-flex justify-content-end flex-wrap gap-2">
                    <Link to="/login" className="small d-inline-flex align-items-center gap-1"><ArrowLeft size={13} /> {t('common.login')}</Link>
                  </div>
                </>
              ) : null}

              {phase === 'exchanging' ? (
                <div className="text-center py-4">
                  <Spinner label={t('reset.verifying', { defaultValue: 'Verifying your recovery code…' })} />
                  <p className="small text-muted mt-3 mb-0">{t('reset.verifyingBody', { defaultValue: 'This happens once, straight after the link opens.' })}</p>
                </div>
              ) : null}

              {phase === 'set-password' ? (
                <>
                  <div className="alert alert-success py-2 small d-flex align-items-center gap-2">
                    <ShieldCheck size={15} /> {t('reset.codeOk', { defaultValue: 'Code accepted — choose a new password.' })}
                  </div>
                  <p className="small text-muted">{t('reset.pickBody', { defaultValue: 'Your session is valid for this one change. Choose a password of at least 8 characters that you have not used elsewhere.' })}</p>

                  {message ? <div className="alert alert-danger py-2 small">{message}</div> : null}

                  <form onSubmit={submit} noValidate>
                    <div className="mb-3">
                      <label className="form-label small fw-semibold" htmlFor="rp-pass">{t('reset.newPassword', { defaultValue: 'New password' })}</label>
                      <div className="input-group">
                        <input id="rp-pass" type={show ? 'text' : 'password'} className={`form-control${errors.password ? ' is-invalid' : ''}`}
                          value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
                        <button type="button" className="btn btn-outline-secondary" onClick={() => setShow((s) => !s)} aria-label="Toggle password visibility">
                          {show ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                      {errors.password ? <div className="form-text text-danger small">{errors.password}</div> : null}
                    </div>
                    <div className="mb-3">
                      <label className="form-label small fw-semibold" htmlFor="rp-confirm">{t('account.confirmPassword', { defaultValue: 'Confirm password' })}</label>
                      <input id="rp-confirm" type={show ? 'text' : 'password'} className={`form-control${errors.confirm ? ' is-invalid' : ''}`}
                        value={confirm} autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
                      {errors.confirm ? <div className="form-text text-danger small">{errors.confirm}</div> : null}
                    </div>
                    <button type="submit" className="btn btn-primary w-100 d-flex align-items-center justify-content-center gap-2" disabled={saving}>
                      {saving ? <Spinner label={t('common.loading')} /> : <><KeyRound size={16} /> {t('reset.save', { defaultValue: 'Save password' })}</>}
                    </button>
                  </form>
                </>
              ) : null}

              {phase === 'done' ? (
                <div className="text-center">
                  <span className="stat-icon mx-auto mb-3" style={{ width: 56, height: 56, background: '#d1e7dd', color: '#0f5132' }}>
                    <ShieldCheck size={26} />
                  </span>
                  <h2 className="h5 fw-bold">{t('reset.doneTitle', { defaultValue: 'Password changed' })}</h2>
                  <p className="small text-muted">{t('reset.doneBody', { defaultValue: 'Taking you to your dashboard…' })}</p>
                  <Link to={profile?.dashboardRoute || '/dashboard'} className="btn btn-sm btn-primary" replace>
                    {t('public.openDashboard', { defaultValue: 'Open dashboard' })}
                  </Link>
                  <div className="mt-3 small text-muted">{t('reset.signedInAs', { defaultValue: 'Signed in as' })} <b>{profile?.email}</b></div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
