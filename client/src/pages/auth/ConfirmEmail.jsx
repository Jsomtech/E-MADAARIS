import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Mail, ShieldAlert, Ticket, ArrowLeft } from 'lucide-react';
import { apiPost } from '../../api/client.js';
import { Spinner } from '../../components/ui/Basics.jsx';

const BRAND = '#6027ff';

/** Email confirmation for a newly created account: redeems the signed token from the confirmation mail. */
export default function ConfirmEmail() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();

  const token = (params.get('token') || '').trim();
  const [manual, setManual] = useState('');
  const [phase, setPhase] = useState(token ? 'confirming' : 'need-token');
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState(null);
  const attempted = useRef('');

  useEffect(() => {
    if (!token || attempted.current === token) return;
    let alive = true;
    attempted.current = token;
    setPhase('confirming');
    setMessage(null);
    (async () => {
      try {
        const { data } = await apiPost('/auth/confirm-email', { token });
        if (!alive) return;
        setResult(data);
        setPhase('confirmed');
      } catch (error) {
        if (!alive) return;
        attempted.current = '';
        setMessage(error.message);
        setPhase('invalid-token');
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const useManualToken = (e) => {
    e.preventDefault();
    const value = manual.trim();
    if (value.length < 10) {
      setMessage(t('confirmEmail.errToken', { defaultValue: 'Paste the full confirmation token from the link.' }));
      return;
    }
    setParams({ token: value });
  };

  return (
    <section className="public-section">
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-12 col-md-8 col-lg-6 col-xl-5">
            <div className="card-soft p-4 p-lg-5">
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="stat-icon" style={{ background: BRAND, color: '#fff' }}><BadgeCheck size={18} /></span>
                <div className="fw-bold" style={{ color: '#130c2d' }}>{t('auth.confirmEmail', { defaultValue: 'Confirm your email' })}</div>
              </div>

              {phase === 'confirmed' ? (
                <>
                  <div className="alert alert-success py-3 d-flex align-items-start gap-2">
                    <BadgeCheck size={18} className="mt-1 flex-shrink-0" />
                    <div>
                      <div className="fw-semibold">{t('confirmEmail.doneTitle', { defaultValue: 'Email confirmed' })}</div>
                      <div className="small">
                        {t('confirmEmail.doneBody', {
                          defaultValue: '{{name}}, {{email}} is now the sign-in address for {{school}}.',
                          name: result?.fullName || '',
                          email: result?.email || '',
                          school: result?.schoolName || 'your school',
                        })}
                      </div>
                    </div>
                  </div>
                  <p className="small text-muted">
                    {t('confirmEmail.nextBody', { defaultValue: 'Sign in with that address and the password your administrator set. Make it your own password the first time you get in — from Account → Security.' })}
                  </p>
                  <Link to="/login" className="btn btn-primary w-100 d-flex align-items-center justify-content-center gap-2">
                    <ArrowLeft size={16} /> {t('common.login')}
                  </Link>
                </>
              ) : null}

              {phase === 'confirming' ? (
                <div className="text-center py-4">
                  <Spinner label={t('confirmEmail.working', { defaultValue: 'Confirming your email…' })} />
                  <p className="small text-muted mt-3 mb-0">{t('confirmEmail.workingBody', { defaultValue: 'The platform is marking this address as verified.' })}</p>
                </div>
              ) : null}

              {phase === 'need-token' || phase === 'invalid-token' ? (
                <>
                  <p className="small text-muted">
                    {phase === 'invalid-token'
                      ? t('confirmEmail.invalidBody', { defaultValue: 'That confirmation link could not be used. Confirmation links expire, so your administrator can send the account email again from Users.' })
                      : t('confirmEmail.needBody', { defaultValue: 'Open the confirmation link from your account email — it carries the token that verifies the address. If your mail app shows the link but drops the token, paste it here instead.' })}
                  </p>

                  {phase === 'invalid-token' ? (
                    <div className="alert alert-danger py-2 small d-flex align-items-start gap-2">
                      <ShieldAlert size={15} className="mt-1 flex-shrink-0" />
                      <div>{message || t('confirmEmail.invalidDefault', { defaultValue: 'The confirmation link is invalid or has expired.' })}</div>
                    </div>
                  ) : null}

                  <form onSubmit={useManualToken} className="mt-2">
                    <div className="mb-3">
                      <label className="form-label small fw-semibold" htmlFor="ce-token">{t('confirmEmail.pasteToken', { defaultValue: 'Paste confirmation token' })}</label>
                      <div className="input-group">
                        <span className="input-group-text bg-white"><Ticket size={15} /></span>
                        <input id="ce-token" className="form-control" value={manual} onChange={(e) => setManual(e.target.value)}
                          placeholder={t('confirmEmail.tokenPlaceholder', { defaultValue: 'token from the end of the confirmation link' })} autoComplete="off" />
                      </div>
                      {phase === 'need-token' && message ? <div className="form-text text-danger small">{message}</div> : null}
                    </div>
                    <button type="submit" className="btn btn-primary w-100 d-flex align-items-center justify-content-center gap-2">
                      <BadgeCheck size={16} /> {t('confirmEmail.confirm', { defaultValue: 'Confirm my email' })}
                    </button>
                  </form>

                  <div className="alert alert-secondary small mt-4 mb-0 d-flex align-items-start gap-2">
                    <Mail size={15} className="mt-1 flex-shrink-0" />
                    <div>
                      <div className="fw-semibold">{t('confirmEmail.noEmailTitle', { defaultValue: 'No email yet?' })}</div>
                      <div>{t('confirmEmail.noEmailBody', { defaultValue: 'You can still sign in with the address and password from your account email. Confirmation only proves the address is yours, so ask your administrator to re-send it if the message never arrived.' })}</div>
                    </div>
                  </div>

                  <div className="border-top mt-4 pt-3 d-flex justify-content-between flex-wrap gap-2">
                    <Link to="/login" className="small d-inline-flex align-items-center gap-1"><ArrowLeft size={13} /> {t('common.login')}</Link>
                    <Link to="/faq" className="small">{t('public.faq', { defaultValue: 'FAQ' })}</Link>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
