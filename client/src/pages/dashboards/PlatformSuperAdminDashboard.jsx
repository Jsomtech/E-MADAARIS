import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Building2, GraduationCap, Users, Wallet, TrendingUp, ReceiptText, ClipboardList,
  FileStack, Activity, Inbox, CreditCard, DatabaseBackup, Trash2,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import {
  PageHeader, StatCard, Badge, StatusBadge, Spinner, ErrorState, EmptyState, money, dateOnly,
} from '../../components/ui/Basics.jsx';
import { ChartCard, BarView, DoughnutView } from '../../components/ui/Charts.jsx';

/**
 * Platform console overview: reads the aggregated SaaS-wide payload from GET /platform/dashboard
 * (platform users only) and shows revenue, tenant growth, plan mix and the newest activity.
 */
export default function PlatformSuperAdminDashboard() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/platform/dashboard');

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const stats = data?.stats || {};
  const planEntries = Object.entries(data?.planDistribution || {}).sort((a, b) => b[1] - a[1]);
  const growthKeys = Object.keys(data?.registrationGrowth || {}).sort();
  const statusEntries = Object.entries(data?.subscriptionStatuses || {});
  const recentSchools = data?.recentSchools || [];
  const recentPayments = data?.recentPayments || [];

  return (
    <>
      <PageHeader
        title={t('dashboards.platformOverview', { defaultValue: 'Platform overview' })}
        subtitle={t('dashboards.platformSubtitle', { defaultValue: 'All tenants, billing and registrations' })}
        actions={(
          <>
            <Link to="/platform/applications" className="btn btn-sm btn-primary d-flex align-items-center gap-1">
              <ClipboardList size={14} /> {t('modules.applications')}
              {stats.pendingApplications ? <Badge tone="warn" className="ms-1">{stats.pendingApplications}</Badge> : null}
            </Link>
            <Link to="/platform/plans" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1">
              <FileStack size={14} /> {t('modules.plans')}
            </Link>
            <Link to="/platform/schools" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1">
              <Building2 size={14} /> {t('modules.schools')}
            </Link>
            <Link to="/platform/backups" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1">
              <DatabaseBackup size={14} /> {t('sections.backupsTitle', { defaultValue: 'Backups' })}
            </Link>
            <Link to="/platform/trash" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1">
              <Trash2 size={14} /> {t('sections.trashTitle', { defaultValue: 'Recycle bin' })}
            </Link>
            <Link to="/platform/audit" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1">
              <Activity size={14} /> {t('modules.audit')}
            </Link>
          </>
        )}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.totalRevenue', { defaultValue: 'Total revenue' })} value={money(stats.totalRevenue)} icon={Wallet}
            hint={t('dashboards.verifiedPayments', { defaultValue: 'Verified subscription payments' })} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.mrr', { defaultValue: 'Revenue last 30 days' })} value={money(stats.mrr)} icon={TrendingUp} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.outstandingInvoices', { defaultValue: 'Open invoices' })} value={money(stats.outstandingInvoices)} icon={ReceiptText} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.activeSubscriptions', { defaultValue: 'Subscriptions' })} value={stats.subscriptions} icon={CreditCard}
            hint={`${stats.pendingApplications ?? 0} ${t('dashboards.awaitingApproval', { defaultValue: 'awaiting approval' })}`} />
        </div>
      </div>

      <div className="row g-3 my-1">
        <div className="col-6 col-lg-3"><StatCard label={t('modules.schools')} value={stats.schools} icon={Building2} hint={`${stats.activeSchools ?? 0} ${t('dashboards.activeNow', { defaultValue: 'active' })}`} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.trialSchools', { defaultValue: 'Trial schools' })} value={stats.trialSchools} icon={Inbox} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.students')} value={stats.totalStudents} icon={GraduationCap} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.staff')} value={stats.totalUsers} icon={Users} /></div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-4">
          <ChartCard title={t('dashboards.planDistribution', { defaultValue: 'Plan distribution' })}
            subtitle={t('dashboards.planDistributionHint', { defaultValue: 'Active subscriptions per plan' })}>
            {planEntries.length === 0 && <EmptyState title={t('common.none')} />}
            {planEntries.length > 0 && (
              <DoughnutView
                labels={planEntries.map(([name]) => name)}
                data={planEntries.map(([, count]) => count)}
                height={220}
              />
            )}
            <Link to="/platform/subscriptions" className="btn btn-sm btn-outline-primary mt-2">{t('modules.subscriptions')}</Link>
          </ChartCard>
        </div>

        <div className="col-12 col-lg-4">
          <ChartCard title={t('dashboards.registrationGrowth', { defaultValue: 'School registrations' })}
            subtitle={t('dashboards.registrationGrowthHint', { defaultValue: 'New schools per month' })}>
            {growthKeys.length === 0 && <EmptyState title={t('common.none')} />}
            {growthKeys.length > 0 && (
              <BarView
                labels={growthKeys}
                datasets={[{ label: t('dashboards.newSchools', { defaultValue: 'New schools' }), data: growthKeys.map((k) => data.registrationGrowth[k]) }]}
                height={220}
              />
            )}
          </ChartCard>
        </div>

        <div className="col-12 col-lg-4">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2"><CreditCard size={15} className="me-1" /> {t('dashboards.subscriptionStatuses', { defaultValue: 'Subscription statuses' })}</div>
            {statusEntries.length === 0 && <EmptyState title={t('common.none')} />}
            <div className="d-flex flex-wrap gap-2">
              {statusEntries.map(([status, count]) => (
                <span key={status} className="d-flex align-items-center gap-2">
                  <StatusBadge value={status} />
                  <span className="small fw-semibold">{count}</span>
                </span>
              ))}
            </div>
            <div className="small text-muted mt-3">{t('dashboards.suspendedSchools', { defaultValue: 'Suspended schools' })}: {stats.suspendedSchools ?? 0}</div>
            <Link to="/platform/invoices" className="btn btn-sm btn-outline-secondary mt-2">{t('modules.invoices')}</Link>
          </div>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><Building2 size={15} className="me-1" /> {t('dashboards.recentSchools', { defaultValue: 'Newest schools' })}</div>
              <Link to="/platform/schools" className="small">{t('common.viewAll')}</Link>
            </div>
            {recentSchools.length === 0 && <EmptyState title={t('common.none')} />}
            {recentSchools.map((s) => (
              <div key={s.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <span className="text-truncate me-2">{s.school_name || s.id}</span>
                <span className="d-flex align-items-center gap-2 text-muted white-space-nowrap">
                  <StatusBadge value={s.status} /> {dateOnly(s.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><ReceiptText size={15} className="me-1" /> {t('dashboards.recentPlatformPayments', { defaultValue: 'Recent plan payments' })}</div>
              <Link to="/platform/payments" className="small">{t('common.viewAll')}</Link>
            </div>
            {recentPayments.length === 0 && <EmptyState title={t('common.none')} />}
            {recentPayments.map((p) => (
              <div key={p.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <span className="text-truncate me-2">{p.schools?.school_name || '—'} <span className="text-muted">· {p.transaction_reference || '—'}</span></span>
                <span className="d-flex align-items-center gap-2 text-muted white-space-nowrap">
                  {money(p.amount, p.currency)} <StatusBadge value={p.status} /> {dateOnly(p.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
