/**
 * The monthly fee register — how a school actually collects fees: pick the month, pick the class,
 * tick the learners who paid. A learner recorded for January leaves the January list and reappears
 * when the cashier moves to February, because every payment carries the month it settles.
 *
 * Plain words on purpose: this screen is used by a cashier, not by an accountant.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
import { BadgeCheck, CalendarDays, CircleDollarSign, Download, GraduationCap, Undo2, Users, Wallet } from 'lucide-react';
import { apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge, dateOnly, money,
} from '../../components/ui/Basics.jsx';
import { Modal } from '../../components/ui/Modal.jsx';

const METHODS = ['cash', 'mobile_money', 'bank', 'other'];
const TABS = [
  { key: 'unpaid', label: 'Not paid yet', tone: 'danger' },
  { key: 'paid', label: 'Paid this month', tone: 'ok' },
  { key: 'all', label: 'Everyone', tone: 'neutral' },
];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const monthNow = () => new Date().toISOString().slice(0, 7);
const pad2 = (n) => String(n).padStart(2, '0');
const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const isMonthKey = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
const toMonthKey = (year, num) => `${String(year).padStart(4, '0')}-${pad2(num)}`;

const MONTHLY_FILE = 'supabase/migrations/0021_monthly_fees.sql';
/** The register says which SQL file the database is missing; show that as instructions, not as a stack trace. */
const isMigrationGap = (error) => /0021_monthly_fees\.sql/.test(String(error?.message || ''));

export default function FeeCollectionPage({ query = {} }) {
  const { t, i18n } = useTranslation();
  const { can, profile } = useAuth();

  const [month, setMonth] = useState(isMonthKey(query.month) ? query.month : monthNow());
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));
  const [classId, setClassId] = useState(query.class_id || '');
  const [tab, setTab] = useState('unpaid');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState([]);
  const [feeDraft, setFeeDraft] = useState('');
  const [feeSaving, setFeeSaving] = useState(false);
  const [paying, setPaying] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payReference, setPayReference] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [undoing, setUndoing] = useState(null);
  const [undoReason, setUndoReason] = useState('');
  const [undoBusy, setUndoBusy] = useState(false);

  const allowed = Boolean(can('finance.view'));
  const register = useApi(allowed ? '/finance/monthly' : null, { month, class_id: classId || undefined }, allowed);
  const history = useApi(allowed ? '/finance/monthly/history' : null, { year }, allowed);
  const data = register.data || {};
  const classes = data.classes || [];
  const rows = data.students || [];
  const summary = data.summary || {};
  const currency = summary.currency || profile?.school?.currency || history.data?.currency || 'SOS';
  const fee = data.monthly_fee;

  /** '2026-11' becomes "November 2026" / "Nibraayo 2026" in the language on screen. */
  const monthLabel = (value) => {
    if (!isMonthKey(value)) return value || '—';
    const num = Number(value.slice(5, 7));
    const fallback = new Date(`${value}-01T00:00:00`).toLocaleDateString(i18n.language, { month: 'long' });
    return `${t(`months.${num}`, { defaultValue: fallback })} ${value.slice(0, 4)}`;
  };
  // The years a cashier can walk back through: what the server saw in the ledger, plus this year.
  const yearOptions = useMemo(() => {
    const fromServer = (history.data?.years || []).map(Number);
    const nowYear = new Date().getFullYear();
    const all = new Set([...fromServer, nowYear, year]);
    for (let y = nowYear; y > nowYear - 5; y -= 1) all.add(y);
    return [...all].filter((y) => y >= 2000 && y <= 2100).sort((a, b) => b - a);
  }, [history.data, year]);

  const canRecord = Boolean(can('finance.create'));
  const canUndo = Boolean(can('finance.approve'));

  useEffect(() => { setPicked([]); }, [month, classId, tab]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === 'unpaid' && r.status !== 'unpaid' && r.status !== 'partial') return false;
      if (tab === 'paid' && r.status !== 'paid') return false;
      if (term && !`${r.full_name || ''} ${r.admission_number || ''}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, tab, search]);

  const openPay = (student) => {
    setPaying(student ? { kind: 'one', students: [student] } : { kind: 'many', students: rows.filter((r) => picked.includes(r.id)) });
    setPayAmount('');
    setPayMethod('cash');
    setPayReference('');
  };
  const closePay = () => setPaying(null);

  const pay = async () => {
    if (!paying) return;
    const ids = paying.students.map((s) => s.id);
    if (!ids.length) return;
    if (paying.kind === 'one' && !(Number(payAmount) > 0) && paying.students[0].amount_due == null) {
      toast.error(t('modules.feeAmountNeeded', { defaultValue: 'Set the monthly fee for this class, or type the amount being paid.' }));
      return;
    }
    setPayBusy(true);
    try {
      const body = await apiPost('/finance/monthly/collect', {
        class_id: classId,
        month,
        student_ids: ids,
        ...(payAmount ? { amount: round2(payAmount) } : {}),
        payment_method: payMethod,
        ...(payReference.trim() ? { provider_reference: payReference.trim() } : {}),
      });
      const out = body.data || {};
      const skippedNote = out.skipped ? ` · ${t('modules.alreadyRecordedCount', { defaultValue: '{{count}} already recorded', count: out.skipped })}` : '';
      toast.success(`${t('modules.feesRecorded', { defaultValue: 'Recorded for' })} ${out.recorded || 0} ${t('modules.learners', { defaultValue: 'learner(s)' })} · ${monthLabel(month)}${skippedNote}`);
      closePay();
      register.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setPayBusy(false);
    }
  };

  const saveFee = async () => {
    const value = Number(feeDraft);
    if (!classId) return;
    if (!Number.isFinite(value) || value < 0) {
      toast.error(t('modules.feeAmountInvalid', { defaultValue: 'Enter the monthly fee as an amount of money.' }));
      return;
    }
    setFeeSaving(true);
    try {
      await apiPost('/finance/monthly/fee', { class_id: classId, amount: round2(value), currency });
      toast.success(t('modules.monthlyFeeSaved', { defaultValue: 'Monthly fee saved for this class' }));
      setFeeDraft('');
      register.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setFeeSaving(false);
    }
  };

  const undo = async () => {
    if (!undoing?.payment) return;
    if (undoReason.trim().length < 3) {
      toast.error(t('modules.reverseReasonNeeded', { defaultValue: 'Say why the payment is being removed.' }));
      return;
    }
    setUndoBusy(true);
    try {
      await apiPost(`/finance/payments/${undoing.payment.id}/reverse`, { reason: undoReason.trim() });
      toast.success(t('modules.paymentRemoved', { defaultValue: 'Payment removed — the learner is back on the list to pay.' }));
      setUndoing(null);
      setUndoReason('');
      register.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setUndoBusy(false);
    }
  };

  const exportCsv = () => {
    const head = ['Name', 'Admission number', 'Section', 'Fee', 'Paid', 'Status', 'Reference', 'Paid on'];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.map(cell).join(',')];
    for (const r of visible) {
      lines.push([r.full_name, r.admission_number, r.section, r.amount_due ?? '', r.paid_amount, r.status,
        r.payment?.transaction_reference || '', r.payment?.paid_at || ''].map(cell).join(','));
    }
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fees-${month}-${(data.class_name || 'class').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const countOf = (key) => (key === 'all' ? rows.length : rows.filter((r) => (key === 'paid' ? r.status === 'paid' : r.status !== 'paid')).length);

  /**
   * A missing migration is not a stack trace: name the SQL file and offer Retry. Any other failure
   * keeps the normal error card, so a real outage is not dressed up as a setup step.
   */
  const gapOrError = (error, reload, compact = false) => (
    isMigrationGap(error) ? (
      <div className={compact ? 'p-3' : 'card-soft p-4'}>
        <div className="d-flex gap-3 align-items-start">
          <div className="stat-icon tone-warn flex-shrink-0"><CalendarDays size={20} /></div>
          <div className="min-width-0">
            <div className="fw-semibold">{t('modules.monthlyMigrationTitle', { defaultValue: 'The monthly register is not switched on yet' })}</div>
            <div className="small text-muted mt-1">
              {t('modules.monthlyMigrationHint', {
                defaultValue: 'Your school database is missing the table this screen reads. On the platform database, run {{file}} in the SQL editor once, then press Retry here.',
                file: MONTHLY_FILE,
              })}
            </div>
            <div className="small font-monospace text-muted mt-2">{MONTHLY_FILE}</div>
            <button type="button" className="btn btn-sm btn-outline-primary mt-3" onClick={reload}>{t('common.retry', { defaultValue: 'Retry' })}</button>
          </div>
        </div>
      </div>
    ) : (
      <div className={compact ? 'p-3' : undefined}><ErrorState error={error} onRetry={reload} /></div>
    )
  );

  const months = history.data?.months || [];
  const yearTotals = history.data?.totals || {};

  return (
    <>
      <PageHeader
        title={t('modules.fee-collection', { defaultValue: 'Monthly fees' })}
        subtitle={t('modules.feeCollectionHint', {
          defaultValue: 'Choose the month and the class, then mark the learners who paid. A learner who has paid this month leaves the list and comes back next month.',
        })}
        actions={(
          <>
            {visible.length > 0 && (
              <button type="button" className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1" onClick={exportCsv}>
                <Download size={14} /> {t('common.export')}
              </button>
            )}
            <Link className="btn btn-outline-secondary btn-sm" to="/m/finance-payments">{t('modules.finance-payments', { defaultValue: 'Fee payments' })}</Link>
            <Link className="btn btn-outline-secondary btn-sm" to="/m/finance-summary">{t('modules.finance-summary', { defaultValue: 'Finance overview' })}</Link>
          </>
        )}
      />

      {!allowed && (
        <div className="alert alert-warning small">
          {t('modules.noFinanceView', { defaultValue: 'Your role cannot read the fee register (finance.view), so there is nothing to show.' })}
        </div>
      )}

      {allowed && (
        <>
          <div className="card-soft p-3 mb-3">
            <div className="row g-3 align-items-end">
              <div className="col-12 col-md-5">
                <label className="form-label small fw-semibold d-flex align-items-center gap-1" htmlFor="fee-month">
                  <CalendarDays size={14} /> {t('modules.monthToRecord', { defaultValue: 'Month being recorded' })}
                </label>
                <div className="d-flex gap-2">
                  <select id="fee-month" className="form-select" value={monthNum}
                    onChange={(e) => setMonth(toMonthKey(year, Number(e.target.value)))}>
                    {MONTH_NUMBERS.map((n) => (
                      <option key={n} value={n}>
                        {t(`months.${n}`, { defaultValue: new Date(2026, n - 1, 1).toLocaleDateString(i18n.language, { month: 'long' }) })}
                      </option>
                    ))}
                  </select>
                  <select className="form-select" style={{ maxWidth: 130 }} value={year} aria-label={t('modules.year', { defaultValue: 'Year' })}
                    onChange={(e) => setMonth(toMonthKey(Number(e.target.value), monthNum))}>
                    {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="form-text small">
                  {t('modules.monthPickHint', { defaultValue: 'Any month, any year — the register shows what was recorded for it.' })}
                </div>
              </div>
              <div className="col-12 col-md-4">
                <label className="form-label small fw-semibold d-flex align-items-center gap-1" htmlFor="fee-class">
                  <GraduationCap size={14} /> {t('modules.classToRecord', { defaultValue: 'Class' })}
                </label>
                <select id="fee-class" className="form-select" value={classId} disabled={!classes.length} onChange={(e) => setClassId(e.target.value)}>
                  <option value="">
                    {classes.length ? t('modules.chooseClass', { defaultValue: 'Choose a class' }) : t('modules.noClassesYet', { defaultValue: 'No classes in the school yet' })}
                  </option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.monthly_fee != null ? ` · ${money(c.monthly_fee, c.currency || currency)}` : ` · ${t('modules.feeNotSet', { defaultValue: 'no monthly fee set' })}`}
                    </option>
                  ))}
                </select>
                <div className="form-text small">{t('modules.classesCount', { defaultValue: '{{count}} classes', count: classes.length })}</div>
              </div>
              <div className="col-12 col-md-3">
                <div className="text-muted small fw-semibold d-flex align-items-center gap-1">
                  <CircleDollarSign size={14} /> {t('modules.classMonthlyFee', { defaultValue: 'One month costs' })}
                </div>
                {!classId ? (
                  <div className="small text-muted">—</div>
                ) : fee == null ? (
                  <div className="small text-danger">{t('modules.feeMissingShort', { defaultValue: 'No fee set for this class yet' })}</div>
                ) : (
                  <div className="fs-5 fw-semibold tabular-nums">{money(fee, currency)}</div>
                )}
              </div>
            </div>

            {classId && (
              <div className="d-flex flex-wrap align-items-center gap-2 mt-3 pt-3 border-top">
                <span className="small text-muted">{t('modules.changeFeeLabel', { defaultValue: 'Change the monthly fee for this class' })}</span>
                <input type="number" min="0" step="any" inputMode="decimal" className="form-control form-control-sm" style={{ maxWidth: 160 }}
                  placeholder={fee == null ? '0.00' : String(fee)} value={feeDraft} aria-label={t('modules.monthlyFee', { defaultValue: 'Monthly fee' })}
                  onChange={(e) => setFeeDraft(e.target.value)} />
                <button type="button" className="btn btn-outline-primary btn-sm" onClick={saveFee} disabled={feeSaving || !canRecord || !feeDraft}>
                  {feeSaving ? '…' : t('common.save')}
                </button>
                {!canRecord && <span className="small text-muted">{t('modules.needFinanceCreate', { defaultValue: 'Your role can read fees but not change them.' })}</span>}
              </div>
            )}
          </div>

          {register.error ? (
            gapOrError(register.error, register.reload)
          ) : !classId ? (
            <div className="card-soft p-4">
              <EmptyState icon={Users} title={t('modules.pickClassFirst', { defaultValue: 'Choose a class' })}
                hint={t('modules.pickClassFirstHint', { defaultValue: 'Pick the month and the class, and their learners appear here with who has paid.' })} />
            </div>
          ) : register.loading && !register.data ? (
            <div className="card-soft p-4"><Spinner label={t('common.loading')} /></div>
          ) : (
            <>
              {!data.fee_configured && (
                <div className="alert alert-warning small">
                  {t('modules.feeMissingHint', {
                    defaultValue: 'This class has no monthly fee yet, so the list cannot say how much each learner owes. Set the fee above, or type an amount each time you record a payment.',
                  })}
                </div>
              )}

              <div className="row g-2 mb-3">
                <div className="col-6 col-lg-3"><StatCard label={t('modules.learnersInClass', { defaultValue: 'Learners' })} value={summary.students ?? 0} icon={Users} /></div>
                <div className="col-6 col-lg-3"><StatCard label={t('modules.notPaidYet', { defaultValue: 'Not paid yet' })} value={(summary.unpaid ?? 0) + (summary.partial ?? 0)} icon={Wallet} tone={((summary.unpaid ?? 0) + (summary.partial ?? 0)) > 0 ? 'danger' : 'ok'} /></div>
                <div className="col-6 col-lg-3"><StatCard label={t('modules.paidThisMonth', { defaultValue: 'Paid' })} value={summary.paid ?? 0} icon={BadgeCheck} tone="ok" /></div>
                <div className="col-6 col-lg-3">
                  <StatCard label={t('modules.collectedThisMonth', { defaultValue: 'Collected' })} value={money(summary.collected, currency)} tone="brand"
                    hint={summary.expected != null ? `${t('modules.expected', { defaultValue: 'Expected' })} ${money(summary.expected, currency)}` : undefined} />
                </div>
              </div>

              <div className="nav nav-pills gap-1 mb-3 flex-wrap">
                {TABS.map((item) => (
                  <button key={item.key} type="button" className={`nav-link${tab === item.key ? ' active' : ''}`} onClick={() => setTab(item.key)}>
                    {t(`modules.tab.${item.key}`, { defaultValue: item.label })}
                    <span className="badge text-bg-light ms-2">{countOf(item.key)}</span>
                  </button>
                ))}
                <input className="form-control form-control-sm ms-auto" style={{ maxWidth: 240 }} value={search}
                  placeholder={t('modules.searchInClass', { defaultValue: 'Find a learner in this list' })}
                  onChange={(e) => setSearch(e.target.value)} aria-label={t('common.search')} />
              </div>

              {tab === 'unpaid' && canRecord && visible.length > 0 && (
                <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                  <span className="small text-muted">{t('modules.selectManyHint', { defaultValue: 'Tick the learners who paid, then record them in one go.' })}</span>
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setPicked(visible.map((r) => r.id))}>
                    {t('modules.selectAll', { defaultValue: 'Select all' })}
                  </button>
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setPicked([])}>{t('modules.clearSelection', { defaultValue: 'Clear' })}</button>
                  {picked.length > 0 && (
                    <button type="button" className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={() => openPay(null)}>
                      <BadgeCheck size={14} /> {t('modules.recordSelected', { defaultValue: 'Record {{count}} learner(s)', count: picked.length })}
                    </button>
                  )}
                </div>
              )}

              <div className="card-soft overflow-hidden">
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="bg-white">
                      <tr>
                        {tab === 'unpaid' && canRecord && <th style={{ width: 38 }} aria-label={t('modules.select')} />}
                        <th>{t('transfers.fullName', { defaultValue: 'Learner' })}</th>
                        <th>{t('transfers.section', { defaultValue: 'Section' })}</th>
                        <th className="text-end">{t('modules.feeThisMonth', { defaultValue: 'Fee' })}</th>
                        <th className="text-end">{t('modules.paidShort', { defaultValue: 'Paid' })}</th>
                        <th>{t('common.status')}</th>
                        <th className="text-end">{t('modules.receipt', { defaultValue: 'Receipt' })}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((r) => (
                        <tr key={r.id}>
                          {tab === 'unpaid' && canRecord && (
                            <td>
                              <input className="form-check-input" type="checkbox" checked={picked.includes(r.id)}
                                onChange={() => setPicked((prev) => (prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id]))}
                                aria-label={`${t('modules.select')} ${r.full_name || ''}`} />
                            </td>
                          )}
                          <td className="small">
                            <div className="fw-semibold">{r.full_name || '—'}</div>
                            <div className="text-muted">{r.admission_number || ''}</div>
                          </td>
                          <td className="small text-muted">{r.section || '—'}</td>
                          <td className="text-end tabular-nums small">{r.amount_due == null ? '—' : money(r.amount_due, currency)}</td>
                          <td className="text-end tabular-nums small">{money(r.paid_amount, currency)}</td>
                          <td><StatusBadge value={r.status} /></td>
                          <td className="text-end small">
                            {r.payment ? (
                              <span className="text-muted">
                                {r.payment.transaction_reference} · {dateOnly(r.payment.paid_at)}
                                {canUndo && (
                                  <button type="button" className="btn btn-link btn-sm text-danger p-0 ms-2 border-0"
                                    onClick={() => { setUndoing(r); setUndoReason(''); }}>
                                    <Undo2 size={13} /> {t('modules.undo', { defaultValue: 'Undo' })}
                                  </button>
                                )}
                              </span>
                            ) : (
                              canRecord && (
                                <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => openPay(r)} disabled={!classId}>
                                  {t('modules.recordFee', { defaultValue: 'Record fee' })}
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                      ))}
                      {!visible.length && (
                        <tr>
                          <td colSpan={tab === 'unpaid' && canRecord ? 7 : 6}>
                            <EmptyState title={tab === 'unpaid'
                              ? t('modules.everyonePaid', { defaultValue: 'Everyone in this class has paid for {{month}}', month: monthLabel(month) })
                              : search ? t('modules.noLearnerMatch', { defaultValue: 'No learner in this list matches that name' })
                                : t('modules.nonePaidYet', { defaultValue: 'No payment has been recorded for {{month}} yet', month: monthLabel(month) })}
                              hint={!rows.length ? t('modules.noActiveLearners', { defaultValue: 'This class has no active learners. Add them under Students first.' }) : undefined} />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="small text-muted mt-2">
                {t('modules.monthlyRegisterNote', {
                  defaultValue: 'Recorded here are the class’s monthly fees. One-off charges (exams, books, transport) are taken on the fee payments screen.',
                })}
              </div>
            </>
          )}

          {/* The same missing table breaks both panels; one instruction card is enough. */}
          {!(register.error && isMigrationGap(register.error)) && (
          <div className="card-soft overflow-hidden mt-3">
            <div className="d-flex flex-wrap align-items-center gap-2 p-3 border-bottom">
              <div className="d-flex align-items-center gap-2 min-width-0">
                <div className="stat-icon tone-brand flex-shrink-0"><Wallet size={18} /></div>
                <div className="min-width-0">
                  <div className="fw-semibold">{t('modules.incomeByMonth', { defaultValue: 'Income by month' })} · {year}</div>
                  <div className="small text-muted">
                    {history.data?.totals?.expected != null
                      ? t('modules.incomeExpectedNote', { defaultValue: 'A full month should bring in {{amount}} across all classes.', amount: money(history.data.totals.expected, currency) })
                      : t('modules.incomeByMonthHint', { defaultValue: 'What the school actually collected in each month, including months recorded before this register existed.' })}
                    {history.data && history.data.classes_with_fee < history.data.classes && (
                      <span className="text-warning-emphasis">
                        {' '}{t('modules.feeCoverageNote', {
                          defaultValue: 'Only {{set}} of {{total}} classes have a monthly fee, so amounts here are what was typed in, not what is owed.',
                          set: history.data.classes_with_fee, total: history.data.classes,
                        })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="ms-auto text-end">
                <div className="small text-muted">{t('modules.yearTotal', { defaultValue: 'Total for {{year}}', year })}</div>
                <div className="fs-5 fw-semibold tabular-nums">{history.data ? money(yearTotals.collected ?? 0, currency) : '—'}</div>
              </div>
            </div>

            {history.loading && !history.data ? (
              <div className="p-4"><Spinner label={t('common.loading')} /></div>
            ) : history.error ? (
              gapOrError(history.error, history.reload, true)
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead className="bg-white">
                    <tr>
                      <th>{t('modules.month', { defaultValue: 'Month' })}</th>
                      <th className="text-end">{t('modules.collectedThisMonth', { defaultValue: 'Collected' })}</th>
                      <th className="text-end">{t('modules.learnersPaid', { defaultValue: 'Learners paid' })}</th>
                      <th style={{ width: '26%' }}>{t('modules.shareOfYear', { defaultValue: 'Share of the year' })}</th>
                      <th className="text-end">{t('modules.openMonth', { defaultValue: 'Open' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((m) => {
                      const share = (yearTotals.collected ?? 0) > 0 ? Math.round((m.collected / yearTotals.collected) * 100) : 0;
                      const isOpen = m.month === month;
                      return (
                        <tr key={m.month} className={isOpen ? 'table-active' : undefined}>
                          <td className="small fw-semibold">{monthLabel(m.month)}</td>
                          <td className="text-end tabular-nums small">
                            {m.collected > 0 ? money(m.collected, currency) : <span className="text-muted">—</span>}
                          </td>
                          <td className="text-end tabular-nums small">{m.learners || <span className="text-muted">—</span>}</td>
                          <td>
                            <div className="progress" style={{ height: 8 }} role="progressbar"
                              aria-valuenow={share} aria-valuemin={0} aria-valuemax={100} aria-label={monthLabel(m.month)}>
                              <div className={`progress-bar ${isOpen ? 'bg-primary' : m.collected > 0 ? 'bg-success' : 'bg-secondary'}`}
                                style={{ width: `${Math.min(100, share)}%` }} />
                            </div>
                          </td>
                          <td className="text-end">
                            <button type="button" className={`btn btn-sm ${isOpen ? 'btn-primary' : 'btn-outline-secondary'}`}
                              onClick={() => setMonth(m.month)}>
                              {isOpen ? t('modules.viewing', { defaultValue: 'Viewing' }) : t('modules.openMonth', { defaultValue: 'Open' })}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="fw-semibold small">
                      <td>{t('modules.yearTotal', { defaultValue: 'Total for {{year}}', year })}</td>
                      <td className="text-end tabular-nums">{money(yearTotals.collected ?? 0, currency)}</td>
                      <td className="text-end tabular-nums">{yearTotals.payments ?? 0}</td>
                      <td colSpan={2} className="text-end text-muted">
                        {t('modules.monthsWithIncome', { defaultValue: '{{count}} months with income', count: yearTotals.months_with_income ?? 0 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          )}
        </>
      )}

      <Modal
        open={Boolean(paying)}
        size="sm"
        icon={CircleDollarSign}
        title={paying?.kind === 'many'
          ? t('modules.recordManyTitle', { defaultValue: 'Record {{count}} learners', count: paying?.students.length || 0 })
          : t('modules.recordOneTitle', { defaultValue: 'Record a fee payment' })}
        subtitle={`${monthLabel(month)} · ${data.class_name || ''}`}
        onClose={closePay}
        footer={(
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={closePay}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={pay} disabled={payBusy}>
              {payBusy ? '…' : t('modules.confirmRecord', { defaultValue: 'Confirm and issue receipt' })}
            </button>
          </>
        )}
      >
        {paying?.kind === 'one' && (
          <div className="mb-3 small">
            <div className="fw-semibold">{paying.students[0].full_name}</div>
            <div className="text-muted">
              {t('modules.owesLabel', { defaultValue: 'Still owed this month' })}: {' '}
              <span className="fw-semibold text-body tabular-nums">
                {money(paying.students[0].amount_due == null ? 0 : paying.students[0].amount_due - paying.students[0].paid_amount, currency)}
              </span>
            </div>
          </div>
        )}
        {paying?.kind === 'many' && (
          <div className="alert alert-light border small mb-3">
            {paying.students.map((s) => s.full_name).join(', ')}
          </div>
        )}
        <div className="row g-2">
          <div className="col-12">
            <label className="form-label small fw-semibold" htmlFor="fee-amount">{t('modules.amountPaid', { defaultValue: 'Amount paid' })}</label>
            <input id="fee-amount" type="number" min="0" step="any" inputMode="decimal" className="form-control" value={payAmount}
              placeholder={fee == null ? '0.00' : t('modules.fullFeePlaceholder', { defaultValue: 'Leave blank for the full monthly fee ({{fee}})', fee: money(fee, currency) })}
              onChange={(e) => setPayAmount(e.target.value)} />
            <div className="form-text small">{t('modules.amountBlankNote', { defaultValue: 'Blank means the fee that is still owing, per learner.' })}</div>
          </div>
          <div className="col-12">
            <label className="form-label small fw-semibold" htmlFor="fee-method">{t('modules.paymentMethod', { defaultValue: 'How was it paid?' })}</label>
            <select id="fee-method" className="form-select" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              {METHODS.map((m) => <option key={m} value={m}>{t(`paymentMethods.${m}`, { defaultValue: m.replace('_', ' ') })}</option>)}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label small fw-semibold" htmlFor="fee-ref">{t('modules.providerReference', { defaultValue: 'Reference (optional)' })}</label>
            <input id="fee-ref" className="form-control" value={payReference} onChange={(e) => setPayReference(e.target.value)}
              placeholder={t('modules.providerReferencePlaceholder', { defaultValue: 'Mobile money / bank slip no.' })} />
          </div>
        </div>
        <div className="small text-muted mt-3">
          {t('modules.receiptNote', { defaultValue: 'Each learner gets a receipt number, and the payment is stamped with {{month}}.', month: monthLabel(month) })}
        </div>
      </Modal>

      <Modal
        open={Boolean(undoing)}
        size="sm"
        icon={Undo2}
        title={t('modules.undoTitle', { defaultValue: 'Remove this payment' })}
        subtitle={undoing ? `${undoing.full_name} · ${undoing.payment?.transaction_reference || ''}` : ''}
        onClose={() => setUndoing(null)}
        footer={(
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setUndoing(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-danger" onClick={undo} disabled={undoBusy}>{undoBusy ? '…' : t('modules.confirmUndo', { defaultValue: 'Remove payment' })}</button>
          </>
        )}
      >
        <div className="small text-muted mb-2">
          {t('modules.undoHint', { defaultValue: 'The learner goes back to the list of people who still have to pay for {{month}}.', month: monthLabel(month) })}
        </div>
        <label className="form-label small fw-semibold" htmlFor="undo-reason">{t('modules.reason', { defaultValue: 'Why?' })}</label>
        <input id="undo-reason" className="form-control" value={undoReason} onChange={(e) => setUndoReason(e.target.value)}
          placeholder={t('modules.undoReasonPlaceholder', { defaultValue: 'Paid twice / wrong learner / cash returned' })} />
      </Modal>
    </>
  );
}
