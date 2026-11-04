// Parent home: linked children with quick access to each child record, fees and announcements.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Users, Wallet, Megaphone, FileCheck2 } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader, Spinner, ErrorState, EmptyState, StatusBadge, dateOnly } from '../../components/ui/Basics.jsx';

export default function ParentDashboard() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/school/dashboard');
  const announcements = useApi('/announcements', { pageSize: 5 });

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const children = data?.children || [];

  return (
    <>
      <PageHeader
        title={t('dashboards.parentHome', { defaultValue: 'My family' })}
        subtitle={data?.school?.school_name}
        actions={<Link to="/school/my-fees" className="btn btn-sm btn-primary d-flex align-items-center gap-1"><Wallet size={14} /> {t('dashboards.fees', { defaultValue: 'Fees' })}</Link>}
      />

      {children.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('dashboards.noChildren', { defaultValue: 'No children linked to your account' })}
          hint={t('dashboards.noChildrenHint', { defaultValue: 'Please contact the school office to link your children to this login.' })}
        />
      ) : (
        <div className="row g-3 my-1">
          {children.map((c) => {
            const name = c.full_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();
            const att = c.attendance;
            return (
              <div key={c.id} className="col-12 col-md-6 col-xl-4">
                <div className="card-soft p-3 h-100">
                  <div className="d-flex align-items-center gap-3 mb-2">
                    <Avatar name={name} url={c.photo_url} />
                    <div className="flex-grow-1 min-w-0">
                      <div className="fw-semibold text-truncate">{name || '—'}</div>
                      <div className="small text-muted">{c.classes?.name || '—'}{c.sections?.name ? ` / ${c.sections.name}` : ''}</div>
                      <div className="small text-muted">{c.admission_number || '—'}</div>
                    </div>
                    <StatusBadge value={c.status} />
                  </div>
                  {att && (
                    <div className="small mb-2">
                      {t('dashboards.attendanceRate', { defaultValue: 'Attendance rate' })}:{' '}
                      <span className="fw-semibold">{att.rate != null ? `${att.rate}%` : '—'}</span>
                    </div>
                  )}
                  <div className="d-flex flex-wrap gap-2">
                    <Link to={`/school/my-children?student_id=${c.id}`} className="btn btn-sm btn-outline-primary">{t('dashboards.viewChild', { defaultValue: 'View child' })}</Link>
                    {!att && <Link to="/m/report-card" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"><FileCheck2 size={13} /> {t('dashboards.viewReportCard', { defaultValue: 'View report card' })}</Link>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="row g-3 mt-1">
        <div className="col-12">
          <div className="card-soft p-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><Megaphone size={15} className="me-1" /> {t('modules.announcements')}</div>
              <Link to="/m/announcements" className="small">{t('common.viewAll')}</Link>
            </div>
            {announcements.loading && !announcements.data && <Spinner />}
            {(announcements.data || []).length === 0 && !announcements.loading && <EmptyState title={t('common.none')} />}
            {(announcements.data || []).map((a) => (
              <div key={a.id} className="border-bottom py-2">
                <div className="d-flex justify-content-between align-items-center">
                  <span className="small fw-semibold">{a.title}</span>
                  <span className="small text-muted">{dateOnly(a.published_at || a.created_at)}</span>
                </div>
                {a.body && <div className="small text-muted mt-1">{a.body}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Avatar({ name, url }) {
  const initials = (name || '?').split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
  return url
    ? <img src={url} alt="" className="rounded-circle" style={{ width: 48, height: 48, objectFit: 'cover' }} />
    : <div className="rounded-circle bg-secondary text-white d-flex align-items-center justify-content-center fw-semibold" style={{ width: 48, height: 48 }}>{initials}</div>;
}
