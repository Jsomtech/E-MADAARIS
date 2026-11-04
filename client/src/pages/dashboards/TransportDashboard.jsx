// Transport office: fleet readiness, routes and recent student assignments.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bus, Route as RouteIcon, Users, Megaphone } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader, StatCard, Spinner, ErrorState, EmptyState, StatusBadge, money, dateOnly } from '../../components/ui/Basics.jsx';

export default function TransportDashboard() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/school/dashboard');
  const vehicles = useApi('/transport-vehicles', { pageSize: 20 });
  const routes = useApi('/transport-routes', { pageSize: 10 });
  const assignments = useApi('/student-transport-assignments', { pageSize: 5 });

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const vehicleRows = vehicles.data || [];
  const active = vehicleRows.filter((v) => v.status === 'active').length;
  const maintenance = vehicleRows.filter((v) => String(v.status).includes('maintenance')).length;
  const routeRows = routes.data || [];
  const currency = data?.school?.currency;

  return (
    <>
      <PageHeader
        title={t('dashboards.transportHome', { defaultValue: 'Transport office' })}
        subtitle={data?.school?.school_name}
        actions={(
          <>
            <Link to="/m/transport-routes" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"><RouteIcon size={14} /> {t('modules.transport-routes')}</Link>
            <Link to="/m/transport-vehicles" className="btn btn-sm btn-primary d-flex align-items-center gap-1"><Bus size={14} /> {t('modules.transport-vehicles')}</Link>
          </>
        )}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.activeVehicles', { defaultValue: 'Active vehicles' })} value={active} icon={Bus} tone="ok" /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.inMaintenance', { defaultValue: 'In maintenance' })} value={maintenance} icon={Bus} tone="warn" /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.totalVehicles', { defaultValue: 'Fleet size' })} value={vehicles.total ?? vehicleRows.length} icon={Bus} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.totalRoutes', { defaultValue: 'Routes' })} value={routes.total ?? routeRows.length} icon={RouteIcon} /></div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><RouteIcon size={15} className="me-1" /> {t('dashboards.routesList', { defaultValue: 'Routes' })}</div>
              <Link to="/m/transport-routes" className="small">{t('common.viewAll')}</Link>
            </div>
            {routes.loading && !routes.data && <Spinner />}
            {routeRows.length === 0 && !routes.loading && <EmptyState title={t('common.none')} />}
            {routeRows.map((r) => (
              <div key={r.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <span className="fw-semibold text-truncate me-2">{r.name}</span>
                <span className="d-flex align-items-center gap-2 text-nowrap">
                  <span className="text-muted">{money(r.monthly_fee, r.currency || currency)}</span>
                  <StatusBadge value={r.status} />
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><Users size={15} className="me-1" /> {t('dashboards.recentAssignments', { defaultValue: 'Recent student assignments' })}</div>
              <Link to="/m/student-transport-assignments" className="small">{t('common.viewAll')}</Link>
            </div>
            {assignments.loading && !assignments.data && <Spinner />}
            {(assignments.data || []).length === 0 && !assignments.loading && <EmptyState title={t('common.none')} />}
            {(assignments.data || []).map((a) => (
              <div key={a.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <span className="text-truncate me-2">{String(a.student_id || '').slice(0, 8) || '—'}{a.pickup_point ? ` · ${a.pickup_point}` : ''}</span>
                <StatusBadge value={a.fee_status} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card-soft p-3 mt-1">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="fw-semibold"><Megaphone size={15} className="me-1" /> {t('modules.announcements')}</div>
          <Link to="/m/transport-vehicles" className="small">{t('common.viewAll')}</Link>
        </div>
        {(data?.announcements || []).length === 0 && <EmptyState title={t('common.none')} />}
        {(data?.announcements || []).map((ann) => (
          <div key={ann.id} className="border-bottom py-2">
            <div className="small fw-semibold">{ann.title}</div>
            <div className="small text-muted">{dateOnly(ann.created_at)}</div>
          </div>
        ))}
      </div>
    </>
  );
}
