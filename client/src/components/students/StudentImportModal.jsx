// Shared admissions import: the same Excel/CSV workflow for school admins and registrars.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  AlertCircle, CalendarDays, CheckCircle2, FileSpreadsheet, FileText, Loader2,
  UploadCloud, X,
} from 'lucide-react';
import { apiUpload, downloadFile } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { Modal } from '../ui/Modal.jsx';

const MAX_BYTES = 5 * 1024 * 1024;

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StudentImportModal({ open, onClose, onImported }) {
  const { t } = useTranslation();
  const years = useApi('/school/students/academic-years', undefined, open);
  const [yearId, setYearId] = useState('');
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  // Default to the school's current academic year, the same default the admissions desk uses.
  useEffect(() => {
    if (!open || yearId || !years.data?.length) return;
    const pick = years.data.find((y) => y.is_current) || years.data[0];
    if (pick) setYearId(pick.id);
  }, [open, yearId, years.data]);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setResult(null);
    setDragging(false);
    if (inputRef.current) inputRef.current.value = '';
  }, [open]);

  const chooseFile = useCallback((next) => {
    if (!next) return;
    if (!/\.(xlsx|xlsm|csv)$/i.test(next.name)) {
      toast.error(t('sections.importTypeError', { defaultValue: 'Choose an .xlsx, .xlsm or .csv file.' }));
      return;
    }
    if (next.size > MAX_BYTES) {
      toast.error(t('sections.importTooLarge', { defaultValue: 'That file is larger than 5 MB — split it into smaller files.' }));
      return;
    }
    setFile(next);
    setResult(null);
  }, [t]);

  const download = useCallback(async (format) => {
    setDownloading(format);
    try {
      const filename = format === 'doc' ? 'student-registration-form.doc' : 'student-import-template.xlsx';
      const suffix = yearId ? `&academic_year_id=${encodeURIComponent(yearId)}` : '';
      await downloadFile(`/school/students/import-template?format=${format}${suffix}`, filename);
    } catch (error) {
      toast.error(error.message);
    } finally { setDownloading(''); }
  }, [yearId]);

  const runImport = useCallback(async () => {
    if (!file) {
      toast.info(t('sections.chooseImportFile', { defaultValue: 'Choose the completed Excel file first.' }));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append('file', file);
      if (yearId) body.append('academic_year_id', yearId);
      const { data } = await apiUpload('/school/students/import', body);
      setResult(data);
      if (data.created) {
        toast.success(t('sections.importDone', { defaultValue: '{{count}} students imported.', count: data.created }));
        setFile(null);
        if (inputRef.current) inputRef.current.value = '';
        onImported?.(data);
      } else {
        toast.warn(t('sections.importNone', { defaultValue: 'No rows could be imported — check the row list.' }));
      }
    } catch (error) {
      toast.error(error.details ? JSON.stringify(error.details) : error.message);
    } finally { setBusy(false); }
  }, [file, yearId, onImported, t]);

  const activeYear = (years.data || []).find((y) => y.id === yearId) || null;

  return (
    <Modal
      open={open}
      size="lg"
      icon={UploadCloud}
      title={t('sections.importStudents', { defaultValue: 'Import students' })}
      subtitle={t('sections.importModalSubtitle', { defaultValue: 'Fill the template and upload it once — Excel and CSV are both accepted.' })}
      onClose={busy ? undefined : onClose}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={busy}>
            {t('common.close')}
          </button>
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2"
            onClick={runImport} disabled={!file || busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
            {busy ? t('common.loading') : t('sections.startImport', { defaultValue: 'Import students' })}
          </button>
        </>
      )}
    >
      <div className="student-import">
        <section className="import-step">
          <div className="import-step-head">
            <span className="import-step-index">1</span>
            <div>
              <div className="fw-semibold">{t('sections.importStepDownload', { defaultValue: 'Download the template' })}</div>
              <div className="small text-muted">
                {t('sections.importStepDownloadHelp', { defaultValue: 'The Excel template already has the correct columns, date formats and an example sheet. The Word form is for collecting details on paper.' })}
              </div>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
              onClick={() => download('xlsx')} disabled={Boolean(downloading)}>
              {downloading === 'xlsx' ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
              {t('sections.excelTemplate', { defaultValue: 'Excel template' })}
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
              onClick={() => download('doc')} disabled={Boolean(downloading)}>
              {downloading === 'doc' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              {t('sections.wordTemplate', { defaultValue: 'Word form' })}
            </button>
          </div>
        </section>

        <section className="import-step">
          <div className="import-step-head">
            <span className="import-step-index">2</span>
            <div className="flex-grow-1">
              <div className="fw-semibold">{t('sections.importStepUpload', { defaultValue: 'Upload the completed file' })}</div>
              <div className="small text-muted">
                {t('sections.importStepUploadHelp', { defaultValue: 'Leave the admission number blank to generate it automatically. Class and section names must match the school’s existing classes.' })}
              </div>
            </div>
          </div>

          <label className="form-label small fw-semibold mt-3 mb-1" htmlFor="import-year">
            <CalendarDays size={14} className="me-1" />
            {t('sections.importYear', { defaultValue: 'Academic year for these admissions' })}
          </label>
          <select id="import-year" className="form-select form-select-sm" value={yearId}
            onChange={(e) => setYearId(e.target.value)} disabled={years.loading || !years.data?.length}>
            {!years.data?.length && (
              <option value="">{years.loading ? t('common.loading') : t('sections.noYear', { defaultValue: 'No academic year yet' })}</option>
            )}
            {(years.data || []).map((y) => (
              <option key={y.id} value={y.id}>{y.name}{y.is_current ? ` · ${t('sections.currentYear', { defaultValue: 'current' })}` : ''}</option>
            ))}
          </select>
          {activeYear && (
            <div className="form-text">
              {t('sections.importYearHelp', { defaultValue: 'New student IDs use {{year}}.', year: activeYear.name })}
            </div>
          )}
          {years.error && <div className="text-danger small mt-1">{years.error.message}</div>}

          <div
            className={`import-drop mt-3${dragging ? ' is-drag' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              chooseFile(e.dataTransfer.files?.[0]);
            }}
          >
            <span className="import-drop-icon"><UploadCloud size={22} /></span>
            <div className="fw-semibold small mt-2">
              {t('sections.importDropTitle', { defaultValue: 'Drop the file here or click to browse' })}
            </div>
            <div className="small text-muted">.xlsx · .xlsm · .csv — {t('sections.importMax', { defaultValue: 'up to 5 MB' })}</div>
            <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.csv" hidden
              onChange={(e) => chooseFile(e.target.files?.[0])} />
          </div>

          {file && (
            <div className="import-file mt-2">
              <FileSpreadsheet size={18} className="text-primary" />
              <div className="flex-grow-1 min-w-0">
                <div className="import-file-name">{file.name}</div>
                <div className="small text-muted">{formatSize(file.size)}</div>
              </div>
              <button type="button" className="btn-icon sm" aria-label={t('common.remove')}
                onClick={(e) => { e.stopPropagation(); setFile(null); setResult(null); if (inputRef.current) inputRef.current.value = ''; }}>
                <X size={15} />
              </button>
            </div>
          )}
        </section>

        {result && (
          <div className={`alert ${result.created ? 'alert-success' : 'alert-warning'} small py-2 mb-0`}>
            <div className="fw-semibold d-flex align-items-center gap-1">
              {result.created ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              {t('sections.importSummary', { defaultValue: '{{created}} imported · {{failed}} skipped', created: result.created, failed: result.failed })}
            </div>
            {result.academic_year && (
              <div className="text-muted mt-1">
                {t('sections.importYearUsed', { defaultValue: 'Admissions year: {{year}}', year: result.academic_year })}
              </div>
            )}
            {result.errors?.length > 0 && (
              <details className="mt-1">
                <summary className="text-danger">
                  {t('sections.importErrors', { defaultValue: '{{count}} rows need attention', count: result.errors.length })}
                </summary>
                <ul className="mb-0 ps-3 mt-1">
                  {result.errors.slice(0, 50).map((err, index) => (
                    <li key={index}>{t('sections.rowNumber', { defaultValue: 'Row' })} {err.row}: {err.message}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
