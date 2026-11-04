/**
 * Cashier screen: find a student, read their fee account from /finance/student-balance, take a
 * payment (optionally allocated to specific fee lines) and reverse it when needed.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
import { BadgeCheck, CreditCard, Search, Undo2, Wallet } from 'lucide-react';
import { apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge, money, dateTime } from '../../components/ui/Basics.jsx';
import { Modal } from '../../components/ui/Modal.jsx';

const METHODS = ['cash', 'mobile_money', 'bank', 'other'];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export default function FinancePaymentsPage({ query = {} }) {
  const { t } = useTranslation();
  const { can } = useAuth();

  const [picked, setPicked] = useState(query.student_id || '');
  const [known, setKnown] = useState(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [allocs, setAllocs] = useState({});
  const [amountError, setAmountError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [reversing, setReversing] = useState(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseBusy, setReverseBusy] = useState(false);

  const lookup = useApi('/students', { pageSize: 25, q: debounced || undefined }, Boolean(can('students.view') || can('finance.view')));
  const balance = useApi(picked ? `/finance/student-balance/${picked}` : null, undefined, Boolean(picked) && can('finance.view'));

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(id);
  }, [search]);

  const account = balance.data || {};
  const assignments = useMemo(() => account.assignments || [], [account]);
  const payments = useMemo(() => account.payments || [], [account]);
  const invoices = useMemo(() => account.invoices || [], [account]);
  const clearances = useMemo(() => account.clearances || [], [account]);
  const summary = account.summary || {};
  const outstanding = round2(summary.outstanding ?? 0);
  const currency = payments[0]?.currency || invoices[0]?.currency;
  // The endpoint answers for one student; ignore a payload that still belongs to the previous pick.
  const loadedFor = (account.assignments?.[0]?.student_id) || (account.payments?.[0]?.student_id) || null;
  const accountReady = Boolean(balance.data) && (!loadedFor || loadedFor === picked);

  useEffect(() => {
    if (!balance.data || !accountReady) return;
    setAmount(String(round2(balance.data.summary?.outstanding ?? 0)));
    setAllocs({});
    setAmountError('');
    setTicket(null);
  }, [picked, accountReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const studentTitle = (s) => `${s.full_name || s.first_name}${s.admission_number ? ` · ${s.admission_number}` : ''}`;
  const selectedFromLookup = (lookup.data || []).find((s) => s.id === picked);
  const studentName = known?.full_name || selectedFromLookup?.full_name
    || payments[0]?.students?.full_name || query.student_name || picked || '';

  const dueOf = (a) => round2(Number(a.amount) - Number(a.discount || 0) - Number(a.paid_amount || 0));
  const toggleAlloc = (a) => setAllocs((prev) => {
    const next = { ...prev };
    if (next[a.id]) delete next[a.id];
    else next[a.id] = String(dueOf(a));
    return next;
  });

  const allocatedTotal = round2(Object.values(allocs).reduce((s, v) => s + (Number(v) || 0), 0));
  const usingAllocations = Object.keys(allocs).length > 0;

  const validate = () => {
    const value = Number(amount);
    if (!picked) return t('modules.pickStudent', { defaultValue: 'Pick a student first' });
    if (!Number.isFinite(value) || value <= 0) return t('modules.amountPositive', { defaultValue: 'Enter an amount greater than zero' });
    if (value > outstanding) {
      return t('modules.exceedsOutstanding', { defaultValue: 'Payment exceeds outstanding balance ({{outstanding}})', outstanding: money(outstanding, currency) });
    }
    if (usingAllocations && allocatedTotal !== round2(value)) {
      return t('modules.allocationsMismatch', { defaultValue: 'Allocated lines must add up to the payment amount ({{allocated}} of {{amount}})', allocated: money(allocatedTotal, currency), amount: money(value, currency) });
    }
    return '';
  };

  const pay = async () => {
    const problem = validate();
    setAmountError(problem);
    if (problem) return;
    setSubmitting(true);
    try {
      const value = Number(amount);
      const body = await apiPost('/finance/payments', {
        student_id: picked,
        amount: round2(value),
        payment_method: method,
        ...(reference.trim() ? { provider_reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(usingAllocations
          ? { allocations: Object.entries(allocs).map(([fee_assignment_id, allocAmount]) => ({ fee_assignment_id, amount: round2(allocAmount) })) }
          : {}),
      });
      const data = body?.data || {};
      setTicket({ receipt: data.receipt, payment: data.payment, amount: round2(value) });
      toast.success(`${t('modules.paymentRecorded', { defaultValue: 'Payment recorded' })} · ${data.receipt?.receipt_number || ''}`);
      setAmount(String(round2(Math.max(0, outstanding - value))));
      setAllocs({});
      setReference('');
      setNote('');
      balance.reload();
    } catch (error) {
      setAmountError(error.message);
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const reverse = async () => {
    if (!reversing) return;
    setReverseBusy(true);
    try {
      await apiPost(`/finance/payments/${reversing.id}/reverse`, { reason: reverseReason.trim() });
      toast.success(t('modules.paymentReversed', { defaultValue: 'Payment reversed' }));
      setReversing(null);
      setReverseReason('');
      balance.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setReverseBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('modules.finance-payments', { defaultValue: 'Fee payments' })}
        subtitle={t('modules.cashierHint', { defaultValue: 'Pick a student to load their fee account, then take a payment. The receipt number comes back with the response.' })}
        actions={(
          <>
            <Link className="btn btn-outline-secondary btn-sm" to="/m/finance-summary">{t('modules.finance-summary', { defaultValue: 'Finance overview' })}</Link>
            <Link className="btn btn-outline-secondary btn-sm" to="/m/clearances">{t('modules.clearances', { defaultValue: 'Exam clearances' })}</Link>
          </>
        )}
      />

      <div className="row g-3">
        <div className="col-12 col-lg-5">
          <div className="card-soft p-3 mb-3">
            <div className="fw-semibold mb-2"><Search size={15} className="me-1" />{t('modules.findStudent', { defaultValue: 'Find a student' })}</div>
            <input className="form-control form-control-sm mb-2" placeholder={t('modules.searchStudentPlaceholder', { defaultValue: 'Name or admission number' })}
              value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('common.search')} />
            {lookup.loading && <Spinner label={t('common.loading')} />}
            {lookup.error && <ErrorState error={lookup.error} onRetry={lookup.reload} />}
            {!lookup.loading && !lookup.error && !(lookup.data || []).length && (
              <EmptyState title={search ? t('modules.noStudentMatch', { defaultValue: 'No student matches that search' }) : t('modules.typeToSearch', { defaultValue: 'Type a name or admission number' })} />
            )}
            <div className="list-group list-group-flush">
              {(lookup.data || []).map((s) => (
                <button key={s.id} className={`list-group-item list-group-item-action small d-flex justify-content-between align-items-center ${picked === s.id ? 'active' : ''}`}
                  onClick={() => { setPicked(s.id); setKnown(s); setSearch(''); }}>
                  <span className="text-truncate">{studentTitle(s)}</span>
                  {s.classes?.name && <span className="text-muted ms-2">{s.classes.name}</span>}
                </button>
              ))}
            </div>
            {picked && (
              <div className="mt-2 small text-muted">
                {t('modules.selectedStudent', { defaultValue: 'Selected' })}: <span className="fw-semibold text-body">{studentName}</span>
              </div>
            )}
          </div>
        </div>

        <div className="col-12 col-lg-7">
          {!picked && (
            <div className="card-soft p-4 mb-3">
              <EmptyState icon={Wallet} title={t('modules.noStudentPicked', { defaultValue: 'No student selected' })}
                hint={t('modules.noStudentPickedHint', { defaultValue: 'Search on the left, or open this page with ?student_id=… from a student profile.' })} />
            </div>
          )}
          {picked && balance.loading && !balance.data && <div className="card-soft p-4 mb-3"><Spinner label={t('common.loading')} /></div>}
          {picked && balance.error && (
            <div className="mb-3"><ErrorState error={balance.error} onRetry={balance.reload} /></div>
          )}
          {picked && !can('finance.view') && (
            <div className="alert alert-warning small mb-3">
              {t('modules.noFinanceView', { defaultValue: 'Your role cannot read student fee accounts (finance.view), so the cashier screen has nothing to show.' })}
            </div>
          )}

          {picked && !balance.loading && accountReady && (
            <>
              <div className="row g-2 mb-3">
                <div className="col-4"><StatCard label={t('modules.expected', { defaultValue: 'Expected' })} value={money(summary.expected, currency)} /></div>
                <div className="col-4"><StatCard label={t('modules.paid', { defaultValue: 'Paid' })} value={money(summary.paid, currency)} tone="ok" /></div>
                <div className="col-4"><StatCard label={t('modules.outstanding', { defaultValue: 'Outstanding' })} value={money(summary.outstanding, currency)} tone={outstanding > 0 ? 'danger' : 'ok'} /></div>
              </div>

              <div className="card-soft p-3 mb-3">
                <div className="fw-semibold mb-2"><CreditCard size={15} className="me-1" />{t('modules.recordPayment', { defaultValue: 'Record a payment' })}</div>
                {!assignments.length && (
                  <div className="alert alert-light border small">{t('modules.noAssignments', { defaultValue: 'This student has no fee assignments, so a payment cannot be recorded yet.' })}</div>
                )}
                <div className="row g-2">
                  <div className="col-6 col-md-4">
                    <label className="form-label small fw-semibold" htmlFor="pay-amount">{t('common.amount')}<span className="text-danger"> *</span></label>
                    <input id="pay-amount" type="number" min="0" step="any" inputMode="decimal"
                      className={`form-control${amountError ? ' is-invalid' : ''}`} value={amount}
                      disabled={!can('finance.create') || !assignments.length}
                      onChange={(e) => { setAmount(e.target.value); setAmountError(''); }} />
                    {amountError && <div className="invalid-feedback d-block small">{amountError}</div>}
                    <div className="form-text small">{t('modules.outstandingIs', { defaultValue: 'Outstanding' })}: {money(outstanding, currency)}</div>
                  </div>
                  <div className="col-6 col-md-4">
                    <label className="form-label small fw-semibold" htmlFor="pay-method">{t('modules.paymentMethod', { defaultValue: 'Method' })}</label>
                    <select id="pay-method" className="form-select" value={method} onChange={(e) => setMethod(e.target.value)}>
                      {METHODS.map((m) => <option key={m} value={m}>{t(`paymentMethods.${m}`, { defaultValue: m.replace('_', ' ') })}</option>)}
                    </select>
                  </div>
                  <div className="col-12 col-md-4">
                    <label className="form-label small fw-semibold" htmlFor="pay-ref">{t('modules.providerReference', { defaultValue: 'Provider reference' })}</label>
                    <input id="pay-ref" className="form-control" value={reference} placeholder={t('modules.providerReferencePlaceholder', { defaultValue: 'Mobile money / bank slip no.' })}
                      onChange={(e) => setReference(e.target.value)} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-semibold" htmlFor="pay-note">{t('modules.note', { defaultValue: 'Note' })}</label>
                    <input id="pay-note" className="form-control" value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                </div>

                <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-3">
                  <div className="small text-muted">
                    {usingAllocations
                      ? `${t('modules.allocated', { defaultValue: 'Allocated' })} ${money(allocatedTotal, currency)}`
                      : t('modules.oldestFirstNote', { defaultValue: 'Without ticked lines the server splits the payment oldest-first.' })}
                  </div>
                  {can('finance.create') && (
                    <button className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={pay} disabled={submitting || !assignments.length}>
                      <BadgeCheck size={14} /> {submitting ? '…' : t('modules.takePayment', { defaultValue: 'Take payment' })}
                    </button>
                  )}
                </div>
              </div>

              {ticket && (
                <div className="alert alert-success">
                  <div className="fw-semibold">{t('modules.paymentRecorded', { defaultValue: 'Payment recorded' })} · {money(ticket.amount, currency)}</div>
                  <div className="small">
                    {t('modules.receiptNumber', { defaultValue: 'Receipt' })}: <span className="fw-semibold">{ticket.receipt?.receipt_number || '—'}</span>
                    {' · '}{t('modules.transactionReference', { defaultValue: 'Reference' })}: {ticket.payment?.transaction_reference || '—'}
                  </div>
                  <div className="small mt-1 text-muted">
                    {t('modules.receiptPdfNote', { defaultValue: 'The receipt PDF endpoint needs the session bearer token, so it is printed from the school documents area rather than linked here.' })}
                  </div>
                </div>
              )}

              <div className="card-soft overflow-hidden mb-3">
                <div className="px-3 py-2 border-bottom bg-white fw-semibold small">
                  {t('modules.feeLines', { defaultValue: 'Fee lines' })}
                  <span className="text-muted fw-normal ms-2">· {t('modules.tickToAllocate', { defaultValue: 'Tick a line to allocate the payment against it' })}</span>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="bg-white">
                      <tr>
                        <th style={{ width: 40 }} aria-label={t('modules.allocate', { defaultValue: 'Allocate' })} />
                        <th>{t('modules.fee', { defaultValue: 'Fee' })}</th>
                        <th className="text-end">{t('modules.due', { defaultValue: 'Due' })}</th>
                        <th className="text-end">{t('modules.paidShort', { defaultValue: 'Paid' })}</th>
                        <th style={{ width: 130 }}>{t('modules.allocateAmount', { defaultValue: 'Allocate' })}</th>
                        <th>{t('common.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map((a) => {
                        const on = Boolean(allocs[a.id]);
                        const structure = a.fee_structures;
                        const label = structure?.fee_categories?.name || structure?.name || t('modules.feeItem', { defaultValue: 'Fee item' });
                        return (
                          <tr key={a.id}>
                            <td>
                              <input className="form-check-input" type="checkbox" checked={on} disabled={!can('finance.create')}
                                onChange={() => toggleAlloc(a)} aria-label={`${t('modules.allocate')} ${label}`} />
                            </td>
                            <td className="small">
                              <div className="fw-semibold">{label}</div>
                              <div className="text-muted">{dateOrCreated(a)}{structure?.fee_categories?.is_examination_fee ? ` · ${t('modules.examinationFee', { defaultValue: 'gates exam clearance' })}` : ''}</div>
                            </td>
                            <td className="text-end tabular-nums small">{money(dueOf(a), currency)}</td>
                            <td className="text-end tabular-nums small">{money(a.paid_amount, currency)}</td>
                            <td>
                              <input type="number" min="0" step="any" className="form-control form-control-sm" value={on ? allocs[a.id] : ''}
                                disabled={!on || !can('finance.create')}
                                onChange={(e) => setAllocs((prev) => ({ ...prev, [a.id]: e.target.value }))}
                                aria-label={`${t('modules.allocateAmount', { defaultValue: 'Allocate' })} · ${label}`} />
                            </td>
                            <td><StatusBadge value={a.status} /></td>
                          </tr>
                        );
                      })}
                      {!assignments.length && (
                        <tr><td colSpan={6}><EmptyState title={t('modules.noFeeLines', { defaultValue: 'No fees assigned to this student' })} /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card-soft overflow-hidden mb-3">
                <div className="px-3 py-2 border-bottom bg-white fw-semibold small">
                  {t('modules.studentPayments', { defaultValue: 'Payments for this student' })}
                  <span className="text-muted fw-normal ms-2">· {t('modules.perStudentNote', { defaultValue: 'The API exposes payment history per student; there is no school-wide payments list yet.' })}</span>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="bg-white">
                      <tr>
                        <th>{t('modules.reference', { defaultValue: 'Reference' })}</th>
                        <th>{t('common.date')}</th>
                        <th>{t('modules.paymentMethod', { defaultValue: 'Method' })}</th>
                        <th className="text-end">{t('common.amount')}</th>
                        <th>{t('common.status')}</th>
                        <th className="text-end">{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td className="small">{p.transaction_reference}</td>
                          <td className="small text-muted">{dateTime(p.paid_at)}</td>
                          <td className="small text-capitalize">{String(p.payment_method || '').replace('_', ' ')}</td>
                          <td className="text-end tabular-nums small">{money(p.amount, p.currency)}</td>
                          <td>
                            <StatusBadge value={p.reversed ? 'refunded' : p.status} />
                            {p.reversal_reason && <div className="small text-muted">{p.reversal_reason}</div>}
                          </td>
                          <td className="text-end">
                            {can('finance.approve') && !p.reversed && p.status !== 'refunded' ? (
                              <button className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                                onClick={() => { setReversing(p); setReverseReason(''); }}>
                                <Undo2 size={13} /> {t('modules.reverse', { defaultValue: 'Reverse' })}
                              </button>
                            ) : <span className="text-muted small">—</span>}
                          </td>
                        </tr>
                      ))}
                      {!payments.length && (
                        <tr><td colSpan={6}><EmptyState title={t('modules.noPaymentsYet', { defaultValue: 'No payments recorded for this student' })} /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <div className="card-soft p-3 h-100">
                    <div className="fw-semibold small mb-2">{t('modules.invoices', { defaultValue: 'Invoices' })}</div>
                    {!invoices.length && <EmptyState title={t('modules.noInvoices', { defaultValue: 'No invoices yet' })} />}
                    {invoices.map((inv) => (
                      <div key={inv.id} className="d-flex justify-content-between border-bottom py-1 small">
                        <span>{inv.invoice_number}</span>
                        <span className="text-muted">{money(inv.balance, inv.currency)} · <StatusBadge value={inv.status} /></span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="col-12 col-md-6">
                  <div className="card-soft p-3 h-100">
                    <div className="fw-semibold small mb-2">{t('modules.examClearance', { defaultValue: 'Examination clearance' })}</div>
                    {!clearances.length && <EmptyState title={t('modules.noClearance', { defaultValue: 'No clearance record yet' })} />}
                    {clearances.map((c) => (
                      <div key={c.id} className="d-flex justify-content-between border-bottom py-1 small">
                        <span className="text-capitalize">{t('modules.requiredPaid', { defaultValue: 'Required / paid' })}</span>
                        <span className="text-muted tabular-nums">{money(c.required_amount)} / {money(c.paid_amount)} · <StatusBadge value={c.status} /></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal open={Boolean(reversing)} size="md" onClose={() => setReversing(null)}
        title={t('modules.reversePayment', { defaultValue: 'Reverse this payment' })}
        footer={(
          <>
            <button className="btn btn-outline-secondary" onClick={() => setReversing(null)}>{t('common.cancel')}</button>
            <button className="btn btn-danger" disabled={reverseBusy || reverseReason.trim().length < 3} onClick={reverse}>
              {reverseBusy ? '…' : t('modules.reverse', { defaultValue: 'Reverse' })}
            </button>
          </>
        )}>
        <p className="small text-muted">
          {t('modules.reverseBody', { defaultValue: 'Reversing returns the money to the outstanding balance, recomputes invoices and refreshes the examination clearance.' })}
        </p>
        <div className="mb-2 small">{reversing?.transaction_reference} · {money(reversing?.amount, reversing?.currency)}</div>
        <textarea className="form-control" rows={3} autoFocus value={reverseReason}
          placeholder={t('modules.reverseReasonPlaceholder', { defaultValue: 'Reason for the reversal (required)' })}
          onChange={(e) => setReverseReason(e.target.value)} />
        {reverseReason.trim().length > 0 && reverseReason.trim().length < 3 && (
          <div className="form-text text-danger small">{t('modules.reasonTooShort', { defaultValue: 'Give a reason (at least 3 characters)' })}</div>
        )}
      </Modal>
    </>
  );
}

function dateOrCreated(row) {
  // The due date lives on the fee structure (embedded by /finance/student-balance), not on the assignment.
  const value = row.due_date || row.fee_structures?.due_date || row.created_at || '';
  return String(value).slice(0, 10);
}
