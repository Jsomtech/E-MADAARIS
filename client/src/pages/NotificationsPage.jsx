import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Link, useSearchParams } from 'react-router-dom';
import { Bell, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CheckCheck, Search, Send, Smartphone, SlidersHorizontal } from 'lucide-react';
import { apiPost, apiPut } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useNotificationStream } from '../hooks/useNotificationStream.js';
import { useAuth } from '../context/AuthContext.jsx';
import { humanize } from '../config/resources.jsx';
import { PageHeader, EmptyState, Spinner, ErrorState, Badge, dateTime } from '../components/ui/Basics.jsx';

const PAGE_SIZES = [25, 50, 100];
const PRIORITY_TONE = { urgent: 'danger', high: 'warn', low: 'neutral' };

export default function NotificationsPage() {
  const { t } = useTranslation();
  const { profile, can } = useAuth();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState({ search: '', category: '', priority: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const params = {
    unread: unreadOnly ? 'true' : undefined,
    category: filters.category || undefined,
    priority: filters.priority || undefined,
    search: filters.search || undefined,
    from: filters.from || undefined,
    // The picker names a day, so the range has to reach the end of it rather than its first second.
    to: filters.to ? `${filters.to}T23:59:59` : undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
  const { data, loading, error, reload, unread, total, meta } = useApi('/school/notifications', params);
  const items = Array.isArray(data) ? data : [];
  const categories = meta?.categories || [];
  const priorities = meta?.priorities || [];

  const filtered = unreadOnly || Object.values(filters).some(Boolean);
  const clearFilters = () => {
    setSearchInput('');
    setFilters({ search: '', category: '', priority: '', from: '', to: '' });
    setPage(1);
  };

  // A day of typing should not become a day of queries.
  useEffect(() => {
    const id = setTimeout(() => {
      const term = searchInput.trim();
      setFilters((prev) => (prev.search === term ? prev : { ...prev, search: term }));
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  // The list moves on its own while the sign-in is live. Alerting is left to the push handler in the
  // app shell — both feeds can fire for the same message, and a toast is not meant to arrive twice.
  const refreshTimer = useRef(null);
  const { live, offlineReason } = useNotificationStream(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(reload, 400);
  });
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  // A tap on the phone's notification lands here as ?open=<id>. The row is opened and, since the person
  // has now read it, marked read — for the recipient only, which is what the /read route already enforces.
  // The address is then rewritten away so a reload does not reopen a message they have moved past.
  const [searchParams, setSearchParams] = useSearchParams();
  const [focusId, setFocusId] = useState(() => searchParams.get('open') || '');
  useEffect(() => {
    const id = searchParams.get('open');
    if (id) setFocusId(id);
  }, [searchParams]);
  const handledFocus = useRef('');
  useEffect(() => {
    if (!focusId || handledFocus.current === focusId) return;
    const target = items.find((n) => n.id === focusId);
    if (!target) return;
    handledFocus.current = focusId;
    if (!target.is_read) apiPost(`/school/notifications/${focusId}/read`, {}).then(reload).catch(() => {});
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('open');
      return next;
    }, { replace: true });
  }, [focusId, items, reload, setSearchParams]);

  const markAll = async () => {
    try {
      await apiPost('/school/notifications/read-all', {});
      toast.success(t('common.saved'));
      // Everything this page was showing is now read, so an unread-only view starts over at the top.
      setPage(1);
      reload();
    } catch (e) { toast.error(e.message); }
  };

  const shown = total ?? items.length;
  const pages = Math.max(1, Math.ceil(shown / pageSize));
  const first = shown ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, shown);

  return (
    <>
      <PageHeader
        title={t('common.notifications')}
        subtitle={t('notifications.subtitle', { defaultValue: 'Messages routed to your account only.' })}
        actions={(
          <>
            <span className="small text-muted d-inline-flex align-items-center gap-1 me-1"
              title={live
                ? t('notifications.feedLiveHint', { defaultValue: 'The inbox opens as soon as a message is written for you — no refresh, no push permission.' })
                : `${t('notifications.feedPolledHint', { defaultValue: 'This browser shows new messages when the page reloads.' })}${offlineReason ? ` (${offlineReason})` : ''}`}>
              {live && <span className="bell-live" style={{ position: 'static' }} aria-hidden="true" />}
              {live
                ? t('notifications.feedLive', { defaultValue: 'Live' })
                : t('notifications.feedPolled', { defaultValue: 'On refresh' })}
            </span>
            <button className={`btn btn-sm ${unreadOnly ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => { setUnreadOnly((v) => !v); setPage(1); }}>
              {t('notifications.unreadOnly', { defaultValue: 'Unread only' })}
              {unread ? <span className="badge rounded-pill bg-light text-dark ms-1">{unread}</span> : null}
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

      <div className="card-soft p-3 mb-3">
        <div className="row g-2 align-items-end">
          <div className="col-12 col-md-4">
            <label className="form-label small fw-semibold mb-0" htmlFor="nt-search">{t('notifications.search', { defaultValue: 'Search' })}</label>
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-white"><Search size={14} /></span>
              <input id="nt-search" className="form-control" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('notifications.searchPlaceholder', { defaultValue: 'Subject or message text…' })} />
            </div>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold mb-0" htmlFor="nt-category">{t('sections.category', { defaultValue: 'Type' })}</label>
            <select id="nt-category" className="form-select form-select-sm" value={filters.category}
              onChange={(e) => { setFilters((f) => ({ ...f, category: e.target.value })); setPage(1); }}>
              <option value="">{t('common.all')}</option>
              {categories.map((c) => <option key={c} value={c}>{t(`notifications.categories.${c}`, { defaultValue: humanize(c) })}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold mb-0" htmlFor="nt-priority">{t('sections.priority', { defaultValue: 'Priority' })}</label>
            <select id="nt-priority" className="form-select form-select-sm" value={filters.priority}
              disabled={!priorities.length}
              title={priorities.length ? undefined : t('notifications.priorityNeedsMigration', { defaultValue: 'Needs migration 0025 in this database.' })}
              onChange={(e) => { setFilters((f) => ({ ...f, priority: e.target.value })); setPage(1); }}>
              <option value="">{t('common.all')}</option>
              {priorities.map((p) => <option key={p} value={p}>{t(`notifications.priorities.${p}`, { defaultValue: humanize(p) })}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold mb-0" htmlFor="nt-from">{t('notifications.from', { defaultValue: 'From' })}</label>
            <input id="nt-from" type="date" className="form-control form-control-sm" value={filters.from}
              onChange={(e) => { setFilters((f) => ({ ...f, from: e.target.value })); setPage(1); }} />
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold mb-0" htmlFor="nt-to">{t('notifications.to', { defaultValue: 'To' })}</label>
            <input id="nt-to" type="date" className="form-control form-control-sm" value={filters.to}
              onChange={(e) => { setFilters((f) => ({ ...f, to: e.target.value })); setPage(1); }} />
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold mb-0" htmlFor="nt-size">{t('sections.perPage', { defaultValue: 'Per page' })}</label>
            <select id="nt-size" className="form-select form-select-sm" value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <button type="button" className="btn btn-sm btn-outline-secondary w-100" onClick={clearFilters} disabled={!filtered}>
              {t('sections.clear', { defaultValue: 'Clear' })}
            </button>
          </div>
        </div>
      </div>

      {loading && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {!loading && !error && !items.length && (
        <EmptyState icon={Bell} title={t('common.none')}
          hint={filtered ? t('notifications.noneFiltered', { defaultValue: 'No message matches these filters.' }) : undefined} />
      )}
      {!!items.length && (
        <>
          <div className="card-soft">
            {items.map((n) => (
              <NotificationRow key={n.id} item={n} onRead={reload} focused={n.id === focusId}
                label={t('notifications.markRead', { defaultValue: 'Mark read' })}
                mayExport={can('notifications.export')} />
            ))}
          </div>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-2">
            <span className="small text-muted">
              {t('notifications.showing', { defaultValue: 'Showing {{first}}–{{last}} of {{total}}.', first, last, total: shown })}
            </span>
            <div className="d-flex align-items-center gap-2">
              <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
                onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
                <ChevronLeft size={14} /> {t('common.previous', { defaultValue: 'Previous' })}
              </button>
              <span className="small text-muted tabular-nums">{page} / {pages}</span>
              <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
                onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages || loading}>
                {t('common.next', { defaultValue: 'Next' })} <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** The list row stays short; the detail pane is what the whole row of the record actually says. */
function NotificationRow({ item, onRead, label, mayExport, focused }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rowRef = useRef(null);

  // Arriving from the lock screen means the person wanted this message, so it shows itself and scrolls
  // into the middle of the list rather than waiting for a second tap.
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused]);

  const mark = async () => {
    if (item.is_read) return;
    await apiPost(`/school/notifications/${item.id}/read`, {});
    onRead();
  };

  // Reading and acknowledging are different promises, so they are different writes: opening the row
  // clears the bell, only the button below settles what the sender asked for.
  const mayAcknowledge = item.ack_required && !item.acknowledged_at;
  const acknowledge = async () => {
    try {
      await apiPost(`/school/notifications/${item.id}/ack`, {});
      window.dispatchEvent(new Event('emadaaris:acks-changed'));
      toast.success(t('notifications.ackSaved', { defaultValue: 'Your acknowledgment was recorded.' }));
      onRead();
    } catch (e) { toast.error(e.message); }
  };

  const categoryLabel = t(`notifications.categories.${item.category}`, { defaultValue: humanize(item.category) });
  const body = String(item.body || '');

  return (
    <>
      <div ref={rowRef} className="d-flex justify-content-between align-items-start gap-3 p-3 border-bottom">
        <div className="min-width-0">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            {item.link
              ? <Link to={item.link} className="fw-semibold small text-decoration-none" onClick={mark}>{item.title}</Link>
              : <span className="fw-semibold small">{item.title}</span>}
            {!item.is_read && <Badge tone="brand">new</Badge>}
            {item.ack_required && (
              <Badge tone={item.acknowledged_at ? 'ok' : 'danger'}>
                {item.acknowledged_at
                  ? t('notifications.ackDone', { defaultValue: 'acknowledged' })
                  : t('notifications.ackNeeded', { defaultValue: 'needs your acknowledgment' })}
              </Badge>
            )}
            {item.priority && item.priority !== 'normal' && (
              <Badge tone={PRIORITY_TONE[item.priority] || 'neutral'}>
                {t(`notifications.priorities.${item.priority}`, { defaultValue: humanize(item.priority) })}
              </Badge>
            )}
          </div>
          {body && !open && <div className="small text-muted mt-1">{body.length > 160 ? `${body.slice(0, 160)}…` : body}</div>}
          <div className="small text-muted mt-1">{categoryLabel} · {dateTime(item.created_at)}</div>
        </div>
        <div className="d-flex align-items-center gap-1 flex-shrink-0">
          {mayAcknowledge && (
            <button type="button" className="btn btn-sm btn-primary" onClick={acknowledge}>
              {t('notifications.acknowledge', { defaultValue: 'I have read and understood' })}
            </button>
          )}
          {!item.is_read && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={mark}>{label}</button>}
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setOpen((v) => !v)}
            aria-expanded={open} aria-label={t('notifications.details', { defaultValue: 'Details' })}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {open && (
        <div className="px-3 pb-3 pt-2 border-bottom bg-white">
          {body && <div className="small mb-2" style={{ whiteSpace: 'pre-line' }}>{body}</div>}
          {!body && <div className="small text-muted mb-2">{t('notifications.noBody', { defaultValue: 'This message carries a subject only.' })}</div>}
          <div className="small text-muted d-flex flex-column gap-1">
            <span>{t('notifications.receivedAt', { defaultValue: 'Written' })}: {dateTime(item.created_at)}</span>
            {item.sent_at && <span>{t('notifications.deliveredAt', { defaultValue: 'Pushed' })}: {dateTime(item.sent_at)}</span>}
            <span>{item.is_read
              ? t('notifications.alreadyRead', { defaultValue: 'Already read' })
              : t('notifications.stillUnread', { defaultValue: 'Still unread' })}</span>
            {item.ack_required && (
              <span className={item.acknowledged_at ? '' : 'fw-semibold'}>
                {item.acknowledged_at
                  ? `${t('notifications.acknowledgedAt', { defaultValue: 'Acknowledged' })}: ${dateTime(item.acknowledged_at)}`
                  : t('notifications.awaitingAck', { defaultValue: 'The sender is waiting for your acknowledgment.' })}
              </span>
            )}
            {item.link && (
              <Link to={item.link} className="text-decoration-none" onClick={mark}>
                {t('notifications.openRecord', { defaultValue: 'Open the record it refers to' })}
              </Link>
            )}
            {mayExport && item.batch_id && (
              <Link to={`/school/notification-report?batch=${item.batch_id}`} className="text-decoration-none">
                {t('notifications.whoElse', { defaultValue: 'See the send this came from' })}
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * What the device and the server can each do. The sender answer comes from the server because a missing
 * service-account key is the platform administrator's to fix, not a browser setting.
 */
function DeviceCard() {
  const { t } = useTranslation();
  const { profile, can } = useAuth();
  const maySendNotices = profile?.type === 'platform' || can('notifications.send');
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
    // Which transport answers matters when something goes quiet: an iPhone is never on Firebase, and a
    // desktop Chrome is never on plain Web Push while Firebase is registered.
    const by = status.by_provider || {};
    const transports = [
      by.fcm ? t('notifications.viaFcm', { defaultValue: '{{count}} on Firebase', count: by.fcm }) : null,
      by.webpush ? t('notifications.viaWebPush', { defaultValue: '{{count}} on Web Push (iPhone/iPad)', count: by.webpush }) : null,
    ].filter(Boolean).join(' · ');
    return t('notifications.liveOnDevices', {
      defaultValue: 'Push is live: the server is configured and this account has {{count}} browser(s) registered.{{transports}}',
      count: status.devices,
      transports: transports ? ` ${transports}.` : '',
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
        {maySendNotices && (
          <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
            onClick={sendTest} disabled={busy || !status?.ready}>
            <Send size={14} /> {busy ? t('common.saving') : t('notifications.sendTest', { defaultValue: 'Send a test notification' })}
          </button>
        )}
        <Link to="/account" className="btn btn-sm btn-link text-decoration-none">{t('notifications.deviceSettings', { defaultValue: 'Turn push on for this browser' })}</Link>
      </div>
      {!maySendNotices && (
        <div className="small text-muted mt-2">
          {t('notifications.sendingIsStaff', { defaultValue: 'Only school staff can send messages. This device still receives whatever the school sends you.' })}
        </div>
      )}
    </div>
  );
}

/** The switches notify() reads before it writes an inbox row, so a school can silence what it ignores. */
function PreferencesCard() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/school/notifications/preferences');
  const [busyKey, setBusyKey] = useState('');
  const rows = Array.isArray(data) ? data : [];

  // The push switch is migration 0025's. A database that has not run it returns no `push` key, and the
  // column is left out rather than offering a switch the server would forget on the next save.
  const switchKeys = rows.length && rows[0].push !== undefined
    ? ['in_app', 'push', 'email']
    : ['in_app', 'email'];

  const save = async (row, key, value) => {
    const next = { ...row, [key]: value };
    // Switching the inbox off clears the push and email copies too: notify() filters a category once, so
    // a message that never reaches the list cannot be delivered by any other route either.
    if (!next.in_app) { next.email = false; if (next.push !== undefined) next.push = false; }
    setBusyKey(`${row.category}:${key}`);
    try {
      await apiPut('/school/notifications/preferences', {
        category: row.category, in_app: next.in_app, email: next.email,
        ...(row.push === undefined ? {} : { push: next.push }),
      });
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
        {t('notifications.preferencesHint', { defaultValue: 'In-app decides whether a message appears in this list at all. Push and email send a copy as well.' })}
      </div>
      {loading && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {!loading && !error && (
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-0">
            <thead>
              <tr>
                <th className="small fw-semibold border-0">{t('common.type', { defaultValue: 'Type' })}</th>
                {switchKeys.map((key) => (
                  <th key={key} className="small fw-semibold border-0 text-center" style={{ width: 90 }}>
                    {key === 'in_app'
                      ? t('notifications.inApp', { defaultValue: 'In-app' })
                      : key === 'push'
                        ? t('notifications.pushShort', { defaultValue: 'Push' })
                        : t('common.email', { defaultValue: 'Email' })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category}>
                  <td className="small">{t(`notifications.categories.${row.category}`, { defaultValue: humanize(row.category) })}</td>
                  {switchKeys.map((key) => (
                    <td key={key} className="text-center">
                      <span className="form-check form-switch d-inline-block m-0 ps-0">
                        <input className="form-check-input float-none m-0" type="checkbox" role="switch"
                          checked={Boolean(row[key])}
                          disabled={busyKey === `${row.category}:${key}` || (key !== 'in_app' && !row.in_app)}
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
