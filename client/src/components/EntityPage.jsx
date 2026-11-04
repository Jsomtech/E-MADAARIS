import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Plus, Download, Search, RefreshCw, Loader2, School, Trash2, FileSpreadsheet, ListPlus, X } from 'lucide-react';
import DataTable from './ui/DataTable.jsx';
import Field, { buildPayload } from './ui/Field.jsx';
import { Modal, ConfirmDialog } from './ui/Modal.jsx';
import { PageHeader, Spinner } from './ui/Basics.jsx';
import StudentFormModal from '../pages/school/StudentFormModal.jsx';
import StudentImportModal from './students/StudentImportModal.jsx';
import { useApi } from '../hooks/useApi.js';
import { apiGet, apiPost, apiPatch, apiDelete, downloadFile } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { humanize, resourceConfig } from '../config/resources.jsx';

const optionCache = new Map();

const blankSubjectRow = () => ({ name: '', code: '' });
const blankSubjectRows = () => [blankSubjectRow(), blankSubjectRow(), blankSubjectRow()];

/** Trim + upper-case the codes, drop untouched rows, and let the unique index catch duplicates. */
function filledSubjectRows(rows) {
  return rows
    .map((row) => ({ name: row.name.trim().slice(0, 96), code: row.code.trim().slice(0, 32).toUpperCase() }))
    .filter((row) => row.name);
}

/** Drop cached relation options so a newly created/edited row shows up immediately. */
export function invalidateOptionCache() { optionCache.clear(); }

/**
 * Options for a relation select. `source` may be a bare resource key or an absolute API path.
 * The cache key includes the tenant scope: two schools signing in on the same browser must
 * never see each other's classes, sections or teachers.
 */
async function loadOptions(scope, source, labelKey) {
  const path = source.startsWith('/') ? source : `/${source}`;
  const key = `${scope}:${path}`;
  if (optionCache.has(key)) return optionCache.get(key);
  const promise = apiGet(path, { pageSize: 300 }).then((body) => {
    const rows = Array.isArray(body.data) ? body.data : (body.data?.rows || []);
    return rows.map((r) => ({ value: r.id, label: r[labelKey] || r.name || r.full_name || r.title || r.id }));
  });
  optionCache.set(key, promise);
  promise.catch(() => optionCache.delete(key));
  return promise;
}

/** Tenant-safe class/section strip shown above every portal page. */
function PortalScopeBanner({ students }) {
  if (!students.length) return null;
  return (
    <div className="portal-scope-banner card-soft px-3 py-2 mb-3 d-flex flex-wrap align-items-center gap-2">
      <School size={16} />
      {students.map((s) => (
        <span key={s.id} className="d-inline-flex align-items-center gap-1 small">
          <strong>{s.full_name || `${s.first_name} ${s.last_name || ''}`.trim()}</strong>
          <span className="text-muted">·</span>
          <span>{s.classes?.name || 'No class'}</span>
          {s.sections?.name ? <span className="text-muted">· Section {s.sections.name}</span> : null}
        </span>
      ))}
    </div>
  );
}

export default function EntityPage({ config, title, subtitle, defaultFilters = {}, lockFilters = {}, exportType: exportTypeProp }) {
  const exportType = exportTypeProp || config.exportType;
  const { t } = useTranslation();
  const { can, profile } = useAuth();
  const tenantScope = profile?.schoolId || `platform:${profile?.userId || 'anonymous'}`;
  const roles = profile?.roles?.length ? profile.roles : [profile?.primaryRole].filter(Boolean);
  const isPortalAccount = roles.length > 0 && roles.every((r) => r === 'student' || r === 'parent');
  const portal = useApi('/school/me/students', undefined, isPortalAccount);
  const portalStudents = portal.data || [];
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ ...defaultFilters });
  const [editing, setEditing] = useState(null); // null | {} (create) | row
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearText, setClearText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [options, setOptions] = useState({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState(blankSubjectRows);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const subjectMode = config.key === 'subjects';
  // Students open the same guided registration form as the admissions desk, so school admins
  // and registrars see one consistent flow instead of the raw column form.
  const studentMode = config.key === 'students';
  const [studentForm, setStudentForm] = useState({ open: false, row: null });
  const [importOpen, setImportOpen] = useState(false);
  const studentFormOpen = studentMode && studentForm.open;
  const studentYears = useApi('/school/students/academic-years', undefined, studentFormOpen);
  const studentClasses = useApi('/classes', { pageSize: 200 }, studentFormOpen);

  const params = useMemo(() => ({
    page, pageSize: 25, q: search || undefined,
    ...lockFilters, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v != null)),
  }), [page, search, filters, lockFilters]);

  const list = useApi(config.api, params);
  const readonly = Boolean(config.readonly);
  // Mirrors the server guard: timetable resources also accept school.edit so admins whose
  // role predates the timetable.manage grant can still write.
  const manages = can(`${config.perm}.manage`)
    || (config.perm === 'timetable' && can('school.edit'));
  const canCreate = !readonly && (manages || can(`${config.perm}.create`));
  const canEdit = !readonly && (manages || can(`${config.perm}.edit`));
  const canDelete = !readonly && (manages || can(`${config.perm}.delete`));
  // The bulk endpoint clears the whole table, so never offer it while the list is narrowed
  // by a search or filter — the visible rows would understate what is about to be deleted.
  const narrowed = Boolean(search)
    || Object.values(filters).some((v) => v !== '' && v != null)
    || Object.values(lockFilters || {}).some((v) => v !== '' && v != null);
  const canBulkClear = canDelete && !isPortalAccount && !narrowed && (list.total ?? 0) > 0;

  useEffect(() => {
    const id = setTimeout(() => setSearch(query), 350);
    return () => clearTimeout(id);
  }, [query]);

  // A different school must never reuse the previous tenant's cached relation rows.
  useEffect(() => { invalidateOptionCache(); }, [tenantScope]);

  // Relation selects are populated lazily, once per field source.
  useEffect(() => {
    let alive = true;
    const sources = [
      ...(config.fields || []).filter((f) => f.type === 'relation').map((f) => [f.name, f.resource, f.labelKey]),
      ...Object.entries(config.filter || {})
        .filter(([name, key]) => !Array.isArray(key) && !config.fields?.some((f) => f.name === name) && (key.startsWith('/') || resourceConfig(key)))
        .map(([name, key]) => [name, key, 'name']),
    ];
    Promise.all(sources.map(([name, resource, labelKey]) => loadOptions(tenantScope, resource, labelKey).then((opts) => [name, opts], () => [name, []])))
      .then((pairs) => { if (alive) setOptions(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [config, tenantScope]);

  // Raw FK columns fall back to the loaded relation labels, so a portal never shows a UUID.
  const displayColumns = useMemo(() => (config.columns || []).map((c) => {
    if (c.render || !options[c.key]) return c;
    return {
      ...c,
      render: (row) => {
        const value = row[c.key];
        if (value === null || value === undefined || value === '') return <span className="text-muted">—</span>;
        const match = options[c.key].find((o) => o.value === value);
        return match?.label || String(value);
      },
    };
  }), [config.columns, options]);

  const openCreate = () => {
    if (studentMode) { setStudentForm({ open: true, row: null }); return; }
    const initial = { ...lockFilters, ...filters };
    for (const f of config.fields || []) if (initial[f.name] === undefined) initial[f.name] = f.type === 'checkbox' ? false : '';
    setValues(initial); setErrors({}); setEditing({});
  };
  const openEdit = (row) => {
    if (studentMode) { setStudentForm({ open: true, row }); return; }
    const initial = {};
    for (const f of config.fields || []) initial[f.name] = row[f.name] ?? (f.type === 'checkbox' ? false : '');
    setValues(initial); setErrors({}); setEditing(row);
  };

  const submit = useCallback(async () => {
    const missing = {};
    for (const f of config.fields || []) {
      if (f.required && (values[f.name] === '' || values[f.name] == null)) missing[f.name] = t('common.required');
    }
    setErrors(missing);
    if (Object.keys(missing).length) return;

    setBusy(true);
    try {
      const payload = buildPayload(config.fields || [], values);
      if (editing?.id) { await apiPatch(`${config.api}/${editing.id}`, payload); }
      else { await apiPost(config.api, payload); }
      toast.success(t('common.saved'));
      invalidateOptionCache();
      setEditing(null);
      list.reload();
    } catch (error) {
      toast.error(error.message);
      if (Array.isArray(error.details)) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.field, d.message])));
      }
    } finally { setBusy(false); }
  }, [config, values, editing, list, t]);

  const openBulk = () => { setBulkRows(blankSubjectRows()); setBulkResult(null); setBulkOpen(true); };
  const closeBulk = () => { setBulkOpen(false); setBulkRows(blankSubjectRows()); setBulkResult(null); };
  const setBulkField = (index, name, value) => setBulkRows((prev) => prev.map((row, i) => (
    i === index ? { ...row, [name]: value } : row
  )));
  const addBulkRow = () => setBulkRows((prev) => [...prev, blankSubjectRow()]);
  const removeBulkRow = (index) => setBulkRows((prev) => (
    prev.length === 1 ? [blankSubjectRow()] : prev.filter((_, i) => i !== index)
  ));

  const submitBulk = useCallback(async () => {
    const rows = filledSubjectRows(bulkRows);
    if (!rows.length) return;
    setBulkBusy(true);
    let created = 0;
    let duplicates = 0;
    const failures = [];
    for (const row of rows) {
      try {
        await apiPost(config.api, { name: row.name, ...(row.code ? { code: row.code } : {}) });
        created += 1;
      } catch (error) {
        // 409 is the (school_id, name) unique constraint — the subject is already there.
        if (error.status === 409) duplicates += 1;
        else failures.push(`${row.name}: ${error.message}`);
      }
    }
    setBulkBusy(false);
    if (created) { invalidateOptionCache(); list.reload(); }
    if (failures.length) {
      setBulkResult({ created, duplicates, failures });
      return;
    }
    toast.success(t('sections.subjectsBulkDone', {
      defaultValue: 'Added {{created}} subjects{{dupes}}.',
      created,
      dupes: duplicates
        ? ` · ${t('sections.subjectsBulkSkipped', { defaultValue: '{{count}} already existed', count: duplicates })}`
        : '',
    }));
    setBulkOpen(false);
    setBulkRows(blankSubjectRows());
  }, [bulkRows, config.api, list, t]);

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await apiDelete(`${config.api}/${confirm.id}`);
      toast.success(t('common.deleted'));
      invalidateOptionCache();
      setConfirm(null);
      list.reload();
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  }, [config, confirm, list, t]);

  const clearAll = useCallback(async () => {
    setClearing(true);
    try {
      const body = await apiPost(`${config.api}/delete-all`, { confirm: clearText });
      toast.success(t('sections.sectionCleared', {
        defaultValue: 'Deleted {{rows}} rows. They stay restorable in the recycle bin.',
        rows: body.data?.rows ?? 0,
      }));
      setClearOpen(false);
      setClearText('');
      invalidateOptionCache();
      list.reload();
    } catch (error) { toast.error(error.message); } finally { setClearing(false); }
  }, [config, clearText, list, t]);

  const filterDefs = Object.entries(config.filter || {});
  const label = (f) => f.label || humanize(f.name);
  const bulkReady = subjectMode ? filledSubjectRows(bulkRows).length : 0;

  if (list.loading && !list.data) return <Spinner label={t('common.loading')} />;

  return (
    <>
      <PageHeader
        title={title || t(`modules.${config.key}`, { defaultValue: humanize(config.key || '') })}
        subtitle={subtitle}
        actions={(
          <>
            {exportType && can(`${config.perm}.export`) && (
              <button type="button" className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                onClick={() => downloadFile(`/school/reports/${exportType}`, `${exportType}.csv`).catch((e) => toast.error(e.message))}>
                <Download size={14} /> {t('common.export')}
              </button>
            )}
            {studentMode && canCreate && (
              <>
                <button type="button" className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                  onClick={() => downloadFile('/school/students/import-template?format=xlsx', 'student-import-template.xlsx')
                    .catch((e) => toast.error(e.message))}>
                  <Download size={14} /> {t('sections.template', { defaultValue: 'Template' })}
                </button>
                <button type="button" className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                  onClick={() => setImportOpen(true)}>
                  <FileSpreadsheet size={14} /> {t('sections.import', { defaultValue: 'Import' })}
                </button>
              </>
            )}
            <button className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1" onClick={list.reload}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            {canBulkClear && (
              <button className="btn btn-outline-danger btn-sm d-flex align-items-center gap-1"
                onClick={() => { setClearText(''); setClearOpen(true); }}>
                <Trash2 size={14} /> {t('sections.deleteAll', { defaultValue: 'Delete all' })}
              </button>
            )}
            {subjectMode && canCreate && (
              <button className="btn btn-outline-primary btn-sm d-flex align-items-center gap-1" onClick={openBulk}>
                <ListPlus size={14} /> {t('sections.addManySubjects', { defaultValue: 'Add many' })}
              </button>
            )}
            {canCreate && (
              <button className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={openCreate}>
                <Plus size={14} /> {studentMode
                  ? t('sections.registerStudent', { defaultValue: 'Register student' })
                  : t('common.create')}
              </button>
            )}
          </>
        )}
      />

      <PortalScopeBanner students={portalStudents} />

      <div className="card-soft p-2 mb-3">
        <div className="row g-2 align-items-end">
          <div className="col-12 col-md-4">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-white"><Search size={14} /></span>
              <input className="form-control" placeholder={config.search ? `Search ${config.search.replace(/_/g, ' ')}…` : t('common.search')}
                value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
            </div>
          </div>
          {filterDefs.map(([field, spec]) => {
            const asOptions = (list) => list.map((o) => (typeof o === 'string' ? { value: o, label: humanize(o) } : o));
            const choices = Array.isArray(spec) ? asOptions(spec)
              : (options[field] || asOptions(config.fields?.find((f) => f.name === field)?.options || []));
            if (!choices.length) return null;
            const isRelation = typeof spec === 'string' && (spec.startsWith('/') || Boolean(resourceConfig(spec)));
            const noun = humanize(field.replace(/_id$/, ''));
            const allLabel = isRelation
              ? `${t('common.all', { defaultValue: 'All' })} ${(/(s|x|ch|sh)$/i.test(noun) ? `${noun}es` : `${noun}s`).toLowerCase()}`
              : humanize(field);
            return (
              <div className="col-6 col-md-3" key={field}>
                <select className="form-select form-select-sm" value={filters[field] || ''}
                  onChange={(e) => { setFilters((f) => ({ ...f, [field]: e.target.value })); setPage(1); }}>
                  <option value="">{allLabel}</option>
                  {choices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <DataTable
        columns={displayColumns}
        rows={list.data}
        total={list.total}
        page={page}
        onPage={setPage}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        onEdit={canEdit ? openEdit : undefined}
        onDelete={canDelete ? (row) => setConfirm(row) : undefined}
      />

      <Modal open={Boolean(editing)} title={editing?.id ? t('common.edit') : t('common.create')}
        icon={Plus}
        onClose={() => setEditing(null)}
        footer={(
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={submit} disabled={busy}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              {busy ? t('common.loading') : t('common.save')}
            </button>
          </>
        )}>
        <div className="row">
          {(config.fields || []).map((f) => (
            <Field key={f.name} field={{ ...f, label: label(f) }} value={values[f.name]}
              options={f.type === 'relation' ? options[f.name] : f.options}
              error={errors[f.name]}
              onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))} />
          ))}
        </div>
      </Modal>

      {subjectMode && (
        <Modal open={bulkOpen} title={t('sections.addManySubjects', { defaultValue: 'Add many subjects' })}
          subtitle={t('sections.addManySubjectsHint', {
            defaultValue: 'Fill one row per subject — the same Name and Code fields as Create, just repeated. Existing names are skipped.',
          })}
          icon={ListPlus} onClose={closeBulk}
          footer={(
            <>
              <button type="button" className="btn btn-outline-secondary" onClick={closeBulk}>{t('common.cancel')}</button>
              <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2"
                onClick={submitBulk} disabled={bulkBusy || bulkReady === 0}>
                {bulkBusy ? <Loader2 size={15} className="animate-spin" /> : <ListPlus size={15} />}
                {t('sections.addManySubjectsCount', { defaultValue: 'Create {{count}} subjects', count: bulkReady })}
              </button>
            </>
          )}>
          <div className="row g-2 mb-1">
            <div className="col-7 small text-muted">{t('sections.name', { defaultValue: 'Name' })}</div>
            <div className="col-4 small text-muted">{t('sections.code', { defaultValue: 'Code' })}</div>
            <div className="col-1" />
          </div>
          <div className="d-flex flex-column gap-2">
            {bulkRows.map((row, index) => (
              <div className="row g-2 align-items-center" key={index}>
                <div className="col-7">
                  <input className="form-control" value={row.name} disabled={bulkBusy}
                    placeholder={t('sections.subjectNamePlaceholder', { defaultValue: 'e.g. Arabic' })}
                    aria-label={`${t('sections.name', { defaultValue: 'Name' })} ${index + 1}`}
                    onChange={(e) => setBulkField(index, 'name', e.target.value)} />
                </div>
                <div className="col-4">
                  <input className="form-control" value={row.code} disabled={bulkBusy} autoComplete="off"
                    placeholder={t('sections.codePlaceholder', { defaultValue: 'ARB' })}
                    aria-label={`${t('sections.code', { defaultValue: 'Code' })} ${index + 1}`}
                    onChange={(e) => setBulkField(index, 'code', e.target.value)} />
                </div>
                <div className="col-1 text-end">
                  <button type="button" className="btn-icon sm" disabled={bulkBusy}
                    aria-label={t('common.delete')} title={t('common.delete')}
                    onClick={() => removeBulkRow(index)}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1 mt-3"
            onClick={addBulkRow} disabled={bulkBusy}>
            <Plus size={14} /> {t('sections.addAnotherSubject', { defaultValue: 'Add another subject' })}
          </button>
          <div className="small text-muted mt-2">
            {t('sections.addManySubjectsReady', {
              defaultValue: '{{count}} subjects ready to create. Names that already exist in this school are skipped.',
              count: bulkReady,
            })}
          </div>
          {bulkResult && (
            <div className="alert alert-warning small mt-3 mb-0">
              <div className="fw-semibold mb-1">
                {t('sections.addManySubjectsPartial', {
                  defaultValue: 'Created {{created}} of {{total}}{{dupes}} — these lines failed:',
                  created: bulkResult.created,
                  total: bulkResult.created + bulkResult.failures.length + bulkResult.duplicates,
                  dupes: bulkResult.duplicates ? ` (${bulkResult.duplicates} already existed)` : '',
                })}
              </div>
              <ul className="mb-0 ps-3">
                {bulkResult.failures.map((message) => <li key={message}>{message}</li>)}
              </ul>
            </div>
          )}
        </Modal>
      )}

      <ConfirmDialog open={Boolean(confirm)} message={t('common.deleteConfirm')} busy={busy}
        onClose={() => setConfirm(null)} onConfirm={remove} />

      <Modal open={clearOpen} title={t('sections.deleteAll', { defaultValue: 'Delete all' })}
        icon={Trash2} size="sm"
        onClose={() => { setClearOpen(false); setClearText(''); }}
        footer={(
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={() => { setClearOpen(false); setClearText(''); }}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-danger d-inline-flex align-items-center gap-2"
              onClick={clearAll} disabled={clearing || clearText.trim().toUpperCase() !== 'DELETE ALL'}>
              {clearing ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              {t('sections.deleteAll', { defaultValue: 'Delete all' })}
            </button>
          </>
        )}>
        <p className="small text-muted">
          {t('sections.deleteAllHint', {
            defaultValue: 'This removes all {{count}} rows in this section for the whole school — not just this page. They are snapshotted into the recycle bin first, so the Super Admin can restore them until that bin entry is purged.',
            count: list.total ?? 0,
          })}
        </p>
        <label className="form-label small fw-semibold" htmlFor="entity-clear-confirm">
          {t('sections.typeDeleteAll', { defaultValue: 'Type “DELETE ALL” to confirm' })}
        </label>
        <input id="entity-clear-confirm" className="form-control" value={clearText} autoComplete="off"
          placeholder="DELETE ALL" onChange={(e) => setClearText(e.target.value)} />
      </Modal>

      {studentMode && (
        <>
          <StudentFormModal
            open={studentForm.open}
            student={studentForm.row}
            years={studentYears.data || []}
            classes={studentClasses.data || []}
            classesLoading={studentClasses.loading || (studentClasses.data === null && !studentClasses.error)}
            defaultYearId={(studentYears.data || []).find((y) => y.is_current)?.id || ''}
            defaultClassId={lockFilters.class_id || filters.class_id || ''}
            mayGuardian={can('guardians.create')}
            onClassesChanged={() => studentClasses.reload()}
            onClose={() => setStudentForm({ open: false, row: null })}
            onImport={() => { setStudentForm({ open: false, row: null }); setImportOpen(true); }}
            onCreated={() => { invalidateOptionCache(); list.reload(); }}
            onSaved={() => { invalidateOptionCache(); list.reload(); }}
          />
          <StudentImportModal
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onImported={() => { invalidateOptionCache(); list.reload(); }}
          />
        </>
      )}
    </>
  );
}
