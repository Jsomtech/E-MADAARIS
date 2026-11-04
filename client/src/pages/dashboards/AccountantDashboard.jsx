// Accountant home: collection totals, today's payments and pending expense approvals.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Wallet, TrendingDown, ReceiptText, BarChart3, CheckCircle2 } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPost } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, StatCard, Spinner, ErrorState, EmptyState, StatusBadge, money, dateOnly } from '../../components/ui/Basics.jsx';

export default function AccountantDashboard() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/school/dashboard');
  const pendingExpenses = useApi('/expenses', { pageSize: 5, status: 'pending_approval' });
  const approve = can('finance.approve');

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const totals = data?.totals || {};
  const collections = data?.todayCollections || [];
  const currency = data?.school?.currency;

  const review = async (id, action) => {
    let reason;
    if (action === 'reject') {
      reason = window.prompt(t('dashboards.rejectReason', { defaultValue: 'Reason for rejection' }));
      if (!reason) return;
    }
    try {
      await apiPost(`/finance/expenses/${id}/review`, { action, reason });
      toast.success(t('common.saved'));
      pendingExpenses.reload();
      reload();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <PageHeader
        title={t('dashboards.accountantHome', { defaultValue: 'Finance dashboard' })}
        subtitle={data?.school?.school_name}
        actions={(
          <>
            <Link to="/m/finance-summary" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"><BarChart3 size={14} /> {t('modules.finance-summary')}</Link>
            <Link to="/m/finance-payments" className="btn btn-sm btn-primary d-flex align-items-center gap-1"><ReceiptText size={14} /> {t('modules.finance-payments')}</Link>
          </>
        )}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-2"><StatCard label={t('dashboards.expected', { defaultValue: 'Expected' })} value={money(totals.expected, currency)} icon={Wallet} /></div>
        <div className="col-6 col-lg-2"><StatCard label={t('dashboards.collected', { defaultValue: 'Collected' })} value={money(totals.collected, currency)} icon={ReceiptText} /></div>
        <div className="col-6 col-lg-2"><StatCard label={t('dashboards.outstanding', { defaultValue: 'Outstanding' })} value={money(totals.outstanding, currency)} icon={TrendingDown} /></div>
        <div className="col-6 col-lg-2"><StatCard label={t('dashboards.expenses', { defaultValue: 'Expenses' })} value={money(totals.expenses, currency)} icon={TrendingDown} /></div>
        <div className="col-6 col-lg-2"><StatCard label={t('dashboards.monthCollected', { defaultValue: 'This month' })} value={money(totals.monthCollections, currency)} icon={Wallet} /></div>
        <div className="col-6 col-lg-2"><StatCard label={t('dashboards.pendingApprovals', { defaultValue: 'Pending approvals' })} value={data?.pendingExpenseApprovals ?? 0} icon={CheckCircle2} footer={<Link to="/m/expenses" className="small">{t('modules.expenses')}</Link>} /></div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><ReceiptText size={15} className="me-1" /> {t('dashboards.todayCollections', { defaultValue: "Today's collections" })}</div>
              <Link to="/m/finance-payments" className="small">{t('common.viewAll')}</Link>
            </div>
            {collections.length === 0 && <EmptyState title={t('common.none')} />}
            {collections.map((p) => {
              const who = `${p.students?.first_name || ''} ${p.students?.last_name || ''}`.trim() || p.students?.admission_number || '—';
              return (
                <div key={p.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                  <span className="text-truncate me-2">{who}</span>
                  <span className="text-muted text-nowrap">{String(p.payment_method || '—')} · {money(p.amount, p.currency || currency)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><TrendingDown size={15} className="me-1" /> {t('dashboards.expensesToReview', { defaultValue: 'Expenses awaiting review' })}</div>
              <Link to="/m/expenses" className="small">{t('common.viewAll')}</Link>
            </div>
            {pendingExpenses.loading && !pendingExpenses.data && <Spinner />}
            {(pendingExpenses.data || []).length === 0 && !pendingExpenses.loading && <EmptyState title={t('dashboards.noPendingExpenses', { defaultValue: 'No expenses to review' })} />}
            {(pendingExpenses.data || []).map((e) => (
              <div key={e.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <div className="text-truncate me-2">
                  <span className="fw-semibold">{e.title}</span>
                  <div className="text-muted">{money(e.amount, e.currency || currency)} · {dateOnly(e.expense_date)}</div>
                </div>
                {approve ? (
                  <span className="d-flex gap-1 text-nowrap">
                    <button className="btn btn-sm btn-outline-success" onClick={() => review(e.id, 'approve')}>{t('dashboards.approve', { defaultValue: 'Approve' })}</button>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => review(e.id, 'reject')}>{t('dashboards.reject', { defaultValue: 'Reject' })}</button>
                  </span>
                ) : <StatusBadge value={e.status} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
