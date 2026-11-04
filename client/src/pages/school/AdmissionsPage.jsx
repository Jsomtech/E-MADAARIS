// Admissions desk: academic year for new IDs, single enrolment, and one-shot Excel import.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  AlertCircle, CalendarDays, CheckCircle2, ClipboardList, Copy,
  FileSpreadsheet, FileText, GraduationCap, KeyRound, Plus, RefreshCw, Search, Star, UploadCloud,
  UserPlus,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiGet, apiPost, apiUpload, downloadFile } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Field from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { PageHeader, StatCard, dateOnly } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import StudentFormModal from './StudentFormModal.jsx';

/** /students is paginated by the CRUD factory with pageSize capped at 200. */
const SCAN_PAGE_SIZE = 200;
const MAX_SCAN_PAGES = 10;

const EMPTY_YEAR = { name: '', start_date: '', end_date: '', makeCurrent: true };

function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

export default function AdmissionsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [formOpen, setFormOpen] = useState(false);
  const [lastCredential, setLastCredential] = useState(null);
  const [credentialCopied, setCredentialCopied] = useState(false);
  const [scan, setScan] = useState({ loading: false, error: null, total: null, thisMonth: null, withoutClass: null, scanned: 0, truncated: false });
  const [recentQuery, setRecentQuery] = useState('');
  const [recentSearch, setRecentSearch] = useState('');
  const [recentPage, setRecentPage] = useState(1);

  const [yearId, setYearId] = useState('');
  const [yearTouched, setYearTouched] = useState(false);
  const [yearBusy, setYearBusy] = useState(false);
  const [yearModal, setYearModal] = useState(false);
  const [newYear, setNewYear] = useState(EMPTY_YEAR);
  const [nextId, setNextId] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [provisionBusy, setProvisionBusy] = useState(false);
  const fileRef = useRef(null);

  const mayCreate = can('students.create');
  const mayGuardian = can('guardians.create');
  const mayManageYears = can('school.edit') || can('timetable.manage');

  const params = useMemo(() => ({
    pageSize: 10,
    q: recentSearch || undefined,
    page: recentPage,
  }), [recentSearch, recentPage]);

  const recent = useApi('/students', params, can('students.view'));
  const classes = useApi('/classes', { pageSize: 200 }, mayCreate);
  const years = useApi('/school/students/academic-years', undefined, mayCreate);

  useEffect(() => {
    const id = setTimeout(() => { setRecentSearch(recentQuery.trim()); setRecentPage(1); }, 350);
    return () => clearTimeout(id);
  }, [recentQuery]);

  // Default the admissions year to the school's current year until the admin picks another.
  const yearOptions = useMemo(() => (years.data || []).map((y) => ({
    value: y.id,
    label: `${y.name}${y.is_current ? ` · ${t('sections.currentYear', { defaultValue: 'current' })}` : ''}`,
  })), [years.data, t]);

  useEffect(() => {
    if (yearTouched || yearId || !years.data?.length) return;
    const pick = years.data.find((y) => y.is_current) || years.data[0];
    if (pick) setYearId(pick.id);
  }, [years.data, yearId, yearTouched]);

  const activeYear = useMemo(() => (years.data || []).find((y) => y.id === yearId) || null, [years.data, yearId]);

  const loadNextId = useCallback(async () => {
    if (!mayCreate) return;
    try {
      const body = await apiGet('/school/students/next-admission-number', { academic_year_id: yearId || undefined });
      setNextId(body.data);
    } catch { setNextId(null); }
  }, [mayCreate, yearId]);

  useEffect(() => { loadNextId(); }, [loadNextId]);

  /**
   * GET /students exposes no counters, so "admitted this month" and "without a class" are
   * counted in the browser by paging the list (pageSize 200, max 10 pages = 2000 rows).
   */
  const runScan = useCallback(async () => {
    setScan((s) => ({ ...s, loading: true, error: null }));
    try {
      const first = await apiGet('/students', { page: 1, pageSize: 1 });
      const total = first.total ?? 0;
      const prefix = monthKey();
      let thisMonth = 0;
      let withoutClass = 0;
      let scanned = 0;
      let truncated = false;
      const pages = Math.min(MAX_SCAN_PAGES, Math.ceil(total / SCAN_PAGE_SIZE) || 1);
      for (let p = 1; p <= pages; p += 1) {
        const body = await apiGet('/students', { page: p, pageSize: SCAN_PAGE_SIZE });
        const rows = body.data || [];
        scanned += rows.length;
        for (const r of rows) {
          const admitted = String(r.admission_date || r.created_at || '').slice(0, 7);
          if (admitted === prefix) thisMonth += 1;
          if (!r.class_id) withoutClass += 1;
        }
        if (p === pages && scanned < total) truncated = true;
      }
      setScan({ loading: false, error: null, total, thisMonth, withoutClass, scanned, truncated });
    } catch (error) {
      setScan((s) => ({ ...s, loading: false, error }));
    }
  }, []);

  useEffect(() => { runScan(); }, [runScan]);

  const activateYear = useCallback(async () => {
    if (!yearId) return;
    setYearBusy(true);
    try {
      const { data } = await apiPost(`/school/academic-years/${yearId}/activate`, {});
      toast.success(t('sections.yearActivated', { defaultValue: '{{name}} is now the academic year for new admissions.', name: data.name }));
      years.reload();
    } catch (error) {
      toast.error(error.message);
    } finally { setYearBusy(false); }
  }, [yearId, years, t]);

  const createYear = useCallback(async () => {
    const name = newYear.name.trim();
    if (name.length < 4) { toast.error(t('sections.yearNameRequired', { defaultValue: 'Enter a year name such as 2026/2027.' })); return; }
    setYearBusy(true);
    try {
      const { data } = await apiPost('/school/academic-years', {
        name,
        start_date: newYear.start_date || null,
        end_date: newYear.end_date || null,
        is_current: Boolean(newYear.makeCurrent),
      });
      toast.success(t('sections.yearCreated', { defaultValue: '{{name}} opened for admissions.', name: data.name }));
      setYearModal(false);
      setNewYear(EMPTY_YEAR);
      setYearTouched(true);
      setYearId(data.id);
      years.reload();
    } catch (error) {
      toast.error(error.message);
    } finally { setYearBusy(false); }
  }, [newYear, years, t]);

  const downloadTemplate = useCallback((format) => {
    const name = format === 'doc' ? 'student-registration-form.doc' : 'student-import-template.xlsx';
    const query = format === 'doc' ? 'doc' : 'xlsx';
    downloadFile(`/school/students/import-template?format=${query}${yearId ? `&academic_year_id=${yearId}` : ''}`, name)
      .catch((error) => toast.error(error.message));
  }, [yearId]);

  const runImport = useCallback(async () => {
    if (!importFile) { toast.info(t('sections.chooseImportFile', { defaultValue: 'Choose the completed Excel file first.' })); return; }
    setImporting(true);
    setImportResult(null);
    try {
      const body = new FormData();
      body.append('file', importFile);
      if (yearId) body.append('academic_year_id', yearId);
      const { data } = await apiUpload('/school/students/import', body);
      setImportResult(data);
      if (data.created) {
        toast.success(t('sections.importDone', { defaultValue: '{{count}} students imported.', count: data.created }));
        setImportFile(null);
        if (fileRef.current) fileRef.current.value = '';
        recent.reload();
        runScan();
        loadNextId();
      } else {
        toast.warn(t('sections.importNone', { defaultValue: 'No rows could be imported — check the row list.' }));
      }
    } catch (error) {
      toast.error(error.details ? JSON.stringify(error.details) : error.message);
    } finally {
      setImporting(false);
    }
  }, [importFile, yearId, recent, runScan, loadNextId, t]);

  const provisionLogins = useCallback(async () => {
    setProvisionBusy(true);
    try {
      const { data } = await apiPost('/school/students/provision-accounts', { limit: 50 });
      if (data.created) {
        toast.success(t('sections.loginsCreated', { defaultValue: '{{count}} student logins created. Each student signs in with their student ID as the password, then sets a new one.', count: data.created }));
        recent.reload();
      } else {
        toast.info(t('sections.loginsNone', { defaultValue: 'Every student already has a login. Nothing to create.' }));
      }
      if (data.failed?.length) {
        toast.warn(t('sections.loginsFailed', { defaultValue: '{{count}} logins could not be created — check the admission numbers.', count: data.failed.length }));
      }
      if (data.remaining) {
        toast.info(t('sections.loginsRemaining', { defaultValue: '{{count}} students still have no login — press the button again.', count: data.remaining }));
      }
    } catch (error) {
      toast.error(error.message);
    } finally { setProvisionBusy(false); }
  }, [recent, t]);

  const copyCredential = useCallback(async () => {
    if (!lastCredential) return;
    try {
      await navigator.clipboard.writeText(
        `${lastCredential.full_name}\nStudent ID: ${lastCredential.admission_number}\nPassword: ${lastCredential.admission_number}`,
      );
      setCredentialCopied(true);
      setTimeout(() => setCredentialCopied(false), 2000);
    } catch { setCredentialCopied(false); }
  }, [lastCredential]);

  const recentColumns = [
    {
      key: 'full_name',
      label: t('sections.student', { defaultValue: 'Student' }),
      render: (row) => (
        <div>
          <div className="fw-semibold small">{row.full_name || `${row.first_name || ''} ${row.last_name || ''}`.trim()}</div>
          <div className="small text-muted">{row.admission_number}</div>
        </div>
      ),
    },
    { key: 'admission_date', label: t('sections.admittedOn', { defaultValue: 'Admitted' }), render: (r) => <span className="small">{dateOnly(r.admission_date)}</span> },
    {
      key: 'class_id',
      label: t('sections.class', { defaultValue: 'Class' }),
      render: (r) => <span className="small">{r.classes?.name || t('sections.unassigned', { defaultValue: 'unassigned' })}</span>,
    },
    { key: 'gender', label: t('sections.gender', { defaultValue: 'Gender' }), render: (r) => <span className="small text-capitalize">{r.gender || '—'}</span> },
    { key: 'status', label: t('common.status'), type: 'status', width: 110 },
  ];

  if (!mayCreate) {
    return (
      <>
        <PageHeader title={t('sections.admissionsTitle', { defaultValue: 'Admissions' })} />
        <div className="card-soft p-3">
          <div className="d-flex align-items-start gap-2">
            <Star size={18} className="text-muted mt-1" />
            <div>
              <div className="fw-semibold">{t('sections.admissionsNoAccess', { defaultValue: 'Enrolment needs students.create' })}</div>
              <div className="small text-muted">{t('sections.admissionsNoAccessHint', { defaultValue: 'Registrar and school admin roles can enrol; teachers and accountants only see the student list.' })}</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('sections.admissionsTitle', { defaultValue: 'Admissions' })}
        subtitle={t('sections.admissionsSubtitle', { defaultValue: 'Enrol a student, import a whole class from Excel, and keep every student ID aligned with the academic year.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={runScan} disabled={scan.loading}>
              <RefreshCw size={14} /> {t('sections.recount', { defaultValue: 'Recount' })}
            </button>
            <button className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" onClick={provisionLogins} disabled={provisionBusy}>
              <KeyRound size={14} /> {provisionBusy ? '…' : t('sections.createLogins', { defaultValue: 'Create student logins' })}
            </button>
          </>
        )}
      />

      {/* Academic year drives every generated student ID. */}
      <div className="card-soft p-3 mb-3">
        <div className="d-flex flex-wrap align-items-end gap-3">
          <div className="flex-grow-1" style={{ minWidth: 260 }}>
            <label className="form-label small fw-semibold mb-1" htmlFor="adm-year">
              <CalendarDays size={14} className="me-1" />
              {t('sections.admissionsYear', { defaultValue: 'Academic year for new admissions' })}
            </label>
            <select id="adm-year" className="form-select form-select-sm" value={yearId}
              disabled={years.loading || !yearOptions.length}
              onChange={(e) => { setYearTouched(true); setYearId(e.target.value); }}>
              {!yearOptions.length && <option value="">{years.loading ? t('common.loading') : t('sections.noYear', { defaultValue: 'No academic year yet' })}</option>}
              {yearOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div className="form-text">
              {activeYear ? (
                <>
                  {t('sections.idPreview', { defaultValue: 'Next student ID for {{year}}', year: activeYear.name })}:{' '}
                  <code>{nextId?.admission_number || '—'}</code>
                  {' '}({nextId?.prefix}{nextId?.year_code} + {t('sections.sequence', { defaultValue: '4-digit sequence' })})
                </>
              ) : t('sections.createYearHint', { defaultValue: 'Create an academic year to open admissions.' })}
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            {mayManageYears && activeYear && !activeYear.is_current && (
              <button className="btn btn-sm btn-outline-primary" onClick={activateYear} disabled={yearBusy}>
                {yearBusy ? '…' : t('sections.setCurrentYear', { defaultValue: 'Set as current' })}
              </button>
            )}
            {mayManageYears && (
              <button className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={() => setYearModal(true)}>
                <Plus size={14} /> {t('sections.newYear', { defaultValue: 'New year' })}
              </button>
            )}
          </div>
        </div>
        {years.error && <div className="text-danger small mt-2">{years.error.message}</div>}
      </div>

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-4">
          <StatCard label={t('sections.totalStudents', { defaultValue: 'Students on record' })} value={scan.total ?? '…'} icon={GraduationCap}
            hint={t('sections.totalHint', { defaultValue: 'all statuses' })} />
        </div>
        <div className="col-6 col-lg-4">
          <StatCard label={t('sections.admittedMonth', { defaultValue: 'Admitted this month' })} value={scan.thisMonth ?? '…'} icon={UserPlus}
            hint={monthKey()} />
        </div>
        <div className="col-12 col-lg-4">
          <StatCard label={t('sections.noClass', { defaultValue: 'Students without a class' })} value={scan.withoutClass ?? '…'} icon={ClipboardList}
            hint={t('sections.noClassHint', { defaultValue: 'assign them from the Students module' })} />
        </div>
      </div>
      {scan.error && <div className="text-danger small mb-2">{scan.error.message}</div>}

      <div className="row g-3">
        <div className="col-12 col-xl-7">
          <div className="card-soft p-3 mb-3">
            <div className="d-flex flex-wrap align-items-start gap-3">
              <span className="feature-icon"><UserPlus size={18} /></span>
              <div className="flex-grow-1" style={{ minWidth: 220 }}>
                <div className="fw-semibold">{t('sections.addNewStudent', { defaultValue: 'Add New Student' })}</div>
                <div className="small text-muted">
                  {t('sections.addNewStudentHint', { defaultValue: 'Guided registration: student details, guarantor (damiin) and additional notes. The student ID and first password are generated automatically.' })}
                </div>
                <div className="small text-muted mt-1">
                  {t('sections.nextStudentId', { defaultValue: 'Next student ID' })}: <code>{nextId?.admission_number || '—'}</code>
                  {activeYear ? ` · ${activeYear.name}` : ''}
                </div>
              </div>
              <button className="btn btn-primary d-inline-flex align-items-center gap-1"
                onClick={() => { setLastCredential(null); setFormOpen(true); }} disabled={!yearId}>
                <Plus size={15} /> {t('sections.registerStudent', { defaultValue: 'Register student' })}
              </button>
            </div>
            {!yearId && (
              <div className="alert alert-warning small py-2 mt-2 mb-0">
                {t('sections.selectYearFirst', { defaultValue: 'Select or open an academic year before registering a student.' })}
              </div>
            )}
          </div>

          {lastCredential && (
            <div className="credential-card mb-3">
              <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                <div>
                  <div className="fw-semibold d-flex align-items-center gap-1">
                    <KeyRound size={15} /> {t('sections.loginDetails', { defaultValue: 'Student login' })}
                  </div>
                  <div className="small text-muted">
                    {t('sections.loginIssuedFor', { defaultValue: '{{name}} · issued just now', name: lastCredential.full_name })}
                  </div>
                </div>
                <button type="button" className="btn-close" aria-label={t('common.close')} onClick={() => setLastCredential(null)} />
              </div>
              <div className="credential-row">
                <span className="small text-muted">{t('sections.studentId', { defaultValue: 'Student ID' })}</span>
                <span className="credential-value">{lastCredential.admission_number}</span>
              </div>
              <div className="credential-row">
                <span className="small text-muted">{t('sections.password', { defaultValue: 'Password' })}</span>
                <span className="credential-value">{lastCredential.admission_number}</span>
              </div>
              <div className="d-flex flex-wrap align-items-center gap-2">
                <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={copyCredential}>
                  <Copy size={13} /> {credentialCopied ? t('sections.copied', { defaultValue: 'Copied' }) : t('sections.copyLogin', { defaultValue: 'Copy login details' })}
                </button>
                <span className="small text-muted">
                  {t('sections.loginIssuedHelp', { defaultValue: 'The student signs in with this ID, then can set a new password.' })}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="col-12 col-xl-5">
          <div className="card-soft p-3 mb-3">
            <div className="d-flex justify-content-between align-items-start mb-1">
              <div className="fw-semibold"><UploadCloud size={15} className="me-1" /> {t('sections.importStudents', { defaultValue: 'Import all students' })}</div>
              {activeYear && <span className="badge text-bg-light">{activeYear.name}</span>}
            </div>
            <div className="small text-muted mb-2">
              {t('sections.importHint', { defaultValue: 'Download a template, fill it, upload it once. Every row uses {{year}} for its student ID.', year: activeYear?.name || t('sections.noYear', { defaultValue: 'the selected year' }) })}
            </div>
            <div className="d-flex flex-wrap gap-2 mb-2">
              <button className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" onClick={() => downloadTemplate('xlsx')}>
                <FileSpreadsheet size={14} /> {t('sections.excelTemplate', { defaultValue: 'Excel template' })}
              </button>
              <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={() => downloadTemplate('doc')}>
                <FileText size={14} /> {t('sections.wordTemplate', { defaultValue: 'Word form' })}
              </button>
            </div>
            <input ref={fileRef} type="file" className="form-control form-control-sm" accept=".xlsx,.xlsm,.csv"
              onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportResult(null); }} />
            <button className="btn btn-primary btn-sm w-100 mt-2 d-inline-flex align-items-center justify-content-center gap-1"
              disabled={!importFile || importing} onClick={runImport}>
              <UploadCloud size={14} /> {importing ? t('common.loading') : t('sections.startImport', { defaultValue: 'Import students' })}
            </button>
            {importResult && (
              <div className={`alert ${importResult.created ? 'alert-success' : 'alert-warning'} small py-2 mt-2 mb-0`}>
                <div className="fw-semibold d-flex align-items-center gap-1">
                  {importResult.created ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  {t('sections.importSummary', { defaultValue: '{{created}} imported · {{failed}} skipped', created: importResult.created, failed: importResult.failed })}
                </div>
                {importResult.errors?.length > 0 && (
                  <details className="mt-1">
                    <summary className="text-danger">{t('sections.importErrors', { defaultValue: '{{count}} rows need attention', count: importResult.errors.length })}</summary>
                    <ul className="mb-0 ps-3 mt-1">
                      {importResult.errors.slice(0, 50).map((err, index) => (
                        <li key={index}>{t('sections.rowNumber', { defaultValue: 'Row' })} {err.row}: {err.message}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>

          <div className="card-soft p-2 mb-2">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-white"><Search size={14} /></span>
              <input className="form-control" value={recentQuery} onChange={(e) => setRecentQuery(e.target.value)}
                placeholder={t('sections.searchRecent', { defaultValue: 'Search names or admission number…' })} />
            </div>
          </div>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="fw-semibold"><Star size={15} className="me-1" /> {t('sections.recentAdmissions', { defaultValue: 'Recent admissions' })}</div>
            <Link to="/m/students" className="small">{t('common.viewAll')}</Link>
          </div>
          <DataTable columns={recentColumns} rows={recent.data} total={recent.total} page={recentPage} pageSize={10} onPage={setRecentPage}
            loading={recent.loading} error={recent.error} onRetry={recent.reload} dense
            empty={t('sections.noStudentsYet', { defaultValue: 'No students enrolled yet' })} />
          {!can('students.view') && <div className="small text-warning mt-1">{t('sections.recentHidden', { defaultValue: 'The recent list is empty for you: reading /students needs students.view.' })}</div>}
        </div>
      </div>

      <StudentFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        years={years.data || []}
        defaultYearId={yearId}
        classes={classes.data || []}
        classesLoading={classes.loading || (classes.data === null && !classes.error)}
        mayGuardian={mayGuardian}
        onClassesChanged={() => classes.reload()}
        onCreated={(student) => {
          setLastCredential(student);
          recent.reload();
          runScan();
          loadNextId();
        }}
      />

      <Modal open={yearModal} size="md"
        title={t('sections.newYearTitle', { defaultValue: 'Open a new academic year' })}
        onClose={() => setYearModal(false)}
        footer={(
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setYearModal(false)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={createYear} disabled={yearBusy}>
              {yearBusy ? '…' : t('sections.openYear', { defaultValue: 'Open year' })}
            </button>
          </>
        )}>
        <div className="row">
          <Field field={{
            name: 'year_name', required: true, col: 12,
            label: t('sections.yearName', { defaultValue: 'Year name' }),
            placeholder: '2026/2027',
            help: t('sections.yearNameHelp', { defaultValue: 'Include both years. The first year sets the two digits in every new student ID.' }),
          }} value={newYear.name} onChange={(v) => setNewYear((s) => ({ ...s, name: v }))} />
          <Field field={{ name: 'year_start', type: 'date', col: 6, label: t('sections.startDate', { defaultValue: 'Start date' }) }}
            value={newYear.start_date} onChange={(v) => setNewYear((s) => ({ ...s, start_date: v }))} />
          <Field field={{ name: 'year_end', type: 'date', col: 6, label: t('sections.endDate', { defaultValue: 'End date' }) }}
            value={newYear.end_date} onChange={(v) => setNewYear((s) => ({ ...s, end_date: v }))} />
          <Field field={{
            name: 'year_current', type: 'checkbox', col: 12,
            checkLabel: t('sections.openAdmissionsNow', { defaultValue: 'Open admissions in this year (set as current)' }),
          }} value={newYear.makeCurrent} onChange={(v) => setNewYear((s) => ({ ...s, makeCurrent: v }))} />
        </div>
      </Modal>
    </>
  );
}
