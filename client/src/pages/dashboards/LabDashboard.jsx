// Laboratory assistant home: equipment inventory and recent allocations.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FlaskConical, ArrowLeftRight, Megaphone } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader, StatCard, Spinner, ErrorState, EmptyState, StatusBadge, dateTime, dateOnly } from '../../components/ui/Basics.jsx';

export default function LabDashboard() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/school/dashboard');
  const equipment = useApi('/lab-equipment', { pageSize: 20 });
  const allocations = useApi('/equipment-allocations', { pageSize: 5 });

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const items = equipment.data || [];
  const totalQuantity = items.reduce((s, e) => s + Number(e.quantity || 0), 0);
  const damaged = items.filter((e) => ['damaged', 'maintenance'].includes(String(e.condition || e.status)));

  return (
    <>
      <PageHeader
        title={t('dashboards.labHome', { defaultValue: 'Laboratory' })}
        subtitle={data?.school?.school_name}
        actions={<Link to="/m/lab-equipment" className="btn btn-sm btn-primary d-flex align-items-center gap-1"><FlaskConical size={14} /> {t('modules.lab-equipment')}</Link>}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-4"><StatCard label={t('dashboards.equipmentItems', { defaultValue: 'Equipment items' })} value={equipment.total ?? items.length} icon={FlaskConical} /></div>
        <div className="col-6 col-lg-4"><StatCard label={t('dashboards.totalUnits', { defaultValue: 'Units in stock' })} value={totalQuantity} icon={FlaskConical} tone="ok" /></div>
        <div className="col-12 col-lg-4"><StatCard label={t('dashboards.needsAttention', { defaultValue: 'Damaged / maintenance' })} value={damaged.length} icon={FlaskConical} tone="danger" /></div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-7">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><FlaskConical size={15} className="me-1" /> {t('dashboards.inventory', { defaultValue: 'Equipment inventory' })}</div>
              <Link to="/m/lab-equipment" className="small">{t('common.viewAll')}</Link>
            </div>
            {equipment.loading && !equipment.data && <Spinner />}
            {items.length === 0 && !equipment.loading && <EmptyState title={t('common.none')} />}
            {items.map((e) => (
              <div key={e.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <span className="text-truncate me-2">
                  <span className="fw-semibold">{e.name || '—'}</span>
                  {e.category ? <span className="text-muted"> · {e.category}</span> : null}
                </span>
                <span className="d-flex align-items-center gap-2 text-nowrap">
                  <span className="text-muted">{e.quantity ?? 0}</span>
                  <StatusBadge value={e.condition || e.status} />
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-12 col-lg-5">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><ArrowLeftRight size={15} className="me-1" /> {t('dashboards.allocations', { defaultValue: 'Recent allocations' })}</div>
              <Link to="/m/equipment-allocations" className="small">{t('common.viewAll')}</Link>
            </div>
            {allocations.loading && !allocations.data && <Spinner />}
            {(allocations.data || []).length === 0 && !allocations.loading && <EmptyState title={t('common.none')} />}
            {(allocations.data || []).map((a) => (
              <div key={a.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <div className="text-truncate me-2">
                  <span className="fw-semibold">{a.allocated_to || '—'}</span>
                  <div className="text-muted">{dateTime(a.allocated_at)}</div>
                </div>
                <StatusBadge value={a.status} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card-soft p-3 mt-1">
        <div className="fw-semibold mb-2"><Megaphone size={15} className="me-1" /> {t('modules.announcements')}</div>
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
