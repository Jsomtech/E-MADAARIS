// School notification analytics: GET /school/notifications/analytics, /delivery-logs and /batches/:batchId.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, BellRing, Mail, Megaphone, RefreshCw, ShieldAlert, ShieldCheck, Smartphone, Users } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { BarView, ChartCard, DoughnutView, LineView } from '../../components/ui/Charts.jsx';
import { Badge, EmptyState, ErrorState, PageHeader, Spinner, StatCard, dateTime } from '../../components/ui/Basics.jsx';
import { humanize } from '../../config/resources.jsx';

const WINDOWS = [7, 14, 30, 90];
const LOG_SIZES = [25, 50, 100];
const CHANNELS = ['push', 'email', 'in_app'];
const OUTCOMES = ['sent', 'failed', 'skipped'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the last sends actually did. The numbers come from the tenant's own inbox and delivery log, so the
 * answer to "did the parents get it" is a record rather than a guess.
 */
export default function NotificationReportPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useState(30);
  const [logPage, setLogPage] = useState(1);
  const [logSize, setLogSize] = useState(25);
  const [logChannel, setLogChannel] = useState('');
  const [logStatus, setLogStatus] = useState('');

  const batchId = params.get('batch') || '';
  const trackedBatch = UUID.test(batchId) ? batchId : '';

  const analytics = useApi('/school/notifications/analytics', { days }, can('notifications.export'));
  const logs = useApi('/school/notifications/delivery-logs', {
    days,
    batch_id: trackedBatch || undefined,
    channel: logChannel || undefined,
    delivery_status: logStatus || undefined,
    limit: logSize,
    offset: (logPage - 1) * logSize,
  }, can('notifications.export'));
  const batch = useApi(`/school/notifications/batches/${trackedBatch}`, undefined, Boolean(trackedBatch) && can('notifications.export'));

  if (!can('notifications.export')) {
    return (
      <>
        <PageHeader title={t('notifications.report.title', { defaultValue: 'Notification delivery' })} />
        <div className="card-soft">
          <EmptyState icon={ShieldAlert}
            title={t('notifications.report.needsPermission', { defaultValue: 'Needs notifications.export' })}
            hint={t('notifications.report.needsPermissionHint', { defaultValue: 'Delivery records name every recipient, so the read is limited to roles granted notifications.export.' })} />
        </div>
      </>
    );
  }

  const a = analytics.data;
  const totals = a?.totals || {};
  const channels = a?.channels || {};

  return (
    <>
      <PageHeader
        title={t('notifications.report.title', { defaultValue: 'Notification delivery' })}
        subtitle={t('notifications.report.subtitle', { defaultValue: 'What this school sent over the last {{days}} days, and how each copy ended.', days })}
        actions={(
          <>
            <select className="form-select form-select-sm" value={days} aria-label={t('notifications.report.window', { defaultValue: 'Window' })}
              onChange={(e) => { setDays(Number(e.target.value)); setLogPage(1); }}>
              {WINDOWS.map((d) => <option key={d} value={d}>{t('notifications.report.lastDays', { defaultValue: 'Last {{days}} days', days: d })}</option>)}
            </select>
            <Link to="/school/send-notice" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1">
              <Megaphone size={14} /> {t('notifications.report.compose', { defaultValue: 'Write a notice' })}
            </Link>
            <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
              onClick={() => { analytics.reload(); logs.reload(); }} disabled={analytics.loading || logs.loading}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
          </>
        )}
      />

      <div className="small text-muted mb-3">
        {t('notifications.report.needsMigration', { defaultValue: 'These reads come from the delivery log and the priority column, both added by supabase/migrations/0025_notification_ops.sql. Until this database has run it the screen reports a missing table rather than empty results.' })}
      </div>

      {analytics.error && <ErrorState error={analytics.error} onRetry={analytics.reload} />}
      {analytics.loading && !a && <Spinner />}
      {a && (
        <>
          <div className="row g-3 mb-3">
            <div className="col-6 col-lg-3">
              <StatCard label={t('notifications.report.sent', { defaultValue: 'Messages written' })} value={totals.sent ?? 0} icon={BellRing}
                hint={a.sampled ? t('notifications.report.sampled', { defaultValue: 'A bounded sample of the busiest window, not the whole ledger.' }) : undefined} />
            </div>
            <div className="col-6 col-lg-3">
              <StatCard label={t('notifications.report.readRate', { defaultValue: 'Read rate' })} value={`${Math.round((totals.read_rate || 0) * 100)}%`} icon={Activity}
                hint={t('notifications.report.readOf', { defaultValue: '{{read}} of {{sent}} opened', read: totals.read ?? 0, sent: totals.sent ?? 0 })} />
            </div>
            <div className="col-6 col-lg-3">
              <StatCard label={t('notifications.report.sends', { defaultValue: 'Composed sends' })} value={totals.sends ?? 0} icon={Megaphone}
                hint={t('notifications.report.reached', { defaultValue: '{{count}} accounts reached', count: totals.recipients_reached ?? 0 })} />
            </div>
            <div className="col-6 col-lg-3">
              <StatCard label={t('notifications.report.devices', { defaultValue: 'Browsers registered' })} value={a.devices?.registered ?? 0} icon={Smartphone} tone="info"
                hint={t('notifications.report.deviceUsers', { defaultValue: '{{count}} accounts with a device', count: a.devices?.unique_users ?? 0 })} />
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-7">
              <ChartCard title={t('notifications.report.overTime', { defaultValue: 'Written and opened, by day' })}>
                <LineView
                  labels={a.by_day.map((d) => d.date)}
                  datasets={[
                    { label: t('notifications.report.sentShort', { defaultValue: 'Written' }), data: a.by_day.map((d) => d.sent) },
                    { label: t('notifications.report.readShort', { defaultValue: 'Opened' }), data: a.by_day.map((d) => d.read), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.12)' },
                  ]}
                />
              </ChartCard>
            </div>
            <div className="col-12 col-md-6 col-xl-5">
              <ChartCard title={t('notifications.report.channelsTitle', { defaultValue: 'How each copy ended' })}
                subtitle={t('notifications.report.channelsSubtitle', { defaultValue: 'Push and email are logged per device and per address; in-app is the inbox row itself.' })}>
                <ChannelSlices channels={channels} t={t} />
              </ChartCard>
            </div>
            <div className="col-12 col-md-6">
              <ChartCard title={t('notifications.report.byCategory', { defaultValue: 'By type' })}>
                {a.by_category.length
                  ? (
                    <BarView
                      labels={a.by_category.map((c) => t(`notifications.categories.${c.category}`, { defaultValue: humanize(c.category) }))}
                      datasets={[
                        { label: t('notifications.report.sentShort', { defaultValue: 'Written' }), data: a.by_category.map((c) => c.sent) },
                        { label: t('notifications.report.readShort', { defaultValue: 'Opened' }), data: a.by_category.map((c) => c.read), backgroundColor: '#22c55e' },
                      ]}
                    />
                  )
                  : <EmptyState icon={BellRing} title={t('common.none')} />}
              </ChartCard>
            </div>
            <div className="col-12 col-md-6">
              <ChartCard title={t('notifications.report.pushErrors', { defaultValue: 'Push rejection codes' })}
                subtitle={t('notifications.report.pushErrorsSubtitle', { defaultValue: 'Firebase answers with these; UNREGISTERED means the browser was re-registered or removed.' })}>
                {a.push_errors.length
                  ? (
                    <table className="table table-sm align-middle mb-0">
                      <tbody>
                        {a.push_errors.map((e) => (
                          <tr key={e.key}>
                            <td className="small"><Badge tone="danger">{e.key}</Badge></td>
                            <td className="small text-muted">{t('notifications.report.occurrences', { defaultValue: 'occurrences' })}</td>
                            <td className="small text-end tabular-nums fw-semibold">{e.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                  : <div className="small text-muted">{t('notifications.report.noPushErrors', { defaultValue: 'No rejected push in this window.' })}</div>}
                <div className="small text-muted mt-2 d-flex align-items-center gap-1">
                  <Users size={13} />
                  {t('notifications.report.pending', { defaultValue: '{{count}} notice(s) still waiting in the queue.', count: a.scheduled_pending ?? 0 })}
                </div>
              </ChartCard>
            </div>
          </div>
        </>
      )}

      {trackedBatch && <BatchCard batch={batch} onClear={() => setParams(() => ({}))} />}

      <div className="card-soft p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
          <strong className="small">{t('notifications.report.logTitle', { defaultValue: 'Delivery log' })}</strong>
          {trackedBatch && (
            <Badge tone="brand">{t('notifications.report.filteredToBatch', { defaultValue: 'Showing one send only' })}</Badge>
          )}
        </div>
        <div className="row g-2 align-items-end">
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold mb-0" htmlFor="dl-channel">{t('notifications.report.channel', { defaultValue: 'Channel' })}</label>
            <select id="dl-channel" className="form-select form-select-sm" value={logChannel}
              onChange={(e) => { setLogChannel(e.target.value); setLogPage(1); }}>
              <option value="">{t('common.all')}</option>
              {CHANNELS.map((c) => <option key={c} value={c}>{t(`notifications.channels.${c}`, { defaultValue: humanize(c) })}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold mb-0" htmlFor="dl-status">{t('common.status')}</label>
            <select id="dl-status" className="form-select form-select-sm" value={logStatus}
              onChange={(e) => { setLogStatus(e.target.value); setLogPage(1); }}>
              <option value="">{t('common.all')}</option>
              {OUTCOMES.map((s) => <option key={s} value={s}>{t(`notifications.outcomes.${s}`, { defaultValue: s })}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold mb-0" htmlFor="dl-size">{t('sections.perPage', { defaultValue: 'Per page' })}</label>
            <select id="dl-size" className="form-select form-select-sm" value={logSize}
              onChange={(e) => { setLogSize(Number(e.target.value)); setLogPage(1); }}>
              {LOG_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <button type="button" className="btn btn-sm btn-outline-secondary w-100"
              onClick={() => { setLogChannel(''); setLogStatus(''); setLogPage(1); }}>
              {t('sections.clear', { defaultValue: 'Clear' })}
            </button>
          </div>
        </div>
      </div>

      <DataTable
        columns={logColumns(t)}
        rows={logs.data || []}
        total={logs.total ?? 0}
        page={logPage}
        pageSize={logSize}
        onPage={setLogPage}
        loading={logs.loading}
        error={logs.error}
        onRetry={logs.reload}
        dense
        rowKey={(r) => r.id || `${r.recipient_user_id}-${r.channel}-${r.attempt}-${r.created_at}`}
        empty={t('notifications.report.logEmpty', { defaultValue: 'Nothing was delivered in this window with these filters.' })}
      />
    </>
  );
}

function ChannelSlices({ channels, t }) {
  const slices = CHANNELS
    .flatMap((channel) => OUTCOMES.map((outcome) => ({
      label: `${t(`notifications.channels.${channel}`, { defaultValue: humanize(channel) })} · ${t(`notifications.outcomes.${outcome}`, { defaultValue: outcome })}`,
      value: channels[channel]?.[outcome] ?? 0,
    })))
    .filter((slice) => slice.value > 0);
  if (!slices.length) return <div className="small text-muted">{t('notifications.report.noLogYet', { defaultValue: 'No push or email has been attempted in this window, so there is nothing to tally. The inbox rows above still counted.' })}</div>;
  return <DoughnutView labels={slices.map((s) => s.label)} data={slices.map((s) => s.value)} />;
}

/** One send, every recipient: what the composer's confirmation screen promised and who actually received it. */
function BatchCard({ batch, onClear }) {
  const { t } = useTranslation();
  if (batch.loading && !batch.data) return <div className="card-soft p-3 mb-3"><Spinner label={t('common.loading')} /></div>;
  if (batch.error) return <div className="mb-3"><ErrorState error={batch.error} onRetry={batch.reload} /></div>;
  const b = batch.data;
  if (!b) return null;

  return (
    <div className="card-soft p-3 mb-3">
      <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-2">
        <div>
          <div className="fw-semibold">{b.title}</div>
          <div className="small text-muted">
            {t(`notifications.categories.${b.category}`, { defaultValue: humanize(b.category) })}
            {b.priority && b.priority !== 'normal' && <> · {t(`notifications.priorities.${b.priority}`, { defaultValue: humanize(b.priority) })}</>}
            <> · {dateTime(b.created_at)}</>
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClear}>
          {t('notifications.report.showWholeWindow', { defaultValue: 'Show the whole window' })}
        </button>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3">
          <StatCard label={t('notifications.report.recipients', { defaultValue: 'Inboxes written' })} value={b.recipients} icon={Mail} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('notifications.report.opened', { defaultValue: 'Already opened' })} value={b.read} icon={Activity} tone="ok" />
        </div>
        {b.requires_ack && (
          <div className="col-6 col-lg-3">
            <StatCard label={t('notifications.report.acknowledged', { defaultValue: 'Acknowledged' })}
              value={`${b.acknowledged ?? 0}/${b.recipients}`} icon={ShieldCheck}
              tone={b.acknowledged === b.recipients ? 'ok' : 'warn'}
              hint={t('notifications.report.ackHint', { defaultValue: 'Opened is not acknowledged — this send asked for a confirmation.' })} />
          </div>
        )}
        <div className="col-12 col-lg-6">
          <div className="small fw-semibold mb-1">{t('notifications.report.channelTally', { defaultValue: 'This send, per channel' })}</div>
          <div className="d-flex flex-wrap gap-1">
            {b.channels.length
              ? b.channels.map((c) => <Badge key={c.key} tone={c.key.endsWith('.sent') ? 'ok' : c.key.endsWith('.failed') ? 'danger' : 'warn'}>{humanize(c.key.replace('.', ' '))} · {c.value}</Badge>)
              : <span className="small text-muted">{t('notifications.report.noChannelLog', { defaultValue: 'This send left no push or email log — it went to the inbox only.' })}</span>}
          </div>
        </div>
      </div>
      <DataTable columns={logColumns(t)} rows={b.deliveries.slice(0, 25)} dense
        rowKey={(r) => `${r.recipient_user_id}-${r.channel}-${r.attempt}-${r.sent_at}`}
        empty={t('notifications.report.noChannelLog', { defaultValue: 'This send left no push or email log — it went to the inbox only.' })} />
      {b.deliveries.length > 25 && (
        <div className="small text-muted mt-2">
          {t('notifications.report.truncatedDeliveries', { defaultValue: 'The 25 newest of {{count}} delivery rows; the log below lists the rest.', count: b.deliveries.length })}
        </div>
      )}
    </div>
  );
}

function logColumns(t) {
  return [
    { key: 'created_at', label: t('common.date'), width: 165, render: (r) => <span className="small tabular-nums">{dateTime(r.created_at || r.sent_at)}</span> },
    {
      key: 'channel',
      label: t('notifications.report.channel', { defaultValue: 'Channel' }),
      width: 110,
      render: (r) => <Badge tone={r.channel === 'push' ? 'brand' : r.channel === 'email' ? 'info' : 'neutral'}>{t(`notifications.channels.${r.channel}`, { defaultValue: humanize(r.channel) })}</Badge>,
    },
    { key: 'delivery_status', label: t('common.status'), type: 'status', width: 110 },
    {
      key: 'recipient_user_id',
      label: t('notifications.report.recipient', { defaultValue: 'Recipient' }),
      width: 130,
      render: (r) => <span className="small text-muted" title={r.recipient_user_id}>{String(r.recipient_user_id || '').slice(0, 8)}</span>,
    },
    {
      key: 'provider_code',
      label: t('notifications.report.code', { defaultValue: 'Answer' }),
      width: 150,
      render: (r) => (r.provider_code ? <span className="small text-capitalize">{r.provider_code}</span> : <span className="text-muted">—</span>),
    },
    { key: 'attempt', label: t('notifications.report.attempt', { defaultValue: 'Try' }), width: 70 },
    {
      key: 'error_message',
      label: t('sections.summary', { defaultValue: 'Detail' }),
      render: (r) => <span className="small">{r.error_message || <span className="text-muted">—</span>}</span>,
    },
  ];
}
