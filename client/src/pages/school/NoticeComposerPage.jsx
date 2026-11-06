/**
 * Send a notice: the school's own composer.
 *
 * The audience is described, never enumerated by the browser — the server resolves who receives the
 * message and re-checks the sender's permissions, so a teacher's class notice cannot become a whole
 * school announcement and a queued notice that fires at dawn obeys the same rule as the keystroke that
 * wrote it. Every picker on this screen is filled from `compose-options`, which answers with the classes,
 * categories and audiences this account is actually allowed to use.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
import { CalendarClock, Loader2, Megaphone, Search, Send, Users, X } from 'lucide-react';
import clsx from 'clsx';
import { apiGet, apiPost } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { humanize } from '../../config/resources.jsx';
import { Badge, EmptyState, ErrorState, PageHeader, Spinner, StatCard } from '../../components/ui/Basics.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const CHANNELS = ['in_app', 'push', 'email'];
/** The caps the composer's own schema applies, stated here so the screen refuses before the server does. */
const MAX_CLASSES = 60;
const MAX_ROLES = 12;
const MAX_PEOPLE = 500;

export default function NoticeComposerPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const maySend = can('notifications.send');

  const [options, setOptions] = useState(null);
  const [optionsError, setOptionsError] = useState(null);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [form, setForm] = useState({
    title: '', body: '', link: '', category: 'announcements', priority: 'normal',
    channels: ['in_app', 'push'], audience: 'all', sendAt: '', ackRequired: false,
  });
  const [classIds, setClassIds] = useState([]);
  const [roleNames, setRoleNames] = useState([]);
  const [people, setSelectedPeople] = useState([]);

  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [scheduled, setScheduled] = useState([]);

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!maySend) return undefined;
    let alive = true;
    apiGet('/school/notifications/compose-options')
      .then((body) => {
        if (!alive) return;
        const data = body.data || {};
        setOptions(data);
        // Default to something this account is allowed to do, rather than the first name in a list it
        // will be refused.
        setForm((prev) => ({
          ...prev,
          audience: (data.audiences || []).includes(prev.audience) ? prev.audience : (data.audiences || ['class'])[0],
          category: (data.categories || []).includes(prev.category) ? prev.category : (data.categories || ['general'])[0],
        }));
      })
      .catch((error) => { if (alive) setOptionsError(error); })
      .finally(() => { if (alive) setLoadingOptions(false); });
    return () => { alive = false; };
  }, [maySend]);

  const loadScheduled = useCallback(async () => {
    try {
      const body = await apiGet('/school/notifications/scheduled');
      setScheduled(Array.isArray(body.data) ? body.data : []);
    } catch { setScheduled([]); }
  }, []);
  useEffect(() => { if (maySend) loadScheduled(); }, [maySend, loadScheduled]);

  if (!maySend) {
    return (
      <>
        <PageHeader title={t('composer.title', { defaultValue: 'Send a notice' })} />
        <EmptyState icon={Megaphone}
          title={t('composer.noPermission', { defaultValue: 'This account cannot send notices' })}
          hint={t('composer.noPermissionHint', { defaultValue: 'Ask a school administrator for the Send notifications switch, or publish through Announcements.' })} />
      </>
    );
  }
  if (loadingOptions) return <Spinner />;
  if (optionsError) {
    return (
      <>
        <PageHeader title={t('composer.title', { defaultValue: 'Send a notice' })} />
        <ErrorState error={optionsError} onRetry={() => window.location.reload()} />
      </>
    );
  }

  const payload = {
    title: form.title.trim(),
    body: form.body.trim() || undefined,
    link: form.link.trim() || undefined,
    category: form.category,
    priority: form.priority,
    channels: form.channels,
    audience: form.audience,
    class_ids: form.audience === 'class' ? classIds : [],
    role_names: form.audience === 'roles' ? roleNames : [],
    user_ids: form.audience === 'users' ? people.map((p) => p.id) : [],
    ack_required: form.ackRequired && form.channels.includes('in_app'),
    send_at: form.sendAt ? new Date(form.sendAt).toISOString() : undefined,
  };
  // The preview is the confirmation: it is only worth its number while nothing has changed since.
  const signature = JSON.stringify(payload);

  const missing = () => {
    if (payload.title.length < 3) return t('composer.needSubject', { defaultValue: 'Write a subject of at least three characters.' });
    if (!payload.channels.length) return t('composer.needChannel', { defaultValue: 'Choose at least one way to deliver it.' });
    if (payload.audience === 'class' && !payload.class_ids.length) return t('composer.needClass', { defaultValue: 'Pick the class or classes to address.' });
    if (payload.audience === 'roles' && !payload.role_names.length) return t('composer.needRole', { defaultValue: 'Pick at least one role.' });
    if (payload.audience === 'users' && !payload.user_ids.length) return t('composer.needPerson', { defaultValue: 'Pick at least one recipient.' });
    if (payload.class_ids.length > MAX_CLASSES) return t('composer.tooManyClasses', { defaultValue: 'One notice may cover at most {{max}} classes.', max: MAX_CLASSES });
    if (payload.role_names.length > MAX_ROLES) return t('composer.tooManyRoles', { defaultValue: 'One notice may name at most {{max}} roles.', max: MAX_ROLES });
    if (payload.user_ids.length > MAX_PEOPLE) return t('composer.tooManyPeople', { defaultValue: 'One notice may name at most {{max}} people.', max: MAX_PEOPLE });
    if (form.sendAt && new Date(form.sendAt).getTime() - Date.now() < 60_000) {
      return t('composer.needFuture', { defaultValue: 'A scheduled notice must be at least a minute from now, or leave the time empty to send at once.' });
    }
    return null;
  };

  const runPreview = async () => {
    const problem = missing();
    if (problem) { toast.error(problem); return null; }
    setChecking(true);
    try {
      const body = await apiPost('/school/notifications/preview', payload);
      setPreview({ ...body.data, signature });
      return body.data;
    } catch (e) {
      toast.error(e.message);
      setPreview(null);
      return null;
    } finally {
      setChecking(false);
    }
  };

  const askToSend = async () => {
    const fresh = preview?.signature === signature ? preview : await runPreview();
    if (fresh) setConfirmOpen(true);
  };

  const send = async () => {
    setBusy(true);
    try {
      const body = await apiPost('/school/notifications/send', payload);
      setResult({ ...body.data, ack_requested: payload.ack_required });
      setConfirmOpen(false);
      setPreview(null);
      setForm((prev) => ({ ...prev, title: '', body: '' }));
      toast.success(body.data?.status === 'scheduled'
        ? t('composer.scheduled', { defaultValue: 'Queued — it will go out at the time you set.' })
        : t('composer.sent', { defaultValue: 'Sent to {{count}} inbox(es).', count: body.data?.delivered ?? 0 }));
      loadScheduled();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelScheduled = async (row) => {
    try {
      await apiPost(`/school/notifications/scheduled/${row.id}/cancel`, {});
      toast.success(t('composer.cancelled', { defaultValue: 'Cancelled.' }));
      loadScheduled();
    } catch (e) {
      toast.error(e.message);
      loadScheduled();
    }
  };

  return (
    <>
      <PageHeader
        title={t('composer.title', { defaultValue: 'Send a notice' })}
        subtitle={t('composer.subtitle', { defaultValue: 'Say who should receive it; the server decides who actually does.' })}
        actions={(
          <Link to="/notifications" className="btn btn-sm btn-outline-secondary">
            {t('composer.myInbox', { defaultValue: 'My inbox' })}
          </Link>
        )}
      />

      <div className="row g-3">
        <div className="col-lg-7">
          <div className="card-soft p-3">
            <div className="mb-3">
              <label className="form-label" htmlFor="notice-title">{t('composer.subject', { defaultValue: 'Subject' })}</label>
              <input id="notice-title" className="form-control" maxLength={180} value={form.title}
                placeholder={t('composer.subjectExample', { defaultValue: 'Mark your attendance for today before 16:00' })}
                onChange={(e) => set('title')(e.target.value)} />
              <div className="small text-muted mt-1">{form.title.trim().length}/180</div>
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="notice-body">{t('composer.message', { defaultValue: 'Message' })}</label>
              <textarea id="notice-body" className="form-control" rows={5} maxLength={2000} value={form.body}
                placeholder={t('composer.messageExample', { defaultValue: 'The register closes automatically at the end of the day.' })}
                onChange={(e) => set('body')(e.target.value)} />
            </div>

            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label" htmlFor="notice-category">{t('composer.category', { defaultValue: 'About' })}</label>
                <select id="notice-category" className="form-select" value={form.category} onChange={(e) => set('category')(e.target.value)}>
                  {(options?.categories || []).map((c) => (
                    <option key={c} value={c}>{t(`notifications.categories.${c}`, { defaultValue: humanize(c) })}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label" htmlFor="notice-priority">{t('composer.priority', { defaultValue: 'Priority' })}</label>
                <select id="notice-priority" className="form-select" value={form.priority} onChange={(e) => set('priority')(e.target.value)}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{t(`composer.priorities.${p}`, { defaultValue: humanize(p) })}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label" htmlFor="notice-link">{t('composer.link', { defaultValue: 'Open this page' })}</label>
                <input id="notice-link" className="form-control" maxLength={200} value={form.link} placeholder="/notifications"
                  onChange={(e) => set('link')(e.target.value)} />
              </div>
            </div>

            <div className="mt-3">
              <div className="form-label">{t('composer.channels', { defaultValue: 'How it arrives' })}</div>
              <div className="d-flex gap-3 flex-wrap">
                {CHANNELS.map((channel) => (
                  <div className="form-check" key={channel}>
                    <input className="form-check-input" type="checkbox" id={`ch-${channel}`}
                      checked={form.channels.includes(channel)}
                      onChange={(e) => set('channels')(
                        e.target.checked ? [...form.channels, channel] : form.channels.filter((c) => c !== channel),
                      )} />
                    <label className="form-check-label small" htmlFor={`ch-${channel}`}>
                      {t(`composer.channels.${channel}`, {
                        defaultValue: channel === 'in_app' ? 'In the inbox' : channel === 'push' ? 'As a push' : 'By email',
                      })}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-check mt-3">
              <input className="form-check-input" type="checkbox" id="notice-ack"
                checked={form.ackRequired} disabled={!form.channels.includes('in_app')}
                onChange={(e) => set('ackRequired')(e.target.checked)} />
              <label className="form-check-label small" htmlFor="notice-ack">
                {t('composer.requireAck', { defaultValue: 'Require each recipient to confirm they read it' })}
              </label>
              <div className="small text-muted mt-1">
                {form.channels.includes('in_app')
                  ? t('composer.requireAckHint', { defaultValue: 'The message is put in front of them again every time they sign in until they press Acknowledge. A phone showing the notification does not count — being told is not having read it.' })
                  : t('composer.requireAckNeedsInbox', { defaultValue: 'Needs the inbox copy switched on: the confirmation is asked of the message in their list.' })}
              </div>
            </div>

            <hr className="my-3" />

            <AudiencePicker
              options={options} form={form} set={set}
              classIds={classIds} setClassIds={setClassIds}
              roleNames={roleNames} setRoleNames={setRoleNames}
              people={people} setPeople={setSelectedPeople}
            />

            <div className="mt-3">
              <label className="form-label" htmlFor="notice-when">
                <CalendarClock size={13} className="me-1 align-text-bottom" />
                {t('composer.schedule', { defaultValue: 'Send at (leave empty for now)' })}
              </label>
              <div className="d-flex align-items-center gap-2">
                <input id="notice-when" type="datetime-local" className="form-control" style={{ maxWidth: 260 }}
                  value={form.sendAt} onChange={(e) => set('sendAt')(e.target.value)} />
                {form.sendAt && (
                  <button type="button" className="btn btn-sm btn-link text-decoration-none"
                    onClick={() => set('sendAt')('')}>
                    {t('composer.sendNow', { defaultValue: 'Send now instead' })}
                  </button>
                )}
              </div>
              <div className="small text-muted mt-1">
                {t('composer.scheduleHint', { defaultValue: 'A queued notice counts its recipients again when it is due, and a sender who has since lost the permission cannot send it.' })}
              </div>
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="card-soft p-3 sticky-lg-top" style={{ top: 16 }}>
            <strong className="small">{t('composer.goingTo', { defaultValue: 'Going to' })}</strong>
            <div className="display-6 fw-semibold my-2">
              {preview?.signature === signature ? preview.recipients : '—'}
              {preview?.signature === signature && (
                <span className="h6 text-muted ms-2">{t('composer.people', { defaultValue: 'people' })}</span>
              )}
            </div>
            {preview?.signature === signature ? (
              <>
                <div className="small text-muted mb-2">{preview.audience_detail}</div>
                {preview.over_cap && (
                  <div className="alert alert-warning py-2 small mb-2">
                    {t('composer.overCap', { defaultValue: 'This audience is larger than one send may carry; the rest are trimmed.' })}
                  </div>
                )}
                {preview.scoped_to_classes != null && form.audience !== 'class' && (
                  <div className="small text-muted mb-2">
                    {t('composer.narrowed', { defaultValue: 'Narrowed to the {{count}} class(es) this account teaches.', count: preview.scoped_to_classes })}
                  </div>
                )}
              </>
            ) : (
              <div className="small text-muted mb-2">
                {t('composer.previewHint', { defaultValue: 'Check the audience to see exactly how many inboxes this reaches before anything is written.' })}
              </div>
            )}
            <div className="d-flex gap-2 flex-wrap mt-2">
              <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                onClick={runPreview} disabled={checking}>
                {checking ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
                {t('composer.checkAudience', { defaultValue: 'Check the audience' })}
              </button>
              <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1"
                onClick={askToSend} disabled={checking || busy}>
                <Send size={14} /> {t('composer.send', { defaultValue: 'Send' })}
              </button>
            </div>

            {result && <ResultCard result={result} />}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="d-flex align-items-center justify-content-between mb-2">
          <h2 className="h6 mb-0">{t('composer.queue', { defaultValue: 'Waiting to go out' })}</h2>
          <button type="button" className="btn btn-sm btn-link text-decoration-none" onClick={loadScheduled}>
            {t('common.refresh', { defaultValue: 'Refresh' })}
          </button>
        </div>
        {!scheduled.length
          ? <EmptyState icon={CalendarClock} title={t('composer.queueEmpty', { defaultValue: 'Nothing is scheduled.' })} />
          : (
            <div className="card-soft">
              {scheduled.map((row) => (
                <div key={row.id} className="d-flex justify-content-between align-items-start gap-3 p-3 border-bottom">
                  <div className="min-width-0">
                    <div className="fw-semibold small">{row.title}</div>
                    <div className="small text-muted">
                      {t(`notifications.categories.${row.category}`, { defaultValue: humanize(row.category) })}
                      {' · '}
                      {new Date(row.scheduled_at).toLocaleString()}
                      {' · '}
                      <StatusTone status={row.status} />
                    </div>
                    {row.last_error && <div className="small text-danger mt-1">{row.last_error}</div>}
                  </div>
                  {row.status === 'pending' && (
                    <button type="button" className="btn btn-sm btn-outline-danger flex-shrink-0"
                      onClick={() => cancelScheduled(row)}>
                      {t('composer.cancel', { defaultValue: 'Cancel' })}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t('composer.confirmTitle', { defaultValue: 'Send this notice?' })}
        message={(
          <div>
            <div className="fw-semibold mb-1">{payload.title}</div>
            {payload.body && <div className="small text-muted mb-2">{payload.body.slice(0, 300)}</div>}
            <div className="small">
              {t('composer.confirmTo', { defaultValue: 'Reaches' })} <strong>{preview?.recipients ?? 0}</strong>{' '}
              {preview?.audience_detail}
            </div>
            <div className="small text-muted mt-1">
              {(payload.channels || []).map((c) => t(`composer.channels.${c}`, { defaultValue: humanize(c) })).join(' · ')}
              {payload.send_at ? ` · ${new Date(payload.send_at).toLocaleString()}` : ''}
            </div>
            {payload.ack_required && (
              <div className="small mt-1">
                {t('composer.confirmAck', { defaultValue: 'Each recipient is asked to confirm they read it, every time they sign in, until they do.' })}
              </div>
            )}
            <div className="small text-muted mt-2">
              {payload.send_at
                ? t('composer.confirmQueued', { defaultValue: 'Queued now, counted again when it is due.' })
                : t('composer.confirmNow', { defaultValue: 'This writes to those inboxes immediately and cannot be recalled.' })}
            </div>
          </div>
        )}
        confirmLabel={busy ? t('common.saving') : t('composer.send', { defaultValue: 'Send' })}
        danger={false}
        busy={busy}
        onConfirm={send}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}

function StatusTone({ status }) {
  const tone = status === 'failed' ? 'danger' : status === 'sending' ? 'info' : 'warn';
  return <Badge tone={tone}>{humanize(status)}</Badge>;
}

/** The audience controls: only the pickers this account may use are rendered. */
function AudiencePicker({ options, form, set, classIds, setClassIds, roleNames, setRoleNames, people, setPeople }) {
  const { t } = useTranslation();
  const toggle = (list, setList, value) => setList(
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
  );

  return (
    <>
      <div className="form-label">{t('composer.audience', { defaultValue: 'Who receives it' })}</div>
      <div className="btn-group flex-wrap" role="group" style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
        {(options?.audiences || []).map((a) => (
          <button type="button" key={a}
            className={clsx('btn btn-sm', form.audience === a ? 'btn-primary' : 'btn-outline-primary')}
            onClick={() => set('audience')(a)}>
            {t(`composer.audiences.${a}`, { defaultValue: humanize(a) })}
          </button>
        ))}
      </div>

      {!options?.can_announce && (
        <div className="small text-muted mt-2">
          {t('composer.narrowAudience', { defaultValue: 'This account addresses its own classes and the people it teaches. Whole-school audiences need the announcement switches.' })}
        </div>
      )}

      {form.audience === 'class' && (
        <div className="mt-3">
          <div className="form-label small fw-semibold">{t('composer.classes', { defaultValue: 'Classes' })}</div>
          {!options?.classes?.length ? (
            <div className="small text-muted">{t('composer.noClasses', { defaultValue: 'No classes are assigned to this account yet.' })}</div>
          ) : (
            <ClassPicker classes={options.classes} selected={classIds} onChange={setClassIds} />
          )}
        </div>
      )}

      {form.audience === 'roles' && (
        <div className="mt-3">
          <div className="form-label small fw-semibold">{t('composer.roles', { defaultValue: 'Roles' })}</div>
          <div className="d-flex gap-2 flex-wrap">
            {(options?.roles || []).map((name) => (
              <button type="button" key={name}
                className={clsx('btn btn-sm', roleNames.includes(name) ? 'btn-primary' : 'btn-outline-secondary')}
                onClick={() => toggle(roleNames, setRoleNames, name)}>
                {t(`roles.${name}`, { defaultValue: humanize(name) })}
              </button>
            ))}
          </div>
          {!options?.roles?.length && <div className="small text-muted">{t('composer.noRoles', { defaultValue: 'No roles exist in this school yet.' })}</div>}
        </div>
      )}

      {form.audience === 'users' && (
        <div className="mt-3">
          <div className="form-label small fw-semibold">{t('composer.peopleLabel', { defaultValue: 'Recipients' })}</div>
          <PersonPicker people={people} onChange={setPeople} />
        </div>
      )}
    </>
  );
}

function ClassPicker({ classes, selected, onChange }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return term ? classes.filter((c) => String(c.name).toLowerCase().includes(term)) : classes;
  }, [classes, filter]);

  return (
    <>
      <input className="form-control form-control-sm mb-2" value={filter}
        placeholder={t('composer.filterClasses', { defaultValue: 'Filter classes' })}
        onChange={(e) => setFilter(e.target.value)} />
      <div className="border rounded-3 p-2" style={{ maxHeight: 220, overflowY: 'auto' }}>
        {shown.map((c) => (
          <label key={c.id} className="form-check d-flex align-items-center gap-2 mb-1">
            <input className="form-check-input m-0 flex-shrink-0" type="checkbox"
              checked={selected.includes(c.id)}
              onChange={() => onChange(
                selected.includes(c.id) ? selected.filter((id) => id !== c.id) : [...selected, c.id],
              )} />
            <span className="small">{c.name}</span>
          </label>
        ))}
        {!shown.length && <div className="small text-muted">{t('common.none')}</div>}
      </div>
      <div className="small text-muted mt-1">
        {t('composer.classesSelected', { defaultValue: '{{count}} selected', count: selected.length })}
      </div>
    </>
  );
}

/**
 * One search box for the individual audience. The directory call needs at least two characters, which
 * keeps a permission to send a message from becoming a way to page through the school's records.
 */
function PersonPicker({ people, onChange }) {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const [role, setRole] = useState('');
  const [results, setResults] = useState([]);
  const [roleNames, setRoleNames] = useState([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (term.trim().length < 2 && !role) { setResults([]); return undefined; }
    timer.current = setTimeout(() => {
      setSearching(true);
      const params = { limit: 30, ...(term.trim() ? { q: term.trim() } : {}), ...(role ? { role } : {}) };
      apiGet('/school/notifications/compose-options', params)
        .then((body) => {
          setResults(body.data?.people || []);
          setRoleNames(body.data?.roles || []);
        })
        .catch((error) => toast.error(error.message))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer.current);
  }, [term, role]);

  const toggle = (row) => onChange(
    people.some((p) => p.id === row.id) ? people.filter((p) => p.id !== row.id) : [...people, row],
  );

  return (
    <>
      <div className="d-flex gap-2 mb-2">
        <div className="input-group input-group-sm flex-grow-1">
          <span className="input-group-text"><Search size={13} /></span>
          <input className="form-control" value={term} onChange={(e) => setTerm(e.target.value)}
            placeholder={t('composer.searchPeople', { defaultValue: 'Search a name or email (two characters)' })} />
        </div>
        <select className="form-select form-select-sm" style={{ maxWidth: 180 }} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">{t('composer.anyRole', { defaultValue: 'Any role' })}</option>
          {roleNames.map((name) => <option key={name} value={name}>{t(`roles.${name}`, { defaultValue: humanize(name) })}</option>)}
        </select>
      </div>
      {searching && <Spinner />}
      {!searching && (term.trim().length < 2 && !role) && (
        <div className="small text-muted">{t('composer.searchHint', { defaultValue: 'Start typing to find someone in this school.' })}</div>
      )}
      {!searching && results.length > 0 && (
        <div className="border rounded-3 p-2 mb-2" style={{ maxHeight: 200, overflowY: 'auto' }}>
          {results.map((row) => (
            <label key={row.id} className="form-check d-flex align-items-center gap-2 mb-1">
              <input className="form-check-input m-0 flex-shrink-0" type="checkbox"
                checked={people.some((p) => p.id === row.id)} onChange={() => toggle(row)} />
              <span className="min-width-0">
                <span className="small d-block text-truncate">{row.full_name}</span>
                <span className="small text-muted">{(row.roles || []).map((r) => humanize(r)).join(', ') || row.email || ''}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {!searching && term.trim().length >= 2 && !results.length && (
        <div className="small text-muted mb-2">{t('composer.noMatches', { defaultValue: 'Nobody in this school matches.' })}</div>
      )}
      {people.length > 0 && (
        <div className="class-chip-row mt-2">
          {people.map((p) => (
            <button type="button" key={p.id} className="class-chip class-chip-btn" onClick={() => toggle(p)} title={p.full_name}>
              {p.full_name}
              <span className="chip-x"><X size={12} /></span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ResultCard({ result }) {
  const { t } = useTranslation();
  if (result.status === 'scheduled') {
    return (
      <div className="alert alert-info py-2 small mt-3 mb-0">
        {t('composer.queuedNote', { defaultValue: 'Queued for {{when}}. Recipients are counted again when it is due.', when: new Date(result.scheduled?.scheduled_at).toLocaleString() })}
      </div>
    );
  }
  const push = result.push || {};
  return (
    <div className="mt-3">
      <div className="row g-2">
        <div className="col-6">
          <StatCard label={t('composer.delivered', { defaultValue: 'Inboxes written' })} value={result.delivered}
            hint={`${result.addressed} ${t('composer.addressed', { defaultValue: 'addressed' })}`} />
        </div>
        <div className="col-6">
          <StatCard label={t('composer.suppressed', { defaultValue: 'Silenced by their own settings' })} value={result.suppressed} tone="warn" />
        </div>
      </div>
      <div className="small text-muted mt-2">
        {push.skipped && typeof push.skipped === 'string'
          ? t(`composer.pushSkipped.${push.skipped}`, { defaultValue: `Push was skipped (${humanize(push.skipped)}).` })
          : `${t('composer.pushNote', { defaultValue: 'Push' })}: ${push.sent ?? 0} sent, ${push.failed ?? 0} failed`}
        {push.pending ? ` — ${t('composer.pushPending', { defaultValue: 'still sending; the delivery log has the final counts' })}` : ''}
      </div>
      {result.ack_requested && (result.ack_required ? (
        <div className="small text-muted mt-1">
          {t('composer.ackAsked', { defaultValue: 'Acknowledgment is required — the send report counts who has confirmed.' })}
        </div>
      ) : (
        <div className="small text-warning mt-1">
          {t('composer.ackUnavailable', { defaultValue: 'The notice went out, but no acknowledgment was attached: this database needs migration 0027.' })}
        </div>
      ))}
      <Link to={`/school/notification-report?batch=${result.batch_id}`} className="small">
        {t('composer.seeDelivery', { defaultValue: 'See who received it' })}
      </Link>
    </div>
  );
}
