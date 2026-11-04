/**
 * Report card: computed server-side per student + examination, rendered as a printable sheet.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Award, GraduationCap, Printer, RefreshCw, Search } from 'lucide-react';
import { apiGet } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { EmptyState, PageHeader, Spinner } from '../../components/ui/Basics.jsx';

const pct = (obtained, maximum) => (Number(maximum) > 0 ? Math.round((Number(obtained) / Number(maximum)) * 1000) / 10 : null);

export default function ReportCardPage({ query = {} }) {
  const { t } = useTranslation();
  const { profile, can, hasRole } = useAuth();
  const personal = hasRole('student') || hasRole('parent');

  const [examinationId, setExaminationId] = useState(query.examination_id || '');
  const [studentId, setStudentId] = useState(query.student_id || '');
  const [studentLabel, setStudentLabel] = useState(query.student_name || '');
  const [scopeId, setScopeId] = useState(query.class_id || '');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mayView = can('results.view') || can('marks.view');
  const examinations = useApi('/examinations', { pageSize: 200 });
  const scopes = useApi('/exam-class-subjects', { pageSize: 200 }, !personal);
  const classes = useApi('/classes', { pageSize: 200 }, !personal);
  const myChildren = useApi('/school/me/students', undefined, personal);
  const students = useApi('/students', { pageSize: 50, class_id: scopeId || undefined, q: debounced || undefined },
    !personal && Boolean(can('students.view') || mayView));
  const people = personal ? (myChildren.data || []) : (students.data || []);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(id);
  }, [search]);

  // A student/parent account is pinned to its own record; parents pick among their children.
  useEffect(() => {
    if (!personal || studentId) return;
    const first = (myChildren.data || [])[0];
    if (first) { setStudentId(first.id); setStudentLabel(first.full_name || ''); }
  }, [personal, studentId, myChildren.data]);

  const examOptions = useMemo(() => {
    const rows = personal ? (examinations.data || []).filter((e) => e.status === 'published') : (examinations.data || []);
    const fromApi = rows.map((e) => ({ id: e.id, name: e.name || e.title }));
    if (personal) return fromApi;
    const known = new Set(fromApi.map((e) => e.id));
    const derived = (scopes.data || [])
      .map((s) => s.examination_id)
      .filter((id) => id && !known.has(id))
      .map((id) => ({ id, name: `${t('modules.examinationFallback', { defaultValue: 'Examination' })} ${String(id).slice(0, 8)}` }));
    return [...fromApi, ...derived];
  }, [examinations.data, scopes.data, personal, t]);

  const load = useCallback(async () => {
    if (!examinationId || !studentId) { setCard(null); setError(null); return; }
    setLoading(true);
    setError(null);
    try {
      const body = await apiGet('/examinations/report-card', { examination_id: examinationId, student_id: studentId });
      setCard(body.data || null);
    } catch (err) {
      setCard(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [examinationId, studentId]);

  useEffect(() => { load(); }, [load]);

  const forbidden = error?.status === 403;
  const examName = examOptions.find((e) => e.id === examinationId)?.name || card?.examination?.name || '';

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .rc-print, .rc-print * { visibility: visible !important; }
          .rc-print { position: absolute !important; inset: 0 auto auto 0 !important; width: 100% !important; border: 0 !important; box-shadow: none !important; }
          .rc-no-print { display: none !important; }
        }
      `}</style>

      <PageHeader
        title={t('modules.report-card', { defaultValue: 'Report card' })}
        subtitle={t('modules.reportCardHint', { defaultValue: 'Totals, grade and class rank are computed by the API for the selected student and examination.' })}
        actions={(
          <>
            <button className="btn btn-outline-secondary btn-sm rc-no-print d-flex align-items-center gap-1" onClick={load} disabled={!examinationId || !studentId || loading}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            {card && (
              <button className="btn btn-primary btn-sm rc-no-print d-flex align-items-center gap-1" onClick={() => window.print()}>
                <Printer size={14} /> {t('modules.print', { defaultValue: 'Print' })}
              </button>
            )}
          </>
        )}
      />

      <div className="card-soft p-3 mb-3 rc-no-print">
        <div className="row g-2">
          <div className="col-12 col-md-4">
            <label className="form-label small fw-semibold" htmlFor="rc-exam">{t('modules.examination', { defaultValue: 'Examination' })}</label>
            <select id="rc-exam" className="form-select form-select-sm" value={examinationId}
              onChange={(e) => setExaminationId(e.target.value)}>
              <option value="">{t('modules.selectExamination', { defaultValue: 'Select an examination' })}</option>
              {examOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          {personal ? (
            <div className="col-12 col-md-5">
              <label className="form-label small fw-semibold" htmlFor="rc-child">
                {hasRole('parent') ? t('modules.child', { defaultValue: 'Child' }) : t('modules.student', { defaultValue: 'Student' })}
              </label>
              {people.length > 1 ? (
                <select id="rc-child" className="form-select form-select-sm" value={studentId}
                  onChange={(e) => {
                    const chosen = people.find((s) => s.id === e.target.value);
                    setStudentId(e.target.value);
                    setStudentLabel(chosen?.full_name || '');
                  }}>
                  {people.map((s) => <option key={s.id} value={s.id}>{s.full_name} · {s.admission_number}</option>)}
                </select>
              ) : (
                <div className="form-control form-control-sm bg-light">
                  {people[0] ? `${people[0].full_name} · ${people[0].admission_number}` : t('modules.noLinkedStudent', { defaultValue: 'No student linked to this account' })}
                </div>
              )}
              <div className="form-text small">
                {t('modules.publishedOnlyNote', { defaultValue: 'Only published examinations with approved marks are shown.' })}
              </div>
            </div>
          ) : (
            <>
              <div className="col-6 col-md-3">
                <label className="form-label small fw-semibold" htmlFor="rc-class">{t('modules.class', { defaultValue: 'Class' })}</label>
                <select id="rc-class" className="form-select form-select-sm" value={scopeId}
                  onChange={(e) => { setScopeId(e.target.value); setStudentId(''); }}>
                  <option value="">{t('common.all')}</option>
                  {(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="col-6 col-md-5">
                <label className="form-label small fw-semibold" htmlFor="rc-student">{t('modules.student', { defaultValue: 'Student' })}</label>
                <div className="input-group input-group-sm">
                  <span className="input-group-text bg-white"><Search size={14} /></span>
                  <input id="rc-student" className="form-control" list="rc-student-list" autoComplete="off"
                    placeholder={search || t('modules.searchStudentPlaceholder', { defaultValue: 'Name or admission number' })}
                    value={search} onChange={(e) => { setSearch(e.target.value); }} />
                </div>
                <datalist id="rc-student-list">
                  {people.map((s) => <option key={s.id} value={s.full_name} label={s.admission_number} />)}
                </datalist>
                <select className="form-select form-select-sm mt-2" value={studentId} aria-label={t('modules.student', { defaultValue: 'Student' })}
                  onChange={(e) => {
                    const chosen = people.find((s) => s.id === e.target.value);
                    setStudentId(e.target.value);
                    setStudentLabel(chosen?.full_name || '');
                    if (chosen) setSearch('');
                  }}>
                  <option value="">{t('modules.selectStudent', { defaultValue: 'Select a student' })}</option>
                  {people.map((s) => (
                    <option key={s.id} value={s.id}>{s.full_name} · {s.admission_number}</option>
                  ))}
                </select>
                {students.loading && <div className="small text-muted mt-1">{t('common.loading')}</div>}
              </div>
            </>
          )}
        </div>
        {!mayView && (
          <div className="alert alert-warning small mb-0 mt-3">
            {t('modules.noResultsPermission', { defaultValue: 'You do not have permission to view results.' })}
          </div>
        )}
      </div>

      {!examinationId || !studentId ? (
        <div className="card-soft p-4">
          <EmptyState title={t('modules.pickBoth', { defaultValue: 'Choose an examination and a student' })}
            hint={t('modules.pickBothHint', { defaultValue: 'The card is generated on demand — nothing is stored until you print or export it.' })}
            icon={GraduationCap} />
        </div>
      ) : loading ? (
        <div className="card-soft p-4"><Spinner label={t('common.loading')} /></div>
      ) : error ? (
        <div className={`alert ${forbidden ? 'alert-info' : 'alert-warning'}`}>
          <div className="fw-semibold">
            {forbidden
              ? t('modules.notPublishedYet', { defaultValue: 'Results are not published yet' })
              : t('modules.reportCardFailed', { defaultValue: 'The report card could not be loaded' })}
          </div>
          <div className="small">{error.message}</div>
          {forbidden && (
            <div className="small mt-2">{t('modules.notPublishedHint', { defaultValue: 'Students and parents only see a card once the examination has been published.' })}</div>
          )}
        </div>
      ) : card ? (
        <div className="card-soft rc-print p-4">
          <div className="d-flex justify-content-between align-items-start border-bottom pb-3 mb-3">
            <div>
              <div className="h5 mb-0 fw-bold">{profile?.school?.school_name || t('brand.name', { defaultValue: 'E-MADAARIS' })}</div>
              <div className="small text-muted">{profile?.school?.motto || profile?.school?.address || ''}</div>
            </div>
            <div className="text-end">
              <div className="fw-semibold">{t('modules.reportCardTitle', { defaultValue: 'Report card' })}</div>
              <div className="small text-muted">{card.examination?.status ? String(card.examination.status).toUpperCase() : ''}</div>
            </div>
          </div>

          <div className="row g-2 mb-3 small">
            <div className="col-6 col-md-3">
              <div className="text-muted">{t('modules.examination', { defaultValue: 'Examination' })}</div>
              <div className="fw-semibold">{card.examination?.name || examName}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-muted">{t('modules.student', { defaultValue: 'Student' })}</div>
              <div className="fw-semibold">{studentLabel || card.student_id}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-muted">{t('modules.class', { defaultValue: 'Class' })}</div>
              <div className="fw-semibold">{card.class_name || (classes.data || []).find((c) => c.id === scopeId)?.name || '—'}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-muted">{t('modules.generated', { defaultValue: 'Generated' })}</div>
              <div className="fw-semibold">{new Date().toLocaleDateString()}</div>
            </div>
          </div>

          <div className="table-responsive mb-3">
            <table className="table table-bordered align-middle mb-0">
              <thead className="bg-white">
                <tr>
                  <th>{t('modules.subject', { defaultValue: 'Subject' })}</th>
                  <th className="text-end">{t('modules.obtainedShort', { defaultValue: 'Obtained' })}</th>
                  <th className="text-end">{t('modules.maximumShort', { defaultValue: 'Maximum' })}</th>
                  <th className="text-end">{t('modules.percent', { defaultValue: '%' })}</th>
                </tr>
              </thead>
              <tbody>
                {(card.subjects || []).map((s, i) => (
                  <tr key={`${s.name || 'subject'}-${i}`}>
                    <td>{s.name || `${t('modules.subjectFallback', { defaultValue: 'Subject' })} ${i + 1}`}</td>
                    <td className="text-end tabular-nums">{s.obtained}</td>
                    <td className="text-end tabular-nums">{s.maximum}</td>
                    <td className="text-end tabular-nums">{pct(s.obtained, s.maximum) ?? '—'}</td>
                  </tr>
                ))}
                {!card.subjects?.length && (
                  <tr><td colSpan={4}><EmptyState title={t('modules.noMarksOnCard', { defaultValue: 'No approved marks found for this student' })} /></td></tr>
                )}
              </tbody>
              <tfoot className="fw-bold">
                <tr>
                  <td>{t('common.total')}</td>
                  <td className="text-end tabular-nums">{card.total_obtained}</td>
                  <td className="text-end tabular-nums">{card.total_maximum}</td>
                  <td className="text-end tabular-nums">{card.percent ?? '—'}%</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="row g-3">
            <div className="col-6 col-md-3">
              <div className="card-soft p-3 text-center">
                <Award size={18} className="text-primary mb-1" />
                <div className="text-muted small text-uppercase">{t('modules.grade', { defaultValue: 'Grade' })}</div>
                <div className="fs-3 fw-bold">{card.grade || '—'}</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card-soft p-3 text-center">
                <div className="text-muted small text-uppercase mt-4">{t('modules.classRank', { defaultValue: 'Class rank' })}</div>
                <div className="fs-3 fw-bold">
                  {card.class_rank ? `${card.class_rank}${card.class_size ? ` / ${card.class_size}` : ''}` : '—'}
                </div>
              </div>
            </div>
            <div className="col-12 col-md-6">
              <div className="card-soft p-3 h-100">
                <div className="text-muted small text-uppercase">{t('modules.remark', { defaultValue: 'Teacher remark' })}</div>
                <div className="fw-semibold">{card.remark || t('modules.noRemark', { defaultValue: 'No remark set for this grade band.' })}</div>
              </div>
            </div>
          </div>

          <div className="small text-muted mt-3 rc-no-print">
            {t('modules.reportCardFootnote', { defaultValue: 'Printed from E-MADAARIS. Figures come from approved marks only.' })}
          </div>
        </div>
      ) : null}
    </>
  );
}
