// Platform → school SaaS invoices (saas_invoices). This is subscription billing, never school student fees.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Banknote, FileText, Plus, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPost } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Field from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { EmptyState, PageHeader, Spinner, StatCard, dateOnly, money as formatMoney } from '../../components/ui/Basics.jsx';
import { PaymentModal } from './PaymentsPage.jsx';

/** saas_invoices.status values (supabase/migrations/0004_subscriptions_billing.sql). */
const INVOICE_STATUSES = ['draft', 'open', 'paid', 'partial', 'overdue', 'void'];

export default function InvoicesPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState(null);
  const [busy, setBusy] = useState(false);

  const params = useMemo(() => ({ status: status || undefined, school_id: schoolId || undefined }), [status, schoolId]);
  const list = useApi('/platform/invoices', params);
  const schools = useApi('/platform/schools', { pageSize: 200 }, creating);

  const rows = useMemo(() => {
    const all = list.data || [];
    const term = query.trim().toLowerCase();
    if (!term) return all;
    return all.filter((r) => `${r.invoice_number} ${r.schools?.school_name || ''}`.toLowerCase().includes(term));
  }, [list.data, query]);

  const outstanding = useMemo(() => {
    const all = list.data || [];
    const openRows = all.filter((r) => ['open', 'partial', 'overdue'].includes(r.status));
    return {
      openCount: openRows.length,
      openAmount: openRows.reduce((sum, r) => sum + Number(r.total || 0), 0),
      paidAmount: all.filter((r) => r.status === 'paid').reduce((sum, r) => sum + Number(r.total || 0), 0),
      currency: openRows[0]?.currency || all[0]?.currency || '',
      schoolCount: new Set(all.map((r) => r.school_id)).size,
    };
  }, [list.data]);

  const forbidden = list.error?.status === 403;

  const columns = [
    {
      key: 'invoice_number',
      label: t('platform.invoiceNumber', { defaultValue: 'Invoice #' }),
      render: (row) => (
        <div>
          <div className="fw-semibold small">{row.invoice_number}</div>
          <Link to={`/platform/schools/${row.school_id}`} className="small text-muted text-decoration-none">
            {row.schools?.school_name || row.school_id}
          </Link>
        </div>
      ),
    },
    {
      key: 'total',
      label: t('common.amount'),
      render: (row) => (
        <div className="tabular-nums">
          {formatMoney(row.total, row.currency)}
          {Number(row.discount) > 0 && <div className="small text-muted">− {formatMoney(row.discount, row.currency)}</div>}
        </div>
      ),
    },
    { key: 'status', label: t('common.status'), type: 'status', width: 110 },
    { key: 'due_date', label: t('platform.dueDate', { defaultValue: 'Due date' }), type: 'date', width: 120 },
    {
      key: 'billing_period',
      label: t('platform.billingPeriod', { defaultValue: 'Billing period' }),
      render: (row) => <span className="small text-muted">{dateOnly(row.billing_period_start)} → {dateOnly(row.billing_period_end)}</span>,
    },
    { key: 'created_at', label: t('platform.issued', { defaultValue: 'Issued' }), type: 'date', width: 110 },
    {
      key: 'actions',
      label: t('common.actions'),
      width: 120,
      className: 'text-end',
      render: (row) => (
        <button className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
          disabled={['paid', 'void'].includes(row.status)} onClick={() => setPaying(row)}>
          <Banknote size={14} /> {t('platform.recordPayment', { defaultValue: 'Record a manual payment' })}
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('platform.invoices', { defaultValue: 'SaaS invoices' })}
        subtitle={t('platform.invoicesSubtitle', { defaultValue: 'Invoices the platform issues to schools for their subscription.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={list.reload}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <button className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={() => setCreating(true)}>
              <Plus size={14} /> {t('platform.newInvoice', { defaultValue: 'New invoice' })}
            </button>
          </>
        )}
      />

      <div className="alert alert-light border small d-flex align-items-start gap-2">
        <FileText size={15} className="mt-1 text-primary" />
        <div>{t('platform.saasScopeNote', { defaultValue: 'These are platform billing documents (saas_invoices). Student tuition and school fee invoices live in each tenant and are never shown or edited here.' })}</div>
      </div>

      {forbidden ? (
        <div className="card-soft">
          <EmptyState icon={ShieldAlert}
            title={t('platform.superAdminOnlyTitle', { defaultValue: 'Super Admin only' })}
            hint={t('platform.superAdminWriteHint', { defaultValue: 'Writing to subscriptions is restricted to Super Admins.' })} />
        </div>
      ) : (
        <>
          <div className="row g-3 mb-3">
            <div className="col-6 col-lg-3"><StatCard label={t('platform.outstandingCount', { defaultValue: 'Open invoices (loaded)' })} value={outstanding.openCount} icon={FileText} tone="warn" /></div>
            <div className="col-6 col-lg-3"><StatCard label={t('platform.outstandingAmount', { defaultValue: 'Outstanding (loaded)' })} value={formatMoney(outstanding.openAmount, outstanding.currency)} icon={FileText} tone="danger" /></div>
            <div className="col-6 col-lg-3"><StatCard label={t('platform.collectedInvoices', { defaultValue: 'Paid (loaded)' })} value={formatMoney(outstanding.paidAmount, outstanding.currency)} icon={Banknote} tone="ok" /></div>
            <div className="col-6 col-lg-3"><StatCard label={t('platform.schoolsBilled', { defaultValue: 'Schools billed' })} value={outstanding.schoolCount} icon={Search} /></div>
          </div>

          <div className="card-soft p-2 mb-3">
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <div className="input-group input-group-sm" style={{ maxWidth: 300 }}>
                <span className="input-group-text bg-white"><Search size={14} /></span>
                <input className="form-control" value={query} placeholder={t('platform.invoiceSearch', { defaultValue: 'Filter loaded invoices…' })} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="nav nav-pills gap-1 flex-wrap">
                <button className={`btn btn-sm ${status === '' ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setStatus('')}>{t('common.all')}</button>
                {INVOICE_STATUSES.map((s) => (
                  <button key={s} className={`btn btn-sm ${status === s ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setStatus(s)}>
                    {t(`platform.status.${s}`, { defaultValue: s })}
                  </button>
                ))}
              </div>
              {schoolId && (
                <button className="btn btn-sm btn-outline-danger" onClick={() => setSchoolId('')}>{t('platform.clearSchool', { defaultValue: 'Clear school filter' })}</button>
              )}
            </div>
          </div>

          <DataTable columns={columns} rows={rows} loading={list.loading} error={list.error} onRetry={list.reload}
            empty={t('platform.noInvoices', { defaultValue: 'No platform invoices yet' })} />
        </>
      )}

      <NewInvoiceModal open={creating} schools={schools.data} schoolsLoading={schools.loading} busy={busy}
        onClose={() => setCreating(false)}
        onCreated={async (body) => {
          setBusy(true);
          try {
            await apiPost('/platform/invoices', body);
            toast.success(t('platform.invoiceCreated', { defaultValue: 'Invoice issued to the school.' }));
            setCreating(false);
            list.reload();
          } catch (error) {
            toast.error(error.status === 403 ? t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }) : error.message);
          } finally { setBusy(false); }
        }} />

      <PaymentModal open={Boolean(paying)} invoice={paying} onClose={() => setPaying(null)}
        onSaved={() => { setPaying(null); list.reload(); }} />
    </>
  );
}

function NewInvoiceModal({ open, schools, schoolsLoading, busy, onClose, onCreated }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [schoolQuery, setSchoolQuery] = useState('');
  const subscriptions = useApi('/platform/subscriptions', { school_id: values.school_id }, open && Boolean(values.school_id));

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSchoolQuery('');
    setValues({ school_id: '', subscription_id: '', amount: '', currency: 'USD', discount: 0, due_date: '' });
  }, [open]);

  const schoolOptions = useMemo(() => {
    const term = schoolQuery.trim().toLowerCase();
    return (schools || [])
      .filter((s) => !term || `${s.school_name} ${s.city || ''} ${s.country || ''}`.toLowerCase().includes(term))
      .slice(0, 100)
      .map((s) => ({ value: s.id, label: `${s.school_name} (${s.status})` }));
  }, [schools, schoolQuery]);

  const subscriptionOptions = useMemo(() => (subscriptions.data || [])
    .map((s) => ({ value: s.id, label: `${s.subscription_plans?.name || s.id} · ${s.billing_cycle} · ${s.status}` })), [subscriptions.data]);

  const submit = useCallback(() => {
    const missing = {};
    if (!values.school_id) missing.school_id = t('common.required');
    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || amount < 0) missing.amount = t('platform.amountInvalid', { defaultValue: 'Enter an amount of 0 or more' });
    const discount = values.discount === '' || values.discount == null ? 0 : Number(values.discount);
    if (!Number.isFinite(discount) || discount < 0) missing.discount = t('platform.amountInvalid', { defaultValue: 'Enter an amount of 0 or more' });
    else if (discount > amount) missing.discount = t('platform.discountTooBig', { defaultValue: 'Discount cannot exceed the amount' });
    if (!String(values.currency || '').trim() || String(values.currency).length > 8) missing.currency = t('platform.currencyLength', { defaultValue: 'Max 8 characters' });
    setErrors(missing);
    if (Object.keys(missing).length) return;

    const body = {
      school_id: values.school_id,
      amount,
      currency: String(values.currency).trim(),
      discount,
    };
    if (values.subscription_id) body.subscription_id = values.subscription_id;
    if (values.due_date) body.due_date = new Date(values.due_date).toISOString();
    onCreated(body);
  }, [values, onCreated, t]);

  const labels = {
    amount: t('platform.invoiceAmount', { defaultValue: 'Amount' }),
    currency: t('platform.currency', { defaultValue: 'Currency' }),
    discount: t('platform.discount', { defaultValue: 'Discount' }),
    due_date: t('platform.dueDate', { defaultValue: 'Due date' }),
    subscription_id: t('platform.linkedSubscription', { defaultValue: 'Linked subscription (optional)' }),
  };
  const fields = [
    { name: 'amount', type: 'money', required: true, col: 4 },
    { name: 'currency', required: true, col: 4 },
    { name: 'discount', type: 'money', col: 4 },
    { name: 'due_date', type: 'date', col: 4 },
  ];

  return (
    <Modal open={open} size="lg" title={t('platform.newInvoice', { defaultValue: 'New invoice' })} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : t('common.create')}</button>
        </>
      )}>
      <div className="alert alert-info small py-2">
        {t('platform.invoiceNote', { defaultValue: 'The server numbers the invoice itself (INV-<year>-#####), stores subtotal = amount, total = amount − discount and starts it as "open".' })}
      </div>
      <div className="mb-3">
        <label className="form-label small fw-semibold">{t('platform.school', { defaultValue: 'School' })}<span className="text-danger"> *</span></label>
        {schoolsLoading ? <Spinner label={t('common.loading')} /> : (
          <>
            <div className="input-group input-group-sm mb-1">
              <span className="input-group-text bg-white"><Search size={14} /></span>
              <input className="form-control" value={schoolQuery} placeholder={t('platform.filterSchools', { defaultValue: 'Filter the school list…' })} onChange={(e) => setSchoolQuery(e.target.value)} />
            </div>
            <select className={`form-select${errors.school_id ? ' is-invalid' : ''}`} value={values.school_id || ''}
              onChange={(e) => setValues((v) => ({ ...v, school_id: e.target.value, subscription_id: '' }))}>
              <option value="">{t('platform.pickSchool', { defaultValue: 'Select a school' })}</option>
              {schoolOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </>
        )}
        {errors.school_id && <div className="form-text text-danger small">{errors.school_id}</div>}
      </div>
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
      <div className="small text-muted">{t('platform.invoicePaymentNote', { defaultValue: 'Once issued, money is registered with "Record a manual payment" — an approving payment settles the invoice to paid or partial.' })}</div>
    </Modal>
  );
}
