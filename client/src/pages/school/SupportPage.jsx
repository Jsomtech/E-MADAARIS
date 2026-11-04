// School support desk: /school/support/tickets (+ /:id thread, replies) — create, browse, reply.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { LifeBuoy, Lock, MessageSquarePlus, Plus, RefreshCw, Send, StickyNote } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiGet, apiPost } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Field from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Badge, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge, dateTime } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/** support_tickets columns (supabase/migrations/0013_communication.sql lines 48-61) mirrored by the zod schema in server/src/api/flows/extras.js. */
const CATEGORIES = ['technical', 'account', 'subscription', 'billing', 'other'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TICKET_STATUSES = ['open', 'in_progress', 'waiting_for_school', 'resolved', 'closed'];
const PRIORITY_TONE = { low: 'neutral', medium: 'info', high: 'warn', urgent: 'danger' };

export default function SupportPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  const mayView = can('support.view');
  const mayCreate = can('support.create');
  const mayManage = can('support.manage');

  const list = useApi('/school/support/tickets', undefined, mayView);

  const rows = useMemo(() => (list.data || []).filter((r) => !statusFilter || r.status === statusFilter), [list.data, statusFilter]);

  const replyCount = useCallback((row) => (row.support_replies || []).length, []);

  const columns = useMemo(() => [
    {
      key: 'subject',
      label: t('sections.subject', { defaultValue: 'Subject' }),
      render: (row) => (
        <button className="btn btn-sm text-start p-0 fw-semibold" onClick={() => setOpenId(row.id)}>
          {row.subject}
          <div className="small text-muted">
            {row.category} · {t('sections.repliesCount', { defaultValue: '{{count}} replies', count: replyCount(row) })}
          </div>
        </button>
      ),
    },
    {
      key: 'priority',
      label: t('sections.priority', { defaultValue: 'Priority' }),
      width: 110,
      render: (r) => <Badge tone={PRIORITY_TONE[r.priority] || 'neutral'}>{r.priority}</Badge>,
    },
    { key: 'status', label: t('common.status'), type: 'status', width: 160 },
    {
      key: 'created_at',
      label: t('sections.opened', { defaultValue: 'Opened' }),
      width: 170,
      render: (r) => <span className="small text-muted">{dateTime(r.created_at)}</span>,
    },
    {
      key: 'updated_at',
      label: t('sections.updated', { defaultValue: 'Updated' }),
      width: 170,
      render: (r) => <span className="small text-muted">{dateTime(r.updated_at)}</span>,
    },
    {
      key: 'open',
      label: t('common.actions'),
      width: 90,
      className: 'text-end',
      render: (row) => <button className="btn btn-sm btn-outline-secondary" onClick={() => setOpenId(row.id)}>{t('sections.openTicket', { defaultValue: 'Open' })}</button>,
    },
  ], [replyCount, t]);

  if (!mayView) {
    return (
      <>
        <PageHeader title={t('sections.supportTitle', { defaultValue: 'Support center' })} />
        <div className="card-soft">
          <EmptyState icon={LifeBuoy} title={t('sections.supportNoAccess', { defaultValue: 'Your role cannot read support tickets (support.view).' })} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('sections.supportTitle', { defaultValue: 'Support center' })}
        subtitle={t('sections.supportSubtitle', { defaultValue: 'Tickets raised by this school for the E-MADAARIS platform team. The list is the 200 most recently updated tickets; there is no pagination.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={list.reload}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            {mayCreate && (
              <button className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={() => setCreating(true)}>
                <Plus size={14} /> {t('sections.newTicket', { defaultValue: 'New ticket' })}
              </button>
            )}
          </>
        )}
      />

      <div className="card-soft p-2 mb-3">
        <div className="nav nav-pills gap-1 flex-wrap">
          <button className={`btn btn-sm ${statusFilter === '' ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setStatusFilter('')}>{t('common.all')}</button>
          {TICKET_STATUSES.map((s) => (
            <button key={s} className={`btn btn-sm ${statusFilter === s ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setStatusFilter(s)}>
              {t(`sections.ticketStatus.${s}`, { defaultValue: s.replace(/_/g, ' ') })}
            </button>
          ))}
        </div>
        <div className="small text-muted mt-2">
          {t('sections.statusFilterHint', { defaultValue: 'Status filtering happens in the browser: GET /school/support/tickets accepts no query parameters.' })}
        </div>
      </div>

      <DataTable columns={columns} rows={rows} loading={list.loading} error={list.error} onRetry={list.reload} dense
        empty={t('sections.noTickets', { defaultValue: 'No tickets yet — the first one you open will show up here' })} />

      <CreateModal open={creating} onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); list.reload(); }} />

      <TicketModal ticketId={openId} mayManage={mayManage} mayReply={mayCreate}
        onClose={() => setOpenId(null)} onChanged={list.reload} />
    </>
  );
}

function CreateModal({ open, onClose, onCreated }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({ subject: '', category: CATEGORIES[0], priority: 'medium', body: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setValues({ subject: '', category: CATEGORIES[0], priority: 'medium', body: '' }); setErrors({}); }
  }, [open]);

  const submit = async () => {
    const missing = {};
    const subject = values.subject.trim();
    if (subject.length < 3 || subject.length > 200) missing.subject = t('sections.subjectRange', { defaultValue: 'Between 3 and 200 characters' });
    if (values.body.trim().length > 4000) missing.body = t('sections.bodyMax', { defaultValue: 'Max 4000 characters' });
    setErrors(missing);
    if (Object.keys(missing).length) return;
    const body = { subject, category: values.category, priority: values.priority };
    if (values.body.trim()) body.body = values.body.trim();
    setBusy(true);
    try {
      await apiPost('/school/support/tickets', body);
      toast.success(t('sections.ticketCreated', { defaultValue: 'Ticket submitted — the platform team has been notified.' }));
      onCreated();
    } catch (error) {
      toast.error(error.status === 403 ? t('sections.supportCreateRequired', { defaultValue: 'Opening a ticket needs the support.create permission.' }) : error.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} size="md" title={t('sections.newTicket', { defaultValue: 'New ticket' })} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : t('sections.submitTicket', { defaultValue: 'Submit ticket' })}</button>
        </>
      )}>
      <div className="row">
        <Field field={{ name: 'subject', required: true, col: 12, label: t('sections.subject', { defaultValue: 'Subject' }) }}
          value={values.subject} error={errors.subject} onChange={(v) => setValues((p) => ({ ...p, subject: v }))} />
        <Field field={{ name: 'category', type: 'select', col: 6, required: true, label: t('sections.category', { defaultValue: 'Category' }), options: CATEGORIES.map((v) => ({ value: v, label: v })) }}
          value={values.category} onChange={(v) => setValues((p) => ({ ...p, category: v }))} />
        <Field field={{ name: 'priority', type: 'select', col: 6, required: true, label: t('sections.priority', { defaultValue: 'Priority' }), options: PRIORITIES.map((v) => ({ value: v, label: v })) }}
          value={values.priority} onChange={(v) => setValues((p) => ({ ...p, priority: v }))} />
        <Field field={{ name: 'body', type: 'textarea', col: 12, rows: 6, label: t('sections.description', { defaultValue: 'Description' }), placeholder: t('sections.describePlaceholder', { defaultValue: 'What happened, when, and what did you expect?' }) }}
          value={values.body} error={errors.body} onChange={(v) => setValues((p) => ({ ...p, body: v }))} />
      </div>
      <div className="small text-muted">
        {t('sections.createNote', { defaultValue: 'category, subject, body and priority are the only fields the server accepts; status starts at open and is set by the platform team.' })}
      </div>
    </Modal>
  );
}

function TicketModal({ ticketId, mayManage, mayReply, onClose, onChanged }) {
  const { t } = useTranslation();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const body = await apiGet(`/school/support/tickets/${ticketId}`);
      setTicket(body.data || null);
    } catch (e) {
      setError(e);
      setTicket(null);
    } finally { setLoading(false); }
  }, [ticketId]);

  useEffect(() => {
    setReply('');
    setReplyError('');
    load();
  }, [load]);

  const send = useCallback(async () => {
    const text = reply.trim();
    if (!text) { setReplyError(t('sections.replyEmpty', { defaultValue: 'Write something first' })); return; }
    if (text.length > 4000) { setReplyError(t('sections.replyMax', { defaultValue: 'Max 4000 characters' })); return; }
    setBusy(true);
    setReplyError('');
    try {
      await apiPost(`/school/support/tickets/${ticket.id}/replies`, { reply_body: text });
      toast.success(t('sections.replySent', { defaultValue: 'Reply sent to the platform team.' }));
      setReply('');
      await load();
      onChanged();
    } catch (e) {
      toast.error(e.status === 403 ? t('sections.supportCreateRequired', { defaultValue: 'Replying needs the support.create permission.' }) : e.message);
    } finally { setBusy(false); }
  }, [reply, ticket, load, onChanged, t]);

  if (!ticketId) return null;

  return (
    <Modal open size="lg" title={ticket?.subject || t('sections.ticket', { defaultValue: 'Ticket' })} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.close')}</button>
          {mayReply && (
            <button className="btn btn-primary d-inline-flex align-items-center gap-1" onClick={send} disabled={busy}>
              <Send size={14} /> {busy ? '…' : t('sections.sendReply', { defaultValue: 'Send reply' })}
            </button>
          )}
        </>
      )}>
      {loading && <Spinner label={t('common.loading')} />}
      {error && <ErrorState error={error} onRetry={load} />}
      {!loading && !error && ticket && (
        <>
          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <StatusBadge value={ticket.status} />
            <Badge tone={PRIORITY_TONE[ticket.priority] || 'neutral'}>{ticket.priority}</Badge>
            <span className="small text-muted">{t('sections.category', { defaultValue: 'Category' })}: {ticket.category}</span>
            <span className="small text-muted">{dateTime(ticket.created_at)}</span>
          </div>

          <div className="mb-3">
            <div className="small text-muted mb-1">{t('sections.originalMessage', { defaultValue: 'Original message' })}</div>
            <div className="card-soft p-2 small" style={{ whiteSpace: 'pre-wrap' }}>{ticket.body || t('sections.noBody', { defaultValue: 'No description given.' })}</div>
          </div>

          <div className="small text-muted mb-1 d-flex align-items-center gap-1">
            <MessageSquarePlus size={13} /> {t('sections.thread', { defaultValue: 'Thread' })}
          </div>
          {(ticket.replies || []).length === 0 && (
            <div className="alert alert-secondary small py-2">{t('sections.noReplies', { defaultValue: 'No replies yet.' })}</div>
          )}
          {(ticket.replies || []).map((r) => (
            <div key={r.id} className={`p-2 mb-2 rounded small ${r.is_internal_note ? 'border border-warning bg-body-tertiary' : 'card-soft'}`}>
              {r.is_internal_note && (
                <div className="d-flex align-items-center gap-1 text-warning fw-semibold mb-1">
                  <Lock size={12} /> {t('sections.internalBadge', { defaultValue: 'Internal note from the platform team — not authored by your school' })}
                </div>
              )}
              {!r.is_internal_note && r.author_school_user && (
                <div className="d-flex align-items-center gap-1 text-muted mb-1"><StickyNote size={12} /> {t('sections.fromYourSchool', { defaultValue: 'Posted from this school' })}</div>
              )}
              <div style={{ whiteSpace: 'pre-wrap' }}>{r.reply_body}</div>
              <div className="text-muted mt-1">{dateTime(r.created_at)}</div>
            </div>
          ))}

          {mayReply ? (
            <div className="border-top pt-3">
              <textarea className={`form-control${replyError ? ' is-invalid' : ''}`} rows={4} maxLength={4000} value={reply}
                placeholder={t('sections.replyPlaceholder', { defaultValue: 'Add details or answer the platform team…' })}
                onChange={(e) => { setReply(e.target.value); setReplyError(''); }} />
              {replyError && <div className="form-text text-danger small">{replyError}</div>}
            </div>
          ) : (
            <div className="small text-muted border-top pt-2">{t('sections.cannotReply', { defaultValue: 'Reading is allowed, but posting replies needs support.create.' })}</div>
          )}

          <div className="small text-muted mt-2">
            {mayManage
              ? t('sections.manageHint', { defaultValue: 'Your role has support.manage, so the server also returns internal notes in this thread. Replying to a resolved/closed ticket reopens it (the route sets status = open).' })
              : t('sections.threadHint', { defaultValue: 'Without support.manage the server filters internal notes out of this thread. Replying to a resolved/closed ticket reopens it (the route sets status = open).' })}
          </div>
          <div className="small text-muted">
            {t('sections.replyFieldHint', { defaultValue: 'The school-side reply endpoint takes only reply_body — is_internal_note and status changes are platform-side fields.' })}
          </div>
        </>
      )}
    </Modal>
  );
}
