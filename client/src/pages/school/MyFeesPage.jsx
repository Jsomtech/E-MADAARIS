// Student/parent fee portal: /school/me/students + GET /finance/student-balance/:student_id (read-only).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Ban, GraduationCap, ReceiptText, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { Badge, EmptyState, ErrorState, PageHeader, dateOnly, dateTime, money } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function MyFeesPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const [studentId, setStudentId] = useState('');

  const mine = useApi('/school/me/students');
  const students = mine.data || [];
  const chosen = useMemo(() => students.find((s) => s.id === studentId) || null, [students, studentId]);

  useEffect(() => {
    if (!mine.data) return;
    const list = mine.data || [];
    if (!list.length) { setStudentId(''); return; }
    const fromUrl = searchParams.get('student_id');
    const picked = fromUrl && list.some((s) => s.id === fromUrl) ? fromUrl : list[0].id;
    setStudentId((current) => (current && list.some((s) => s.id === current) ? current : picked));
  }, [mine.data, searchParams]);

  const balance = useApi(studentId ? `/finance/student-balance/${studentId}` : null, undefined, Boolean(studentId));
  const summary = balance.data?.summary || {};
  const assignments = balance.data?.assignments || [];
  const invoices = balance.data?.invoices || [];
  const payments = balance.data?.payments || [];
  const clearances = balance.data?.clearances || [];
  const currency = payments[0]?.currency || invoices[0]?.currency || null;

  const assignmentColumns = [
    {
      key: 'category',
      label: t('sections.feeCategory', { defaultValue: 'Fee category' }),
      render: (row) => (
        <div>
          <div className="fw-semibold small">{row.fee_structures?.fee_categories?.name || t('sections.unnamedFee', { defaultValue: 'Fee structure {{id}}', id: String(row.fee_structure_id).slice(0, 8) })}</div>
          <div className="small text-muted">
            {t('sections.dueOn', { defaultValue: 'due' })} {dateOnly(row.fee_structures?.due_date)}
            {row.fee_structures?.fee_categories?.is_examination_fee ? <> · <Badge tone="warn">{t('sections.examFee', { defaultValue: 'exam fee' })}</Badge></> : null}
          </div>
        </div>
      ),
    },
    { key: 'amount', label: t('sections.billed', { defaultValue: 'Amount' }), render: (r) => <span className="tabular-nums">{money(r.amount, currency)}</span> },
    { key: 'discount', label: t('sections.discount', { defaultValue: 'Discount' }), render: (r) => <span className="tabular-nums">{money(r.discount, currency)}</span> },
    { key: 'paid_amount', label: t('sections.paid', { defaultValue: 'Paid' }), render: (r) => <span className="tabular-nums">{money(r.paid_amount, currency)}</span> },
    {
      key: 'balance',
      label: t('sections.remaining', { defaultValue: 'Remaining' }),
      render: (r) => <span className="tabular-nums">{money(Math.max(0, Number(r.amount || 0) - Number(r.discount || 0) - Number(r.paid_amount || 0)), currency)}</span>,
    },
    { key: 'status', label: t('common.status'), type: 'status', width: 120 },
  ];

  const invoiceColumns = [
    { key: 'invoice_number', label: t('sections.invoice', { defaultValue: 'Invoice' }), render: (r) => <span className="fw-semibold small">{r.invoice_number}</span> },
    { key: 'subtotal', label: t('sections.subtotal', { defaultValue: 'Subtotal' }), render: (r) => <span className="tabular-nums small">{money(r.subtotal, r.currency)}</span> },
    { key: 'discount', label: t('sections.discount', { defaultValue: 'Discount' }), render: (r) => <span className="tabular-nums small">{money(r.discount, r.currency)}</span> },
    { key: 'total', label: t('common.total'), render: (r) => <span className="tabular-nums fw-semibold">{money(r.total, r.currency)}</span> },
    { key: 'balance', label: t('sections.outstanding', { defaultValue: 'Outstanding' }), render: (r) => <span className="tabular-nums">{money(r.balance, r.currency)}</span> },
    { key: 'due_date', label: t('sections.dueDate', { defaultValue: 'Due' }), render: (r) => <span className="small">{dateOnly(r.due_date)}</span> },
    { key: 'status', label: t('common.status'), type: 'status', width: 110 },
  ];

  const paymentColumns = [
    { key: 'transaction_reference', label: t('sections.reference', { defaultValue: 'Reference' }), render: (r) => <span className="small fw-semibold">{r.transaction_reference}</span> },
    { key: 'amount', label: t('common.amount'), render: (r) => <span className="tabular-nums">{money(r.amount, r.currency)}</span> },
    { key: 'payment_method', label: t('sections.method', { defaultValue: 'Method' }), render: (r) => <span className="small">{String(r.payment_method || '—').replace(/_/g, ' ')}</span> },
    { key: 'status', label: t('common.status'), type: 'status', width: 120 },
    {
      key: 'reversed',
      label: t('sections.reversed', { defaultValue: 'Reversed' }),
      width: 100,
      render: (r) => (r.reversed ? <Badge tone="danger">{t('common.yes')}</Badge> : <span className="small text-muted">{t('common.no')}</span>),
    },
    { key: 'paid_at', label: t('sections.paidOn', { defaultValue: 'Paid on' }), render: (r) => <span className="small text-muted">{dateTime(r.paid_at)}</span> },
    { key: 'note', label: t('sections.note', { defaultValue: 'Note' }), render: (r) => <span className="small text-muted">{r.note || '—'}</span>, },
  ];

  const clearanceColumns = [
    {
      key: 'examination_id',
      label: t('sections.examination', { defaultValue: 'Examination' }),
      render: (r) => <span className="small">{r.examinations?.name || String(r.examination_id || '—').slice(0, 8)}</span>,
    },
    { key: 'required_amount', label: t('sections.required', { defaultValue: 'Required' }), render: (r) => <span className="tabular-nums">{money(r.required_amount, currency)}</span> },
    { key: 'paid_amount', label: t('sections.paid', { defaultValue: 'Paid' }), render: (r) => <span className="tabular-nums">{money(r.paid_amount, currency)}</span> },
    { key: 'status', label: t('common.status'), type: 'status', width: 170 },
  ];

  if (mine.error?.status === 403) {
    return (
      <>
        <PageHeader title={t('sections.myFeesTitle', { defaultValue: 'My fees' })} />
        <div className="card-soft">
          <EmptyState icon={Ban} title={t('sections.myFeesStaffTitle', { defaultValue: 'Staff accounts have no personal fee portal' })}
            hint={t('sections.myFeesStaffHint', { defaultValue: 'GET /school/me/students answers 403 for any role that is not a student or a parent. Use the finance modules instead.' })} />
        </div>
      </>
    );
  }

  const noStudents = !mine.loading && !mine.error && students.length === 0;

  return (
    <>
      <PageHeader
        title={t('sections.myFeesTitle', { defaultValue: 'My fees' })}
        subtitle={profile?.school?.school_name ? `${profile.school.school_name} · ${profile?.primaryRole || ''}` : t('sections.myFeesSubtitle', { defaultValue: 'Fees, invoices and receipts for the students linked to this account.' })}
        actions={(
          <>
            {students.length > 1 && (
              <select className="form-select form-select-sm" style={{ maxWidth: 240 }} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                {students.map((s) => <option key={s.id} value={s.id}>{s.full_name} · {s.admission_number}</option>)}
              </select>
            )}
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={() => { mine.reload(); balance.reload(); }}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
          </>
        )}
      />

      {mine.loading && !mine.data && <EmptyState icon={Wallet} title={t('common.loading')} />}

      {noStudents && (
        <div className="card-soft">
          <EmptyState icon={GraduationCap} title={t('sections.noLinkedStudent', { defaultValue: 'No student is linked to this account yet' })}
            hint={t('sections.noLinkedStudentHint', { defaultValue: 'A student account needs students.user_id and a parent account needs a guardian row with user_id plus a student_guardians link. The school office completes that; contact them through Support.' })} />
        </div>
      )}

      {!noStudents && (
        <>
          <div className="row g-3 mb-1">
            <div className="col-12 col-md-4">
              <div className="card-soft p-3 h-100">
                <div className="text-muted small text-uppercase">{t('sections.expected', { defaultValue: 'Expected' })}</div>
                <div className="fs-4 fw-bold lh-1">{money(summary.expected, currency)}</div>
                <div className="small text-muted">{t('sections.expectedHint', { defaultValue: 'sum of amount − discount over all fee assignments' })}</div>
              </div>
            </div>
            <div className="col-12 col-md-4">
              <div className="card-soft p-3 h-100">
                <div className="text-muted small text-uppercase">{t('sections.paidTotal', { defaultValue: 'Paid' })}</div>
                <div className="fs-4 fw-bold lh-1 text-success">{money(summary.paid, currency)}</div>
                <div className="small text-muted">{t('sections.paidHint', { defaultValue: 'sum of paid_amount' })}</div>
              </div>
            </div>
            <div className="col-12 col-md-4">
              <div className="card-soft p-3 h-100">
                <div className="text-muted small text-uppercase">{t('sections.outstanding', { defaultValue: 'Outstanding' })}</div>
                <div className="fs-4 fw-bold lh-1 text-danger">{money(summary.outstanding, currency)}</div>
                <div className="small text-muted">{t('sections.outstandingHint', { defaultValue: 'expected − paid, never below zero' })}</div>
              </div>
            </div>
          </div>

          <div className="alert alert-secondary small py-2 d-flex align-items-start gap-2">
            <ShieldCheck size={15} className="mt-1" />
            <div>
              {t('sections.readOnlyNote', { defaultValue: 'This portal is read-only: payments are recorded at the school office by staff with finance.create, and there is no online payment endpoint for families. If a payment is missing, open a billing support ticket.' })}
            </div>
          </div>

          <div className="mb-2 small text-muted">
            {chosen ? <>{t('sections.viewing', { defaultValue: 'Showing' })}: <span className="fw-semibold text-body">{chosen.full_name}</span> · {chosen.admission_number}</> : t('sections.pickStudent', { defaultValue: 'Pick a student above' })}
          </div>

          <ErrorStateWrapper error={balance.error} onRetry={balance.reload} />
          {balance.loading && !balance.data && <EmptyState icon={ReceiptText} title={t('common.loading')} />}

          {balance.data && (
            <>
              <div className="fw-semibold mb-2">{t('sections.feeAssignments', { defaultValue: 'Fee assignments' })}</div>
              <DataTable columns={assignmentColumns} rows={assignments} loading={balance.loading} dense
                empty={t('sections.noAssignments', { defaultValue: 'No fees have been assigned to this student' })} />

              <div className="fw-semibold mb-2 mt-4">{t('sections.invoices', { defaultValue: 'Invoices' })}</div>
              <DataTable columns={invoiceColumns} rows={invoices} loading={balance.loading} dense
                empty={t('sections.noInvoices', { defaultValue: 'No invoice issued yet' })} />

              <div className="fw-semibold mb-2 mt-4">{t('sections.payments', { defaultValue: 'Payments' })}</div>
              <DataTable columns={paymentColumns} rows={payments} loading={balance.loading} dense
                empty={t('sections.noPayments', { defaultValue: 'No payment recorded yet' })} />

              <div className="fw-semibold mb-2 mt-4">{t('sections.clearances', { defaultValue: 'Examination clearances' })}</div>
              <DataTable columns={clearanceColumns} rows={clearances} loading={balance.loading} dense
                empty={t('sections.noClearances', { defaultValue: 'No examination clearance for this student' })} />

              <div className="small text-muted mt-3">
                {t('sections.balanceShape', { defaultValue: 'All four tables come from one call: GET /finance/student-balance/{{id}} returns { assignments, invoices, payments, clearances, summary } — assignments embed fee_structures → fee_categories, payments are capped at the 200 most recent, and nothing here is paginated.', id: String(studentId).slice(0, 8) })}
              </div>
              <div className="small text-muted">
                {t('sections.clearanceStatusValues', { defaultValue: 'Clearance status is one of not_required, unpaid, partially_paid, paid, pending_verification, cleared, blocked — a student with an outstanding exam fee is blocked from sitting the examination.' })}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function ErrorStateWrapper({ error, onRetry }) {
  const { t } = useTranslation();
  if (!error) return null;
  if (error.status === 403) {
    return (
      <div className="alert alert-warning small d-flex align-items-start gap-2">
        <AlertTriangle size={16} className="mt-1" />
        <div>{t('sections.balanceForbidden', { defaultValue: 'The balance call was refused: {{message}} Only the students linked to your account (or staff with finance.view) can read it.', message: error.message })}</div>
      </div>
    );
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}
