import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Bell, BellOff, KeyRound, Save } from 'lucide-react';
import { apiPost, tokens } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHeader, Badge } from '../components/ui/Basics.jsx';
import Field from '../components/ui/Field.jsx';
import { humanize } from '../config/resources.jsx';

export default function AccountPage() {
  const { t, i18n } = useTranslation();
  const { profile, refresh } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const isStudentLogin = /@students\.e-madaaris\.local$/i.test(profile?.email || '');
  const [push, setPush] = useState({
    busy: false,
    configured: null,
    missing: [],
    enabled: false,
    permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  });

  useEffect(() => {
    let alive = true;
    import('../services/push.js')
      .then((service) => {
        if (!alive) return;
        setPush((state) => ({
          ...state,
          configured: service.isPushConfigured,
          missing: service.missingPushConfig(),
          enabled: Boolean(service.storedPushToken()),
        }));
      })
      .catch(() => { if (alive) setPush((state) => ({ ...state, configured: false })); });
    return () => { alive = false; };
  }, []);

  const togglePush = async () => {
    setPush((state) => ({ ...state, busy: true }));
    try {
      const service = await import('../services/push.js');
      if (push.enabled) {
        await service.disablePush();
        setPush((state) => ({ ...state, busy: false, enabled: false }));
        toast.success(t('account.pushDisabled', { defaultValue: 'Push notifications turned off on this device' }));
      } else {
        await service.enablePush();
        setPush((state) => ({ ...state, busy: false, enabled: true, permission: 'granted' }));
        toast.success(t('account.pushEnabled', { defaultValue: 'Push notifications enabled on this device' }));
      }
    } catch (error) {
      setPush((state) => ({
        ...state,
        busy: false,
        permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
      }));
      toast.error(error.message);
    }
  };

  const changePassword = async () => {
    if (password.length < 8) { toast.error('Use at least 8 characters'); return; }
    if (password !== confirm) { toast.error('The two passwords do not match'); return; }
    setBusy(true);
    try {
      const { data } = await apiPost('/auth/update-password', { password });
      // The server revokes the old session with the password; adopt the fresh one it returns.
      if (data.tokens) tokens.set(data.tokens);
      toast.success(t('account.passwordChanged', { defaultValue: 'Password updated' }));
      setPassword(''); setConfirm('');
      await refresh();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title={t('common.account')} subtitle={t('account.subtitle', { defaultValue: 'Your profile, language and security.' })} />
      {profile?.mustChangePassword && (
        <div className="alert alert-warning py-2 small">
          {t('account.tempPasswordWarning', { defaultValue: 'You are still using the temporary password created for you. Set your own password below so only you know it.' })}
        </div>
      )}
      <div className="row g-3">
        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-3">{t('account.myAccount', { defaultValue: 'My account' })}</div>
            <div className="row g-3">
              <Detail label={t('common.name')} value={profile?.fullName} />
              <Detail label={t('common.email')} value={isStudentLogin
                ? t('account.studentLogin', { defaultValue: 'Student ID sign-in' })
                : profile?.email} />
              <Detail label={t('account.role', { defaultValue: 'Role' })} value={(profile?.roles || []).map(humanize).join(', ')} />
              <Detail label={t('account.school', { defaultValue: 'School' })} value={profile?.school?.school_name || '—'} />
              <Detail label={t('common.status')} value={<Badge tone="ok">{humanize(profile?.subscription?.status || 'platform')}</Badge>} />
            </div>
          </div>
        </div>
        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-3 d-flex align-items-center gap-2"><KeyRound size={16} /> {t('account.security', { defaultValue: 'Password & security' })}</div>
            <div className="row">
              <Field field={{ name: 'new_password', label: t('account.newPassword', { defaultValue: 'New password' }), type: 'password', required: true }}
                value={password} onChange={setPassword} />
              <Field field={{ name: 'confirm_password', label: t('account.confirmPassword', { defaultValue: 'Confirm password' }), type: 'password', required: true }}
                value={confirm} onChange={setConfirm} />
            </div>
            <button className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={changePassword} disabled={busy}>
              <Save size={14} /> {busy ? '…' : t('account.updatePassword', { defaultValue: 'Update password' })}
            </button>
          </div>
        </div>
        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-3 d-flex align-items-center gap-2"><Bell size={16} /> {t('account.pushTitle', { defaultValue: 'Push notifications' })}</div>
            {push.configured === null ? (
              <div className="small text-muted">…</div>
            ) : push.configured ? (
              <>
                <div className="small text-muted mb-2">
                  {t('account.pushHint', { defaultValue: 'Get school updates on this device even when the app is closed. You can turn this off at any time.' })}
                </div>
                <div className="small mb-3">
                  {t('common.status')}: <span className={`badge ${push.enabled ? 'text-bg-success' : 'text-bg-secondary'}`}>
                    {push.enabled
                      ? t('account.pushOn', { defaultValue: 'Enabled on this device' })
                      : t('account.pushOff', { defaultValue: 'Not enabled' })}
                  </span>
                </div>
                <button type="button" className={`btn btn-sm ${push.enabled ? 'btn-outline-secondary' : 'btn-primary'} d-inline-flex align-items-center gap-1`}
                  onClick={togglePush} disabled={push.busy || push.permission === 'unsupported'}>
                  {push.enabled ? <BellOff size={14} /> : <Bell size={14} />}
                  {push.busy
                    ? '…'
                    : push.enabled
                      ? t('account.disablePush', { defaultValue: 'Turn off' })
                      : t('account.enablePush', { defaultValue: 'Enable on this device' })}
                </button>
                {push.permission === 'denied' && (
                  <div className="small text-danger mt-2">
                    {t('account.pushBlocked', { defaultValue: 'Notifications are blocked for this site. Allow them in the browser settings, then try again.' })}
                  </div>
                )}
              </>
            ) : (
              <div className="small text-muted">
                {t('account.pushNotConfigured', { defaultValue: 'Firebase is not configured yet. Add the Firebase web keys to client/.env and restart the app.' })}
                {push.missing.length ? <div className="mt-1"><code>{push.missing.join(', ')}</code></div> : null}
              </div>
            )}
          </div>
        </div>
        <div className="col-12">
          <div className="card-soft p-3">
            <div className="fw-semibold mb-2">{t('common.language')}</div>
            <div className="btn-group">
              {[['en', 'English'], ['so', 'Soomaali']].map(([code, name]) => (
                <button key={code} className={`btn btn-sm ${i18n.language === code ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => i18n.changeLanguage(code)}>{name}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }) {
  return (
    <div className="col-12">
      <div className="small text-muted">{label}</div>
      <div className="fw-semibold">{value || '—'}</div>
    </div>
  );
}
