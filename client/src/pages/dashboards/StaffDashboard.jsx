// Generic staff landing: announcements feed plus self-service shortcuts.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Megaphone, User, Bell, Headphones, Users } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Spinner, ErrorState, EmptyState, dateOnly } from '../../components/ui/Basics.jsx';

export default function StaffDashboard() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { data, loading, error, reload } = useApi('/school/dashboard');

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const roles = (profile?.roles || [])
    .map((r) => (typeof r === 'string' ? r : r?.name || r?.role || ''))
    .filter(Boolean)
    .join(', ');

  const shortcuts = [
    { to: '/school/profile', label: t('modules.profile', { defaultValue: 'My profile' }), icon: User },
    { to: '/notifications', label: t('common.notifications'), icon: Bell },
    { to: '/school/support', label: t('common.support'), icon: Headphones },
    { to: '/m/announcements', label: t('modules.announcements'), icon: Megaphone },
  ];

  return (
    <>
      <PageHeader
        title={t('dashboards.staffHome', { defaultValue: 'Staff dashboard' })}
        subtitle={data?.school?.school_name}
        actions={<Link to="/school/users" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"><Users size={14} /> {t('dashboards.staffDirectory', { defaultValue: 'Staff directory' })}</Link>}
      />

      <div className="row g-3 mb-1">
        {shortcuts.map((s) => (
          <div key={s.to} className="col-6 col-lg-3">
            <Link to={s.to} className="card-soft p-3 d-flex align-items-center gap-2 text-decoration-none h-100">
              <s.icon size={20} className="text-primary" />
              <span className="fw-semibold small">{s.label}</span>
            </Link>
          </div>
        ))}
      </div>

      {roles && (
        <div className="card-soft p-3 my-1 small text-muted">
          {t('dashboards.yourRoles', { defaultValue: 'Your roles' })}: <span className="fw-semibold text-capitalize">{roles}</span>
        </div>
      )}

      <div className="card-soft p-3 mt-1">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="fw-semibold"><Megaphone size={15} className="me-1" /> {t('dashboards.latestAnnouncements', { defaultValue: 'Latest announcements' })}</div>
          <Link to="/m/announcements" className="small">{t('common.viewAll')}</Link>
        </div>
        {(data?.announcements || []).length === 0 && <EmptyState title={t('common.none')} />}
        {(data?.announcements || []).map((a) => (
          <div key={a.id} className="border-bottom py-2">
            <div className="d-flex justify-content-between align-items-center">
              <span className="small fw-semibold">{a.title}</span>
              <span className="small text-muted">{dateOnly(a.published_at || a.created_at)}</span>
            </div>
            {a.body && <div className="small text-muted mt-1">{a.body}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
