// Platform tenant management: school list (search / status / create), per-row status & limits, and the
// school detail view rendered when the route carries an id segment (/platform/schools/<id>).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  ArrowLeft, Building2, CalendarClock, Eye, Gauge, GraduationCap, Info, Loader2, PauseCircle,
  Pencil, PlayCircle, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, Users, Wallet,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiDelete, apiPatch, apiPost, apiSweep, sweepFailure } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Field from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import {
  EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge, dateOnly, money as formatMoney,
} from '../../components/ui/Basics.jsx';

/** Allowed values of PATCH /platform/schools/:id/status (server SCHOOL_STATUSES). */
const SCHOOL_STATUSES = ['pending_approval', 'trial', 'active', 'past_due', 'suspended', 'expired', 'cancelled', 'archived'];
/** Allowed values of schools.school_type (server zod enum). */
const SCHOOL_TYPES = ['primary', 'secondary', 'primary_secondary', 'integrated'];

/** Best-effort counter read: GET /platform/schools returns bare `schools.*` rows, so counts may be absent. */
function counter(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export default function SchoolsPage({ params }) {
  const schoolId = params?.[1];
  if (schoolId) return <SchoolDetail id={schoolId} />;
  return <SchoolList />;
}

// ── List ────────────────────────────────────────────────────────
function SchoolList() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null); // { mode:'create' } | { mode:'profile', row }
  const [statusRow, setStatusRow] = useState(null);
  const [limitsRow, setLimitsRow] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query); setPage(1); }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const queryParams = useMemo(() => ({
    page, pageSize: 25, status: status || undefined, q: search || undefined,
  }), [page, status, search]);

  const list = useApi('/platform/schools', queryParams);
  const rows = list.data || [];

  const label = (value) => t(`platform.status.${value}`, { defaultValue: String(value).replace(/_/g, ' ') });

  const columns = [
    {
      key: 'school_name',
      label: t('platform.school', { defaultValue: 'School' }),
      render: (row) => (
        <Link to={`/platform/schools/${row.id}`} className="fw-semibold text-decoration-none">
          {row.school_name}
          <div className="small text-muted">
            {[row.registration_number, row.city, row.country].filter(Boolean).join(' · ')}
          </div>
        </Link>
      ),
    },
    { key: 'status', label: t('common.status'), type: 'status', width: 130 },
    {
      key: 'plan',
      label: t('platform.plan', { defaultValue: 'Plan' }),
      render: (row) => {
        const subscription = row.subscription;
        const name = subscription?.subscription_plans?.name || row.plan_name || row.subscription_plans?.name;
        if (!name) return <span className="text-muted small">—</span>;
        const end = row.plan_end_date || subscription?.end_date || subscription?.trial_end_date;
        const endLabel = subscription?.status === 'trial'
          ? t('platform.trialEnd', { defaultValue: 'Trial ends' })
          : t('platform.endDate', { defaultValue: 'Ends' });
        return (
          <div>
            <div className="small fw-semibold">{name}</div>
            {end && (
              <div className="small text-muted">
                {endLabel} {dateOnly(end)}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'students',
      label: t('modules.students', { defaultValue: 'Students' }),
      render: (row) => {
        const value = counter(row, ['total_students', 'students_count']);
        return value === null ? <span className="text-muted small">—</span> : <span className="tabular-nums">{value}</span>;
      },
    },
    {
      key: 'users',
      label: t('platform.usersCount', { defaultValue: 'Users' }),
      render: (row) => {
        const value = counter(row, ['total_users', 'users_count']);
        return value === null ? <span className="text-muted small">—</span> : <span className="tabular-nums">{value}</span>;
      },
    },
    { key: 'created_at', label: t('platform.created', { defaultValue: 'Created' }), type: 'date' },
    {
      key: 'actions',
      label: t('common.actions'),
      width: 180,
      className: 'text-end',
      render: (row) => (
        <div className="d-inline-flex gap-1">
          <Link to={`/platform/schools/${row.id}`} className="btn btn-icon sm" title={t('platform.viewDetail', { defaultValue: 'View detail' })}>
            <Eye size={14} />
          </Link>
          <button type="button" className="btn btn-icon sm" title={t('platform.changeStatus', { defaultValue: 'Change status' })} onClick={() => setStatusRow(row)}>
            <PauseCircle size={14} />
          </button>
          <button type="button" className="btn btn-icon sm" title={t('platform.editLimits', { defaultValue: 'Edit limits' })} onClick={() => setLimitsRow(row)}>
            <Gauge size={14} />
          </button>
          <button type="button" className="btn btn-icon sm" title={t('common.edit')} aria-label={t('common.edit')} onClick={() => setForm({ mode: 'profile', row })}>
            <Pencil size={14} />
          </button>
          <button type="button" className="btn btn-icon sm text-danger" title={t('platform.deleteSchool', { defaultValue: 'Delete school' })}
            aria-label={t('platform.deleteSchool', { defaultValue: 'Delete school' })} onClick={() => setDeleteRow(row)}>
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('platform.schools', { defaultValue: 'Schools & tenants' })}
        subtitle={t('platform.schoolsSubtitle', { defaultValue: 'Every school on the platform, with its lifecycle status and subscription.' })}
        actions={(
          <>
            <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={list.reload}>
              <RefreshCw size={14} /> {t('common.refresh', { defaultValue: 'Refresh' })}
            </button>
            <button type="button" className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={() => setForm({ mode: 'create' })}>
              <Plus size={14} /> {t('platform.newSchool', { defaultValue: 'New school' })}
            </button>
          </>
        )}
      />

      <div className="card-soft p-2 mb-3">
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <div className="input-group input-group-sm" style={{ maxWidth: 360 }}>
            <span className="input-group-text bg-white"><Search size={14} /></span>
            <input
              className="form-control"
              value={query}
              placeholder={t('platform.schoolsSearch', { defaultValue: 'Search name, registration, email, city…' })}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            />
          </div>
          <div className="nav nav-pills gap-1 flex-wrap">
            <button type="button" className={`btn btn-sm ${status === '' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => { setStatus(''); setPage(1); }}>
              {t('common.all')}
            </button>
            {SCHOOL_STATUSES.map((s) => (
              <button type="button" key={s} className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => { setStatus(s); setPage(1); }}>
                {label(s)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        total={list.total}
        page={page}
        pageSize={25}
        onPage={setPage}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        empty={t('platform.noSchools', { defaultValue: 'No schools match this filter.' })}
      />

      <SchoolFormModal state={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); list.reload(); }} />
      <StatusModal row={statusRow} onClose={() => setStatusRow(null)} onSaved={() => { setStatusRow(null); list.reload(); }} />
      <LimitsModal row={limitsRow} onClose={() => setLimitsRow(null)} onSaved={() => { setLimitsRow(null); list.reload(); }} />
      <DeleteSchoolModal row={deleteRow} onClose={() => setDeleteRow(null)} onSaved={() => { setDeleteRow(null); list.reload(); }} />
    </>
  );
}

// ── Create / edit profile modal ─────────────────────────────────
const CREATE_SECTIONS = [
  {
    key: '__school',
    title: 'School details',
    hint: 'Identity, contact information and location.',
    icon: Building2,
    fields: [
      { name: 'school_name', required: true, col: 6, placeholder: 'e.g. Al-Noor Primary School', help: 'The name families and staff will see.' },
      { name: 'school_type', type: 'select', required: true, col: 6, placeholder: 'Select school type' },
      { name: 'school_email', type: 'email', required: true, col: 6, placeholder: 'office@school.edu' },
      { name: 'school_phone', type: 'tel', col: 6, placeholder: '+252 61 000 0000' },
      { name: 'country', col: 6, placeholder: 'Somalia' },
      { name: 'region', col: 6, placeholder: 'e.g. Banadir' },
      { name: 'city', col: 6, placeholder: 'e.g. Mogadishu' },
      { name: 'address', type: 'textarea', col: 12, rows: 2, placeholder: 'Street, district' },
    ],
  },
  {
    key: '__admin',
    title: 'Administrator account',
    hint: 'The first School Administrator for this tenant.',
    icon: ShieldCheck,
    fields: [
      { name: 'admin_full_name', required: true, col: 6, placeholder: 'e.g. Amina Yusuf' },
      { name: 'admin_email', type: 'email', required: true, col: 6, placeholder: 'admin@school.edu' },
      { name: 'admin_phone', type: 'tel', col: 6, placeholder: '+252 61 000 0000' },
      {
        name: 'admin_password', type: 'password', required: true, col: 6,
        help: 'At least 8 characters. The administrator can sign in immediately with this email and password.',
      },
    ],
  },
  {
    key: '__plan',
    title: 'Subscription plan',
    hint: 'Trial length and limits come from the chosen plan.',
    icon: Wallet,
    fields: [
      { name: 'plan_id', type: 'select', required: true, col: 6, placeholder: 'Select a plan' },
    ],
  },
];

const CREATE_FIELDS = CREATE_SECTIONS.flatMap((section) => section.fields);

const PROFILE_FIELDS = [
  { name: 'school_name', required: true, col: 6 },
  { name: 'school_type', type: 'select', required: true, col: 6 },
  { name: 'registration_number', col: 6 },
  { name: 'email', type: 'email', col: 6 },
  { name: 'phone', type: 'tel', col: 6 },
  { name: 'country', col: 6 },
  { name: 'region', col: 6 },
  { name: 'city', col: 6 },
  { name: 'address', type: 'textarea', col: 12, rows: 2 },
  { name: 'logo_url', col: 12, placeholder: 'https://…' },
];

const PROFILE_SECTIONS = [{
  key: '__profile',
  title: 'School details',
  hint: 'Update the identity and contact details families see.',
  icon: Building2,
  fields: PROFILE_FIELDS,
}];

function SchoolFormModal({ state, onClose, onSaved }) {
  const { t } = useTranslation();
  const isCreate = state?.mode === 'create';
  const fields = isCreate ? CREATE_FIELDS : PROFILE_FIELDS;
  const sections = isCreate ? CREATE_SECTIONS : PROFILE_SECTIONS;
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const plans = useApi('/platform/plans', { pageSize: 200, status: 'published' }, isCreate);

  useEffect(() => {
    if (!state) return;
    setErrors({});
    if (isCreate) {
      setValues({
        school_name: '', school_type: 'primary_secondary', school_email: '',
        school_phone: '', country: 'Somalia', region: '', city: '', address: '',
        admin_full_name: '', admin_email: '', admin_phone: '', admin_password: '', plan_id: '',
      });
    } else {
      const row = state.row || {};
      setValues({
        school_name: row.school_name || '', school_type: row.school_type || 'primary_secondary',
        registration_number: row.registration_number || '', email: row.email || '', phone: row.phone || '',
        country: row.country || '', region: row.region || '', city: row.city || '',
        address: row.address || '', logo_url: row.logo_url || '',
      });
    }
  }, [state, isCreate]);

  const labels = useMemo(() => ({
    school_name: t('platform.schoolName', { defaultValue: 'School name' }),
    school_type: t('platform.schoolType', { defaultValue: 'School type' }),
    registration_number: t('platform.registrationNumber', { defaultValue: 'Registration number' }),
    school_email: t('platform.schoolEmail', { defaultValue: 'School email' }),
    email: t('platform.schoolEmail', { defaultValue: 'School email' }),
    school_phone: t('platform.schoolPhone', { defaultValue: 'School phone' }),
    phone: t('platform.schoolPhone', { defaultValue: 'School phone' }),
    country: t('platform.country', { defaultValue: 'Country' }),
    region: t('platform.region', { defaultValue: 'Region' }),
    city: t('platform.city', { defaultValue: 'City' }),
    address: t('platform.address', { defaultValue: 'Address' }),
    logo_url: t('platform.logoUrl', { defaultValue: 'Logo URL' }),
    admin_full_name: t('platform.adminName', { defaultValue: 'Initial administrator name' }),
    admin_email: t('platform.adminEmail', { defaultValue: 'Initial administrator email' }),
    admin_phone: t('platform.adminPhone', { defaultValue: 'Administrator phone' }),
    admin_password: t('platform.adminPassword', { defaultValue: 'Initial password' }),
    plan_id: t('platform.plan', { defaultValue: 'Plan' }),
  }), [t]);

  const planOptions = useMemo(() => (plans.data || []).map((p) => ({ value: p.id, label: `${p.name} · ${formatMoney(p.monthly_price, p.currency)}` })), [plans.data]);

  const submit = useCallback(async () => {
    const missing = {};
    for (const f of fields) {
      if (f.type === 'section') continue;
      const raw = values[f.name];
      if (f.required && (raw === '' || raw == null)) missing[f.name] = t('common.required');
      if (!missing[f.name] && (f.name === 'school_email' || f.name === 'admin_email' || f.name === 'email') && raw && !isEmail(raw)) {
        missing[f.name] = t('platform.invalidEmail', { defaultValue: 'Enter a valid email address' });
      }
      if (!missing[f.name] && f.name === 'school_name' && String(raw).trim().length < 2) {
        missing[f.name] = t('platform.nameTooShort', { defaultValue: 'At least 2 characters' });
      }
      if (!missing[f.name] && f.name === 'admin_password' && String(raw).length < 8) {
        missing[f.name] = t('platform.passwordTooShort', { defaultValue: 'Use at least 8 characters' });
      }
    }
    setErrors(missing);
    if (Object.keys(missing).length) return;

    setBusy(true);
    try {
      if (isCreate) {
        const body = {
          school_name: values.school_name.trim(),
          school_type: values.school_type,
          school_email: values.school_email.trim(),
          admin_full_name: values.admin_full_name.trim(),
          admin_email: values.admin_email.trim(),
          admin_password: values.admin_password,
          plan_id: values.plan_id,
          country: values.country?.trim() || 'Somalia',
        };
        if (values.school_phone) body.school_phone = String(values.school_phone).trim();
        if (values.region) body.region = String(values.region).trim();
        if (values.city) body.city = String(values.city).trim();
        if (values.address) body.address = String(values.address).trim();
        if (values.admin_phone) body.admin_phone = String(values.admin_phone).trim();
        const { data } = await apiPost('/platform/schools', body);
        toast.success(t('platform.schoolCreated', { defaultValue: 'School tenant provisioned.' }));
        if (data?.activationLink) {
          toast.info(t('platform.activationHint', { defaultValue: 'An activation invitation was emailed to the school administrator.' }));
        } else {
          toast.info(t('platform.credentialsReady', { defaultValue: 'The administrator can sign in with the email and password you set.' }));
        }
      } else {
        const body = {};
        for (const f of PROFILE_FIELDS) {
          const raw = values[f.name];
          if (raw === undefined || raw === '') continue;
          // logo_url is z.string().url() on the server — never send a bare string there.
          if (f.name === 'logo_url' && !/^https?:\/\//.test(String(raw).trim())) continue;
          body[f.name] = String(raw).trim();
        }
        if (!body.school_name) body.school_name = String(values.school_name || '').trim();
        await apiPatch(`/platform/schools/${state.row.id}`, body);
        toast.success(t('common.saved'));
      }
      onSaved();
    } catch (error) {
      toast.error(error.message);
      if (Array.isArray(error.details)) setErrors(Object.fromEntries(error.details.map((d) => [d.field, d.message])));
    } finally { setBusy(false); }
  }, [fields, values, isCreate, state, onSaved, t]);

  return (
    <Modal open={Boolean(state)} size="lg"
      icon={Building2}
      title={isCreate ? t('platform.newSchool', { defaultValue: 'New school' }) : t('platform.editSchool', { defaultValue: 'Edit school profile' })}
      subtitle={isCreate
        ? t('platform.newSchoolSubtitle', { defaultValue: 'Provision a tenant and its first administrator account.' })
        : t('platform.editSchoolSubtitle', { defaultValue: 'Update the school identity and contact details.' })}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={submit} disabled={busy}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            {busy
              ? t('common.loading')
              : isCreate
                ? t('platform.createSchool', { defaultValue: 'Create school' })
                : t('common.save')}
          </button>
        </>
      )}>
      {isCreate && (
        <div className="form-note mb-1">
          <Info size={16} />
          <div>
            {t('platform.createWarning', {
              defaultValue: 'This creates the school, its settings, system roles and a trial subscription. The administrator signs in with the email and password below.',
            })}
          </div>
        </div>
      )}
      <div className="school-form">
        {sections.map((section) => {
          const SectionIcon = section.icon || Building2;
          return (
            <section className="school-form-card" key={section.key}>
              <header className="school-form-card-head">
                <span className="school-form-card-icon"><SectionIcon size={16} /></span>
                <div className="school-form-card-title">
                  <div className="title">{section.title}</div>
                  <div className="hint">{section.hint}</div>
                </div>
                {section.key === '__school' && isCreate && (
                  <span className="school-form-chip">
                    <Sparkles size={12} /> {t('platform.autoId', { defaultValue: 'Auto ID' })}
                  </span>
                )}
              </header>
              {section.key === '__school' && isCreate && (
                <div className="school-auto-id">
                  <Sparkles size={14} />
                  <span>
                    {t('platform.registrationAuto', {
                      defaultValue: 'A unique registration number (EMD-YEAR-XXXXX) is generated automatically when the school is created.',
                    })}
                  </span>
                </div>
              )}
              <div className="row school-form-fields">
                {section.fields.map((f) => (
                  <Field key={f.name}
                    field={{
                      ...f,
                      label: labels[f.name] || f.name,
                      options: f.name === 'school_type'
                        ? SCHOOL_TYPES.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }))
                        : f.name === 'plan_id' ? planOptions : undefined,
                    }}
                    value={values[f.name]}
                    error={errors[f.name]}
                    onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {isCreate && plans.error && (
        <div className="small text-danger">
          {plans.error.status === 403
            ? t('platform.superAdminOnlyPlans', { defaultValue: 'Plan list is Super Admin only — ask a Super Admin to create the tenant.' })
            : plans.error.message}
        </div>
      )}
    </Modal>
  );
}

// ── Status modal ────────────────────────────────────────────────
function StatusModal({ row, onClose, onSaved }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (row) { setStatus(row.status || ''); setReason(''); }
  }, [row]);

  const submit = useCallback(async () => {
    if (!status) { toast.error(t('platform.pickStatus', { defaultValue: 'Choose a status' })); return; }
    setBusy(true);
    try {
      const body = { status };
      if (reason.trim()) body.reason = reason.trim().slice(0, 500);
      await apiPatch(`/platform/schools/${row.id}/status`, body);
      toast.success(t('platform.statusUpdated', { defaultValue: 'School status updated.' }));
      onSaved();
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  }, [row, status, reason, onSaved, t]);

  return (
    <Modal open={Boolean(row)} size="sm"
      title={`${t('platform.changeStatus', { defaultValue: 'Change status' })} · ${row?.school_name || ''}`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : t('common.save')}</button>
        </>
      )}>
      <div className="mb-3">
        <label className="form-label small fw-semibold">{t('common.status')}</label>
        <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          {SCHOOL_STATUSES.map((s) => <option key={s} value={s}>{String(s).replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      <div>
        <label className="form-label small fw-semibold">{t('platform.reason', { defaultValue: 'Reason (audit trail)' })}</label>
        <textarea className="form-control" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="small text-muted mt-2">{t('platform.statusMailHint', { defaultValue: 'The school contact is notified by email when a status change is saved.' })}</div>
    </Modal>
  );
}

// ── Limits modal ────────────────────────────────────────────────
function LimitsModal({ row, onClose, onSaved }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({ max_students: '', max_staff: '', max_storage_mb: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (row) setValues({ max_students: '', max_staff: '', max_storage_mb: '' });
  }, [row]);

  const submit = useCallback(async () => {
    const body = {};
    for (const key of ['max_students', 'max_staff', 'max_storage_mb']) {
      const raw = values[key];
      if (raw === '' || raw === null || raw === undefined) continue;
      const n = Math.trunc(Number(raw));
      if (!Number.isFinite(n) || n < 0) { toast.error(t('platform.integerOnly', { defaultValue: 'Whole numbers only' })); return; }
      body[key] = n;
    }
    if (!Object.keys(body).length) { toast.error(t('platform.noLimitChange', { defaultValue: 'Fill at least one limit' })); return; }
    setBusy(true);
    try {
      await apiPatch(`/platform/schools/${row.id}/limits`, body);
      toast.success(t('platform.limitsSaved', { defaultValue: 'Overrides saved on the school settings.' }));
      onSaved();
    } catch (error) {
      toast.error(error.status === 404 ? t('platform.noSettings', { defaultValue: 'This school has no settings row yet.' }) : error.message);
    } finally { setBusy(false); }
  }, [row, values, onSaved, t]);

  const limitFields = [
    { name: 'max_students', label: t('platform.maxStudents', { defaultValue: 'Max students' }) },
    { name: 'max_staff', label: t('platform.maxStaff', { defaultValue: 'Max staff' }) },
    { name: 'max_storage_mb', label: t('platform.maxStorage', { defaultValue: 'Max storage (MB)' }) },
  ];

  return (
    <Modal open={Boolean(row)} size="sm"
      title={`${t('platform.editLimits', { defaultValue: 'Edit limits' })} · ${row?.school_name || ''}`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : t('common.save')}</button>
        </>
      )}>
      <div className="row">
        {limitFields.map((f) => (
          <Field key={f.name} field={{ name: f.name, label: f.label, type: 'number', col: 12 }}
            value={values[f.name]} onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))} />
        ))}
      </div>
      <div className="small text-muted">{t('platform.limitsHint', { defaultValue: 'Empty fields are left untouched. Overrides live in the school settings and take precedence over the plan defaults.' })}</div>
    </Modal>
  );
}

// ── Permanently delete a school ─────────────────────────────────
function DeleteSchoolModal({ row, onClose, onSaved }) {
  const { t } = useTranslation();
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (row) setConfirmName(''); }, [row]);

  const submit = useCallback(async () => {
    if (!row) return;
    setBusy(true);
    try {
      const { data } = await apiDelete(`/platform/schools/${row.id}?confirm=${encodeURIComponent(confirmName)}`);
      toast.success(t('platform.schoolDeleted', {
        defaultValue: '{{name}} was deleted with all its data and logins.',
        name: data?.school_name || row.school_name,
      }));
      onSaved();
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  }, [row, confirmName, onSaved, t]);

  return (
    <Modal open={Boolean(row)} size="sm" icon={Trash2}
      title={`${t('platform.deleteSchool', { defaultValue: 'Delete school' })} · ${row?.school_name || ''}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-danger d-inline-flex align-items-center gap-2"
            onClick={submit} disabled={busy || !row || confirmName !== row.school_name}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            {t('platform.deleteSchool', { defaultValue: 'Delete school' })}
          </button>
        </>
      )}>
      <p className="small text-muted">
        {t('platform.deleteSchoolHint', {
          defaultValue: 'This permanently removes the school and every class, student, staff login, record and open recycle-bin snapshot for it. This cannot be undone.',
        })}
      </p>
      <label className="form-label small fw-semibold" htmlFor="platform-delete-school-confirm">
        {t('sections.typeSchoolName', { defaultValue: 'Type “{{name}}” to confirm', name: row?.school_name || '' })}
      </label>
      <input id="platform-delete-school-confirm" className="form-control" value={confirmName} autoComplete="off"
        placeholder={row?.school_name || ''} onChange={(e) => setConfirmName(e.target.value)} />
    </Modal>
  );
}

// ── Delete all data modal ───────────────────────────────────────
function ClearDataModal({ row, onClose, onSaved }) {
  const { t } = useTranslation();
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (row) setConfirmName(''); }, [row]);

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await apiSweep(`/platform/schools/${row.id}/clear-data`, { confirm: confirmName });
      toast.success(t('sections.dataClearedRecoverable', {
        defaultValue: 'School cleared ({{tables}} tables, {{rows}} rows, {{users}} logins removed). The school administrators stay signed in, and everything is restorable from the recycle bin.',
        tables: data?.tables ?? 0, rows: data?.rows ?? 0, users: data?.users ?? 0,
      }));
      onSaved();
    } catch (error) {
      toast.error(sweepFailure(error));
    } finally { setBusy(false); }
  }, [row, confirmName, onSaved, t]);

  return (
    <Modal open={Boolean(row)} size="sm" icon={Trash2}
      title={`${t('sections.clearAllData', { defaultValue: 'Delete all school data' })} · ${row?.school_name || ''}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-danger d-inline-flex align-items-center gap-2"
            onClick={submit} disabled={busy || !row || confirmName !== row.school_name}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            {t('sections.clearAllData', { defaultValue: 'Delete all school data' })}
          </button>
        </>
      )}>
      <p className="small text-muted">
        {t('sections.platformClearRowHint', {
          defaultValue: 'Deletes every student, teacher and parent login and every business record for this school. The school’s own administrator logins, its profile, branding, roles and subscription stay, so the school can still be signed into. Everything is snapshotted into the recycle bin first, so it can be restored from Platform → Recycle bin.',
        })}
      </p>
      <label className="form-label small fw-semibold" htmlFor="platform-clear-confirm">
        {t('sections.typeSchoolName', { defaultValue: 'Type “{{name}}” to confirm', name: row?.school_name || '' })}
      </label>
      <input id="platform-clear-confirm" className="form-control" value={confirmName} autoComplete="off"
        placeholder={row?.school_name || ''} onChange={(e) => setConfirmName(e.target.value)} />
    </Modal>
  );
}

// ── Detail view ─────────────────────────────────────────────────
function SchoolDetail({ id }) {
  const { t } = useTranslation();
  const detail = useApi(`/platform/schools/${id}`);
  const invoices = useApi('/platform/invoices', { school_id: id });
  const [form, setForm] = useState(null);
  const [statusRow, setStatusRow] = useState(null);
  const [limitsRow, setLimitsRow] = useState(null);
  const [trialOpen, setTrialOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const school = detail.data;
  const usage = school?.usage || {};
  const subscriptions = school?.subscriptions || [];
  const currentSub = subscriptions[0] || null;
  const settings = school?.settings || null;

  if (detail.loading && !school) return <Spinner label={t('common.loading')} />;
  if (detail.error) return (
    <>
      <BackLink />
      <ErrorState error={detail.error} onRetry={detail.reload} />
    </>
  );
  if (!school) return <><BackLink /><EmptyState title={t('platform.schoolNotFound', { defaultValue: 'School not found' })} /></>;

  const invoiceColumns = [
    { key: 'invoice_number', label: t('platform.invoiceNumber', { defaultValue: 'Invoice #' }) },
    { key: 'total', label: t('common.amount'), render: (r) => <span className="tabular-nums">{formatMoney(r.total, r.currency)}</span> },
    { key: 'status', label: t('common.status'), type: 'status' },
    { key: 'due_date', label: t('platform.dueDate', { defaultValue: 'Due date' }), type: 'date' },
  ];

  return (
    <>
      <BackLink />
      <PageHeader
        title={school.school_name}
        subtitle={`${[school.school_type?.replace(/_/g, ' '), school.city, school.region, school.country].filter(Boolean).join(' · ')}`}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setForm({ mode: 'profile', row: school })}>{t('platform.editSchool', { defaultValue: 'Edit school profile' })}</button>
            <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={() => setLimitsRow(school)}><Gauge size={14} />{t('platform.editLimits', { defaultValue: 'Edit limits' })}</button>
            {school.status === 'suspended' || school.status === 'expired' || school.status === 'past_due' ? (
              <button className="btn btn-sm btn-outline-success d-flex align-items-center gap-1" onClick={() => setStatusRow(school)}><PlayCircle size={14} />{t('platform.activate', { defaultValue: 'Activate' })}</button>
            ) : (
              <button className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1" onClick={() => setStatusRow(school)}><PauseCircle size={14} />{t('platform.suspend', { defaultValue: 'Suspend' })}</button>
            )}
            <button className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={() => setTrialOpen(true)}><CalendarClock size={14} />{t('platform.extendTrial', { defaultValue: 'Extend trial' })}</button>
            <button className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1" onClick={() => setClearOpen(true)}><Trash2 size={14} />{t('sections.clearAllData', { defaultValue: 'Delete all school data' })}</button>
          </>
        )}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-3"><StatCard label={t('modules.students')} value={usage.students ?? '—'} icon={GraduationCap} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('platform.usersCount', { defaultValue: 'Users' })} value={usage.users ?? '—'} icon={Users} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.staff', { defaultValue: 'Staff' })} value={usage.staff ?? '—'} icon={Users} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.teachers', { defaultValue: 'Teachers' })} value={usage.teachers ?? '—'} icon={Users} /></div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2"><Building2 size={15} className="me-1" />{t('platform.profile', { defaultValue: 'Profile' })}</div>
            <div className="row g-2 small">
              <Row label={t('common.status')} value={<StatusBadge value={school.status} />} />
              <Row label={t('platform.registrationNumber', { defaultValue: 'Registration number' })} value={school.registration_number} />
              <Row label={t('platform.schoolEmail', { defaultValue: 'School email' })} value={school.email} />
              <Row label={t('platform.schoolPhone', { defaultValue: 'School phone' })} value={school.phone} />
              <Row label={t('platform.country', { defaultValue: 'Country' })} value={school.country} />
              <Row label={t('platform.region', { defaultValue: 'Region' })} value={school.region} />
              <Row label={t('platform.city', { defaultValue: 'City' })} value={school.city} />
              <Row label={t('platform.created', { defaultValue: 'Created' })} value={dateOnly(school.created_at)} />
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2"><Wallet size={15} className="me-1" />{t('platform.subscriptionSummary', { defaultValue: 'Subscription' })}</div>
            {!currentSub && <EmptyState title={t('platform.noSubscription', { defaultValue: 'No subscription record' })} />}
            {currentSub && (
              <div className="row g-2 small">
                <Row label={t('platform.plan', { defaultValue: 'Plan' })} value={currentSub.subscription_plans?.name} />
                <Row label={t('common.status')} value={<StatusBadge value={currentSub.status} />} />
                <Row label={t('platform.billingCycle', { defaultValue: 'Billing cycle' })} value={currentSub.billing_cycle} />
                <Row label={t('platform.startDate', { defaultValue: 'Start' })} value={dateOnly(currentSub.start_date)} />
                <Row label={t('platform.endDate', { defaultValue: 'Ends' })} value={dateOnly(currentSub.end_date)} />
                <Row label={t('platform.trialEnd', { defaultValue: 'Trial ends' })} value={dateOnly(currentSub.trial_end_date)} />
                <Row label={t('platform.graceEnd', { defaultValue: 'Grace period ends' })} value={dateOnly(currentSub.grace_period_end)} />
                <Row label={t('platform.autoRenew', { defaultValue: 'Auto-renew' })} value={currentSub.auto_renew ? t('common.yes') : t('common.no')} />
              </div>
            )}
            {subscriptions.length > 1 && (
              <div className="small text-muted mt-2">
                {t('platform.subscriptionHistory', { defaultValue: '{{count}} subscription records on this tenant', count: subscriptions.length })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-6">
          <div className="fw-semibold mb-2 small text-uppercase text-muted">{t('platform.saasInvoices', { defaultValue: 'SaaS invoices for this school' })}</div>
          <DataTable columns={invoiceColumns} rows={invoices.data} loading={invoices.loading} error={invoices.error} onRetry={invoices.reload}
            empty={t('platform.noInvoices', { defaultValue: 'No platform invoices yet' })} dense />
        </div>
        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2"><Users size={15} className="me-1" />{t('platform.administrators', { defaultValue: 'School administrators' })}</div>
            {(school.administrators || []).length === 0 && <EmptyState title={t('platform.noAdmins', { defaultValue: 'No administrator accounts found' })} />}
            {(school.administrators || []).map((a) => (
              <div key={a.id} className="d-flex justify-content-between border-bottom py-2 small">
                <span className="text-truncate me-2">{a.full_name} <span className="text-muted">· {a.email}</span></span>
                <StatusBadge value={a.status} />
              </div>
            ))}
            {settings && (
              <>
                <div className="fw-semibold mt-3 mb-1 small text-uppercase text-muted">{t('platform.settings', { defaultValue: 'Tenant settings' })}</div>
                <div className="row g-2 small">
                  <Row label={t('platform.language', { defaultValue: 'Language' })} value={settings.default_language} />
                  <Row label={t('platform.currency', { defaultValue: 'Currency' })} value={settings.currency} />
                  <Row label={t('platform.timezone', { defaultValue: 'Timezone' })} value={settings.timezone} />
                  <Row label={t('platform.limitOverrides', { defaultValue: 'Limit overrides' })} value={settings.limits_override && Object.keys(settings.limits_override).length ? JSON.stringify(settings.limits_override) : '—'} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <SchoolFormModal state={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); detail.reload(); }} />
      <StatusModal row={statusRow} onClose={() => setStatusRow(null)} onSaved={() => { setStatusRow(null); detail.reload(); }} />
      <LimitsModal row={limitsRow} onClose={() => setLimitsRow(null)} onSaved={() => { setLimitsRow(null); detail.reload(); }} />
      <ExtendTrialModal open={trialOpen} subscription={currentSub} school={school} onClose={() => setTrialOpen(false)} onSaved={() => { setTrialOpen(false); detail.reload(); }} />
      <ClearDataModal row={clearOpen ? school : null} onClose={() => setClearOpen(false)} onSaved={() => { setClearOpen(false); detail.reload(); }} />
    </>
  );
}

function ExtendTrialModal({ open, subscription, school, onClose, onSaved }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    const n = Math.trunc(Number(days));
    if (!Number.isFinite(n) || n < 1) { toast.error(t('platform.integerOnly', { defaultValue: 'Whole numbers only' })); return; }
    if (!subscription?.id) { toast.error(t('platform.needSubscription', { defaultValue: 'This school has no subscription to extend.' })); return; }
    setBusy(true);
    try {
      await apiPatch(`/platform/subscriptions/${subscription.id}`, { extend_days: n });
      if (school && school.status !== 'active' && school.status !== 'trial') {
        await apiPatch(`/platform/schools/${school.id}/status`, { status: 'trial', reason: `Trial extended by ${n} days` }).catch(() => {});
      }
      toast.success(t('platform.trialExtended', { defaultValue: 'End date extended.' }));
      onSaved();
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  }, [days, subscription, school, onSaved, t]);

  return (
    <Modal open={open} size="sm" title={t('platform.extendTrial', { defaultValue: 'Extend trial' })} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !subscription}>{busy ? '…' : t('common.confirm')}</button>
        </>
      )}>
      <div className="row">
        <Field field={{ name: 'extend_days', label: t('platform.extendDays', { defaultValue: 'Days to add to the current end date' }), type: 'number', col: 12 }}
          value={days} onChange={setDays} />
      </div>
      <div className="small text-muted">
        {subscription
          ? t('platform.extendHint', { defaultValue: 'Current end date: {{date}}. The server shifts end_date by the days given.', date: dateOnly(subscription.end_date) })
          : t('platform.needSubscription', { defaultValue: 'This school has no subscription to extend.' })}
      </div>
    </Modal>
  );
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link to="/platform/schools" className="btn btn-sm btn-outline-secondary mb-3 d-inline-flex align-items-center gap-1">
      <ArrowLeft size={14} /> {t('platform.backToSchools', { defaultValue: 'Back to schools' })}
    </Link>
  );
}

function Row({ label, value }) {
  return (
    <div className="col-6">
      <div className="text-muted">{label}</div>
      <div className="fw-semibold">{value ?? '—'}</div>
    </div>
  );
}
