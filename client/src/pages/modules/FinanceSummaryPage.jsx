/**
 * Finance overview: collected vs expected over a date range, split by payment method, plus the
 * biggest outstanding balances and a panel to apply a fee structure to a class.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
import { Layers, Receipt, RefreshCw, Wallet } from 'lucide-react';
import { apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge, dateOnly, money } from '../../components/ui/Basics.jsx';
import { BarView, ChartCard, DoughnutView } from '../../components/ui/Charts.jsx';

const pad = (n) => String(n).padStart(2, '0');
const localDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const monthStart = () => `${localDate().slice(0, 7)}-01`;

export default function FinanceSummaryPage({ query = {} }) {
  const { t } = useTranslation();
  const { can } = useAuth();

  const safeDate = (value, fallback) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : fallback);
  const [from, setFrom] = useState(safeDate(query.from, monthStart()));
  const [to, setTo] = useState(safeDate(query.to, localDate()));
  const [structureId, setStructureId] = useState('');
  const [classId, setClassId] = useState('');
  const [assigning, setAssigning] = useState(false);

  const summary = useApi('/finance/summary', { from, to });
  const clearances = useApi('/finance/clearances', { pageSize: 200 });
  const structures = useApi('/fee-structures', { pageSize: 200 });
  const categories = useApi('/fee-categories', { pageSize: 100 });
  const classes = useApi('/classes', { pageSize: 200 });

  const data = summary.data || {};

  const byMethod = useMemo(() => {
    const entries = Object.entries(data.by_method || {});
    return { labels: entries.map(([k]) => t(`paymentMethods.${k}`, { defaultValue: String(k).replace('_', ' ') })), values: entries.map(([, v]) => Number(v) || 0) };
  }, [data.by_method, t]);

  const debtors = useMemo(() => (clearances.data || [])
    .map((c) => ({
      id: c.id,
      name: c.students?.full_name || c.student_id,
      admission: c.students?.admission_number,
      outstanding: Math.max(0, Math.round((Number(c.required_amount || 0) - Number(c.paid_amount || 0)) * 100) / 100),
      status: c.status,
    }))
    .filter((r) => r.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 10), [clearances.data]);

  const categoryName = (id) => (categories.data || []).find((c) => c.id === id)?.name;

  const structureLabel = (s) => {
    const cat = categoryName(s.category_id) || s.fee_categories?.name || t('modules.feeItem', { defaultValue: 'Fee item' });
    const cls = (classes.data || []).find((c) => c.id === s.class_id)?.name;
    return `${cat}${cls ? ` · ${cls}` : ''} · ${money(s.amount)}`;
  };

  const assign = async () => {
    if (!structureId) { toast.warning(t('modules.pickStructure', { defaultValue: 'Choose a fee structure' })); return; }
    setAssigning(true);
    try {
      const body = await apiPost('/finance/assign-fees', {
        fee_structure_id: structureId,
        ...(classId ? { class_id: classId } : {}),
      });
      toast.success(`${t('modules.feesAssigned', { defaultValue: 'Fees assigned' })} · ${body?.data?.assigned ?? 0} ${t('modules.studentsLower', { defaultValue: 'students' })}`);
      summary.reload();
      clearances.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('modules.finance-summary', { defaultValue: 'Finance overview' })}
        subtitle={t('modules.financeSummaryHint', { defaultValue: 'Collections inside the range come from successful payments; expected and outstanding cover every fee line of the school.' })}
        actions={(
          <>
            <Link className="btn btn-outline-secondary btn-sm" to="/m/finance-payments">{t('modules.finance-payments', { defaultValue: 'Fee payments' })}</Link>
            <button className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
              onClick={() => { summary.reload(); clearances.reload(); }}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
          </>
        )}
      />

      <div className="card-soft p-3 mb-3">
        <div className="row g-2 align-items-end">
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold" htmlFor="fin-from">{t('modules.from', { defaultValue: 'From' })}</label>
            <input id="fin-from" type="date" className="form-control form-control-sm" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold" htmlFor="fin-to">{t('modules.to', { defaultValue: 'To' })}</label>
            <input id="fin-to" type="date" className="form-control form-control-sm" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="col-12 col-md-6 text-md-end small text-muted">
            {data.payment_count != null && (
              <span>{data.payment_count} {t('modules.paymentsInRange', { defaultValue: 'payments in this range' })}</span>
            )}
          </div>
        </div>
      </div>

      {summary.loading && !summary.data && <div className="card-soft p-4 mb-3"><Spinner label={t('common.loading')} /></div>}
      {summary.error && <div className="mb-3"><ErrorState error={summary.error} onRetry={summary.reload} /></div>}

      {!summary.loading && !summary.error && (
        <>
          <div className="row g-3 mb-1">
            <div className="col-6 col-lg-3"><StatCard label={t('modules.collected', { defaultValue: 'Collected in range' })} value={money(data.collected)} icon={Wallet} tone="ok" /></div>
            <div className="col-6 col-lg-3"><StatCard label={t('modules.expected', { defaultValue: 'Expected (all fees)' })} value={money(data.expected)} icon={Receipt} /></div>
            <div className="col-6 col-lg-3"><StatCard label={t('modules.paid', { defaultValue: 'Paid to date' })} value={money(data.paid)} tone="info" /></div>
            <div className="col-6 col-lg-3"><StatCard label={t('modules.outstanding', { defaultValue: 'Outstanding' })} value={money(data.outstanding)} tone={Number(data.outstanding) > 0 ? 'danger' : 'ok'} /></div>
          </div>
          <div className="row g-3 my-1">
            <div className="col-6 col-lg-3"><StatCard label={t('modules.expensesTotal', { defaultValue: 'Expenses' })} value={money(data.expenses_total)} tone="warn" /></div>
            <div className="col-6 col-lg-3">
              <StatCard label={t('modules.expensesPending', { defaultValue: 'Expenses awaiting approval' })} value={data.expenses_pending} tone="warn"
                footer={<Link className="small" to="/m/expenses">{t('modules.openExpenses', { defaultValue: 'Open expenses' })}</Link>} />
            </div>
          </div>

          <div className="row g-3 mt-1">
            <div className="col-12 col-lg-5">
              <ChartCard title={t('modules.byMethod', { defaultValue: 'Collected by payment method' })}>
                {byMethod.labels.length ? (
                  <DoughnutView labels={byMethod.labels} data={byMethod.values} height={240} />
                ) : <EmptyState title={t('modules.noPaymentsInRange', { defaultValue: 'No payments in this range' })} />}
              </ChartCard>
            </div>
            <div className="col-12 col-lg-7">
              <ChartCard title={t('modules.topDebtors', { defaultValue: 'Top outstanding balances' })}
                subtitle={t('modules.topDebtorsHint', { defaultValue: 'Built from examination clearances — the school-wide fee-assignment list is not exposed as an API resource yet.' })}>
                {debtors.length ? (
                  <>
                    <BarView labels={debtors.map((d) => d.name)}
                      datasets={[{ label: t('modules.outstanding', { defaultValue: 'Outstanding' }), data: debtors.map((d) => d.outstanding) }]}
                      height={200} />
                    <div className="table-responsive mt-2">
                      <table className="table table-sm align-middle mb-0">
                        <thead className="bg-white">
                          <tr>
                            <th>{t('modules.student', { defaultValue: 'Student' })}</th>
                            <th>{t('modules.admissionNumber', { defaultValue: 'Admission no.' })}</th>
                            <th className="text-end">{t('modules.outstanding', { defaultValue: 'Outstanding' })}</th>
                            <th>{t('common.status')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {debtors.map((d) => (
                            <tr key={d.id}>
                              <td className="small fw-semibold">{d.name}</td>
                              <td className="small text-muted">{d.admission || '—'}</td>
                              <td className="text-end tabular-nums small">{money(d.outstanding)}</td>
                              <td><StatusBadge value={d.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <EmptyState title={t('modules.nobodyOwes', { defaultValue: 'Nobody has an outstanding balance' })}
                    hint={t('modules.nobodyOwesHint', { defaultValue: 'Clearance rows only appear once an examination fee category is assigned.' })} />
                )}
              </ChartCard>
            </div>
          </div>
        </>
      )}

      {can('finance.create') && (
        <div className="card-soft p-3 mt-3">
          <div className="fw-semibold mb-1"><Layers size={15} className="me-1" />{t('modules.assignFeeStructure', { defaultValue: 'Assign a fee structure' })}</div>
          <p className="small text-muted">{t('modules.assignFeeHint', { defaultValue: 'Applies the structure to every active student of a class (or reuses the open invoice). Fee lines are created once per student.' })}</p>
          <div className="row g-2 align-items-end">
            <div className="col-12 col-md-5">
              <label className="form-label small fw-semibold mb-1" htmlFor="assign-structure">{t('modules.fee-structures', { defaultValue: 'Fee structure' })}</label>
              <select id="assign-structure" className="form-select form-select-sm" value={structureId} onChange={(e) => setStructureId(e.target.value)}>
                <option value="">{t('modules.selectStructure', { defaultValue: 'Select a fee structure' })}</option>
                {(structures.data || []).map((s) => <option key={s.id} value={s.id}>{structureLabel(s)}</option>)}
              </select>
            </div>
            <div className="col-12 col-md-4">
              <label className="form-label small fw-semibold mb-1" htmlFor="assign-class">{t('modules.class', { defaultValue: 'Class' })}</label>
              <select id="assign-class" className="form-select form-select-sm" value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">{t('modules.allClassesOfStructure', { defaultValue: 'Only the class linked to the structure' })}</option>
                {(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-12 col-md-3">
              <button className="btn btn-primary btn-sm w-100" onClick={assign} disabled={assigning || !structureId}>
                {assigning ? '…' : t('modules.apply', { defaultValue: 'Apply' })}
              </button>
            </div>
          </div>
          {structures.error && <div className="mt-2"><ErrorState error={structures.error} onRetry={structures.reload} /></div>}
          <div className="small text-muted mt-2">
            {t('modules.assignNeedsClass', { defaultValue: 'A class is required unless the structure itself is linked to one.' })}
            {' · '}{dateOnly(from)} → {dateOnly(to)}
          </div>
        </div>
      )}
    </>
  );
}
