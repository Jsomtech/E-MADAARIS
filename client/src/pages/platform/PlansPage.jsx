// Subscription plan catalogue: CRUD, publish/disable, delete, and the per-plan feature entitlement editor.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { CheckCircle2, KeyRound, Plus, RefreshCw, Search, ShieldAlert, StopCircle, XCircle } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Field from '../../components/ui/Field.jsx';
import { Modal, ConfirmDialog } from '../../components/ui/Modal.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, money as formatMoney } from '../../components/ui/Basics.jsx';

/** subscription_plans.status values (server zod enum). */
const PLAN_STATUSES = ['draft', 'published', 'disabled', 'archived'];
/** feature_key values seeded for plan_features (supabase/seed.sql §4). */
const FEATURE_KEYS = [
  'students.management', 'teachers.management', 'classes.subjects', 'attendance',
  'examinations', 'results', 'fees', 'parent.portal', 'digital.learning',
  'advanced.analytics', 'certificates', 'library', 'discipline', 'transport', 'hr',
];

const FIELDS = [
  { name: 'name', required: true, col: 6 },
  { name: 'status', type: 'select', required: true, col: 6 },
  { name: 'description', type: 'textarea', col: 12, rows: 2 },
  { name: 'monthly_price', type: 'money', required: true, col: 4 },
  { name: 'quarterly_price', type: 'money', col: 4 },
  { name: 'annual_price', type: 'money', col: 4 },
  { name: 'currency', required: true, col: 4 },
  { name: 'trial_days', type: 'number', col: 4 },
  { name: 'grace_period_days', type: 'number', col: 4 },
  { name: 'max_students', type: 'number', required: true, col: 3 },
  { name: 'max_staff', type: 'number', required: true, col: 3 },
  { name: 'max_storage_mb', type: 'number', required: true, col: 3 },
  { name: 'max_branches', type: 'number', required: true, col: 3 },
  { name: 'sort_order', type: 'number', col: 12 },
];

const DEFAULTS = {
  name: '', status: 'draft', description: '', monthly_price: 0, quarterly_price: '', annual_price: '',
  currency: 'USD', trial_days: 14, grace_period_days: 7, max_students: 100, max_staff: 20,
  max_storage_mb: 1024, max_branches: 1, sort_order: 0,
};

/** Client-side mirror of the server zod schema, so obvious mistakes never reach the API. */
function validatePlan(values, t) {
  const errors = {};
  const name = String(values.name || '').trim();
  if (name.length < 2 || name.length > 64) errors.name = t('platform.planNameLength', { defaultValue: 'Between 2 and 64 characters' });
  if (String(values.description || '').length > 500) errors.description = t('platform.descLength', { defaultValue: 'Max 500 characters' });
  if (!String(values.currency || '').trim() || String(values.currency).length > 8) errors.currency = t('platform.currencyLength', { defaultValue: 'Max 8 characters' });
  for (const key of ['monthly_price', 'quarterly_price', 'annual_price']) {
    const raw = values[key];
    if (raw === '' || raw === null || raw === undefined) continue;
    if (!Number.isFinite(Number(raw)) || Number(raw) < 0) errors[key] = t('platform.priceInvalid', { defaultValue: 'A number of 0 or more' });
  }
  if (values.monthly_price === '' || values.monthly_price == null) errors.monthly_price = t('common.required');
  const ints = {
    trial_days: 0, grace_period_days: 0, max_students: 1, max_staff: 1, max_storage_mb: 1, max_branches: 1, sort_order: null,
  };
  for (const [key, min] of Object.entries(ints)) {
    const raw = values[key];
    if (raw === '' || raw === null || raw === undefined) {
      if (min !== null) errors[key] = t('common.required');
      continue;
    }
    const n = Number(raw);
    if (!Number.isInteger(n)) errors[key] = t('platform.integerOnly', { defaultValue: 'Whole numbers only' });
    else if (min !== null && n < min) errors[key] = t('platform.minValue', { defaultValue: 'At least {{min}}', min });
  }
  return errors;
}

export default function PlansPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // { mode:'create' } | { mode:'edit', row }
  const [featuresPlan, setFeaturesPlan] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const params = useMemo(() => ({ page, pageSize: 25, q: query || undefined, status: status || undefined }), [page, query, status]);
  const list = useApi('/platform/plans', params);

  const forbidden = list.error?.status === 403;

  const patchStatus = useCallback(async (row, nextStatus) => {
    setBusy(true);
    try {
      await apiPatch(`/platform/plans/${row.id}`, { status: nextStatus });
      toast.success(t('platform.planStatusSaved', { defaultValue: '{{plan}} is now {{status}}', plan: row.name, status: nextStatus }));
      list.reload();
    } catch (error) {
      toast.error(error.status === 403 ? t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }) : error.message);
    } finally { setBusy(false); }
  }, [list, t]);

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await apiDelete(`/platform/plans/${deleting.id}`);
      toast.success(t('common.deleted'));
      setDeleting(null);
      list.reload();
    } catch (error) {
      toast.error(error.status === 403
        ? t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' })
        : error.message);
      setDeleting(null);
    } finally { setBusy(false); }
  }, [deleting, list, t]);

  const columns = [
    {
      key: 'name',
      label: t('common.name'),
      render: (row) => (
        <div>
          <div className="fw-semibold">{row.name}</div>
          {row.description && <div className="small text-muted text-truncate" style={{ maxWidth: 320 }}>{row.description}</div>}
        </div>
      ),
    },
    {
      key: 'monthly_price',
      label: t('platform.prices', { defaultValue: 'Monthly / quarterly / annual' }),
      render: (row) => (
        <span className="small tabular-nums">
          {formatMoney(row.monthly_price, row.currency)} · {formatMoney(row.quarterly_price, row.currency)} · {formatMoney(row.annual_price, row.currency)}
        </span>
      ),
    },
    {
      key: 'max_students',
      label: t('platform.limits', { defaultValue: 'Limits' }),
      render: (row) => (
        <span className="small text-muted">
          {t('platform.studentsShort', { defaultValue: 'Stu' })} {row.max_students ?? '—'} · {t('platform.staffShort', { defaultValue: 'Stf' })} {row.max_staff ?? '—'} · {t('platform.storageShort', { defaultValue: 'MB' })} {row.max_storage_mb ?? '—'} · {t('platform.branchesShort', { defaultValue: 'Br' })} {row.max_branches ?? '—'}
        </span>
      ),
    },
    { key: 'trial_days', label: t('platform.trialDays', { defaultValue: 'Trial days' }), width: 90 },
    { key: 'status', label: t('common.status'), type: 'status', width: 110 },
    { key: 'sort_order', label: t('platform.order', { defaultValue: 'Order' }), width: 70 },
    {
      key: 'actions',
      label: t('common.actions'),
      width: 190,
      className: 'text-end',
      render: (row) => (
        <div className="d-inline-flex gap-1">
          <button className="btn btn-sm btn-outline-secondary" title={t('platform.features', { defaultValue: 'Features' })} onClick={() => setFeaturesPlan(row)}>
            <KeyRound size={14} />
          </button>
          {row.status !== 'published' ? (
            <button className="btn btn-sm btn-outline-success" title={t('platform.publish', { defaultValue: 'Publish' })} disabled={busy} onClick={() => patchStatus(row, 'published')}>
              <CheckCircle2 size={14} />
            </button>
          ) : (
            <button className="btn btn-sm btn-outline-warning" title={t('platform.disable', { defaultValue: 'Disable' })} disabled={busy} onClick={() => patchStatus(row, 'disabled')}>
              <StopCircle size={14} />
            </button>
          )}
          <button className="btn btn-sm btn-outline-danger" title={t('common.delete')} disabled={busy} onClick={() => setDeleting(row)}>
            <XCircle size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('platform.plans', { defaultValue: 'Subscription plans' })}
        subtitle={t('platform.plansSubtitle', { defaultValue: 'Catalogue of sellable plans: pricing, capacity limits and feature entitlements.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={list.reload}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <button className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={() => setEditing({ mode: 'create' })}>
              <Plus size={14} /> {t('platform.newPlan', { defaultValue: 'New plan' })}
            </button>
          </>
        )}
      />

      {forbidden ? (
        <div className="card-soft">
          <EmptyState icon={ShieldAlert}
            title={t('platform.superAdminOnlyTitle', { defaultValue: 'Super Admin only' })}
            hint={t('platform.superAdminOnlyHint', { defaultValue: 'Plan management is restricted to platform Super Admins. Platform Support cannot read this catalogue.' })} />
        </div>
      ) : (
        <>
          <div className="card-soft p-2 mb-3">
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <div className="input-group input-group-sm" style={{ maxWidth: 320 }}>
                <span className="input-group-text bg-white"><Search size={14} /></span>
                <input className="form-control" value={query} placeholder={t('platform.plansSearch', { defaultValue: 'Search plan name…' })}
                  onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
              </div>
              <div className="nav nav-pills gap-1 flex-wrap">
                <button className={`btn btn-sm ${status === '' ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => { setStatus(''); setPage(1); }}>{t('common.all')}</button>
                {PLAN_STATUSES.map((s) => (
                  <button key={s} className={`btn btn-sm ${status === s ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => { setStatus(s); setPage(1); }}>
                    {t(`platform.status.${s}`, { defaultValue: s })}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DataTable columns={columns} rows={list.data} total={list.total} page={page} pageSize={25} onPage={setPage}
            loading={list.loading} error={list.error} onRetry={list.reload}
            onEdit={(row) => setEditing({ mode: 'edit', row })}
            empty={t('platform.noPlans', { defaultValue: 'No plans in this catalogue' })} />

          <div className="small text-muted mt-2">
            {t('platform.deleteHint', { defaultValue: 'Deleting removes the plan row outright. Plans already attached to a school subscription are referenced by the database and cannot be deleted — disable them instead.' })}
          </div>
        </>
      )}

      <PlanFormModal state={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />
      <FeaturesModal plan={featuresPlan} onClose={() => setFeaturesPlan(null)} />
      <ConfirmDialog open={Boolean(deleting)} title={t('platform.deletePlan', { defaultValue: 'Delete plan' })}
        message={t('platform.deletePlanMessage', { defaultValue: 'Delete "{{name}}"? Schools already subscribed to it will keep the reference.', name: deleting?.name })}
        busy={busy} onClose={() => setDeleting(null)} onConfirm={remove} />
    </>
  );
}

function PlanFormModal({ state, onClose, onSaved }) {
  const { t } = useTranslation();
  const [values, setValues] = useState(DEFAULTS);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state) return;
    setErrors({});
    if (state.mode === 'create') { setValues({ ...DEFAULTS }); return; }
    const row = state.row || {};
    setValues({
      ...DEFAULTS,
      ...Object.fromEntries(FIELDS.map((f) => [f.name, row[f.name] ?? (row[f.name] === 0 ? 0 : DEFAULTS[f.name])])),
    });
  }, [state]);

  const labels = useMemo(() => ({
    name: t('platform.planName', { defaultValue: 'Plan name' }),
    status: t('common.status'),
    description: t('platform.description', { defaultValue: 'Description' }),
    monthly_price: t('platform.monthlyPrice', { defaultValue: 'Monthly price' }),
    quarterly_price: t('platform.quarterlyPrice', { defaultValue: 'Quarterly price' }),
    annual_price: t('platform.annualPrice', { defaultValue: 'Annual price' }),
    currency: t('platform.currency', { defaultValue: 'Currency' }),
    trial_days: t('platform.trialDays', { defaultValue: 'Trial days' }),
    grace_period_days: t('platform.graceDays', { defaultValue: 'Grace period (days)' }),
    max_students: t('platform.maxStudents', { defaultValue: 'Max students' }),
    max_staff: t('platform.maxStaff', { defaultValue: 'Max staff' }),
    max_storage_mb: t('platform.maxStorage', { defaultValue: 'Max storage (MB)' }),
    max_branches: t('platform.maxBranches', { defaultValue: 'Max branches' }),
    sort_order: t('platform.sortOrder', { defaultValue: 'Display order' }),
  }), [t]);

  const submit = useCallback(async () => {
    const found = validatePlan(values, t);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const body = {
        name: String(values.name).trim(),
        status: values.status,
        currency: String(values.currency).trim(),
        monthly_price: Number(values.monthly_price),
        trial_days: Math.trunc(Number(values.trial_days)),
        grace_period_days: Math.trunc(Number(values.grace_period_days)),
        max_students: Math.trunc(Number(values.max_students)),
        max_staff: Math.trunc(Number(values.max_staff)),
        max_storage_mb: Math.trunc(Number(values.max_storage_mb)),
        max_branches: Math.trunc(Number(values.max_branches)),
        sort_order: Math.trunc(Number(values.sort_order ?? 0)),
      };
      if (String(values.description || '').trim()) body.description = String(values.description).trim();
      // quarterly/annual are optional numbers on the server (no nullable), so blanks are simply omitted.
      for (const key of ['quarterly_price', 'annual_price']) {
        if (values[key] !== '' && values[key] !== null && values[key] !== undefined) body[key] = Number(values[key]);
      }
      if (state?.mode === 'edit') await apiPatch(`/platform/plans/${state.row.id}`, body);
      else await apiPost('/platform/plans', body);
      toast.success(t('common.saved'));
      onSaved();
    } catch (error) {
      toast.error(error.status === 403 ? t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }) : error.message);
      if (Array.isArray(error.details)) setErrors(Object.fromEntries(error.details.map((d) => [d.field, d.message])));
    } finally { setBusy(false); }
  }, [values, state, onSaved, t]);

  return (
    <Modal open={Boolean(state)} size="lg"
      title={state?.mode === 'edit' ? `${t('common.edit')} · ${state?.row?.name || ''}` : t('platform.newPlan', { defaultValue: 'New plan' })}
      onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : t('common.save')}</button>
        </>
      )}>
      <div className="row">
        {FIELDS.map((f) => (
          <Field key={f.name}
            field={{ ...f, label: labels[f.name] || f.name, options: f.name === 'status' ? PLAN_STATUSES.map((v) => ({ value: v, label: v })) : f.options }}
            value={values[f.name]} error={errors[f.name]}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))} />
        ))}
      </div>
      <div className="small text-muted">
        {t('platform.priceHelp', { defaultValue: 'Prices are platform → school SaaS charges, not school fee invoices. Leave quarterly/annual empty to bill those cycles from the monthly price.' })}
      </div>
    </Modal>
  );
}

function FeaturesModal({ plan, onClose }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!plan) return;
    setLoading(true);
    setError(null);
    try {
      const body = await apiGet(`/platform/plans/${plan.id}/features`);
      const saved = body.data || [];
      const byKey = Object.fromEntries(saved.map((f) => [f.feature_key, f]));
      const keys = [...new Set([...FEATURE_KEYS, ...saved.map((f) => f.feature_key)])];
      setRows(keys.map((key) => ({
        feature_key: key,
        enabled: Boolean(byKey[key]?.enabled),
        limit_value: byKey[key]?.limit_value ?? '',
      })));
    } catch (e) {
      setError(e);
      setRows([]);
    } finally { setLoading(false); }
  }, [plan]);

  useEffect(() => { load(); }, [load]);

  const toggle = (key, patch) => setRows((prev) => prev.map((r) => (r.feature_key === key ? { ...r, ...patch } : r)));

  const save = useCallback(async () => {
    setBusy(true);
    try {
      await apiPatch(`/platform/plans/${plan.id}/features`, {
        features: rows.map((r) => {
          const item = { feature_key: r.feature_key, enabled: Boolean(r.enabled) };
          const limit = Math.trunc(Number(r.limit_value));
          if (r.limit_value !== '' && r.limit_value !== null && Number.isFinite(limit) && limit >= 0) item.limit_value = limit;
          return item;
        }),
      });
      toast.success(t('platform.featuresSaved', { defaultValue: 'Feature entitlements saved.' }));
      await load();
    } catch (e) {
      toast.error(e.status === 403 ? t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }) : e.message);
    } finally { setBusy(false); }
  }, [plan, rows, load, t]);

  return (
    <Modal open={Boolean(plan)} size="lg" title={`${t('platform.features', { defaultValue: 'Features' })} · ${plan?.name || ''}`} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.close')}</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || loading || Boolean(error)}>{busy ? '…' : t('common.save')}</button>
        </>
      )}>
      {loading && <Spinner label={t('common.loading')} />}
      {error && (
        <div className="mb-3">
          <ErrorState error={error.status === 403 ? { message: t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }) } : error} onRetry={load} />
        </div>
      )}
      {!loading && !error && (
        <>
          <div className="small text-muted mb-2">
            {t('platform.featuresHelp', { defaultValue: 'Keys come from the seeded feature list. A numeric cap is optional; leave it empty for "no extra cap".' })}
          </div>
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead><tr><th>{t('platform.featureKey', { defaultValue: 'Feature key' })}</th><th style={{ width: 110 }}>{t('common.status')}</th><th style={{ width: 160 }}>{t('platform.limitValue', { defaultValue: 'Limit' })}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.feature_key}>
                    <td className="small fw-semibold">{r.feature_key}</td>
                    <td>
                      <div className="form-check form-switch">
                        <input className="form-check-input" type="checkbox" id={`feat-${r.feature_key}`} checked={r.enabled}
                          onChange={(e) => toggle(r.feature_key, { enabled: e.target.checked })} />
                        <label className="form-check-label small" htmlFor={`feat-${r.feature_key}`}>{r.enabled ? t('platform.on', { defaultValue: 'On' }) : t('platform.off', { defaultValue: 'Off' })}</label>
                      </div>
                    </td>
                    <td>
                      <input className="form-control form-control-sm" type="number" min="0" step="1" value={r.limit_value}
                        disabled={!r.enabled} onChange={(e) => toggle(r.feature_key, { limit_value: e.target.value === '' ? '' : Number(e.target.value) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
