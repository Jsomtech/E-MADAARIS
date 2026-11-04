// Subscription & billing for this tenant: /school/subscription + /school/usage + evidence submission.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { CreditCard, ExternalLink, Gauge, ReceiptText, RefreshCw, Upload, Wallet } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPost } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Field from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Badge, EmptyState, ErrorState, PageHeader, StatusBadge, dateOnly, dateTime, money } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/** z.enum(['bank_transfer','mobile_money']) in POST /school/subscription/evidence. */
const EVIDENCE_METHODS = ['bank_transfer', 'mobile_money'];

function planOf(subscription) {
  const joined = subscription?.subscription_plans;
  if (Array.isArray(joined)) return joined[0] || null;
  return joined || null;
}

function percent(used, limit) {
  if (!Number.isFinite(Number(limit)) || Number(limit) <= 0) return null;
  return Math.round((Number(used || 0) / Number(limit)) * 100);
}

export default function SubscriptionPage() {
  const { t } = useTranslation();
  const { can, profile } = useAuth();
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const mayView = can('subscription.view');
  const subscription = useApi('/school/subscription', undefined, mayView);
  const usage = useApi('/school/usage', undefined, mayView);

  const sub = subscription.data?.subscription || null;
  const plan = planOf(sub) || profile?.subscription?.plan || null;
  const invoices = subscription.data?.invoices || [];
  const payments = subscription.data?.payments || [];
  const limits = usage.data?.limits || {};

  const reload = useCallback(() => { subscription.reload(); usage.reload(); }, [subscription, usage]);

  const invoiceColumns = [
    { key: 'invoice_number', label: t('sections.invoiceNumber', { defaultValue: 'Invoice' }), render: (r) => <span className="fw-semibold small">{r.invoice_number}</span> },
    {
      key: 'period',
      label: t('sections.billingPeriod', { defaultValue: 'Period' }),
      render: (r) => <span className="small text-muted">{dateOnly(r.billing_period_start)} → {dateOnly(r.billing_period_end)}</span>,
    },
    { key: 'subtotal', label: t('sections.subtotal', { defaultValue: 'Subtotal' }), render: (r) => <span className="tabular-nums small">{money(r.subtotal, r.currency)}</span> },
    { key: 'discount', label: t('sections.discount', { defaultValue: 'Discount' }), render: (r) => <span className="tabular-nums small">{money(r.discount, r.currency)}</span> },
    { key: 'total', label: t('common.total'), render: (r) => <span className="tabular-nums fw-semibold">{money(r.total, r.currency)}</span> },
    { key: 'due_date', label: t('sections.dueDate', { defaultValue: 'Due' }), render: (r) => <span className="small">{dateOnly(r.due_date)}</span> },
    { key: 'status', label: t('common.status'), type: 'status', width: 110 },
    { key: 'created_at', label: t('sections.issued', { defaultValue: 'Issued' }), render: (r) => <span className="small text-muted">{dateTime(r.created_at)}</span> },
  ];

  const paymentColumns = [
    { key: 'transaction_reference', label: t('sections.txnReference', { defaultValue: 'Reference' }), render: (r) => <span className="small fw-semibold">{r.transaction_reference}</span> },
    { key: 'amount', label: t('common.amount'), render: (r) => <span className="tabular-nums">{money(r.amount, r.currency)}</span> },
    { key: 'payment_method', label: t('sections.method', { defaultValue: 'Method' }), render: (r) => <span className="small">{String(r.payment_method || '—').replace(/_/g, ' ')}</span> },
    { key: 'provider_reference', label: t('sections.providerRef', { defaultValue: 'Provider ref' }), render: (r) => <span className="small text-muted">{r.provider_reference || '—'}</span> },
    { key: 'status', label: t('common.status'), type: 'status', width: 120 },
    {
      key: 'verification_status',
      label: t('sections.verification', { defaultValue: 'Verification' }),
      width: 130,
      render: (r) => <Badge tone={r.verification_status === 'verified' ? 'ok' : r.verification_status === 'rejected' ? 'danger' : 'warn'}>{String(r.verification_status || '—').replace(/_/g, ' ')}</Badge>,
    },
    {
      key: 'paid_at',
      label: t('sections.paidOrSubmitted', { defaultValue: 'Paid / submitted' }),
      render: (r) => <span className="small text-muted">{dateTime(r.paid_at || r.created_at)}</span>,
    },
    {
      key: 'evidence_url',
      label: t('sections.evidence', { defaultValue: 'Evidence' }),
      width: 90,
      className: 'text-end',
      render: (r) => (r.evidence_url
        ? <a className="small d-inline-flex align-items-center gap-1" href={r.evidence_url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {t('sections.open', { defaultValue: 'open' })}</a>
        : <span className="text-muted small">—</span>),
    },
  ];

  if (!mayView) {
    return (
      <>
        <PageHeader title={t('sections.subscriptionTitle', { defaultValue: 'Subscription & billing' })} />
        <div className="card-soft">
          <EmptyState icon={CreditCard} title={t('sections.noAccess', { defaultValue: 'Not available for your role' })}
            hint={t('sections.subscriptionNoAccess', { defaultValue: 'This page needs the subscription.view permission.' })} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('sections.subscriptionTitle', { defaultValue: 'Subscription & billing' })}
        subtitle={t('sections.subscriptionSubtitle', { defaultValue: 'What this school pays for, how close it is to the plan limits, and how to prove a transfer.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={reload}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <button className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={() => setEvidenceOpen(true)}>
              <Upload size={14} /> {t('sections.submitEvidence', { defaultValue: 'Submit payment evidence' })}
            </button>
          </>
        )}
      />

      <div className="alert alert-info small py-2 d-flex align-items-start gap-2">
        <CreditCard size={16} className="mt-1" />
        <div>{t('sections.planChangeNote', { defaultValue: 'Plan changes, renewals and pricing are handled by the E-MADAARIS platform team. This page is read-only except for payment evidence, which a Super Admin must verify before it is booked.' })}</div>
      </div>

      <div className="row g-3">
        <div className="col-12 col-xl-6">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2"><CreditCard size={15} className="me-1" /> {t('sections.planCard', { defaultValue: 'Current plan' })}</div>
            {!sub && <EmptyState title={t('sections.noSubscription', { defaultValue: 'No subscription row yet' })} hint={t('sections.noSubscriptionHint', { defaultValue: 'The platform team has not attached a plan to this school, so /school/subscription returns no row.' })} />}
            {sub && (
              <div className="row g-2 small">
                <Fact label={t('sections.plan', { defaultValue: 'Plan' })} value={<span className="fw-semibold">{plan?.name || sub.plan_id}</span>} />
                <Fact label={t('common.status')} value={<StatusBadge value={sub.status} />} />
                <Fact label={t('sections.billingCycle', { defaultValue: 'Billing cycle' })} value={String(sub.billing_cycle || '—').replace(/_/g, ' ')} />
                <Fact label={t('sections.autoRenew', { defaultValue: 'Auto-renew' })} value={sub.auto_renew ? t('common.yes') : t('common.no')} />
                <Fact label={t('sections.started', { defaultValue: 'Started' })} value={dateOnly(sub.start_date)} />
                <Fact label={t('sections.ends', { defaultValue: 'Ends' })} value={dateOnly(sub.end_date)} />
                <Fact label={t('sections.trialEnds', { defaultValue: 'Trial ends' })} value={dateOnly(sub.trial_end_date)} />
                <Fact label={t('sections.graceEnds', { defaultValue: 'Grace period ends' })} value={dateOnly(sub.grace_period_end)} />
              </div>
            )}
            {plan && (
              <>
                {plan.description && <div className="small text-muted mt-2">{plan.description}</div>}
                <div className="row g-2 small mt-1">
                  <Fact label={t('sections.monthlyPrice', { defaultValue: 'Monthly' })} value={money(plan.monthly_price, plan.currency)} />
                  <Fact label={t('sections.quarterlyPrice', { defaultValue: 'Quarterly' })} value={money(plan.quarterly_price, plan.currency)} />
                  <Fact label={t('sections.annualPrice', { defaultValue: 'Annual' })} value={money(plan.annual_price, plan.currency)} />
                  <Fact label={t('sections.trialDays', { defaultValue: 'Trial days' })} value={plan.trial_days} />
                  <Fact label={t('sections.graceDays', { defaultValue: 'Grace days' })} value={plan.grace_period_days} />
                  <Fact label={t('sections.planState', { defaultValue: 'Plan status' })} value={<StatusBadge value={plan.status} />} />
                </div>
              </>
            )}
            {plan?.feature_restrictions && Object.keys(plan.feature_restrictions).length > 0 && (
              <div className="small text-muted mt-2"><code>feature_restrictions</code>: {JSON.stringify(plan.feature_restrictions)}</div>
            )}
          </div>
        </div>

        <div className="col-12 col-xl-6">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2"><Gauge size={15} className="me-1" /> {t('sections.usageTitle', { defaultValue: 'Usage against plan limits' })}</div>
            {usage.error && <ErrorState error={usage.error} onRetry={usage.reload} />}
            <UsageBar label={t('sections.studentsUsed', { defaultValue: 'Active students' })} used={usage.data?.students} limit={limits.max_students} />
            <UsageBar label={t('sections.staffUsed', { defaultValue: 'Staff accounts (school_users)' })} used={usage.data?.staffUsers} limit={limits.max_staff} />
            <div className="mt-3 small text-muted">
              {t('sections.storageNote', { defaultValue: 'Plan storage cap: {{cap}} MB. The server exposes no byte-usage counter in GET /school/usage, so no bar can be drawn for it.', cap: limits.max_storage_mb ?? '—' })}
            </div>
            <div className="small text-muted mt-2">
              {t('sections.subscriptionStatus', { defaultValue: 'Status reported by /school/usage' })}: <StatusBadge value={usage.data?.subscription_status} />
            </div>
            <div className="small text-muted mt-2">
              {t('sections.usageHow', { defaultValue: 'students counts students with status = active; staffUsers counts every school_users row of this tenant (pending invitations included).' })}
            </div>
          </div>
        </div>

        <div className="col-12">
          <div className="fw-semibold mb-2"><ReceiptText size={15} className="me-1" /> {t('sections.saasInvoices', { defaultValue: 'Platform invoices' })}</div>
          <DataTable columns={invoiceColumns} rows={invoices} loading={subscription.loading} error={subscription.error} onRetry={subscription.reload} dense
            empty={t('sections.noInvoices', { defaultValue: 'No SaaS invoices issued yet (the server returns the 24 most recent).' })} />
        </div>

        <div className="col-12">
          <div className="fw-semibold mb-2"><Wallet size={15} className="me-1" /> {t('sections.subscriptionPayments', { defaultValue: 'Subscription payments & evidence' })}</div>
          <DataTable columns={paymentColumns} rows={payments} loading={subscription.loading} error={subscription.error} onRetry={subscription.reload} dense
            empty={t('sections.noPayments', { defaultValue: 'Nothing recorded yet — use "Submit payment evidence" after you transfer.' })} />
          <div className="small text-muted mt-2">
            {t('sections.paymentsLimit', { defaultValue: 'Both tables are the 24 newest rows the server returns; there is no pagination on /school/subscription.' })}
          </div>
        </div>
      </div>

      <EvidenceModal open={evidenceOpen} invoices={invoices} defaultCurrency={plan?.currency || sub?.subscription_plans?.currency || 'USD'}
        onClose={() => setEvidenceOpen(false)}
        onSent={() => { setEvidenceOpen(false); reload(); }} />
    </>
  );
}

function Fact({ label, value }) {
  return (
    <div className="col-6">
      <div className="text-muted">{label}</div>
      <div className="fw-semibold text-capitalize">{value ?? '—'}</div>
    </div>
  );
}

function UsageBar({ label, used, limit }) {
  const { t } = useTranslation();
  const pct = percent(used, limit);
  const over = pct !== null && pct > 100;
  const near = pct !== null && pct > 85 && !over;
  const tone = over ? 'bg-danger' : near ? 'bg-warning' : 'bg-primary';
  return (
    <div className="mb-3">
      <div className="d-flex justify-content-between small mb-1">
        <span className="fw-semibold">{label}</span>
        <span className="tabular-nums text-muted">
          {used ?? 0} / {Number.isFinite(Number(limit)) ? limit : t('sections.unlimited', { defaultValue: 'no cap reported' })}
          {pct !== null && <span className="ms-1">({pct}%)</span>}
        </span>
      </div>
      <div className="progress" style={{ height: 8 }}>
        <div className={`progress-bar ${tone}`} style={{ width: `${pct === null ? 0 : Math.min(100, pct)}%` }} />
      </div>
      {over && (
        <div className="alert alert-danger small py-1 mt-2 mb-0">
          {t('sections.overLimit', { defaultValue: 'Over the plan cap: the server blocks new rows on tables capped by this limit (students use limit "max_students"), so creation calls will fail until the platform team raises the plan.' })}
        </div>
      )}
      {near && (
        <div className="small text-warning mt-1">{t('sections.nearLimit', { defaultValue: 'Within 15% of the plan cap — ask the platform team about the next tier.' })}</div>
      )}
    </div>
  );
}

function EvidenceModal({ open, invoices, defaultCurrency, onClose, onSent }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({ amount: '', currency: defaultCurrency, payment_method: EVIDENCE_METHODS[0], provider_reference: '', invoice_id: '', evidence_url: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValues({ amount: '', currency: defaultCurrency || 'USD', payment_method: EVIDENCE_METHODS[0], provider_reference: '', invoice_id: '', evidence_url: '' });
      setErrors({});
      setError('');
    }
  }, [open, defaultCurrency]);

  const openInvoices = useMemo(() => (invoices || []).filter((i) => !['paid', 'void'].includes(i.status)), [invoices]);

  const submit = useCallback(async () => {
    const missing = {};
    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || amount < 0) missing.amount = t('sections.amountInvalid', { defaultValue: 'Enter a number of 0 or more' });
    if (String(values.provider_reference).trim().length < 3) missing.provider_reference = t('sections.providerRefMin', { defaultValue: 'At least 3 characters — the bank/mobile-money reference' });
    if (values.evidence_url && !/^https?:\/\/\S+$/i.test(values.evidence_url.trim())) missing.evidence_url = t('sections.evidenceUrlInvalid', { defaultValue: 'Must be an absolute URL, or leave it empty' });
    setErrors(missing);
    if (Object.keys(missing).length) return;

    const body = {
      amount,
      currency: String(values.currency || 'USD').trim(),
      payment_method: values.payment_method,
      provider_reference: String(values.provider_reference).trim(),
    };
    if (values.invoice_id) body.invoice_id = values.invoice_id;
    if (values.evidence_url.trim()) body.evidence_url = values.evidence_url.trim();

    setBusy(true);
    setError('');
    try {
      const { data } = await apiPost('/school/subscription/evidence', body);
      toast.success(t('sections.evidenceSaved', { defaultValue: 'Evidence stored as a pending payment ({{ref}}) — a Super Admin has to verify it.', ref: data?.transaction_reference }));
      onSent();
    } catch (e) {
      setError(e.status === 403
        ? t('sections.evidenceForbidden', { defaultValue: 'Submitting evidence needs subscription.view.' })
        : e.message);
    } finally { setBusy(false); }
  }, [values, onSent, t]);

  return (
    <Modal open={open} size="md" title={t('sections.submitEvidence', { defaultValue: 'Submit payment evidence' })} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary d-inline-flex align-items-center gap-1" onClick={submit} disabled={busy}>
            <Upload size={14} /> {busy ? '…' : t('sections.sendEvidence', { defaultValue: 'Send evidence' })}
          </button>
        </>
      )}>
      <div className="row">
        <Field field={{ name: 'amount', type: 'number', required: true, col: 6, label: t('common.amount'), step: '0.01' }}
          value={values.amount} error={errors.amount} onChange={(v) => setValues((p) => ({ ...p, amount: v }))} />
        <Field field={{ name: 'currency', col: 6, label: t('sections.currencyCode', { defaultValue: 'Currency' }), placeholder: 'USD', help: t('sections.currencyMax', { defaultValue: 'Max 8 characters; defaults to USD on the server.' }) }}
          value={values.currency} onChange={(v) => setValues((p) => ({ ...p, currency: v }))} />
        <Field field={{
          name: 'payment_method', type: 'select', required: true, col: 6, label: t('sections.method', { defaultValue: 'Method' }),
          options: EVIDENCE_METHODS.map((v) => ({ value: v, label: v.replace(/_/g, ' ') })),
          help: t('sections.methodsHelp', { defaultValue: 'The server enum allows only bank_transfer and mobile_money — "manual"/"provider" rows are created by the platform team.' }),
        }} value={values.payment_method} onChange={(v) => setValues((p) => ({ ...p, payment_method: v }))} />
        <Field field={{ name: 'provider_reference', required: true, col: 6, label: t('sections.providerRef', { defaultValue: 'Provider reference' }) }}
          value={values.provider_reference} error={errors.provider_reference} onChange={(v) => setValues((p) => ({ ...p, provider_reference: v }))} />
        <div className="col-12 mb-3">
          <label className="form-label small fw-semibold" htmlFor="f-evidence-invoice">{t('sections.linkInvoice', { defaultValue: 'Invoice this pays (optional)' })}</label>
          <select id="f-evidence-invoice" className="form-select" value={values.invoice_id} onChange={(e) => setValues((p) => ({ ...p, invoice_id: e.target.value }))}>
            <option value="">{t('sections.noInvoice', { defaultValue: 'Not tied to an invoice' })}</option>
            {openInvoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_number} · {money(i.total, i.currency)}</option>)}
          </select>
          <div className="form-text small">{t('sections.invoiceSelectHelp', { defaultValue: 'Only unpaid invoices of the 24 returned by /school/subscription are listed; invoice_id must be a UUID or the request is rejected.' })}</div>
        </div>
        <Field field={{
          name: 'evidence_url', col: 12, label: t('sections.evidenceUrl', { defaultValue: 'Evidence URL (optional)' }), placeholder: 'https://…',
          help: t('sections.evidenceUrlHelp', { defaultValue: 'Upload the receipt/screenshot to storage first and paste its public URL — the server validates it as a URL.' }),
        }} value={values.evidence_url} error={errors.evidence_url} onChange={(v) => setValues((p) => ({ ...p, evidence_url: v }))} />
      </div>
      {error && <ErrorState error={{ message: error }} />}
      <div className="small text-muted mt-2">
        {t('sections.evidenceNote', { defaultValue: 'The server inserts a subscription_payments row with status=pending, verification_status=unverified and an auto-generated transaction_reference (EVD-…). You cannot mark your own payment as verified.' })}
      </div>
    </Modal>
  );
}
