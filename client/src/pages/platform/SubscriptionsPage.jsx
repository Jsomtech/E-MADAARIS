// Tenant subscriptions: list with school/plan joins, create, renew, change plan, terminate.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { ArrowRightLeft, CalendarClock, CreditCard, Plus, RefreshCw, Search, ShieldAlert, XOctagon } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPatch, apiPost } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Field from '../../components/ui/Field.jsx';
import { Modal, ConfirmDialog } from '../../components/ui/Modal.jsx';
import { Badge, EmptyState, PageHeader, dateOnly } from '../../components/ui/Basics.jsx';

/** school_subscriptions.status values (server zod enum). */
const SUB_STATUSES = ['pending', 'trial', 'active', 'past_due', 'suspended', 'expired', 'cancelled'];
const BILLING_CYCLES = ['monthly', 'quarterly', 'annual'];

function daysUntil(value) {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / 86400000);
}

export default function SubscriptionsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [cycle, setCycle] = useState('');
  const [creating, setCreating] = useState(false);
  const [renewing, setRenewing] = useState(null);
  const [changing, setChanging] = useState(null);
  const [terminating, setTerminating] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = useApi('/platform/subscriptions', { status: status || undefined });
  const plans = useApi('/platform/plans', { pageSize: 200, status: 'published' }, creating || Boolean(changing));
  const schools = useApi('/platform/schools', { pageSize: 200 }, creating);

  const rows = useMemo(() => (list.data || []).filter((r) => !cycle || r.billing_cycle === cycle), [list.data, cycle]);

  const forbidden = list.error?.status === 403;

  const patch = useCallback(async (id, body, message) => {
    setBusy(true);
    try {
      await apiPatch(`/platform/subscriptions/${id}`, body);
      toast.success(message);
      list.reload();
      return true;
    } catch (error) {
      toast.error(error.status === 403 ? t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }) : error.message);
      return false;
    } finally { setBusy(false); }
  }, [list, t]);

  const columns = [
    {
      key: 'school',
      label: t('platform.school', { defaultValue: 'School' }),
      render: (row) => (
        <Link className="fw-semibold text-decoration-none" to={`/platform/schools/${row.school_id}`}>
          {row.schools?.school_name || row.school_id}
        </Link>
      ),
    },
    { key: 'plan', label: t('platform.plan', { defaultValue: 'Plan' }), render: (r) => <span className="small">{r.subscription_plans?.name || '—'}</span> },
    { key: 'status', label: t('common.status'), type: 'status', width: 110 },
    { key: 'billing_cycle', label: t('platform.billingCycle', { defaultValue: 'Cycle' }), render: (r) => <span className="small">{r.billing_cycle}</span>, width: 100 },
    { key: 'start_date', label: t('platform.startDate', { defaultValue: 'Start' }), type: 'date', width: 110 },
    {
      key: 'end_date',
      label: t('platform.endDate', { defaultValue: 'Ends / countdown' }),
      width: 180,
      render: (row) => {
        const left = daysUntil(row.end_date);
        if (left === null) return <span className="text-muted small">—</span>;
        const tone = left < 0 ? 'danger' : left <= 7 ? 'warn' : left <= 30 ? 'info' : 'neutral';
        return (
          <div className="d-flex align-items-center gap-2">
            <span className="small tabular-nums">{dateOnly(row.end_date)}</span>
            <Badge tone={tone}>{left < 0 ? t('platform.expiredDays', { defaultValue: '{{count}}d ago', count: Math.abs(left) }) : t('platform.daysLeft', { defaultValue: '{{count}}d left', count: left })}</Badge>
          </div>
        );
      },
    },
    { key: 'trial_end_date', label: t('platform.trialEnd', { defaultValue: 'Trial ends' }), type: 'date', width: 110 },
    { key: 'auto_renew', label: t('platform.autoRenew', { defaultValue: 'Auto-renew' }), width: 100, render: (r) => <span className="small">{r.auto_renew ? t('common.yes') : t('common.no')}</span> },
    {
      key: 'actions',
      label: t('common.actions'),
      width: 150,
      className: 'text-end',
      render: (row) => (
        <div className="d-inline-flex gap-1">
          <button className="btn btn-sm btn-outline-secondary" title={t('platform.renew', { defaultValue: 'Renew / extend' })} onClick={() => setRenewing(row)}>
            <CalendarClock size={14} />
          </button>
          <button className="btn btn-sm btn-outline-secondary" title={t('platform.changePlan', { defaultValue: 'Change plan' })} onClick={() => setChanging(row)}>
            <ArrowRightLeft size={14} />
          </button>
          <button className="btn btn-sm btn-outline-danger" title={t('platform.terminate', { defaultValue: 'Terminate' })} disabled={row.status === 'cancelled'} onClick={() => setTerminating(row)}>
            <XOctagon size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('platform.subscriptions', { defaultValue: 'Subscriptions' })}
        subtitle={t('platform.subscriptionsSubtitle', { defaultValue: 'Which tenant is on which plan, until when, and on what cycle.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={list.reload}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <button className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={() => setCreating(true)}>
              <Plus size={14} /> {t('platform.newSubscription', { defaultValue: 'Create subscription' })}
            </button>
          </>
        )}
      />

      {forbidden ? (
        <div className="card-soft">
          <EmptyState icon={ShieldAlert}
            title={t('platform.superAdminOnlyTitle', { defaultValue: 'Super Admin only' })}
            hint={t('platform.superAdminWriteHint', { defaultValue: 'Writing to subscriptions is restricted to Super Admins.' })} />
        </div>
      ) : (
        <>
          <div className="card-soft p-2 mb-3">
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <div className="nav nav-pills gap-1 flex-wrap">
                <button className={`btn btn-sm ${status === '' ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setStatus('')}>{t('common.all')}</button>
                {SUB_STATUSES.map((s) => (
                  <button key={s} className={`btn btn-sm ${status === s ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setStatus(s)}>
                    {t(`platform.status.${s}`, { defaultValue: s.replace(/_/g, ' ') })}
                  </button>
                ))}
              </div>
              <select className="form-select form-select-sm" style={{ maxWidth: 200 }} value={cycle} onChange={(e) => setCycle(e.target.value)}>
                <option value="">{t('platform.allCycles', { defaultValue: 'All billing cycles' })}</option>
                {BILLING_CYCLES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="small text-muted">{t('platform.cycleFilterHint', { defaultValue: 'Status filters server-side; billing cycle narrows the rows already loaded.' })}</span>
            </div>
          </div>

          <DataTable columns={columns} rows={rows} loading={list.loading} error={list.error} onRetry={list.reload} dense
            empty={t('platform.noSubscriptions', { defaultValue: 'No subscriptions in this view' })} />
        </>
      )}

      <CreateModal open={creating} plans={plans.data} plansLoading={plans.loading} plansError={plans.error}
        schools={schools.data} schoolsLoading={schools.loading}
        busy={busy} onClose={() => setCreating(false)}
        onCreated={async (body) => {
          const ok = await submitSubscription(body, t);
          if (ok) { setCreating(false); list.reload(); }
        }} />

      <RenewModal row={renewing} busy={busy} onClose={() => setRenewing(null)}
        onSubmit={async (body) => { const ok = await patch(renewing.id, body, t('platform.renewed', { defaultValue: 'Subscription renewed.' })); if (ok) setRenewing(null); return ok; }} />

      <ChangePlanModal row={changing} plans={plans.data} plansLoading={plans.loading} busy={busy} onClose={() => setChanging(null)}
        onSubmit={async (body) => { const ok = await patch(changing.id, body, t('platform.planChanged', { defaultValue: 'Subscription plan updated.' })); if (ok) setChanging(null); return ok; }} />

      <ConfirmDialog open={Boolean(terminating)} title={t('platform.terminate', { defaultValue: 'Terminate' })}
        message={t('platform.terminateMessage', { defaultValue: 'Terminate the {{plan}} subscription for {{school}}? Set it to "cancelled".', plan: terminating?.subscription_plans?.name, school: terminating?.schools?.school_name })}
        busy={busy} onClose={() => setTerminating(null)}
        onConfirm={async () => { const ok = await patch(terminating.id, { status: 'cancelled' }, t('platform.terminated', { defaultValue: 'Subscription terminated.' })); if (ok) setTerminating(null); }} />
    </>
  );
}

async function submitSubscription(body, t) {
  try {
    await apiPost('/platform/subscriptions', body);
    toast.success(t('platform.subscriptionCreated', { defaultValue: 'Subscription created and an open SaaS invoice was issued.' }));
    return true;
  } catch (error) {
    toast.error(error.status === 403 ? t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }) : error.message);
    return false;
  }
}

function CreateModal({ open, plans, plansLoading, plansError, schools, schoolsLoading, busy, onClose, onCreated }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({ school_id: '', plan_id: '', billing_cycle: 'monthly', months: 1, status: 'active' });
  const [schoolQuery, setSchoolQuery] = useState('');
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) { setValues({ school_id: '', plan_id: '', billing_cycle: 'monthly', months: 1, status: 'active' }); setSchoolQuery(''); setErrors({}); }
  }, [open]);

  const schoolOptions = useMemo(() => {
    const term = schoolQuery.trim().toLowerCase();
    return (schools || [])
      .filter((s) => !term || `${s.school_name} ${s.city || ''} ${s.country || ''}`.toLowerCase().includes(term))
      .slice(0, 100)
      .map((s) => ({ value: s.id, label: `${s.school_name} (${s.status})` }));
  }, [schools, schoolQuery]);

  const planOptions = useMemo(() => (plans || []).map((p) => ({ value: p.id, label: p.name })), [plans]);

  const submit = () => {
    const missing = {};
    if (!values.school_id) missing.school_id = t('common.required');
    if (!values.plan_id) missing.plan_id = t('common.required');
    const months = Math.trunc(Number(values.months));
    if (!Number.isInteger(months) || months < 1 || months > 36) missing.months = t('platform.monthsRange', { defaultValue: 'Between 1 and 36 months' });
    setErrors(missing);
    if (Object.keys(missing).length) return;
    onCreated({
      school_id: values.school_id,
      plan_id: values.plan_id,
      billing_cycle: values.billing_cycle,
      months,
      status: values.status,
    });
  };

  return (
    <Modal open={open} size="lg" title={t('platform.newSubscription', { defaultValue: 'Create subscription' })} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : t('common.create')}</button>
        </>
      )}>
      <div className="alert alert-info small py-2">
        {t('platform.subscriptionDatesNote', { defaultValue: 'The server sets start_date from "now" and derives end_date, trial_end_date and grace_period_end from the number of months plus the plan grace period — dates are not sent from here.' })}
      </div>
      <div className="row">
        <div className="col-12 mb-3">
          <label className="form-label small fw-semibold">{t('platform.school', { defaultValue: 'School' })}<span className="text-danger"> *</span></label>
          <div className="d-flex gap-2 mb-1">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-white"><Search size={14} /></span>
              <input className="form-control" value={schoolQuery} placeholder={t('platform.filterSchools', { defaultValue: 'Filter the school list…' })} onChange={(e) => setSchoolQuery(e.target.value)} />
            </div>
            <button className="btn btn-sm btn-outline-secondary" type="button" disabled={schoolsLoading} onClick={() => setSchoolQuery('')}>{t('common.all')}</button>
          </div>
          <select className={`form-select${errors.school_id ? ' is-invalid' : ''}`} value={values.school_id} onChange={(e) => setValues((v) => ({ ...v, school_id: e.target.value }))}>
            <option value="">{schoolsLoading ? t('common.loading') : t('platform.pickSchool', { defaultValue: 'Select a school' })}</option>
            {schoolOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {errors.school_id && <div className="form-text text-danger small">{errors.school_id}</div>}
        </div>
        <Field field={{ name: 'plan_id', type: 'select', required: true, col: 6, label: t('platform.plan', { defaultValue: 'Plan' }) }}
          options={planOptions} value={values.plan_id} error={errors.plan_id} onChange={(v) => setValues((prev) => ({ ...prev, plan_id: v }))} />
        <Field field={{ name: 'billing_cycle', type: 'select', required: true, col: 6, label: t('platform.billingCycle', { defaultValue: 'Billing cycle' }) }}
          options={BILLING_CYCLES.map((c) => ({ value: c, label: c }))} value={values.billing_cycle} onChange={(v) => setValues((prev) => ({ ...prev, billing_cycle: v }))} />
        <Field field={{ name: 'months', type: 'number', required: true, col: 6, label: t('platform.months', { defaultValue: 'Duration (months)' }) }}
          value={values.months} error={errors.months} onChange={(v) => setValues((prev) => ({ ...prev, months: v }))} />
        <Field field={{ name: 'status', type: 'select', required: true, col: 6, label: t('common.status') }}
          options={SUB_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} value={values.status} onChange={(v) => setValues((prev) => ({ ...prev, status: v }))} />
      </div>
      {plansError && (
        <div className="small text-danger">
          {plansError.status === 403 ? t('platform.superAdminOnlyPlans', { defaultValue: 'Plan list is Super Admin only — ask a Super Admin to create the tenant.' }) : plansError.message}
        </div>
      )}
      <div className="small text-muted">{t('platform.invoiceNote', { defaultValue: 'Creating a subscription also issues an open platform invoice for the cycle price.' })}</div>
    </Modal>
  );
}

function RenewModal({ row, busy, onClose, onSubmit }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('days');
  const [days, setDays] = useState(30);
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState('active');
  const [error, setError] = useState('');

  useEffect(() => {
    if (row) { setDays(30); setEndDate(''); setError(''); setStatus(row.status === 'trial' ? 'trial' : 'active'); }
  }, [row]);

  const submit = () => {
    const body = { status };
    if (mode === 'days') {
      const n = Math.trunc(Number(days));
      if (!Number.isInteger(n) || n < 1) { setError(t('platform.daysPositive', { defaultValue: 'Enter 1 or more days' })); return; }
      body.extend_days = n;
    } else {
      if (!endDate) { setError(t('common.required')); return; }
      body.end_date = new Date(endDate).toISOString();
    }
    onSubmit(body);
  };

  return (
    <Modal open={Boolean(row)} size="sm" title={`${t('platform.renew', { defaultValue: 'Renew / extend' })} · ${row?.schools?.school_name || ''}`} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : t('common.save')}</button>
        </>
      )}>
      <div className="nav nav-pills gap-1 mb-3">
        <button className={`btn btn-sm ${mode === 'days' ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setMode('days')}>{t('platform.extendDays', { defaultValue: 'Extend by days' })}</button>
        <button className={`btn btn-sm ${mode === 'date' ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setMode('date')}>{t('platform.setEndDate', { defaultValue: 'Set end date' })}</button>
      </div>
      <div className="small text-muted mb-2">{t('platform.currentEnds', { defaultValue: 'Current end date: {{date}}', date: dateOnly(row?.end_date) })}</div>
      {mode === 'days'
        ? <Field field={{ name: 'extend_days', type: 'number', col: 12, label: t('platform.extendDays', { defaultValue: 'Extend by days' }) }} value={days} onChange={setDays} />
        : <Field field={{ name: 'end_date', type: 'date', col: 12, label: t('platform.newEndDate', { defaultValue: 'New end date' }) }} value={endDate} onChange={setEndDate} />}
      <Field field={{ name: 'status', type: 'select', col: 12, label: t('platform.statusAfterRenew', { defaultValue: 'Status to store' }) }}
        options={SUB_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} value={status} onChange={setStatus} />
      {error && <div className="form-text text-danger small">{error}</div>}
      <div className="small text-muted">{t('platform.renewNote', { defaultValue: 'extend_days shifts the stored end_date; the server ignores any end_date it computes itself.' })}</div>
    </Modal>
  );
}

function ChangePlanModal({ row, plans, plansLoading, busy, onClose, onSubmit }) {
  const { t } = useTranslation();
  const [planId, setPlanId] = useState('');
  const [cycle, setCycle] = useState('');
  const [autoRenew, setAutoRenew] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (row) { setPlanId(row.plan_id || ''); setCycle(row.billing_cycle || ''); setAutoRenew(''); setError(''); }
  }, [row]);

  const submit = () => {
    if (!planId) { setError(t('platform.pickPlan', { defaultValue: 'Pick a plan' })); return; }
    const body = { plan_id: planId };
    if (cycle) body.billing_cycle = cycle;
    if (autoRenew !== '') body.auto_renew = autoRenew === 'true';
    onSubmit(body);
  };

  const planOptions = useMemo(() => (plans || []).map((p) => ({ value: p.id, label: `${p.name} · ${p.status}` })), [plans]);

  return (
    <Modal open={Boolean(row)} size="sm" title={`${t('platform.changePlan', { defaultValue: 'Change plan' })} · ${row?.schools?.school_name || ''}`} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : t('common.save')}</button>
        </>
      )}>
      <div className="small text-muted mb-2">{t('platform.currentPlan', { defaultValue: 'Current plan: {{name}}', name: row?.subscription_plans?.name || '—' })}</div>
      <div className="row">
        <Field field={{ name: 'plan_id', type: 'select', required: true, col: 12, label: t('platform.plan', { defaultValue: 'Plan' }) }}
          options={planOptions} value={planId} error={error}
          onChange={setPlanId} disabled={plansLoading} />
        <Field field={{ name: 'billing_cycle', type: 'select', col: 12, label: t('platform.billingCycle', { defaultValue: 'Billing cycle' }) }}
          options={[{ value: '', label: t('platform.keepCurrent', { defaultValue: 'Keep current' }) }, ...BILLING_CYCLES.map((c) => ({ value: c, label: c }))]}
          value={cycle} onChange={setCycle} />
        <Field field={{ name: 'auto_renew', type: 'select', col: 12, label: t('platform.autoRenew', { defaultValue: 'Auto-renew' }) }}
          options={[{ value: '', label: t('platform.keepCurrent', { defaultValue: 'Keep current' }) }, { value: 'true', label: t('common.yes') }, { value: 'false', label: t('common.no') }]}
          value={autoRenew} onChange={setAutoRenew} />
      </div>
      <div className="small text-muted d-flex align-items-center gap-1"><CreditCard size={13} />{t('platform.changePlanNote', { defaultValue: 'Switching the plan does not re-price invoices already issued.' })}</div>
    </Modal>
  );
}
