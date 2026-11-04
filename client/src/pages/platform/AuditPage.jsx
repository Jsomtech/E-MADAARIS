// Platform-wide audit trail (Super Admin only, read-only: no delete, no export).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { RefreshCw, ScrollText, ShieldAlert } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { Badge, EmptyState, PageHeader, dateTime } from '../../components/ui/Basics.jsx';

/** module values written by audit() in server/src (audit_logs.module). */
const MODULES = [
  'auth', 'school', 'schools', 'plans', 'subscriptions', 'subscription', 'billing',
  'platform_users', 'support', 'users', 'students', 'attendance', 'examinations',
  'marks', 'results', 'finance', 'certificates', 'reports',
];
/** action values written by audit() (audit_logs.action). */
const ACTIONS = [
  'created', 'updated', 'deleted', 'archived', 'approved', 'rejected', 'published',
  'login', 'logout', 'status_changed', 'limits_changed', 'settings_updated',
  'payment_recorded', 'payment_approved', 'payment_rejected', 'payment_reversed',
  'replied', 'submitted', 'evidence_submitted', 'fees_assigned', 'issued', 'invited', 'exported',
];

export default function AuditPage() {
  const { t } = useTranslation();
  const [schoolId, setSchoolId] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [action, setAction] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = useMemo(() => ({
    school_id: schoolId || undefined,
    module: moduleFilter || undefined,
    action: action || undefined,
    status: status || undefined,
    from: from ? new Date(`${from}T00:00:00.000`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  }), [schoolId, moduleFilter, action, status, from, to]);

  const list = useApi('/platform/audit-logs', params);
  const schools = useApi('/platform/schools', { pageSize: 200 });

  const forbidden = list.error?.status === 403;

  const schoolOptions = useMemo(() => (schools.data || []).map((s) => ({ value: s.id, label: s.school_name })), [schools.data]);

  const columns = [
    { key: 'created_at', label: t('common.date'), width: 180, render: (r) => <span className="small">{dateTime(r.created_at)}</span> },
    {
      key: 'school',
      label: t('platform.school', { defaultValue: 'School' }),
      render: (row) => (row.school_id
        ? <Link to={`/platform/schools/${row.school_id}`} className="small text-decoration-none">{row.schools?.school_name || row.school_id}</Link>
        : <span className="small text-muted">{t('platform.platformLevel', { defaultValue: 'Platform level' })}</span>),
    },
    { key: 'module', label: t('platform.module', { defaultValue: 'Module' }), width: 140, render: (r) => <span className="small">{r.module}</span> },
    { key: 'action', label: t('platform.action', { defaultValue: 'Action' }), width: 150, render: (r) => <Badge tone="neutral">{String(r.action).replace(/_/g, ' ')}</Badge> },
    {
      key: 'summary',
      label: t('platform.summary', { defaultValue: 'Summary' }),
      render: (row) => (
        <div className="small">
          <span>{row.summary || '—'}</span>
          {row.record_id && <div className="text-muted">{t('platform.record', { defaultValue: 'Record' })}: {row.record_id}</div>}
        </div>
      ),
    },
    { key: 'status', label: t('common.status'), type: 'status', width: 110 },
  ];

  if (forbidden) {
    return (
      <>
        <PageHeader title={t('platform.audit', { defaultValue: 'Audit trail' })} />
        <div className="card-soft">
          <EmptyState icon={ShieldAlert}
            title={t('platform.superAdminOnlyTitle', { defaultValue: 'Super Admin only' })}
            hint={t('platform.auditForbidden', { defaultValue: 'The platform-wide audit log is readable by Super Admins only. Platform Support gets a 403 here — nothing is broken.' })} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('platform.audit', { defaultValue: 'Audit trail' })}
        subtitle={t('platform.auditSubtitle', { defaultValue: 'Every server-side action across all tenants, newest first (max 500 rows per query).' })}
        actions={(
          <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={list.reload}>
            <RefreshCw size={14} /> {t('platform.refresh', { defaultValue: 'Refresh' })}
          </button>
        )}
      />

      <div className="card-soft p-3 mb-3">
        <div className="row g-2">
          <div className="col-12 col-md-4">
            <label className="form-label small fw-semibold">{t('platform.school', { defaultValue: 'School' })}</label>
            <select className="form-select form-select-sm" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
              <option value="">{schools.loading ? t('common.loading') : t('platform.allSchools', { defaultValue: 'All schools' })}</option>
              {schoolOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold">{t('platform.module', { defaultValue: 'Module' })}</label>
            <select className="form-select form-select-sm" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold">{t('platform.action', { defaultValue: 'Action' })}</label>
            <select className="form-select form-select-sm" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {ACTIONS.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold">{t('common.status')}</label>
            <select className="form-select form-select-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('common.all')}</option>
              <option value="success">{t('platform.success', { defaultValue: 'success' })}</option>
              <option value="failure">{t('platform.failure', { defaultValue: 'failure' })}</option>
            </select>
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold">{t('platform.dateFrom', { defaultValue: 'From' })}</label>
            <input type="date" className="form-control form-control-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label small fw-semibold">{t('platform.dateTo', { defaultValue: 'To' })}</label>
            <input type="date" className="form-control form-control-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2 align-items-center mt-2">
          <button className="btn btn-sm btn-outline-secondary" onClick={() => { setSchoolId(''); setModuleFilter(''); setAction(''); setStatus(''); setFrom(''); setTo(''); }}>
            {t('platform.clearFilters', { defaultValue: 'Clear filters' })}
          </button>
          <span className="small text-muted">{t('platform.auditReadOnly', { defaultValue: 'Read-only: audit entries cannot be edited or deleted from the console.' })}</span>
        </div>
      </div>

      <DataTable columns={columns} rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload} dense
        empty={t('platform.noAudit', { defaultValue: 'No audit entries match these filters' })} />

      <div className="small text-muted mt-2 d-flex align-items-center gap-1">
        <ScrollText size={13} />
        {t('platform.auditScope', { defaultValue: 'Rows are the server\'s 500 most recent matches — narrow the dates if you need older history.' })}
      </div>
    </>
  );
}
