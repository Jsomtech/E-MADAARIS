/**
 * Marks entry: examination → exam scope (class + subject) → component, then a grid of number
 * inputs saved in bulk and submitted for review.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { AlertTriangle, Check, Lock, RefreshCw, Save, Send, Upload } from 'lucide-react';
import { apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Basics.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';

const LOCKED_EXAM_STATUS = ['published', 'archived'];

export default function MarksPage({ query = {} }) {
  const { t } = useTranslation();
  const { can, canAny } = useAuth();
  const mayEnter = canAny(['marks.create', 'marks.edit']);

  const [examinationId, setExaminationId] = useState(query.examination_id || '');
  const [scopeId, setScopeId] = useState(query.exam_class_subject_id || '');
  const [componentId, setComponentId] = useState(query.component_id || '');
  const [entries, setEntries] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const scopes = useApi('/exam-class-subjects', { pageSize: 200 });
  const examinations = useApi('/examinations', { pageSize: 200 });
  const classes = useApi('/classes', { pageSize: 200 });
  const subjects = useApi('/subjects', { pageSize: 200 });

  const scopeList = useMemo(() => scopes.data || [], [scopes.data]);
  const scope = useMemo(() => scopeList.find((s) => s.id === scopeId) || null, [scopeList, scopeId]);

  // The examination name comes from the API when it exposes one, otherwise from the scope rows.
  const examOptions = useMemo(() => {
    const fromApi = (examinations.data || []).map((e) => ({
      id: e.id, name: e.name || e.title || e.examinations?.name || `${e.id.slice(0, 8)}`, status: e.status,
    }));
    const known = new Set(fromApi.map((e) => e.id));
    const derived = scopeList
      .map((s) => s.examination_id)
      .filter((id) => id && !known.has(id))
      .map((id) => ({ id, name: `${t('modules.examinationFallback', { defaultValue: 'Examination' })} ${String(id).slice(0, 8)}`, status: null }));
    return [...fromApi, ...derived];
  }, [examinations.data, scopeList, t]);

  const selectedExam = examOptions.find((e) => e.id === examinationId) || null;
  const examStatus = selectedExam?.status || scope?.examinations?.status || null;

  const components = useApi('/examination-components', { exam_class_subject_id: scopeId }, Boolean(scopeId));
  const roster = useApi('/students', { class_id: scope?.class_id, pageSize: 200 }, Boolean(scope?.class_id));
  const existing = useApi('/marks', { exam_class_subject_id: scopeId, pageSize: 200 }, Boolean(scopeId));

  const students = useMemo(() => roster.data || [], [roster.data]);
  const componentList = useMemo(() => components.data || [], [components.data]);
  const component = componentList.find((c) => c.id === componentId) || null;
  const maximumFor = (studentId) => {
    const row = (existing.data || []).find((m) => m.student_id === studentId
      && (componentId ? m.component_id === componentId : !m.component_id));
    if (row?.maximum_marks) return Number(row.maximum_marks);
    if (component?.maximum_marks) return Number(component.maximum_marks);
    return Number(scope?.total_marks || 100);
  };

  useEffect(() => { setEntries({}); }, [scopeId, componentId]);
  useEffect(() => {
    const rows = existing.data || [];
    if (!rows.length) return;
    setEntries((prev) => {
      const next = { ...prev };
      for (const m of rows) {
        const matches = componentId ? m.component_id === componentId : !m.component_id;
        if (matches && next[m.student_id] === undefined) next[m.student_id] = String(m.marks_obtained ?? '');
      }
      return next;
    });
  }, [existing.data, componentId]);

  const approvalStates = useMemo(() => (existing.data || []).map((m) => m.approval_status), [existing.data]);
  const approved = approvalStates.length > 0 && approvalStates.every((s) => s === 'approved');
  const submitted = approvalStates.length > 0 && approvalStates.some((s) => s === 'submitted');
  const locked = LOCKED_EXAM_STATUS.includes(examStatus) || approved;
  const lockReason = approved
    ? t('modules.marksApprovedLocked', { defaultValue: 'These marks are approved, so the sheet is locked.' })
    : t('modules.marksPublishedLocked', { defaultValue: 'Results are published or archived, so marks can no longer be edited.' });

  const named = (map, id, fallback) => (map.data || []).find((x) => x.id === id)?.name || id?.slice(0, 8) || fallback;

  const stats = useMemo(() => {
    let filled = 0;
    let invalid = 0;
    for (const s of students) {
      const raw = entries[s.id];
      if (raw === undefined || raw === '') continue;
      const value = Number(raw);
      filled += 1;
      if (!Number.isFinite(value) || value < 0 || value > maximumFor(s.id)) invalid += 1;
    }
    return { filled, invalid };
  }, [students, entries, existing.data, component, componentId, scope]);

  const payloadEntries = () => students
    .filter((s) => entries[s.id] !== undefined && entries[s.id] !== '' && Number(entries[s.id]) >= 0 && Number(entries[s.id]) <= maximumFor(s.id))
    .map((s) => ({ student_id: s.id, marks_obtained: Number(entries[s.id]), maximum_marks: maximumFor(s.id) }));

  const save = async () => {
    if (!scopeId) { toast.warning(t('modules.pickScopeFirst', { defaultValue: 'Choose an exam scope first' })); return; }
    const entriesPayload = payloadEntries();
    if (!entriesPayload.length) { toast.warning(t('modules.noValidMarks', { defaultValue: 'Nothing valid to save — check the values' })); return; }
    setSaving(true);
    try {
      const body = await apiPost('/examinations/marks/bulk', {
        exam_class_subject_id: scopeId,
        component_id: componentId || null,
        entries: entriesPayload,
      });
      const saved = body?.data?.saved ?? entriesPayload.length;
      const rejected = body?.data?.rejected ?? 0;
      toast.success(`${t('modules.marksSaved', { defaultValue: 'Saved' })} ${saved} · ${t('modules.marksRejected', { defaultValue: 'rejected' })} ${rejected}`);
      if (rejected) toast.warning(t('modules.rejectedHint', { defaultValue: 'Rejected rows were out of range' }));
      existing.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const body = await apiPost('/examinations/marks/submit', { exam_class_subject_id: scopeId });
      toast.success(`${t('modules.submittedForReview', { defaultValue: 'Submitted for review' })} · ${body?.data?.submitted ?? 0} ${t('modules.rowsLower', { defaultValue: 'rows' })}`);
      setConfirmSubmit(false);
      existing.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const visibleScopes = scopeList.filter((s) => !examinationId || s.examination_id === examinationId);

  return (
    <>
      <PageHeader
        title={t('modules.marks', { defaultValue: 'Marks entry' })}
        subtitle={t('modules.marksHint', { defaultValue: 'Pick the examination, the class + subject scope and the component, then fill the sheet and save in bulk.' })}
        actions={(
          <>
            <button className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
              onClick={() => { scopes.reload(); components.reload(); roster.reload(); existing.reload(); examinations.reload(); }}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            {!locked && mayEnter && (
              <button className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={save} disabled={saving || !stats.filled}>
                <Save size={14} /> {saving ? '…' : t('modules.saveMarks', { defaultValue: 'Save marks' })}
              </button>
            )}
            {!locked && can('marks.submit') && scopeId && (
              <button className="btn btn-outline-dark btn-sm d-flex align-items-center gap-1" onClick={() => setConfirmSubmit(true)}>
                <Send size={14} /> {t('modules.submitForReview', { defaultValue: 'Submit for review' })}
              </button>
            )}
          </>
        )}
      />

      <div className="card-soft p-3 mb-3">
        <div className="row g-2">
          <div className="col-12 col-md-4">
            <label className="form-label small fw-semibold" htmlFor="mk-exam">{t('modules.examination', { defaultValue: 'Examination' })}</label>
            <select id="mk-exam" className="form-select form-select-sm" value={examinationId}
              onChange={(e) => { setExaminationId(e.target.value); setScopeId(''); setComponentId(''); }}>
              <option value="">{t('common.all')}</option>
              {examOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            {examinations.error && (
              <div className="form-text small text-muted">
                {t('modules.examListFallback', { defaultValue: 'Examinations are listed from their scopes; names may be shortened.' })}
              </div>
            )}
          </div>
          <div className="col-12 col-md-4">
            <label className="form-label small fw-semibold" htmlFor="mk-scope">{t('modules.examScope', { defaultValue: 'Class + subject scope' })}</label>
            <select id="mk-scope" className="form-select form-select-sm" value={scopeId}
              onChange={(e) => { setScopeId(e.target.value); setComponentId(''); }}
              disabled={scopes.loading}>
              <option value="">{t('modules.selectScope', { defaultValue: 'Select a scope' })}</option>
              {visibleScopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.classes?.name || named(classes, s.class_id)} · {s.subjects?.name || named(subjects, s.subject_id)} ({s.total_marks})
                </option>
              ))}
            </select>
          </div>
          <div className="col-12 col-md-4">
            <label className="form-label small fw-semibold" htmlFor="mk-component">{t('modules.component', { defaultValue: 'Component' })}</label>
            <select id="mk-component" className="form-select form-select-sm" value={componentId}
              onChange={(e) => setComponentId(e.target.value)} disabled={!scopeId}>
              <option value="">{t('modules.noComponents', { defaultValue: 'Single total (no component)' })}</option>
              {componentList.map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.maximum_marks} ({c.weight_percent}%)</option>
              ))}
            </select>
          </div>
        </div>
        {scopes.error && <div className="mt-2"><ErrorState error={scopes.error} onRetry={scopes.reload} /></div>}
        {!scope && !scopes.loading && (
          <div className="mt-2 small text-muted">
            {t('modules.scopesEmpty', { defaultValue: 'No exam scopes exist yet — create an examination with its class and subjects first.' })}
            {' '}<a className="small" href="/m/examinations">{t('modules.goToExaminations', { defaultValue: 'Open examinations' })}</a>
          </div>
        )}
      </div>

      {locked && scopeId && (
        <div className="alert alert-warning d-flex align-items-start gap-2">
          <Lock size={18} className="mt-1" />
          <div>
            <div className="fw-semibold">{t('modules.marksLocked', { defaultValue: 'Marks are locked' })}</div>
            <div className="small">{lockReason}</div>
          </div>
        </div>
      )}
      {!locked && submitted && scopeId && (
        <div className="alert alert-info d-flex align-items-start gap-2">
          <Upload size={18} className="mt-1" />
          <div className="small">{t('modules.marksSubmittedNote', { defaultValue: 'Marks are already submitted for review; saving again returns them to draft.' })}</div>
        </div>
      )}

      {scopeId && (
        <div className="card-soft overflow-hidden">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 px-3 py-2 border-bottom bg-white">
            <div className="fw-semibold small">
              {t('modules.sheet', { defaultValue: 'Marks sheet' })} · {t('modules.outOf', { defaultValue: 'out of' })} {component?.maximum_marks || scope?.total_marks || 100}
            </div>
            <div className="small text-muted">
              {stats.filled}/{students.length} {t('modules.entered', { defaultValue: 'entered' })}
              {stats.invalid > 0 && (
                <span className="badge text-bg-danger ms-2">
                  <AlertTriangle size={12} className="me-1" />{stats.invalid} {t('modules.outOfRange', { defaultValue: 'out of range' })}
                </span>
              )}
            </div>
          </div>

          {roster.loading && <div className="p-3"><Spinner label={t('common.loading')} /></div>}
          {roster.error && <div className="p-3"><ErrorState error={roster.error} onRetry={roster.reload} /></div>}
          {!roster.loading && !roster.error && !students.length && (
            <div className="p-4"><EmptyState title={t('modules.emptyRoster', { defaultValue: 'This class has no students yet' })} /></div>
          )}

          {students.length > 0 && (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="bg-white">
                  <tr>
                    <th>{t('modules.student', { defaultValue: 'Student' })}</th>
                    <th style={{ width: 150 }}>{t('modules.obtained', { defaultValue: 'Marks obtained' })}</th>
                    <th style={{ width: 150 }}>{t('modules.maximum', { defaultValue: 'Maximum' })}</th>
                    <th style={{ width: 150 }}>{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const max = maximumFor(s.id);
                    const raw = entries[s.id] ?? '';
                    const value = Number(raw);
                    const invalid = raw !== '' && (!Number.isFinite(value) || value < 0 || value > max);
                    const row = (existing.data || []).find((m) => m.student_id === s.id && (componentId ? m.component_id === componentId : !m.component_id));
                    return (
                      <tr key={s.id}>
                        <td>
                          <div className="fw-semibold small">{s.full_name}</div>
                          <div className="text-muted small">{s.admission_number}</div>
                        </td>
                        <td>
                          <input type="number" min={0} max={max} step="any" inputMode="decimal"
                            className={`form-control form-control-sm${invalid ? ' is-invalid' : ''}`}
                            value={raw} disabled={locked || !mayEnter}
                            onChange={(e) => setEntries((prev) => ({ ...prev, [s.id]: e.target.value }))}
                            aria-label={`${t('modules.obtained', { defaultValue: 'Marks obtained' })} · ${s.full_name}`} />
                          {invalid && <div className="invalid-feedback d-block small">{t('modules.mustBeInRange', { defaultValue: 'Must be between 0 and {{max}}', max })}</div>}
                        </td>
                        <td className="small tabular-nums">{max}</td>
                        <td>
                          {row ? <StatusBadge value={row.approval_status} /> : <span className="text-muted small">{t('modules.notEntered', { defaultValue: 'Not entered' })}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {students.length > 0 && !locked && mayEnter && (
            <div className="d-flex flex-wrap justify-content-end gap-2 px-3 py-2 border-top bg-white">
              <button className="btn btn-outline-dark btn-sm d-flex align-items-center gap-1" onClick={() => setConfirmSubmit(true)} disabled={!can('marks.submit')}>
                <Send size={14} /> {t('modules.submitForReview', { defaultValue: 'Submit for review' })}
              </button>
              <button className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={save} disabled={saving || !stats.filled}>
                {saving ? '…' : <><Check size={14} /> {t('modules.saveMarks', { defaultValue: 'Save marks' })} ({stats.filled - stats.invalid})</>}
              </button>
            </div>
          )}

          {existing.error && (
            <div className="px-3 py-2 border-top small text-muted">
              {t('modules.marksLoadNote', { defaultValue: 'Existing marks could not be loaded from the API yet; the sheet starts empty.' })}
              <span className="d-block text-danger">{existing.error.message}</span>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog open={confirmSubmit} danger={false} busy={submitting}
        title={t('modules.submitForReview', { defaultValue: 'Submit for review' })}
        message={t('modules.submitConfirmBody', { defaultValue: 'Submitting locks the sheet for editing and creates a pending result approval for a reviewer to check.' })}
        confirmLabel={t('modules.submitForReview', { defaultValue: 'Submit for review' })}
        onConfirm={submit} onClose={() => setConfirmSubmit(false)} />
    </>
  );
}
