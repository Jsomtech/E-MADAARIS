// Cross-tenant support queue: triage tickets, reply publicly or leave internal notes, set status/priority.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Lock, MessageSquarePlus, RefreshCw, Send, StickyNote } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPatch, apiPost } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Badge, PageHeader, Spinner, StatusBadge, dateTime } from '../../components/ui/Basics.jsx';

/** support_tickets.status values (supabase/migrations/0013_communication.sql). */
const TICKET_STATUSES = ['open', 'in_progress', 'waiting_for_school', 'resolved', 'closed'];
/** support_tickets.priority values. */
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const PRIORITY_TONE = { low: 'neutral', medium: 'info', high: 'warn', urgent: 'danger' };

export default function TicketsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [openId, setOpenId] = useState(null);
  // Replies are only readable through the school endpoint, so the thread we build here is kept per session.
  const [threads, setThreads] = useState({});

  const params = useMemo(() => ({ status: status || undefined, priority: priority || undefined }), [status, priority]);
  const list = useApi('/platform/tickets', params);

  const ticket = (list.data || []).find((r) => r.id === openId) || null;

  const onReply = useCallback((id, reply) => {
    setThreads((prev) => ({ ...prev, [id]: [...(prev[id] || []), reply] }));
    list.reload();
  }, [list]);

  const columns = [
    {
      key: 'subject',
      label: t('platform.subject', { defaultValue: 'Subject' }),
      render: (row) => (
        <button className="btn btn-sm text-start p-0 fw-semibold" onClick={() => setOpenId(row.id)}>
          {row.subject}
          <div className="small text-muted">{row.category} · {row.schools?.school_name || '—'}</div>
        </button>
      ),
    },
    { key: 'priority', label: t('platform.priority', { defaultValue: 'Priority' }), width: 110, render: (r) => <Badge tone={PRIORITY_TONE[r.priority] || 'neutral'}>{r.priority}</Badge> },
    { key: 'status', label: t('common.status'), type: 'status', width: 150 },
    { key: 'updated_at', label: t('platform.updated', { defaultValue: 'Updated' }), render: (r) => <span className="small text-muted">{dateTime(r.updated_at)}</span> },
    {
      key: 'open',
      label: t('common.actions'),
      width: 90,
      className: 'text-end',
      render: (row) => <button className="btn btn-sm btn-outline-secondary" onClick={() => setOpenId(row.id)}>{t('platform.open', { defaultValue: 'Open' })}</button>,
    },
  ];

  const counts = useMemo(() => {
    const all = list.data || [];
    return {
      open: all.filter((r) => r.status === 'open').length,
      urgent: all.filter((r) => r.priority === 'urgent' && !['resolved', 'closed'].includes(r.status)).length,
    };
  }, [list.data]);

  return (
    <>
      <PageHeader
        title={t('platform.tickets', { defaultValue: 'Support tickets' })}
        subtitle={t('platform.ticketsSubtitle', { defaultValue: '{{open}} open · {{urgent}} urgent across all tenants', open: counts.open, urgent: counts.urgent })}
        actions={(
          <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={list.reload}>
            <RefreshCw size={14} /> {t('common.refresh')}
          </button>
        )}
      />

      <div className="card-soft p-2 mb-3">
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <div className="nav nav-pills gap-1 flex-wrap">
            <button className={`btn btn-sm ${status === '' ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setStatus('')}>{t('common.all')}</button>
            {TICKET_STATUSES.map((s) => (
              <button key={s} className={`btn btn-sm ${status === s ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setStatus(s)}>
                {t(`platform.status.${s}`, { defaultValue: s.replace(/_/g, ' ') })}
              </button>
            ))}
          </div>
          <select className="form-select form-select-sm" style={{ maxWidth: 190 }} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">{t('platform.anyPriority', { defaultValue: 'Any priority' })}</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <DataTable columns={columns} rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
        empty={t('platform.noTickets', { defaultValue: 'No tickets in this queue' })} />

      <TicketModal ticket={ticket} replies={threads[ticket?.id] || []}
        onClose={() => setOpenId(null)} onReply={onReply} onUpdated={list.reload} />
    </>
  );
}

function TicketModal({ ticket, replies, onClose, onReply, onUpdated }) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [alsoStatus, setAlsoStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (ticket) { setBody(''); setInternal(false); setAlsoStatus(''); setError(''); }
  }, [ticket]);

  const send = useCallback(async () => {
    const trimmed = body.trim();
    if (trimmed.length < 1) { setError(t('platform.replyEmpty', { defaultValue: 'Write something first' })); return; }
    if (trimmed.length > 4000) { setError(t('platform.replyLong', { defaultValue: 'Max 4000 characters' })); return; }
    setBusy(true);
    try {
      const payload = { reply_body: trimmed, is_internal_note: internal };
      if (alsoStatus) payload.status = alsoStatus;
      const { data } = await apiPost(`/platform/tickets/${ticket.id}/replies`, payload);
      toast.success(internal
        ? t('platform.noteSaved', { defaultValue: 'Internal note saved — not visible to the school.' })
        : t('platform.replySent', { defaultValue: 'Reply sent to the school.' }));
      onReply(ticket.id, data);
      setBody('');
      setAlsoStatus('');
      onUpdated();
    } catch (e) {
      toast.error(e.status === 403 ? t('platform.forbiddenReply', { defaultValue: 'Your account cannot reply to tickets.' }) : e.message);
    } finally { setBusy(false); }
  }, [body, internal, alsoStatus, ticket, onReply, onUpdated, t]);

  const patch = useCallback(async (change) => {
    setBusy(true);
    try {
      await apiPatch(`/platform/tickets/${ticket.id}`, change);
      toast.success(t('platform.ticketUpdated', { defaultValue: 'Ticket updated.' }));
      onUpdated();
    } catch (e) {
      toast.error(e.status === 403 ? t('platform.forbiddenReply', { defaultValue: 'Your account cannot reply to tickets.' }) : e.message);
    } finally { setBusy(false); }
  }, [ticket, onUpdated, t]);

  if (!ticket) return null;

  return (
    <Modal open size="lg" title={ticket.subject} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.close')}</button>
          <button className="btn btn-primary d-flex align-items-center gap-1" onClick={send} disabled={busy}>
            <Send size={14} /> {internal ? t('platform.saveNote', { defaultValue: 'Save internal note' }) : t('platform.sendReply', { defaultValue: 'Send reply' })}
          </button>
        </>
      )}>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        {ticket.schools?.school_id || ticket.school_id ? (
          <Link to={`/platform/schools/${ticket.school_id}`} className="btn btn-sm btn-outline-secondary">{ticket.schools?.school_name || t('platform.school', { defaultValue: 'School' })}</Link>
        ) : <span className="badge text-bg-secondary">{t('platform.noSchool', { defaultValue: 'Platform ticket' })}</span>}
        <span className="small text-muted">{t('platform.category', { defaultValue: 'Category' })}: {ticket.category}</span>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value={ticket.status} onChange={(e) => patch({ status: e.target.value })}>
          {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value={ticket.priority} onChange={(e) => patch({ priority: e.target.value })}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <StatusBadge value={ticket.priority} />
      </div>

      <div className="mb-3">
        <div className="small text-muted mb-1">{t('platform.openedBy', { defaultValue: 'Opened by the school' })} · {dateTime(ticket.created_at)}</div>
        <div className="card-soft p-2 small">{ticket.body || t('platform.noBody', { defaultValue: 'No description given.' })}</div>
      </div>

      {replies.length > 0 && (
        <div className="mb-3">
          <div className="small text-muted mb-1">{t('platform.replies', { defaultValue: 'Replies' })}</div>
          {replies.map((r) => (
            <div key={r.id} className={`p-2 mb-2 rounded small ${r.is_internal_note ? 'border border-warning bg-body-tertiary' : 'card-soft'}`}>
              {r.is_internal_note && (
                <div className="d-flex align-items-center gap-1 text-warning fw-semibold mb-1">
                  <Lock size={12} /> {t('platform.internalBadge', { defaultValue: 'Internal note — never shared with the school' })}
                </div>
              )}
              <div style={{ whiteSpace: 'pre-wrap' }}>{r.reply_body}</div>
              <div className="text-muted mt-1">{dateTime(r.created_at)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="border-top pt-3">
        <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
          <div className="form-check form-switch mb-0">
            <input className="form-check-input" type="checkbox" id="ticket-internal" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            <label className="form-check-label small" htmlFor="ticket-internal">
              <StickyNote size={13} className="me-1" />{t('platform.internalOnly', { defaultValue: 'Internal note (not sent to the school)' })}
            </label>
          </div>
          <select className="form-select form-select-sm" style={{ width: 'auto' }} value={alsoStatus} onChange={(e) => setAlsoStatus(e.target.value)}>
            <option value="">{t('platform.keepStatus', { defaultValue: 'Keep the status' })}</option>
            {TICKET_STATUSES.map((s) => <option key={s} value={s}>{t(`platform.status.${s}`, { defaultValue: s.replace(/_/g, ' ') })}</option>)}
          </select>
        </div>
        <textarea className={`form-control${error ? ' is-invalid' : ''}`} rows={4} maxLength={4000} value={body}
          placeholder={internal ? t('platform.notePlaceholder', { defaultValue: 'Note for the platform team only…' }) : t('platform.replyPlaceholder', { defaultValue: 'Reply to the school…' })}
          onChange={(e) => { setBody(e.target.value); setError(''); }} />
        {error && <div className="form-text text-danger small">{error}</div>}
        <div className="small text-muted mt-2 d-flex align-items-center gap-1">
          <MessageSquarePlus size={13} />
          {t('platform.threadHint', { defaultValue: 'The platform API returns the ticket body plus the replies you post in this session; the school-side history is not exposed here.' })}
        </div>
        {busy && <Spinner label={t('common.loading')} />}
      </div>
    </Modal>
  );
}
