// Platform-wide analytics read straight from GET /platform/dashboard (everything computed server-side).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Activity, Building2, CreditCard, GraduationCap, Landmark, PauseCircle, PlayCircle,
  RefreshCw, TrendingUp, UserPlus, Users, Wallet,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { BarView, ChartCard, DoughnutView } from '../../components/ui/Charts.jsx';
import { Badge, EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge, dateOnly, money as formatMoney } from '../../components/ui/Basics.jsx';

const PERIODS = [6, 12, 24];

function monthLabel(key) {
  const [year, month] = String(key).split('-');
  if (!year || !month) return key;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const [months, setMonths] = useState(12);

  const dashboard = useApi('/platform/dashboard', { months });
  const data = dashboard.data;
  const stats = data?.stats || {};

  if (dashboard.error?.status === 403) {
    return (
      <>
        <PageHeader title={t('platform.analytics', { defaultValue: 'Platform analytics' })} />
        <div className="card-soft">
          <EmptyState icon={Activity} title={t('platform.notAvailableTitle', { defaultValue: 'Not available for your account' })}
            hint={t('platform.analyticsForbidden', { defaultValue: 'The dashboard aggregate refused this request with 403.' })} />
        </div>
      </>
    );
  }
  if (dashboard.loading && !data) return <Spinner label={t('common.loading')} />;
  if (dashboard.error) return <ErrorState error={dashboard.error} onRetry={dashboard.reload} />;
  if (!data) return <EmptyState title={t('platform.noAnalytics', { defaultValue: 'Nothing to report yet' })} />;

  const growthEntries = Object.entries(data.registrationGrowth || {}).sort(([a], [b]) => String(a).localeCompare(String(b)));
  const growthTrimmed = growthEntries.slice(-months);
  const growth = { labels: growthTrimmed.map(([k]) => monthLabel(k)), values: growthTrimmed.map(([, v]) => v) };

  const plans = Object.entries(data.planDistribution || {}).sort((a, b) => b[1] - a[1]);
  const subStatuses = Object.entries(data.subscriptionStatuses || {}).sort((a, b) => b[1] - a[1]);
  const subTotal = subStatuses.reduce((sum, [, n]) => sum + n, 0);

  return (
    <>
      <PageHeader
        title={t('platform.analytics', { defaultValue: 'Platform analytics' })}
        subtitle={t('platform.analyticsSubtitle', { defaultValue: 'Tenants, users, revenue and growth — all computed by the server.' })}
        actions={(
          <>
            <select className="form-select form-select-sm" style={{ width: 'auto' }} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {PERIODS.map((m) => <option key={m} value={m}>{t('platform.lastMonths', { defaultValue: 'Last {{count}} months', count: m })}</option>)}
            </select>
            <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={dashboard.reload}>
              <RefreshCw size={14} /> {t('platform.refresh', { defaultValue: 'Refresh' })}
            </button>
          </>
        )}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-3"><StatCard label={t('platform.totalSchools', { defaultValue: 'Schools' })} value={stats.schools} icon={Building2} hint={`${stats.subscriptions ?? 0} ${t('platform.subscriptionsShort', { defaultValue: 'subscriptions' })}`} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('platform.activeSchools', { defaultValue: 'Active' })} value={stats.activeSchools} icon={PlayCircle} tone="ok" /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('platform.trialSchools', { defaultValue: 'On trial' })} value={stats.trialSchools} icon={TrendingUp} tone="info" /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('platform.suspendedSchools', { defaultValue: 'Suspended' })} value={stats.suspendedSchools} icon={PauseCircle} tone="danger" /></div>
      </div>

      <div className="row g-3 my-1">
        <div className="col-6 col-lg-3"><StatCard label={t('platform.totalStudents', { defaultValue: 'Students (active)' })} value={stats.totalStudents} icon={GraduationCap} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('platform.totalUsers', { defaultValue: 'User accounts' })} value={stats.totalUsers} icon={Users} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('platform.pendingApplications', { defaultValue: 'Applications waiting' })} value={stats.pendingApplications} icon={UserPlus} tone="warn"
          footer={<Link to="/platform/applications" className="small">{t('platform.openQueue', { defaultValue: 'Open the queue' })}</Link>} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('platform.outstandingInvoices', { defaultValue: 'Open invoices' })} value={stats.outstandingInvoices} icon={CreditCard} tone="danger"
          footer={<Link to="/platform/invoices" className="small">{t('platform.openInvoices', { defaultValue: 'Invoice list' })}</Link>} /></div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6 col-xl-3">
          <div className="card-soft p-3 h-100">
            <div className="text-muted small text-uppercase"><Wallet size={14} className="me-1" />{t('platform.mrr', { defaultValue: 'MRR (verified, 30d)' })}</div>
            <div className="fs-3 fw-bold lh-1 mt-1">{formatMoney(stats.mrr)}</div>
            <div className="small text-muted">{t('platform.mrrHint', { defaultValue: 'Verified payments created in the last 30 days.' })}</div>
          </div>
        </div>
        <div className="col-12 col-md-6 col-xl-3">
          <div className="card-soft p-3 h-100">
            <div className="text-muted small text-uppercase"><Landmark size={14} className="me-1" />{t('platform.totalRevenue', { defaultValue: 'Total verified revenue' })}</div>
            <div className="fs-3 fw-bold lh-1 mt-1">{formatMoney(stats.totalRevenue)}</div>
            <div className="small text-muted">{t('platform.revenueHint', { defaultValue: 'Sum of every verified subscription payment (mixed currencies are added as-is).' })}</div>
          </div>
        </div>
        <div className="col-12 col-xl-6">
          <div className="card-soft p-3 h-100">
            <div className="text-muted small text-uppercase mb-1">{t('platform.subscriptionMix', { defaultValue: 'Subscription mix' })}</div>
            {subStatuses.length === 0 && <EmptyState title={t('platform.none', { defaultValue: 'Nothing here yet' })} />}
            <div className="d-flex flex-wrap gap-2 mb-2">
              {subStatuses.map(([key, count]) => (
                <span key={key} className="d-inline-flex align-items-center gap-1">
                  <StatusBadge value={key} />
                  <span className="small fw-semibold tabular-nums">{count}</span>
                  <span className="small text-muted">{subTotal ? `${Math.round((count / subTotal) * 100)}%` : ''}</span>
                </span>
              ))}
            </div>
            <table className="table table-sm mb-0 small">
              <thead><tr><th>{t('common.status')}</th><th className="text-end">{t('platform.count', { defaultValue: 'Count' })}</th></tr></thead>
              <tbody>
                {subStatuses.map(([key, count]) => (
                  <tr key={key}><td className="text-capitalize">{key.replace(/_/g, ' ')}</td><td className="text-end tabular-nums">{count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-lg-8">
          <ChartCard title={t('platform.registrationGrowth', { defaultValue: 'New school tenants per month' })}
            subtitle={t('platform.growthSubtitle', { defaultValue: 'Last {{count}} month keys reported by the server.', count: months })}>
            {growth.labels.length === 0
              ? <EmptyState title={t('platform.noGrowth', { defaultValue: 'No registrations recorded in this window' })} />
              : <BarView labels={growth.labels} datasets={[{ label: t('platform.newSchools', { defaultValue: 'New schools' }), data: growth.values }]} />}
          </ChartCard>
        </div>
        <div className="col-12 col-lg-4">
          <ChartCard title={t('platform.planMix', { defaultValue: 'Subscriptions per plan' })}>
            {plans.length === 0
              ? <EmptyState title={t('platform.noPlansSold', { defaultValue: 'No plan subscriptions yet' })} />
              : <DoughnutView labels={plans.map(([name]) => name)} data={plans.map(([, n]) => n)} height={220} />}
            <div className="mt-2">
              {plans.map(([name, n]) => (
                <div key={name} className="d-flex justify-content-between small border-bottom py-1">
                  <span>{name}</span><span className="tabular-nums fw-semibold">{n}</span>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><Building2 size={15} className="me-1" />{t('platform.recentSchools', { defaultValue: 'Newest tenants' })}</div>
              <Link to="/platform/schools" className="small">{t('common.viewAll')}</Link>
            </div>
            {(data.recentSchools || []).length === 0 && <EmptyState title={t('platform.none', { defaultValue: 'Nothing here yet' })} />}
            {(data.recentSchools || []).map((s) => (
              <div key={s.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <Link to={`/platform/schools/${s.id}`} className="text-decoration-none text-truncate me-2">{s.school_name}</Link>
                <span className="d-flex align-items-center gap-2">
                  <StatusBadge value={s.status} />
                  <span className="text-muted">{dateOnly(s.created_at)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><CreditCard size={15} className="me-1" />{t('platform.recentPayments', { defaultValue: 'Latest subscription payments' })}</div>
              <Link to="/platform/payments" className="small">{t('common.viewAll')}</Link>
            </div>
            {(data.recentPayments || []).length === 0 && <EmptyState title={t('platform.none', { defaultValue: 'Nothing here yet' })} />}
            {(data.recentPayments || []).map((p) => (
              <div key={p.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <span className="text-truncate me-2">
                  {p.schools?.school_name || '—'}
                  <span className="text-muted"> · {p.transaction_reference}</span>
                </span>
                <span className="d-flex align-items-center gap-2">
                  <Badge tone={p.status === 'successful' ? 'ok' : 'warn'}>{String(p.status).replace(/_/g, ' ')}</Badge>
                  <span className="tabular-nums fw-semibold">{formatMoney(p.amount, p.currency)}</span>
                  <span className="text-muted">{dateOnly(p.created_at)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="small text-muted mt-3">
        {t('platform.analyticsFootnote', { defaultValue: 'The period selector refetches the dashboard; headline totals (schools, students, revenue, MRR) are always platform-wide because the server computes them, and the chart shows only the last months it returned.' })}
      </div>
    </>
  );
}
