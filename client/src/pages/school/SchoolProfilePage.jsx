// School profile: GET/PATCH /school/profile — only the columns the server's zod schema accepts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Building2, CalendarClock, ImagePlus, Loader2, RefreshCw, Save, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiDelete, apiPatch, apiUpload } from '../../api/client.js';
import Field from '../../components/ui/Field.jsx';
import { EmptyState, PageHeader, Spinner, StatusBadge, dateTime } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import BrandLogo from '../../components/brand/BrandLogo.jsx';

/** schoolRouter.patch('/profile') field list (server/src/api/school.routes.js lines 22-39). */
const FIELD_DEFS = [
  { name: 'school_name', required: true, col: 6, labelKey: 'sections.schoolName', fallback: 'School name' },
  { name: 'school_type', type: 'select', col: 6, labelKey: 'sections.schoolType', fallback: 'School type',
    options: ['primary', 'secondary', 'primary_secondary', 'integrated'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })) },
  { name: 'email', type: 'email', col: 6, labelKey: 'common.email', fallback: 'Email' },
  { name: 'phone', type: 'tel', col: 6, labelKey: 'common.phone', fallback: 'Phone' },
  { name: 'country', col: 4, labelKey: 'sections.country', fallback: 'Country' },
  { name: 'region', col: 4, labelKey: 'sections.region', fallback: 'Region' },
  { name: 'city', col: 4, labelKey: 'sections.city', fallback: 'City' },
  { name: 'address', col: 12, labelKey: 'sections.address', fallback: 'Address' },
];

export default function SchoolProfilePage() {
  const { t } = useTranslation();
  const { can, profile, refresh } = useAuth();
  const school = useApi('/school/profile');
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const mayEdit = can('school.edit');

  useEffect(() => {
    if (!school.data) return;
    setValues(Object.fromEntries(FIELD_DEFS.map((f) => [f.name, school.data[f.name] ?? ''])));
    setErrors({});
  }, [school.data]);

  const fields = useMemo(() => FIELD_DEFS.map((f) => ({
    ...f,
    label: t(f.labelKey, { defaultValue: f.fallback }),
    help: f.helpKey ? t(f.helpKey, { defaultValue: f.help }) : f.help,
  })), [t]);

  const dirty = useMemo(() => FIELD_DEFS.some((f) => String(values[f.name] ?? '') !== String(school.data?.[f.name] ?? '')), [values, school.data]);

  const save = useCallback(async () => {
    const payload = {};
    const nextErrors = {};
    for (const f of FIELD_DEFS) {
      const raw = values[f.name];
      const original = school.data?.[f.name] ?? '';
      const next = String(raw ?? '').trim();
      if (next === String(original).trim()) continue;
      if (!next && !f.required) continue; // empties are not patchable safely
      payload[f.name] = next;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    if (!Object.keys(payload).length) {
      toast.info(t('sections.nothingChanged', { defaultValue: 'Nothing changed — no field was sent.' }));
      return;
    }
    setSaving(true);
    try {
      await apiPatch('/school/profile', payload);
      toast.success(t('sections.profileSaved', { defaultValue: 'School profile updated.' }));
      school.reload();
    } catch (error) {
      if (error.status === 403) toast.error(t('sections.schoolEditRequired', { defaultValue: 'Editing the school profile needs the school.edit permission.' }));
      else toast.error(error.message || t('sections.noFieldsOrInvalid', { defaultValue: 'Rejected by the server.' }));
    } finally {
      setSaving(false);
    }
  }, [values, school, t]);

  if (school.loading && !school.data) return <Spinner label={t('common.loading')} />;

  const row = school.data || {};

  return (
    <>
      <PageHeader
        title={t('sections.profileTitle', { defaultValue: 'School profile' })}
        subtitle={t('sections.profileSubtitle', { defaultValue: 'Identity and contact details of this tenant, as stored in the schools table.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={school.reload}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <button className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={save}
              disabled={!mayEdit || saving || !dirty}>
              <Save size={14} /> {saving ? '…' : t('common.save')}
            </button>
          </>
        )}
      />

      {school.error && (
        <div className="card-soft mb-3">
          <EmptyState icon={ShieldAlert} title={t('common.error')} hint={school.error.message} />
        </div>
      )}

      {!mayEdit && (
        <div className="alert alert-secondary small py-2">
          {t('sections.profileReadOnly', { defaultValue: 'You can read the profile (school.view) but saving needs school.edit — the fields below are locked.' })}
        </div>
      )}

      <div className="row g-3">
        <div className="col-12 col-xl-7">
          <div className="card-soft p-3">
            <div className="fw-semibold mb-3"><Building2 size={15} className="me-1" /> {t('sections.identity', { defaultValue: 'Identity & contact' })}</div>
            <div className="row">
              {fields.map((f) => (
                <Field key={f.name} field={f} value={values[f.name]} error={errors[f.name]} disabled={!mayEdit || saving}
                  onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))} />
              ))}
            </div>
            <div className="small text-muted">
              {t('sections.patchNote', { defaultValue: 'Only changed fields are sent. status, registration_number and id are server-managed and are not patchable through this endpoint.' })}
            </div>
          </div>
        </div>

        <div className="col-12 col-xl-5">
          <LogoCard school={row} mayEdit={mayEdit} onChanged={() => { school.reload(); refresh(); }} />

          <div className="card-soft p-3 mt-3">
            <div className="fw-semibold mb-2">{t('sections.serverManaged', { defaultValue: 'Server-managed facts' })}</div>
            <div className="row g-2 small">
              <Fact label={t('common.status')} value={<StatusBadge value={row.status} />} />
              <Fact label={t('sections.country', { defaultValue: 'Country' })} value={row.country || '—'} />
              <Fact label={t('sections.registrationNumber', { defaultValue: 'Registration number' })} value={row.registration_number || '—'} />
              <Fact label={t('sections.schoolId', { defaultValue: 'School id' })} value={<span className="text-break">{row.id || profile?.school?.id || '—'}</span>} />
              <Fact label={t('sections.createdOn', { defaultValue: 'Created' })} value={<span><CalendarClock size={13} className="me-1" />{dateTime(row.created_at)}</span>} />
              <Fact label={t('sections.updatedOn', { defaultValue: 'Last update' })} value={dateTime(row.updated_at)} />
            </div>
            <div className="small text-muted mt-2">
              {t('sections.statusValues', { defaultValue: 'schools.status is one of pending_approval, trial, active, past_due, suspended, expired, cancelled, archived and is changed by the platform team, not here.' })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Fact({ label, value }) {
  return (
    <div className="col-6">
      <div className="text-muted">{label}</div>
      <div className="fw-semibold">{value ?? '—'}</div>
    </div>
  );
}

/** Uploads the school crest; the API stores it in public storage and updates schools.logo_url. */
function LogoCard({ school, mayEdit, onChanged }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const upload = async (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(t('sections.logoType', { defaultValue: 'Choose a JPG, PNG or WebP image.' }));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(t('sections.logoTooLarge', { defaultValue: 'That file is larger than 2 MB — resize it and try again.' }));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      await apiUpload('/school/logo', body);
      toast.success(t('sections.logoSaved', { defaultValue: 'School logo updated — it now appears across every dashboard.' }));
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await apiDelete('/school/logo');
      toast.success(t('sections.logoRemoved', { defaultValue: 'School logo removed. The E-MADAARIS mark is shown instead.' }));
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="card-soft p-3 mb-3">
      <div className="fw-semibold mb-2 d-flex align-items-center gap-1">
        <ImagePlus size={15} /> {t('sections.brandLogo', { defaultValue: 'School logo' })}
      </div>
      <div className="d-flex align-items-center justify-content-center mb-3"
        style={{ minHeight: 108, border: '1px solid var(--line)', borderRadius: 14, background: '#fff', padding: '12px 16px' }}>
        <BrandLogo school={school} alt={t('sections.logoAlt', { defaultValue: 'School logo' })} />
      </div>
      <div className="d-flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1"
          disabled={!mayEdit || busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {busy
            ? t('common.loading')
            : school.logo_url
              ? t('sections.replaceLogo', { defaultValue: 'Replace logo' })
              : t('sections.uploadLogo', { defaultValue: 'Upload logo' })}
        </button>
        {school.logo_url && (
          <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
            disabled={!mayEdit || busy} onClick={remove}>
            <Trash2 size={14} /> {t('sections.removeLogo', { defaultValue: 'Remove' })}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
        onChange={(e) => upload(e.target.files?.[0])} />
      <div className="form-text mt-2">
        {t('sections.logoUploadHint', { defaultValue: 'JPG, PNG or WebP · up to 2 MB. Use a wide wordmark or a square crest on a plain background. The logo also appears in the sidebar, the top bar and on student dashboards.' })}
      </div>
      {!mayEdit && (
        <div className="small text-muted mt-1">
          {t('sections.logoEditNeeds', { defaultValue: 'Changing the logo needs the school.edit permission.' })}
        </div>
      )}
      {error && <div className="text-danger small mt-2">{error}</div>}
    </div>
  );
}
