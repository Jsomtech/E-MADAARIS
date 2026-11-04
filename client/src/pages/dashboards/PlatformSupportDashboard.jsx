import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Headphones, Building2, ClipboardList, Inbox, AlertTriangle } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import {
  PageHeader, StatCard, Badge, StatusBadge, Spinner, ErrorState, EmptyState, dateOnly,
} from '../../components/ui/Basics.jsx';

/**
 * Support console: the open queue from GET /platform/tickets plus only the tenant-health numbers a
 * support agent needs from GET /platform/dashboard. Deliberately shows no billing or revenue data.
 */
const OPEN_STATES = ['open', 'pending', 'in_progress', 'waiting_for_school', 'unassigned'];
const PRIORITY_TONE = { urgent: 'danger', high: 'warn', medium: 'info', low: 'neutral' };

export default function PlatformSupportDashboard() {
  const { t } = useTranslation();
  const tickets = useApi('/platform/tickets', { pageSize: 25 });
  const summary = useApi('/platform/dashboard');

  if (tickets.loading && !tickets.data) return <Spinner label={t('common.loading')} />;
  if (tickets.error) return <ErrorState error={tickets.error} onRetry={tickets.reload} />;

  const all = tickets.data || [];
  const openTickets = all.filter((tk) => OPEN_STATES.includes(String(tk.status || 'open')));
  const countsByStatus = all.reduce((acc, tk) => {
    const key = String(tk.status || 'open');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const urgentCount = openTickets.filter((tk) => ['urgent', 'high'].includes(String(tk.priority))).length;
  const stats = summary.data?.stats || {};

  return (
    <>
      <PageHeader
        title={t('dashboards.supportQueue', { defaultValue: 'Support queue' })}
        subtitle={t('dashboards.supportSubtitle', { defaultValue: 'Schools needing help right now' })}
        actions={(
          <>
            <Link to="/platform/tickets" className="btn btn-sm btn-primary d-flex align-items-center gap-1">
              <Headphones size={14} /> {t('modules.tickets')}
            </Link>
            <Link to="/platform/schools" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1">
              <Building2 size={14} /> {t('modules.schools')}
            </Link>
          </>
        )}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.openTickets', { defaultValue: 'Open tickets' })} value={openTickets.length} icon={Headphones}
            hint={`${urgentCount} ${t('dashboards.highPriority', { defaultValue: 'high priority' })}`} />
        </div>
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.activeSchools', { defaultValue: 'Active schools' })} value={stats.activeSchools} icon={Building2} /></div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.trialSchools', { defaultValue: 'Trial schools' })} value={stats.trialSchools} icon={Inbox}
            hint={`${stats.schools ?? 0} ${t('modules.schools').toLowerCase()}`} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.suspendedSchools', { defaultValue: 'Suspended schools' })} value={stats.suspendedSchools} icon={AlertTriangle} tone="warn" />
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-4">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2"><Headphones size={15} className="me-1" /> {t('dashboards.ticketsByStatus', { defaultValue: 'Tickets by status' })}</div>
            {Object.entries(countsByStatus).length === 0 && <EmptyState title={t('common.none')} />}
            {Object.entries(countsByStatus).map(([status, count]) => (
              <div key={status} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <StatusBadge value={status} />
                <span className="fw-semibold">{count}</span>
              </div>
            ))}
            <div className="small text-muted mt-2">
              {stats.pendingApplications ?? 0} {t('dashboards.pendingApplications', { defaultValue: 'school applications waiting' })}
            </div>
            <Link to="/platform/applications" className="btn btn-sm btn-outline-primary mt-2 d-flex align-items-center gap-1">
              <ClipboardList size={14} /> {t('modules.applications')}
            </Link>
          </div>
        </div>

        <div className="col-12 col-lg-8">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><Headphones size={15} className="me-1" /> {t('dashboards.needsAttention', { defaultValue: 'Needs attention' })}</div>
              <Link to="/platform/tickets" className="small">{t('common.viewAll')}</Link>
            </div>
            {openTickets.length === 0 && (
              <EmptyState title={t('dashboards.queueClear', { defaultValue: 'No open tickets' })}
                hint={t('dashboards.queueClearHint', { defaultValue: 'Everything raised by the schools is handled.' })} icon={Inbox} />
            )}
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0 small">
                {openTickets.length > 0 && (
                  <thead className="bg-white">
                    <tr>
                      <th>{t('common.name')}</th>
                      <th>{t('dashboards.school', { defaultValue: 'School' })}</th>
                      <th>{t('common.status')}</th>
                      <th>{t('dashboards.priority', { defaultValue: 'Priority' })}</th>
                      <th className="text-end">{t('common.date')}</th>
                    </tr>
                  </thead>
                )}
                <tbody>
                  {openTickets.slice(0, 15).map((tk) => (
                    <tr key={tk.id}>
                      <td className="text-truncate" style={{ maxWidth: 260 }}>
                        <div className="fw-semibold">{tk.subject || t('dashboards.untitledTicket', { defaultValue: 'Untitled ticket' })}</div>
                        <div className="text-muted">{tk.category || '—'}</div>
                      </td>
                      <td className="text-truncate">{tk.schools?.school_name || '—'}</td>
                      <td><StatusBadge value={tk.status} /></td>
                      <td><Badge tone={PRIORITY_TONE[String(tk.priority)] || 'neutral'}>{String(tk.priority || '—').replace(/_/g, ' ')}</Badge></td>
                      <td className="text-end text-muted white-space-nowrap">{dateOnly(tk.updated_at || tk.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
