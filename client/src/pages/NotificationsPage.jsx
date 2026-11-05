import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Send, Smartphone, SlidersHorizontal } from 'lucide-react';
import { apiPost, apiPut } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { humanize } from '../config/resources.jsx';
import { PageHeader, EmptyState, Spinner, ErrorState, Badge, dateTime } from '../components/ui/Basics.jsx';

export default function NotificationsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, loading, error, reload } = useApi('/school/notifications', unreadOnly ? { unread: 'true' } : undefined);
  const items = Array.isArray(data) ? data : [];

  const markAll = async () => {
    try { await apiPost('/school/notifications/read-all', {}); toast.success(t('common.saved')); reload(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <PageHeader
        title={t('common.notifications')}
        subtitle={t('notifications.subtitle', { defaultValue: 'Messages routed to your account only.' })}
        actions={(
          <>
            <button className={`btn btn-sm ${unreadOnly ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setUnreadOnly((v) => !v)}>
              {t('notifications.unreadOnly', { defaultValue: 'Unread only' })}
            </button>
            <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={markAll}>
              <CheckCheck size={14} /> {t('notifications.markAllRead', { defaultValue: 'Mark all as read' })}
            </button>
          </>
        )}
      />
      <div className="row g-3 mb-3">
        <div className="col-lg-6"><DeviceCard /></div>
        {profile?.type === 'school' && <div className="col-lg-6"><PreferencesCard /></div>}
      </div>
      {loading && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {!loading && !items.length && <EmptyState icon={Bell} title={t('common.none')} />}
      <div className="card-soft">
        {items.map((n) => (
          <NotificationRow key={n.id} item={n} onRead={reload} label={t('notifications.markRead', { defaultValue: 'Mark read' })} />
        ))}
      </div>
    </>
  );
}

function NotificationRow({ item, onRead, label }) {
  const mark = async () => {
    if (item.is_read) return;
    await apiPost(`/school/notifications/${item.id}/read`, {});
    onRead();
  };
  return (
    <div className="d-flex justify-content-between align-items-start gap-3 p-3 border-bottom">
      <div>
        <div className="d-flex align-items-center gap-2">
          {item.link
            ? <Link to={item.link} className="fw-semibold small text-decoration-none" onClick={mark}>{item.title}</Link>
            : <span className="fw-semibold small">{item.title}</span>}
          {!item.is_read && <Badge tone="brand">new</Badge>}
        </div>
        {item.body && <div className="small text-muted mt-1">{item.body}</div>}
        <div className="small text-muted mt-1">{humanize(item.category)} · {dateTime(item.created_at)}</div>
      </div>
      {!item.is_read && <button className="btn btn-sm btn-outline-secondary" onClick={mark}>{label}</button>}
    </div>
  );
}

/**
 * What the device and the server can each do. The sender answer comes from the server because a missing
 * service-account key is the platform administrator's to fix, not a browser setting.
 */
function DeviceCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    import('../services/push.js')
      .then(async (service) => {
        const data = await service.getPushStatus();
        if (alive) setStatus(data);
      })
      .catch((error) => { if (alive) setFailure(error.message); });
    return () => { alive = false; };
  }, []);

  const sendTest = async () => {
    setBusy(true);
    setFailure('');
    try {
      const service = await import('../services/push.js');
      const outcome = await service.sendTestPush();
      if (outcome.sent) {
        toast.success(t('notifications.testSent', { defaultValue: 'A test notification was pushed to {{count}} device(s)', count: outcome.sent }));
      } else if (outcome.skipped === 'no_registered_devices') {
        setFailure(t('notifications.noDevices', { defaultValue: 'No browser is registered on this account yet. Turn push on below and try again.' }));
      } else {
        setFailure(outcome.error || t('notifications.testFailed', { defaultValue: 'The server could not deliver the test notification.' }));
      }
    } catch (error) {
      setFailure(error.message);
    } finally {
      setBusy(false);
    }
  };

  const summary = () => {
    if (failure) return failure;
    if (!status) return t('common.loading');
    if (!status.ready) return status.reason;
    if (!status.devices) return t('notifications.senderReady', { defaultValue: 'The server can send pushes. This account has no browser registered yet.' });
    return t('notifications.liveOnDevices', {
      defaultValue: 'Push is live: the server is configured and this account has {{count}} browser(s) registered.', count: status.devices,
    });
  };

  return (
    <div className="card-soft h-100">
      <div className="d-flex align-items-center gap-2 mb-2">
        <Smartphone size={16} className="text-muted" />
        <strong className="small">{t('notifications.deviceTitle', { defaultValue: 'This device and the sender' })}</strong>
      </div>
      <div className="small text-muted mb-3">{summary()}</div>
      <div className="d-flex align-items-center gap-2 flex-wrap">
        <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
          onClick={sendTest} disabled={busy || !status?.ready}>
          <Send size={14} /> {busy ? t('common.saving') : t('notifications.sendTest', { defaultValue: 'Send a test notification' })}
        </button>
        <Link to="/account" className="btn btn-sm btn-link text-decoration-none">{t('notifications.deviceSettings', { defaultValue: 'Turn push on for this browser' })}</Link>
      </div>
    </div>
  );
}

/** The switches notify() reads before it writes an inbox row, so a school can silence what it ignores. */
function PreferencesCard() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/school/notifications/preferences');
  const [busyKey, setBusyKey] = useState('');
  const rows = Array.isArray(data) ? data : [];

  const save = async (row, key, value) => {
    const next = { ...row, [key]: value };
    // Switching the inbox off clears the email copy too: notify() filters a category once, so a message
    // that never reaches the list cannot be mailed either.
    if (!next.in_app) next.email = false;
    setBusyKey(`${row.category}:${key}`);
    try {
      await apiPut('/school/notifications/preferences', { category: row.category, in_app: next.in_app, email: next.email });
      reload();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="card-soft h-100">
      <div className="d-flex align-items-center gap-2 mb-1">
        <SlidersHorizontal size={16} className="text-muted" />
        <strong className="small">{t('notifications.preferencesTitle', { defaultValue: 'What reaches you' })}</strong>
      </div>
      <div className="small text-muted mb-3">
        {t('notifications.preferencesHint', { defaultValue: 'In-app decides whether a message appears in this list at all. Email sends a copy as well.' })}
      </div>
      {loading && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {!loading && !error && (
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-0">
            <thead>
              <tr>
                <th className="small fw-semibold border-0">{t('common.type', { defaultValue: 'Type' })}</th>
                <th className="small fw-semibold border-0 text-center" style={{ width: 90 }}>{t('notifications.inApp', { defaultValue: 'In-app' })}</th>
                <th className="small fw-semibold border-0 text-center" style={{ width: 90 }}>{t('common.email', { defaultValue: 'Email' })}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category}>
                  <td className="small">{t(`notifications.categories.${row.category}`, { defaultValue: humanize(row.category) })}</td>
                  {['in_app', 'email'].map((key) => (
                    <td key={key} className="text-center">
                      <span className="form-check form-switch d-inline-block m-0 ps-0">
                        <input className="form-check-input float-none m-0" type="checkbox" role="switch"
                          checked={Boolean(row[key])}
                          disabled={busyKey === `${row.category}:${key}` || (key === 'email' && !row.in_app)}
                          onChange={(e) => save(row, key, e.target.checked)}
                          aria-label={`${humanize(row.category)} ${key}`} />
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
