// Discipline office: incident records filterable by status with a school audit link.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ShieldAlert, Activity, Megaphone } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader, Spinner, ErrorState, EmptyState, StatusBadge, dateOnly } from '../../components/ui/Basics.jsx';

export default function DisciplineDashboard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('open');
  const { data, loading, error, reload } = useApi('/school/dashboard');
  const records = useApi('/discipline-records', { pageSize: 10, status });

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const TABS = ['open', 'under_review', 'resolved'];
  const rows = records.data || [];

  return (
    <>
      <PageHeader
        title={t('dashboards.disciplineHome', { defaultValue: 'Discipline office' })}
        subtitle={data?.school?.school_name}
        actions={(
          <>
            <Link to="/school/audit" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"><Activity size={14} /> {t('modules.audit')}</Link>
            <Link to="/m/discipline-records" className="btn btn-sm btn-primary d-flex align-items-center gap-1"><ShieldAlert size={14} /> {t('modules.discipline-records')}</Link>
          </>
        )}
      />

      <div className="d-flex flex-wrap gap-2 mb-3">
        {TABS.map((key) => (
          <button
            key={key}
            className={clsx('btn btn-sm', status === key ? 'btn-primary' : 'btn-outline-secondary', 'text-capitalize')}
            onClick={() => setStatus(key)}
          >
            {t(`dashboards.status.${key}`, { defaultValue: key.replace(/_/g, ' ') })}
          </button>
        ))}
      </div>

      <div className="card-soft p-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="fw-semibold"><ShieldAlert size={15} className="me-1" /> {t('dashboards.incidents', { defaultValue: 'Incident records' })}</div>
          <span className="small text-muted">{records.total ?? rows.length} {t('common.rows')}</span>
        </div>
        {records.loading && !records.data && <Spinner />}
        {rows.length === 0 && !records.loading && <EmptyState title={t('dashboards.noIncidents', { defaultValue: 'No records for this status' })} />}
        {rows.map((r) => (
          <div key={r.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
            <div className="text-truncate me-2">
              <span className="fw-semibold">{r.incident_type || '—'}</span>
              <div className="text-muted">
                {String(r.student_id || '').slice(0, 8) || '—'} · {dateOnly(r.incident_date)}
                {r.severity ? ` · ${t('dashboards.severity', { defaultValue: 'Severity' })}: ${String(r.severity).replace(/_/g, ' ')}` : ''}
              </div>
            </div>
            <StatusBadge value={r.status} />
          </div>
        ))}
      </div>

      <div className="card-soft p-3 mt-3">
        <div className="fw-semibold mb-2"><Megaphone size={15} className="me-1" /> {t('modules.announcements')}</div>
        {(data?.announcements || []).length === 0 && <EmptyState title={t('common.none')} />}
        {(data?.announcements || []).map((a) => (
          <div key={a.id} className="border-bottom py-2">
            <div className="small fw-semibold">{a.title}</div>
            <div className="small text-muted">{dateOnly(a.created_at)}</div>
          </div>
        ))}
      </div>
    </>
  );
}
