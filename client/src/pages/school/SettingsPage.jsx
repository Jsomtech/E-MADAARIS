// School settings: GET/PATCH /school/settings (PATCH inserts the row when it is missing).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { BellRing, Layers, Plus, RefreshCw, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPatch } from '../../api/client.js';
import Field from '../../components/ui/Field.jsx';
import { PageHeader, Spinner, ErrorState } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/** Defaults from supabase/migrations/0003_schools.sql (school_settings column defaults). */
const DEFAULTS = {
  academic_year_id: null,
  default_language: 'so',
  currency: 'SOS',
  timezone: 'Africa/Mogadishu',
  school_working_days: ['Sat', 'Sun', 'Mon', 'Tue', 'Wed'],
  grading_configuration: {},
  attendance_configuration: {},
  branding: {},
  // The keys server/src/services/notificationScheduler.js reads; the lead times are its own defaults.
  notification_configuration: { lesson_reminders: false, lesson_lead_minutes: 10, assignment_reminder_hours: 24, subscription_alerts: true },
};

/** school_working_days is text[]; the enum values used across the app start on Saturday. */
const WEEK_DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/**
 * The three jsonb columns are declared `not null default '{}'::jsonb` in 0003_schools.sql and
 * nothing in server/src writes fixed keys into them, so there is no documented key set: we render
 * whatever keys the tenant already has and merge edits back over the original object.
 */
const JSON_GROUPS = [
  { name: 'grading_configuration', titleKey: 'sections.gradingConfig', fallback: 'Grading configuration' },
  { name: 'attendance_configuration', titleKey: 'sections.attendanceConfig', fallback: 'Attendance configuration' },
  { name: 'branding', titleKey: 'sections.branding', fallback: 'Branding' },
];

const humanize = (key) => String(key).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function coerce(original, text) {
  if (typeof original === 'number') {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  if (typeof original === 'boolean') return text === 'true';
  if (original !== null && typeof original === 'object') {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text;
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const settings = useApi('/school/settings');
  const years = useApi('/academic-years', { pageSize: 200 });
  const [values, setValues] = useState(null);
  const [saving, setSaving] = useState(false);

  const mayEdit = can('school.edit');

  useEffect(() => {
    if (!settings.data) { setValues({ ...DEFAULTS }); return; }
    const row = settings.data;
    setValues({
      academic_year_id: row.academic_year_id || '',
      default_language: row.default_language ?? DEFAULTS.default_language,
      currency: row.currency ?? DEFAULTS.currency,
      timezone: row.timezone ?? DEFAULTS.timezone,
      school_working_days: Array.isArray(row.school_working_days) ? row.school_working_days : [...DEFAULTS.school_working_days],
      grading_configuration: row.grading_configuration || {},
      attendance_configuration: row.attendance_configuration || {},
      branding: row.branding || {},
      notification_configuration: { ...DEFAULTS.notification_configuration, ...(row.notification_configuration || {}) },
    });
  }, [settings.data]);

  const yearOptions = useMemo(() => (years.data || []).map((y) => ({
    value: y.id,
    label: `${y.name}${y.is_current ? ` — ${t('sections.currentYear', { defaultValue: 'current' })}` : ''}`,
  })), [years.data, t]);

  // GET /school/settings answers select('*'): a tenant whose database has not run migration 0025 has no
  // key at all, and sending one would fail the whole save rather than just this card.
  const hasNotificationColumn = !settings.data || settings.data.notification_configuration !== undefined;

  const set = useCallback((patch) => setValues((prev) => ({ ...(prev || DEFAULTS), ...patch })), []);

  const setNotify = useCallback((key, value) => {
    setValues((prev) => ({
      ...(prev || DEFAULTS),
      notification_configuration: { ...DEFAULTS.notification_configuration, ...(prev?.notification_configuration || {}), [key]: value },
    }));
  }, []);

  const toggleDay = useCallback((day, checked) => {
    setValues((prev) => {
      const current = prev?.school_working_days || [];
      const next = checked ? [...WEEK_DAYS.filter((d) => current.includes(d) || d === day)] : current.filter((d) => d !== day);
      return { ...(prev || DEFAULTS), school_working_days: next };
    });
  }, []);

  const save = useCallback(async () => {
    if (!values) return;
    const payload = {
      academic_year_id: values.academic_year_id ? String(values.academic_year_id) : null,
      default_language: values.default_language,
      currency: String(values.currency || '').trim(),
      timezone: String(values.timezone || '').trim(),
      school_working_days: values.school_working_days,
      grading_configuration: values.grading_configuration,
      attendance_configuration: values.attendance_configuration,
      branding: values.branding,
      ...(hasNotificationColumn ? { notification_configuration: values.notification_configuration } : {}),
    };
    setSaving(true);
    try {
      await apiPatch('/school/settings', payload);
      toast.success(t('sections.settingsSaved', { defaultValue: 'Settings saved.' }));
      settings.reload();
    } catch (error) {
      toast.error(error.status === 403
        ? t('sections.settingsForbidden', { defaultValue: 'Saving school settings needs the school.edit permission.' })
        : (error.details ? JSON.stringify(error.details) : error.message));
    } finally {
      setSaving(false);
    }
  }, [values, settings, hasNotificationColumn, t]);

  if (settings.loading && !settings.data) return <Spinner label={t('common.loading')} />;
  if (settings.error) return <ErrorState error={settings.error} onRetry={settings.reload} />;
  if (!values) return <Spinner label={t('common.loading')} />;

  return (
    <>
      <PageHeader
        title={t('sections.settingsTitle', { defaultValue: 'School settings' })}
        subtitle={t('sections.settingsSubtitle', { defaultValue: 'Academic year, locale, working days and the three free-form jsonb configuration blocks.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={settings.reload}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={() => setValues({ ...DEFAULTS })}>
              <RotateCcw size={14} /> {t('sections.resetDefaults', { defaultValue: 'Reload column defaults' })}
            </button>
            <button className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={save} disabled={!mayEdit || saving}>
              <Save size={14} /> {saving ? '…' : t('common.save')}
            </button>
          </>
        )}
      />

      {!mayEdit && (
        <div className="alert alert-secondary small py-2">
          {t('sections.settingsReadOnly', { defaultValue: 'school.view lets you read these settings; saving needs school.edit.' })}
        </div>
      )}

      <div className="row g-3">
        <div className="col-12 col-xl-6">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-3"><Layers size={15} className="me-1" /> {t('sections.general', { defaultValue: 'General' })}</div>
            <div className="row">
              <Field field={{
                name: 'academic_year_id', type: 'select', col: 12,
                label: t('sections.academicYear', { defaultValue: 'Active academic year' }),
                placeholder: years.loading ? t('common.loading') : t('sections.noYear', { defaultValue: 'No academic year set' }),
                help: t('sections.yearHelp', { defaultValue: 'Listed from GET /academic-years; the row flagged is_current is marked "(current)". Only academic_year_id is stored here.' }),
                options: yearOptions,
              }} value={values.academic_year_id} disabled={!mayEdit || years.error} onChange={(v) => set({ academic_year_id: v })} />
              <Field field={{
                name: 'default_language', type: 'select', col: 6,
                label: t('sections.defaultLanguage', { defaultValue: 'Default language' }),
                options: [
                  { value: 'so', label: t('sections.somali', { defaultValue: 'Somali (so)' }) },
                  { value: 'en', label: t('sections.english', { defaultValue: 'English (en)' }) },
                ],
                help: t('sections.languageHelp', { defaultValue: 'The server enum only accepts so and en.' }),
              }} value={values.default_language} disabled={!mayEdit} onChange={(v) => set({ default_language: v })} />
              <Field field={{
                name: 'currency', col: 6, label: t('sections.currency', { defaultValue: 'Currency' }), placeholder: 'SOS',
                help: t('sections.currencyHelp', { defaultValue: 'Max 8 characters; used as the display suffix for school money values.' }),
              }} value={values.currency} disabled={!mayEdit} onChange={(v) => set({ currency: v })} />
              <Field field={{
                name: 'timezone', col: 12, label: t('sections.timezone', { defaultValue: 'Timezone' }), placeholder: 'Africa/Mogadishu',
                help: t('sections.timezoneHelp', { defaultValue: 'IANA name, max 64 characters. Column default is Africa/Mogadishu.' }),
              }} value={values.timezone} disabled={!mayEdit} onChange={(v) => set({ timezone: v })} />
            </div>

            <div className="mt-2">
              <div className="form-label small fw-semibold mb-1">{t('sections.workingDays', { defaultValue: 'School working days' })}</div>
              <div className="d-flex flex-wrap gap-3">
                {WEEK_DAYS.map((day) => (
                  <div className="form-check" key={day}>
                    <input className="form-check-input" type="checkbox" id={`day-${day}`}
                      checked={values.school_working_days.includes(day)} disabled={!mayEdit}
                      onChange={(e) => toggleDay(day, e.target.checked)} />
                    <label className="form-check-label small" htmlFor={`day-${day}`}>{day}</label>
                  </div>
                ))}
              </div>
              <div className="form-text small">
                {t('sections.workingDaysHelp', { defaultValue: 'Stored as school_working_days text[] — column default {Sat, Sun, Mon, Tue, Wed}. Selected: {{days}}', days: values.school_working_days.join(', ') || t('sections.noneSelected', { defaultValue: 'none' }) })}
              </div>
            </div>
          </div>

          <div className="card-soft p-3 mt-3">
            <div className="fw-semibold mb-1"><BellRing size={15} className="me-1" /> {t('sections.automation', { defaultValue: 'Automated notices' })}</div>
            <div className="small text-muted mb-3">
              {t('sections.automationHelp', { defaultValue: 'What the platform clock may send on this school\'s behalf. A timetable reminder is only read for schools that switched it on, so nothing arrives until you ask.' })}
            </div>
            {!hasNotificationColumn && (
              <div className="alert alert-secondary small py-2 mb-3">
                {t('sections.automationNeedsMigration', { defaultValue: 'This database has no notification_configuration column yet, so these switches are saved nowhere. Apply supabase/migrations/0025_notification_ops.sql to unlock them.' })}
              </div>
            )}
            <div className="row g-3">
              <div className="col-12">
                <div className="form-check form-switch">
                  <input className="form-check-input" type="checkbox" role="switch" id="notify-lessons"
                    checked={Boolean(values.notification_configuration?.lesson_reminders)} disabled={!mayEdit || !hasNotificationColumn}
                    onChange={(e) => setNotify('lesson_reminders', e.target.checked)} />
                  <label className="form-check-label small fw-semibold" htmlFor="notify-lessons">{t('sections.lessonReminders', { defaultValue: 'Remind before each lesson' })}</label>
                </div>
                <div className="form-text small">{t('sections.lessonRemindersHelp', { defaultValue: 'Uses the timezone above as the school\'s own clock, so a period is announced at the right minute in Mogadishu.' })}</div>
              </div>
              <Field field={{
                name: 'lesson_lead_minutes', type: 'number', col: 6,
                label: t('sections.lessonLead', { defaultValue: 'Minutes before the period' }),
                help: t('sections.lessonLeadHelp', { defaultValue: '1–180. Default 10.' }),
              }} value={values.notification_configuration?.lesson_lead_minutes}
              disabled={!mayEdit || !hasNotificationColumn}
              onChange={(v) => setNotify('lesson_lead_minutes', Number(v) || DEFAULTS.notification_configuration.lesson_lead_minutes)} />
              <Field field={{
                name: 'assignment_reminder_hours', type: 'number', col: 6,
                label: t('sections.assignmentLead', { defaultValue: 'Hours before a deadline' }),
                help: t('sections.assignmentLeadHelp', { defaultValue: '1–336. Default 24. Sent once per assignment.' }),
              }} value={values.notification_configuration?.assignment_reminder_hours}
              disabled={!mayEdit || !hasNotificationColumn}
              onChange={(v) => setNotify('assignment_reminder_hours', Number(v) || DEFAULTS.notification_configuration.assignment_reminder_hours)} />
              <div className="col-12">
                <div className="form-check form-switch">
                  <input className="form-check-input" type="checkbox" role="switch" id="notify-subscription"
                    checked={Boolean(values.notification_configuration?.subscription_alerts)} disabled={!mayEdit || !hasNotificationColumn}
                    onChange={(e) => setNotify('subscription_alerts', e.target.checked)} />
                  <label className="form-check-label small fw-semibold" htmlFor="notify-subscription">{t('sections.subscriptionAlerts', { defaultValue: 'Tell staff about plan renewal and expiry' })}</label>
                </div>
                <div className="form-text small">{t('sections.subscriptionAlertsHelp', { defaultValue: 'On unless switched off: renewal, grace period and expiry notices for this school\'s subscription.' })}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-12 col-xl-6">
          {JSON_GROUPS.map((g) => (
            <JsonCard key={g.name} group={g} disabled={!mayEdit}
              value={values[g.name] || {}}
              title={t(g.titleKey, { defaultValue: g.fallback })}
              original={settings.data?.[g.name] || {}}
              onChange={(next) => set({ [g.name]: next })} />
          ))}
          <div className="card-soft p-3 mt-3 small text-muted">
            {t('sections.jsonNote', { defaultValue: 'PATCH /school/settings validates these three columns with z.object({}).passthrough(), so any key you add is stored as-is and the whole column is replaced on save. Keys you did not touch are merged from the stored object first, so nothing is silently dropped.' })}
          </div>
        </div>
      </div>
    </>
  );
}

function JsonCard({ group, title, value, original, disabled, onChange }) {
  const { t } = useTranslation();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState('');

  const keys = Object.keys(value || {});
  const merged = { ...(original || {}), ...(value || {}) };

  const update = (key, raw) => {
    const next = { ...merged };
    next[key] = coerce(original?.[key], raw);
    onChange(next);
  };

  const remove = (key) => {
    const next = { ...merged };
    delete next[key];
    onChange(next);
  };

  const add = () => {
    const key = newKey.trim();
    if (!key) { setError(t('sections.keyRequired', { defaultValue: 'Give the field a name' })); return; }
    if (/^(school_id|id|created_at|updated_at|limits_override)$/.test(key)) {
      setError(t('sections.keyReserved', { defaultValue: 'That key is server-managed and must not be written here.' }));
      return;
    }
    setError('');
    onChange({ ...merged, [key]: newValue.trim() });
    setNewKey('');
    setNewValue('');
  };

  return (
    <div className="card-soft p-3 mb-3">
      <div className="d-flex justify-content-between align-items-start mb-2">
        <div>
          <div className="fw-semibold">{title}</div>
          <div className="small text-muted"><code>{group.name}</code> · jsonb</div>
        </div>
        <span className="badge text-bg-secondary">{keys.length}</span>
      </div>

      {keys.length === 0 && (
        <div className="alert alert-secondary small py-2 mb-2">
          {t('sections.emptyJson', { defaultValue: 'No keys stored yet — the column default in 0003_schools.sql is an empty object, so nothing is invented for you here.' })}
        </div>
      )}

      {keys.map((key) => {
        const current = value[key];
        const isComplex = current !== null && typeof current === 'object';
        return (
          <div className="mb-2" key={key}>
            <label className="form-label small fw-semibold" htmlFor={`${group.name}-${key}`}>
              {humanize(key)} <span className="text-muted fw-normal">({typeof current === 'object' && current !== null ? (Array.isArray(current) ? 'array' : 'object') : typeof current})</span>
            </label>
            <div className="d-flex gap-2">
              {typeof current === 'boolean' ? (
                <select id={`${group.name}-${key}`} className="form-select form-select-sm" disabled={disabled}
                  value={String(current)} onChange={(e) => update(key, e.target.value)}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <textarea id={`${group.name}-${key}`} className="form-control form-control-sm" rows={isComplex ? 3 : 1} disabled={disabled}
                  value={isComplex ? JSON.stringify(current, null, 2) : String(current ?? '')}
                  onChange={(e) => update(key, e.target.value)} />
              )}
              {!disabled && (
                <button className="btn btn-sm btn-outline-danger" type="button" title={t('sections.removeKey', { defaultValue: 'Remove this key' })}
                  onClick={() => remove(key)}><Trash2 size={14} /></button>
              )}
            </div>
          </div>
        );
      })}

      {!disabled && (
        <div className="border-top pt-2 mt-2">
          <div className="small fw-semibold mb-1">{t('sections.addKey', { defaultValue: 'Add a field' })}</div>
          <div className="d-flex gap-2">
            <input className="form-control form-control-sm" placeholder={t('sections.keyNameExample', { defaultValue: 'key_name' })} value={newKey} onChange={(e) => { setNewKey(e.target.value); setError(''); }} />
            <input className="form-control form-control-sm" placeholder={t('sections.valuePlaceholder', { defaultValue: 'value' })} value={newValue} onChange={(e) => setNewValue(e.target.value)} />
            <button className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" type="button" onClick={add}>
              <Plus size={14} /> {t('common.add')}
            </button>
          </div>
          {error && <div className="form-text text-danger small mt-1">{error}</div>}
        </div>
      )}
    </div>
  );
}
