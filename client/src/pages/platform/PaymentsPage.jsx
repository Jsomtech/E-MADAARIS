// SaaS subscription payments: manual recording + verification queue. No gateway is simulated — the
// money movement happens outside this app and is registered here by an operator.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { BadgeCheck, Banknote, CheckCircle2, Clock, Info, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPost } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Field from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { PageHeader, Spinner, StatCard, StatusBadge, dateTime, money as formatMoney } from '../../components/ui/Basics.jsx';

/** subscription_payments.payment_method values (server zod enum). */
export const PAYMENT_METHODS = ['manual', 'bank_transfer', 'mobile_money', 'provider'];
/** subscription_payments.status values accepted on create. */
const CREATE_STATUSES = ['pending', 'successful'];
/** subscription_payments.status column values (supabase/migrations/0004_subscriptions_billing.sql). */
const LIST_STATUSES = ['pending', 'processing', 'successful', 'failed', 'rejected', 'refunded', 'cancelled'];

export default function PaymentsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [verification, setVerification] = useState('');
  const [recording, setRecording] = useState(false);
  const [verifying, setVerifying] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = useApi('/platform/payments', { status: status || undefined, verification_status: verification || undefined });
  const rows = useMemo(() => {
    const all = [...(list.data || [])];
    const rank = (r) => (r.verification_status !== 'verified' ? 0 : 1);
    return all.sort((a, b) => rank(a) - rank(b) || new Date(b.created_at) - new Date(a.created_at));
  }, [list.data]);

  const summary = useMemo(() => {
    const all = list.data || [];
    const verified = all.filter((p) => p.verification_status === 'verified');
    return {
      verifiedCount: verified.length,
      verifiedAmount: verified.reduce((sum, p) => sum + Number(p.amount || 0), 0),
      awaiting: all.filter((p) => p.verification_status === 'unverified').length,
      rejected: all.filter((p) => p.verification_status === 'rejected').length,
      currency: verified[0]?.currency || all[0]?.currency || '',
    };
  }, [list.data]);

  const verify = useCallback(async (row, action, reason) => {
    setBusy(true);
    try {
      const body = { action };
      if (reason) body.reason = reason;
      await apiPost(`/platform/payments/${row.id}/verify`, body);
      toast.success(action === 'approve'
        ? t('platform.paymentApproved', { defaultValue: 'Payment verified; the linked invoice was settled.' })
        : t('platform.paymentRejected', { defaultValue: 'Payment rejected.' }));
      setVerifying(null);
      list.reload();
    } catch (error) {
      toast.error(error.status === 403 ? t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }) : error.message);
    } finally { setBusy(false); }
  }, [list, t]);

  const columns = [
    {
      key: 'transaction_reference',
      label: t('platform.reference', { defaultValue: 'Reference' }),
      render: (row) => (
        <div>
          <div className="small fw-semibold">{row.transaction_reference}</div>
          <Link to={`/platform/schools/${row.school_id}`} className="small text-muted text-decoration-none">{row.schools?.school_name || row.school_id}</Link>
        </div>
      ),
    },
    { key: 'amount', label: t('common.amount'), render: (r) => <span className="tabular-nums">{formatMoney(r.amount, r.currency)}</span> },
    { key: 'payment_method', label: t('platform.method', { defaultValue: 'Method' }), render: (r) => <span className="small">{String(r.payment_method || '').replace(/_/g, ' ')}</span> },
    { key: 'status', label: t('common.status'), type: 'status', width: 110 },
    {
      key: 'verification_status',
      label: t('platform.verification', { defaultValue: 'Verification' }),
      width: 130,
      render: (row) => <StatusBadge value={row.verification_status === 'unverified' ? 'pending_verification' : row.verification_status} />,
    },
    { key: 'provider_reference', label: t('platform.providerRef', { defaultValue: 'Provider ref' }), render: (r) => <span className="small text-muted">{r.provider_reference || '—'}</span> },
    { key: 'paid_at', label: t('platform.paidAt', { defaultValue: 'Paid at' }), render: (r) => <span className="small">{r.paid_at ? dateTime(r.paid_at) : '—'}</span> },
    {
      key: 'actions',
      label: t('common.actions'),
      width: 130,
      className: 'text-end',
      render: (row) => (
        <div className="d-inline-flex gap-1">
          <button className="btn btn-sm btn-outline-success" title={t('platform.approve', { defaultValue: 'Approve' })}
            disabled={busy || row.verification_status === 'verified'} onClick={() => setVerifying({ row, action: 'approve' })}>
            <CheckCircle2 size={14} />
          </button>
          <button className="btn btn-sm btn-outline-danger" title={t('platform.reject', { defaultValue: 'Reject' })}
            disabled={busy || row.verification_status === 'rejected'} onClick={() => setVerifying({ row, action: 'reject' })}>
            <XCircle size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('platform.payments', { defaultValue: 'Subscription payments' })}
        subtitle={t('platform.paymentsSubtitle', { defaultValue: 'Platform billing receipts recorded by hand, then verified.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={list.reload}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <button className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={() => setRecording(true)}>
              <Banknote size={14} /> {t('platform.recordPayment', { defaultValue: 'Record a manual payment' })}
            </button>
          </>
        )}
      />

      <div className="alert alert-light border d-flex align-items-start gap-2 small">
        <Info size={16} className="mt-1 text-primary" />
        <div>{t('platform.noGatewayNote', { defaultValue: 'Payments are recorded manually by platform staff. No payment gateway is connected or simulated: approving a verification only marks the record and settles the invoice on our side — it does not move money.' })}</div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3"><StatCard label={t('platform.verifiedRevenue', { defaultValue: 'Verified revenue (loaded rows)' })} value={formatMoney(summary.verifiedAmount, summary.currency)} icon={BadgeCheck} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('platform.awaitingVerification', { defaultValue: 'Awaiting verification' })} value={summary.awaiting} icon={Clock} tone="warn" /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('platform.verifiedCount', { defaultValue: 'Verified payments' })} value={summary.verifiedCount} icon={CheckCircle2} tone="ok" /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('platform.rejectedCount', { defaultValue: 'Rejected payments' })} value={summary.rejected} icon={XCircle} tone="danger" /></div>
      </div>

      <div className="card-soft p-2 mb-3">
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <div className="nav nav-pills gap-1 flex-wrap">
            <button className={`btn btn-sm ${status === '' ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setStatus('')}>{t('common.all')}</button>
            {LIST_STATUSES.map((s) => (
              <button key={s} className={`btn btn-sm ${status === s ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setStatus(s)}>{s.replace(/_/g, ' ')}</button>
            ))}
          </div>
          <select className="form-select form-select-sm" style={{ maxWidth: 220 }} value={verification} onChange={(e) => setVerification(e.target.value)}>
            <option value="">{t('platform.anyVerification', { defaultValue: 'Any verification state' })}</option>
            {['unverified', 'verified', 'rejected'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <span className="small text-muted">{t('platform.pendingFirst', { defaultValue: 'Rows awaiting verification are listed first.' })}</span>
        </div>
      </div>

      <DataTable columns={columns} rows={rows} loading={list.loading} error={list.error} onRetry={list.reload} dense
        empty={t('platform.noPayments', { defaultValue: 'No payments recorded yet' })} />

      <div className="small text-muted mt-2">{t('platform.summaryScope', { defaultValue: 'The summary strip adds up the rows this screen loaded (the server returns at most the 500 most recent payments).' })}</div>

      <PaymentModal open={recording} onClose={() => setRecording(false)} onSaved={() => { setRecording(false); list.reload(); }} />

      <VerifyModal state={verifying} busy={busy} onClose={() => setVerifying(null)} onSubmit={verify} />
    </>
  );
}

// ── Reusable "record a payment" modal (also opened from the invoice list) ──
export function PaymentModal({ open, invoice, onClose, onSaved }) {
  const { t } = useTranslation();
  const knownSchoolId = invoice?.school_id;
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const schools = useApi('/platform/schools', { pageSize: 200 }, open && !knownSchoolId);
  const subscriptions = useApi('/platform/subscriptions', { school_id: values.school_id }, open && Boolean(values.school_id));

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setValues({
      school_id: knownSchoolId || '',
      subscription_id: invoice?.subscription_id || '',
      invoice_id: invoice?.id || '',
      amount: invoice?.total ?? '',
      currency: invoice?.currency || 'USD',
      payment_method: 'bank_transfer',
      provider_reference: '',
      evidence_url: '',
      status: 'successful',
    });
  }, [open, invoice, knownSchoolId]);

  const schoolOptions = useMemo(() => (schools.data || []).map((s) => ({ value: s.id, label: `${s.school_name} (${s.status})` })), [schools.data]);
  const subscriptionOptions = useMemo(() => (subscriptions.data || [])
    .filter((s) => s.id !== invoice?.subscription_id)
    .map((s) => ({ value: s.id, label: `${s.subscription_plans?.name || s.id} · ${s.billing_cycle} · ${s.status}` })), [subscriptions.data, invoice]);

  const submit = useCallback(async () => {
    const missing = {};
    if (!values.school_id) missing.school_id = t('common.required');
    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || amount < 0) missing.amount = t('platform.amountInvalid', { defaultValue: 'Enter an amount of 0 or more' });
    if (!String(values.currency || '').trim() || String(values.currency).length > 8) missing.currency = t('platform.currencyLength', { defaultValue: 'Max 8 characters' });
    if (!values.payment_method) missing.payment_method = t('common.required');
    if (String(values.provider_reference || '').length > 128) missing.provider_reference = t('platform.refLength', { defaultValue: 'Max 128 characters' });
    if (values.evidence_url && !/^https?:\/\//.test(values.evidence_url)) missing.evidence_url = t('platform.urlInvalid', { defaultValue: 'Must start with http(s)://' });
    setErrors(missing);
    if (Object.keys(missing).length) return;

    setBusy(true);
    try {
      const body = {
        school_id: values.school_id,
        amount,
        currency: String(values.currency).trim(),
        payment_method: values.payment_method,
        status: values.status,
      };
      if (values.invoice_id) body.invoice_id = values.invoice_id;
      if (values.subscription_id) body.subscription_id = values.subscription_id;
      if (String(values.provider_reference || '').trim()) body.provider_reference = String(values.provider_reference).trim();
      if (String(values.evidence_url || '').trim()) body.evidence_url = String(values.evidence_url).trim();
      const { data } = await apiPost('/platform/payments', body);
      toast.success(t('platform.paymentRecorded', { defaultValue: 'Payment {{ref}} recorded.', ref: data?.transaction_reference }));
      onSaved?.(data);
    } catch (error) {
      toast.error(error.status === 403 ? t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }) : error.message);
    } finally { setBusy(false); }
  }, [values, onSaved, t]);

  const labels = {
    school_id: t('platform.school', { defaultValue: 'School' }),
    subscription_id: t('platform.linkedSubscription', { defaultValue: 'Linked subscription (optional)' }),
    amount: t('common.amount'),
    currency: t('platform.currency', { defaultValue: 'Currency' }),
    payment_method: t('platform.method', { defaultValue: 'Method' }),
    provider_reference: t('platform.providerRef', { defaultValue: 'Provider reference' }),
    evidence_url: t('platform.evidenceUrl', { defaultValue: 'Receipt / evidence URL' }),
    status: t('platform.initialStatus', { defaultValue: 'Record as' }),
  };
  const fields = [
    { name: 'amount', type: 'money', required: true, col: 6 },
    { name: 'currency', required: true, col: 6 },
    { name: 'payment_method', type: 'select', required: true, col: 6, options: PAYMENT_METHODS.map((m) => ({ value: m, label: m.replace(/_/g, ' ') })) },
    { name: 'status', type: 'select', required: true, col: 6, options: CREATE_STATUSES.map((s) => ({ value: s, label: s })) },
    { name: 'provider_reference', col: 12, placeholder: t('platform.providerRefPlaceholder', { defaultValue: 'Bank transfer //mobile money reference' }) },
    { name: 'evidence_url', col: 12, placeholder: 'https://…' },
  ];

  return (
    <Modal open={open} size="lg"
      title={invoice ? `${t('platform.recordPayment', { defaultValue: 'Record a manual payment' })} · ${invoice.invoice_number}` : t('platform.recordPayment', { defaultValue: 'Record a manual payment' })}
      onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : t('common.save')}</button>
        </>
      )}>
      <div className="alert alert-light border small d-flex align-items-start gap-2 py-2">
        <Info size={15} className="mt-1 text-primary" />
        <div>{t('platform.referenceNote', { defaultValue: 'The platform generates the transaction reference itself; you record the external provider reference. Saving as "successful" verifies the payment immediately and settles the invoice — "pending" puts it in the queue below for a second pair of eyes.' })}</div>
      </div>

      {invoice ? (
        <div className="small mb-3">
          <div className="text-muted">{t('platform.school', { defaultValue: 'School' })}</div>
          <div className="fw-semibold">{invoice.schools?.school_name || invoice.school_id}</div>
          <div className="text-muted mt-1">{t('platform.invoiceTotal', { defaultValue: 'Invoice total' })}</div>
          <div className="fw-semibold">{formatMoney(invoice.total, invoice.currency)}</div>
        </div>
      ) : (
        <div className="mb-3">
          <label className="form-label small fw-semibold">{labels.school_id}<span className="text-danger"> *</span></label>
          {schools.loading ? <Spinner label={t('common.loading')} /> : (
            <select className={`form-select${errors.school_id ? ' is-invalid' : ''}`} value={values.school_id || ''}
              onChange={(e) => setValues((v) => ({ ...v, school_id: e.target.value, subscription_id: '' }))}>
              <option value="">{t('platform.pickSchool', { defaultValue: 'Select a school' })}</option>
              {schoolOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {errors.school_id && <div className="form-text text-danger small">{errors.school_id}</div>}
        </div>
      )}

      <div className="row">
        {fields.map((f) => (
          <Field key={f.name} field={{ ...f, label: labels[f.name] }} value={values[f.name]} error={errors[f.name]}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))} />
        ))}
        {values.school_id && (
          <Field field={{ name: 'subscription_id', type: 'select', col: 12, label: labels.subscription_id }}
            options={subscriptionOptions} value={values.subscription_id}
            onChange={(v) => setValues((prev) => ({ ...prev, subscription_id: v }))} />
        )}
      </div>
    </Modal>
  );
}

function VerifyModal({ state, busy, onClose, onSubmit }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');

  useEffect(() => { if (state) setReason(''); }, [state]);

  if (!state) return null;
  const { row, action } = state;
  const approve = action === 'approve';

  return (
    <Modal open size="sm"
      title={approve ? t('platform.approvePayment', { defaultValue: 'Verify this payment' }) : t('platform.rejectPayment', { defaultValue: 'Reject this payment' })}
      onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className={approve ? 'btn btn-success' : 'btn btn-danger'} disabled={busy} onClick={() => onSubmit(row, action, reason.trim() || undefined)}>
            {busy ? '…' : t('common.confirm')}
          </button>
        </>
      )}>
      <div className="small mb-2">
        <div className="text-muted">{t('platform.reference', { defaultValue: 'Reference' })}</div>
        <div className="fw-semibold">{row.transaction_reference}</div>
        <div className="mt-1">{formatMoney(row.amount, row.currency)} · {row.schools?.school_name || row.school_id}</div>
      </div>
      {!approve && (
        <textarea className="form-control mb-2" rows={3} maxLength={500} value={reason}
          placeholder={t('platform.rejectReason', { defaultValue: 'Why is this payment rejected? (stored on the audit log)' })}
          onChange={(e) => setReason(e.target.value)} />
      )}
      <div className="small text-muted d-flex align-items-start gap-1">
        <ShieldAlert size={14} className="mt-1" />
        <div>{approve
          ? t('platform.approveEffect', { defaultValue: 'Approving marks the payment verified, settles the linked invoice (paid/partial) and, when a subscription is attached, activates the subscription and the school.' })
          : t('platform.rejectEffect', { defaultValue: 'Rejecting sets the payment to "rejected" and leaves the invoice open.' })}</div>
      </div>
    </Modal>
  );
}
