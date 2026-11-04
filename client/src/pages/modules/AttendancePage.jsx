/**
 * Attendance flow: mark a class session (daily or per subject period) in bulk, review the
 * period summary from the server-side tally, and work the correction queue.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  AlertCircle, BookOpen, CalendarDays, CheckCheck, ClipboardList, Lock, RefreshCw, Save, Send, ShieldCheck, UserCheck,
} from 'lucide-react';
import { apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge } from '../../components/ui/Basics.jsx';

const STATUSES = ['present', 'absent', 'late', 'excused'];
const STATUS_BTN = { present: 'btn-success', absent: 'btn-danger', late: 'btn-warning', excused: 'btn-secondary' };
const STATUS_LABEL_KEY = {
  present: 'statuses.present', absent: 'statuses.absent', late: 'statuses.late', excused: 'statuses.excused',
};
const STATUS_FALLBACK = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' };

const pad = (n) => String(n).padStart(2, '0');
const localDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const monthStart = () => `${localDate().slice(0, 7)}-01`;
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
  .map((part) => part[0]).join('').toUpperCase();

export default function AttendancePage({ query = {} }) {
  const { t } = useTranslation();
  const { can, hasRole } = useAuth();
  const personal = hasRole('student') || hasRole('parent');
  const isTeacher = hasRole('teacher') && !hasRole('school_admin');
  const [childId, setChildId] = useState(query.student_id || '');
  const focusStudent = personal ? childId : (query.student_id || '');

  const [classId, setClassId] = useState(query.class_id || '');
  const [date, setDate] = useState(query.date || query.session_date || localDate());
  const [subjectId, setSubjectId] = useState('');
  const [marks, setMarks] = useState({});
  const [showRemarks, setShowRemarks] = useState(false);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(localDate());
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState({ student_id: focusStudent, attendance_date: localDate(), requested_status: 'present', reason: '' });
  const [requestBusy, setRequestBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState('');

  const myChildren = useApi('/school/me/students', undefined, personal);
  const teaching = useApi('/school/me/teaching', undefined, isTeacher && !personal);
  const classes = useApi('/classes', { pageSize: 200 }, !personal && !isTeacher);
  const subjects = useApi('/subjects', { pageSize: 200 }, !personal && !isTeacher);
  const roster = useApi('/students', personal ? { pageSize: 200 } : { class_id: classId, pageSize: 200 }, personal || Boolean(classId));
  const summaryParams = focusStudent
    ? { from, to, student_id: focusStudent }
    : { from, to, ...(classId ? { class_id: classId } : {}) };
  const summary = useApi('/attendance/summary', summaryParams, !personal && Boolean(classId || focusStudent));
  const myRecords = useApi('/attendance/my-records',
    { student_id: focusStudent || undefined, from, to }, personal && Boolean(focusStudent));
  const sessionState = useApi('/attendance/session-state',
    { class_id: classId, date, ...(subjectId ? { subject_id: subjectId } : {}) },
    !personal && Boolean(classId) && (!isTeacher || Boolean(subjectId)));
  const corrections = useApi('/attendance-corrections', { status: 'pending' }, can('attendance.approve'));

  // A parent account starts on its first child; switching children re-pins the whole page.
  useEffect(() => {
    if (!personal) return;
    const kids = myChildren.data || [];
    if (!kids.some((k) => k.id === childId)) setChildId(kids[0]?.id || '');
  }, [personal, myChildren.data, childId]);

  useEffect(() => {
    if (personal) setRequest((prev) => ({ ...prev, student_id: childId || '' }));
  }, [personal, childId]);

  const students = useMemo(() => roster.data || [], [roster.data]);
  const child = (myChildren.data || []).find((s) => s.id === childId);

  const classOptions = useMemo(
    () => (isTeacher ? (teaching.data?.classes || []) : (classes.data || [])),
    [isTeacher, teaching.data, classes.data],
  );

  // Teachers pick from the subjects they actually teach in the chosen class.
  const subjectOptions = useMemo(() => {
    if (!isTeacher) return subjects.data || [];
    const seen = new Map();
    for (const a of teaching.data?.assignments || []) {
      if (classId && a.class_id !== classId) continue;
      if (a.subject_id && !seen.has(a.subject_id)) seen.set(a.subject_id, { id: a.subject_id, name: a.subject_name });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [isTeacher, teaching.data, classId, subjects.data]);

  const subjectName = (id) => subjectOptions.find((s) => s.id === id)?.name || '';

  // A new context always starts from an unmarked sheet.
  useEffect(() => { setMarks({}); }, [classId, date, subjectId]);

  useEffect(() => {
    if (!isTeacher || !subjectId) return;
    if (!subjectOptions.some((s) => s.id === subjectId)) setSubjectId('');
  }, [isTeacher, subjectOptions, subjectId]);

  const locked = !personal && Boolean(sessionState.data?.taken);
  const stateLoading = !personal && sessionState.loading && !sessionState.data;
  const sessionInfo = sessionState.data?.session;

  const setMark = (studentId, status) =>
    setMarks((prev) => ({ ...prev, [studentId]: { ...(prev[studentId] || {}), attendance_status: status } }));
  const setRemark = (studentId, remarks) =>
    setMarks((prev) => ({ ...prev, [studentId]: { ...(prev[studentId] || {}), remarks } }));

  const markAll = (status) =>
    setMarks(Object.fromEntries(students.map((s) => [s.id, { ...(marks[s.id] || {}), attendance_status: status }])));

  const tally = useMemo(() => {
    const out = { present: 0, absent: 0, late: 0, excused: 0, marked: 0 };
    for (const s of students) {
      const status = marks[s.id]?.attendance_status;
      if (status && out[status] !== undefined) { out[status] += 1; out.marked += 1; }
    }
    return out;
  }, [students, marks]);

  const summaryRows = useMemo(() => {
    const map = summary.data || {};
    const ids = Object.keys(map);
    if (!focusStudent && students.length) {
      return students
        .filter((s) => map[s.id])
        .map((s) => ({ id: s.id, name: s.full_name || s.first_name, admission_number: s.admission_number, ...map[s.id] }));
    }
    return ids.map((id) => {
      const known = students.find((s) => s.id === id);
      return {
        id,
        name: known?.full_name || (id === focusStudent ? t('modules.thisStudent', { defaultValue: 'This student' }) : id),
        admission_number: known?.admission_number,
        ...map[id],
      };
    });
  }, [summary.data, students, focusStudent, t]);

  const save = async () => {
    if (!classId) { toast.warning(t('modules.pickClassFirst', { defaultValue: 'Choose a class first' })); return; }
    if (isTeacher && !subjectId) {
      toast.warning(t('modules.pickSubjectFirst', { defaultValue: 'Choose the subject you are taking attendance for' }));
      return;
    }
    if (locked) {
      toast.warning(t('modules.attendanceTakenToday', { defaultValue: 'Attendance was already taken for this class and subject today. Try again tomorrow.' }));
      return;
    }
    const records = students
      .filter((s) => marks[s.id]?.attendance_status)
      .map((s) => ({
        student_id: s.id,
        attendance_status: marks[s.id].attendance_status,
        ...(marks[s.id].remarks ? { remarks: marks[s.id].remarks } : {}),
      }));
    if (!records.length) { toast.warning(t('modules.nothingMarked', { defaultValue: 'Mark at least one student' })); return; }
    setSaving(true);
    try {
      const body = await apiPost('/attendance/sessions', {
        class_id: classId,
        subject_id: subjectId || null,
        session_date: date,
        session_type: subjectId ? 'subject' : 'daily',
        records,
      });
      toast.success(`${t('modules.sessionSaved', { defaultValue: 'Session saved' })} · ${body?.data?.saved ?? records.length} ${t('modules.recordsSuffix', { defaultValue: 'records' })}`);
      setMarks({});
      summary.reload();
      myRecords.reload();
      sessionState.reload();
    } catch (error) {
      toast.error(error.status === 409
        ? t('modules.attendanceTakenToday', { defaultValue: 'Attendance was already taken for this class and subject today. Try again tomorrow.' })
        : error.message);
      if (error.status === 409) sessionState.reload();
    } finally {
      setSaving(false);
    }
  };

  const sendCorrection = async () => {
    if (!request.student_id || !request.attendance_date) {
      toast.warning(t('modules.studentAndDateRequired', { defaultValue: 'Student and date are required' }));
      return;
    }
    if ((request.reason || '').trim().length < 3) {
      toast.warning(t('modules.reasonTooShort', { defaultValue: 'Give a reason (at least 3 characters)' }));
      return;
    }
    setRequestBusy(true);
    try {
      await apiPost('/attendance/corrections', {
        student_id: request.student_id,
        attendance_date: request.attendance_date,
        requested_status: request.requested_status,
        reason: request.reason.trim(),
      });
      toast.success(t('modules.correctionRequested', { defaultValue: 'Correction request submitted' }));
      setRequest((prev) => ({ ...prev, reason: '' }));
      corrections.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRequestBusy(false);
    }
  };

  const review = async (id, action) => {
    setReviewBusy(`${id}:${action}`);
    try {
      await apiPost(`/attendance/corrections/${id}/review`, { action });
      toast.success(action === 'approve'
        ? t('modules.correctionApproved', { defaultValue: 'Correction approved' })
        : t('modules.correctionRejected', { defaultValue: 'Correction rejected' }));
      corrections.reload();
      summary.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setReviewBusy('');
    }
  };

  const optionsLoading = isTeacher
    ? (teaching.loading && !teaching.data)
    : (classes.loading && !classes.data);
  const todayStats = myRecords.data?.today;
  const historyRecords = myRecords.data?.records || [];
  const canSaveNow = !locked && !stateLoading && (!isTeacher || Boolean(subjectId));

  return (
    <>
      <PageHeader
        title={t('modules.attendance', { defaultValue: 'Attendance' })}
        subtitle={personal
          ? t('modules.attendancePersonalHint', { defaultValue: 'Your own attendance history. Pick a date range to see the summary; correction requests go to the school for approval.' })
          : focusStudent
            ? t('modules.attendanceStudentHint', { defaultValue: 'Showing the attendance history of one student.' })
            : isTeacher
              ? t('modules.attendanceTeacherHint', { defaultValue: 'Pick your class and the subject you teach, then mark the roster. Each subject can be taken once per day.' })
              : t('modules.attendanceHint', { defaultValue: 'Pick a class and a date, mark the roster, then save the whole session at once.' })}
        actions={(
          <>
            <button className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
              onClick={() => { roster.reload(); summary.reload(); corrections.reload(); sessionState.reload(); myRecords.reload(); }}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            {can('attendance.create') && (
              <button className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={save}
                disabled={saving || !students.length || !canSaveNow}>
                {locked ? <Lock size={14} /> : <Save size={14} />}
                {locked
                  ? t('modules.takenToday', { defaultValue: 'Taken today' })
                  : saving ? '…' : t('modules.saveSession', { defaultValue: 'Save session' })}
              </button>
            )}
          </>
        )}
      />

      {personal ? (
        <div className="card-soft p-3 mb-3">
          <div className="row g-2 align-items-end">
            <div className="col-12 col-md-6">
              <label className="form-label small fw-semibold" htmlFor="att-child">
                {hasRole('parent') ? t('modules.child', { defaultValue: 'Child' }) : t('modules.student', { defaultValue: 'Student' })}
              </label>
              <select id="att-child" className="form-select form-select-sm" value={childId}
                onChange={(e) => setChildId(e.target.value)} disabled={myChildren.loading && !myChildren.data}>
                {(myChildren.data || []).map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name} · {s.admission_number}</option>
                ))}
                {!(myChildren.data || []).length && <option value="">{t('modules.noLinkedStudent', { defaultValue: 'No student linked to this account' })}</option>}
              </select>
            </div>
            <div className="col-12 col-md-6 small text-muted">
              {child?.classes?.name && (
                <div className="mb-1">
                  <span className="badge text-bg-light border">
                    {t('modules.class', { defaultValue: 'Class' })} · {child.classes.name}
                    {child.sections?.name ? ` · ${child.sections.name}` : ''}
                  </span>
                </div>
              )}
              {t('modules.personalAttendanceNote', { defaultValue: 'You can see only your own attendance. Ask the school office if a day looks wrong.' })}
            </div>
          </div>
          {myChildren.error && <div className="mt-2"><ErrorState error={myChildren.error} onRetry={myChildren.reload} /></div>}
        </div>
      ) : (
        <div className="card-soft p-3 mb-3">
          <div className="row g-2 align-items-end">
            <div className="col-12 col-md-4">
              <label className="form-label small fw-semibold" htmlFor="att-class">{t('modules.class', { defaultValue: 'Class' })}</label>
              <select id="att-class" className="form-select form-select-sm" value={classId}
                onChange={(e) => setClassId(e.target.value)} disabled={optionsLoading}>
                <option value="">
                  {focusStudent
                    ? t('modules.notNeeded', { defaultValue: 'Not needed' })
                    : isTeacher ? t('modules.chooseClass', { defaultValue: 'Choose class…' }) : t('common.all')}
                </option>
                {classOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label small fw-semibold" htmlFor="att-date">
                <CalendarDays size={13} className="me-1" />{t('modules.sessionDate', { defaultValue: 'Session date' })}
              </label>
              <input id="att-date" type="date" className="form-control form-control-sm" value={date} max={localDate(1)}
                onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label small fw-semibold" htmlFor="att-subject">
                {isTeacher
                  ? t('modules.subjectRequired', { defaultValue: 'Subject you teach' })
                  : t('modules.subjectPeriod', { defaultValue: 'Subject period (optional)' })}
                {isTeacher && <span className="text-danger ms-1">*</span>}
              </label>
              <select id="att-subject" className="form-select form-select-sm" value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">
                  {isTeacher
                    ? t('modules.chooseSubject', { defaultValue: 'Choose subject…' })
                    : t('modules.wholeDay', { defaultValue: 'Whole day (daily)' })}
                </option>
                {subjectOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="col-12 col-md-2 text-md-end">
              {locked ? (
                <span className="badge text-bg-warning d-inline-flex align-items-center gap-1">
                  <Lock size={11} /> {t('modules.taken', { defaultValue: 'Taken' })}
                </span>
              ) : (
                <span className="badge text-bg-light border text-capitalize">
                  {subjectId ? t('modules.typeSubject', { defaultValue: 'subject' }) : t('modules.typeDaily', { defaultValue: 'daily' })}
                </span>
              )}
            </div>
          </div>
          {isTeacher && !teaching.loading && !teaching.error && !(teaching.data?.classes || []).length && (
            <div className="alert alert-secondary small py-2 mt-2 mb-0 d-flex align-items-start gap-2">
              <AlertCircle size={14} className="mt-1 flex-shrink-0" />
              {t('modules.noTeachingAssignments', { defaultValue: 'No classes or subjects are assigned to you yet. Ask the school administrator to assign your classes and subjects.' })}
            </div>
          )}
          {isTeacher && classId && !teaching.loading && !subjectOptions.length && Boolean(teaching.data?.classes?.length) && (
            <div className="alert alert-warning small py-2 mt-2 mb-0 d-flex align-items-start gap-2">
              <AlertCircle size={14} className="mt-1 flex-shrink-0" />
              {t('modules.noSubjectsForClass', { defaultValue: 'You have no subject assigned in this class. Pick another class or ask the administrator.' })}
            </div>
          )}
          {(classes.error || teaching.error) && (
            <div className="mt-2">
              <ErrorState error={classes.error || teaching.error} onRetry={isTeacher ? teaching.reload : classes.reload} />
            </div>
          )}
        </div>
      )}

      {can('attendance.create') && !focusStudent && locked && (
        <div className="alert alert-warning d-flex align-items-start gap-2 mb-3">
          <Lock size={16} className="mt-1 flex-shrink-0" />
          <div>
            <div className="fw-semibold">
              {t('modules.attendanceAlreadyTaken', { defaultValue: 'Attendance already taken for this {{type}} on {{date}}', type: subjectId ? t('modules.typeSubject', { defaultValue: 'subject' }) : t('modules.typeDaily', { defaultValue: 'class' }), date })}
            </div>
            <div className="small">
              {sessionInfo?.taken_by
                ? t('modules.takenBy', { defaultValue: 'Submitted by {{name}}', name: sessionInfo.taken_by })
                : t('modules.takenBySystem', { defaultValue: 'Submitted earlier today' })}
              {typeof sessionInfo?.records === 'number' ? ` · ${sessionInfo.records} ${t('modules.recordsSuffix', { defaultValue: 'records' })}` : ''}
              {' — '}
              {t('modules.lockedUntilTomorrow', { defaultValue: 'this sheet is locked until tomorrow. Use a correction request if something is wrong.' })}
            </div>
          </div>
        </div>
      )}

      {can('attendance.create') && !focusStudent && (
        <div className="card-soft overflow-hidden mb-3">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 px-3 py-2 border-bottom bg-white">
            <div className="fw-semibold small">
              <UserCheck size={15} className="me-1" />
              {t('modules.roster', { defaultValue: 'Class roster' })}
              {classId ? ` · ${t('modules.markedOf', { defaultValue: 'marked' })} ${tally.marked}/${students.length}` : ''}
            </div>
            <div className="d-flex flex-wrap gap-1">
              <button className="btn btn-sm btn-outline-success d-flex align-items-center gap-1" onClick={() => markAll('present')}
                disabled={!students.length || locked}>
                <CheckCheck size={14} /> {t('modules.markAllPresent', { defaultValue: 'Mark all present' })}
              </button>
              <button className={`btn btn-sm ${showRemarks ? 'btn-dark' : 'btn-outline-secondary'}`}
                onClick={() => setShowRemarks((v) => !v)}>
                {t('modules.remarks', { defaultValue: 'Remarks' })}
              </button>
            </div>
          </div>

          {!classId && <div className="p-4"><EmptyState title={t('modules.chooseClass', { defaultValue: 'Choose a class to load its roster' })} icon={ClipboardList} /></div>}
          {roster.loading && classId && <div className="p-3"><Spinner label={t('common.loading')} /></div>}
          {roster.error && classId && <div className="p-3"><ErrorState error={roster.error} onRetry={roster.reload} /></div>}
          {classId && !roster.loading && !roster.error && !students.length && (
            <div className="p-4"><EmptyState title={t('modules.emptyRoster', { defaultValue: 'This class has no students yet' })} /></div>
          )}

          {students.length > 0 && (
            <div className="table-responsive">
              <table className="table align-middle mb-0">
                <thead className="bg-white">
                  <tr>
                    <th>{t('modules.student', { defaultValue: 'Student' })}</th>
                    <th className="text-nowrap">{t('modules.status', { defaultValue: 'Status' })}</th>
                    {showRemarks && <th style={{ width: '28%' }}>{t('modules.remarks', { defaultValue: 'Remarks' })}</th>}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s, index) => {
                    const current = marks[s.id]?.attendance_status || '';
                    return (
                      <tr key={s.id}>
                        <td>
                          <div className="fw-semibold small">{s.full_name}</div>
                          <div className="text-muted small">{s.admission_number}</div>
                        </td>
                        <td className="text-nowrap">
                          <div className="btn-group" role="radiogroup"
                            aria-label={`${t('modules.attendance', { defaultValue: 'Attendance' })} · ${s.full_name}`}>
                            {STATUSES.map((status) => {
                              const inputId = `att-${s.id}-${status}`;
                              return (
                                <div key={status} className="d-inline-flex">
                                  <input type="radio" className="btn-check" id={inputId} name={`att-${s.id}`}
                                    autoComplete="off" checked={current === status} disabled={locked}
                                    onChange={() => setMark(s.id, status)} />
                                  <label className={`btn btn-sm btn-outline-${status === 'present' ? 'success' : status === 'absent' ? 'danger' : status === 'late' ? 'warning' : 'secondary'} ${current === status ? STATUS_BTN[status] + ' text-white' : ''}`}
                                    htmlFor={inputId}>
                                    {t(STATUS_LABEL_KEY[status], { defaultValue: STATUS_FALLBACK[status] })}
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                          {index === 0 && <span className="visually-hidden">{t('modules.radioHint', { defaultValue: 'Use the arrow keys to change the status' })}</span>}
                        </td>
                        {showRemarks && (
                          <td>
                            <input className="form-control form-control-sm" value={marks[s.id]?.remarks || ''}
                              disabled={locked}
                              placeholder={`${t('modules.optional', { defaultValue: 'Optional' })}${subjectId ? ` · ${subjectName(subjectId)}` : ''}`}
                              onChange={(e) => setRemark(s.id, e.target.value)} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {students.length > 0 && (
            <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 px-3 py-2 border-top bg-white">
              <div className="d-flex flex-wrap gap-2 small">
                {STATUSES.map((status) => (
                  <span key={status} className={`badge ${STATUS_BTN[status]}`}>
                    {t(STATUS_LABEL_KEY[status], { defaultValue: STATUS_FALLBACK[status] })} {tally[status]}
                  </span>
                ))}
                <span className="badge text-bg-light border">{t('modules.unmarked', { defaultValue: 'Unmarked' })} {students.length - tally.marked}</span>
              </div>
              <button className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={save}
                disabled={saving || !tally.marked || !canSaveNow}>
                {locked ? <Lock size={14} /> : <Save size={14} />}
                {locked
                  ? t('modules.takenToday', { defaultValue: 'Taken today' })
                  : saving ? '…' : t('modules.saveSession', { defaultValue: 'Save session' })}
                {!locked && ` (${tally.marked})`}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="row g-3 mb-1">
        {personal ? (
          <>
            <div className="col-6 col-lg-3">
              <StatCard label={t('modules.classesToday', { defaultValue: 'Classes today' })}
                value={todayStats?.classes ?? 0} tone="brand" />
            </div>
            {['present', 'absent', 'late'].map((status) => (
              <div className="col-6 col-lg-3" key={status}>
                <StatCard label={t(STATUS_LABEL_KEY[status], { defaultValue: STATUS_FALLBACK[status] })}
                  value={todayStats?.[status] ?? 0} tone="brand" />
              </div>
            ))}
          </>
        ) : STATUSES.map((status) => (
          <div className="col-6 col-lg-3" key={status}>
            <StatCard label={t(STATUS_LABEL_KEY[status], { defaultValue: STATUS_FALLBACK[status] })}
              value={tally[status] || 0} tone="brand" />
          </div>
        ))}
      </div>

      {personal && (
        <>
          <div className="card-soft overflow-hidden mb-3">
            <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 px-3 py-2 border-bottom bg-white">
              <div className="fw-semibold small d-inline-flex align-items-center gap-2">
                <BookOpen size={15} />
                {t('modules.todaysClasses', { defaultValue: "Today's classes" })}
                {child?.classes?.name ? <span className="badge text-bg-light border">{child.classes.name}</span> : null}
              </div>
              <span className="badge text-bg-light border">
                {t('modules.classCount', { defaultValue: '{{count}} classes', count: todayStats?.classes ?? 0 })}
              </span>
            </div>
            {myRecords.loading && !myRecords.data && <div className="p-3"><Spinner label={t('common.loading')} /></div>}
            {myRecords.error && <div className="p-3"><ErrorState error={myRecords.error} onRetry={myRecords.reload} /></div>}
            {!myRecords.loading && !myRecords.error && !(todayStats?.records || []).length && (
              <div className="p-4">
                <EmptyState icon={BookOpen}
                  title={t('modules.noAttendanceToday', { defaultValue: 'No attendance has been recorded for you today' })} />
              </div>
            )}
            {(todayStats?.records || []).length > 0 && (
              <div className="table-responsive">
                <table className="table align-middle mb-0 student-timetable-table">
                  <thead>
                    <tr>
                      <th style={{ width: 56 }}>SN</th>
                      <th>{t('modules.subject', { defaultValue: 'Subject' })}</th>
                      <th>{t('modules.teacher', { defaultValue: 'Teacher' })}</th>
                      <th>{t('common.status')}</th>
                      <th>{t('modules.remarks', { defaultValue: 'Remarks' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(todayStats?.records || []).map((r, index) => (
                      <tr key={r.id}>
                        <td><span className="sn-chip">{index + 1}</span></td>
                        <td>
                          <div className="fw-semibold small">{r.subject || t('modules.dailyAttendance', { defaultValue: 'Daily attendance' })}</div>
                          <div className="small text-muted">{r.date}</div>
                        </td>
                        <td>
                          {r.teacher ? (
                            <span className="teacher-cell">
                              <span className="teacher-avatar">
                                {r.teacher_avatar ? <img src={r.teacher_avatar} alt="" /> : initials(r.teacher)}
                              </span>
                              <span className="small fw-semibold">{r.teacher}</span>
                            </span>
                          ) : <span className="small text-muted">—</span>}
                        </td>
                        <td><StatusBadge value={r.status} /></td>
                        <td className="small text-muted">{r.remarks || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card-soft p-3 mb-3">
            <div className="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-2">
              <div>
                <div className="fw-semibold">{t('modules.attendanceHistory', { defaultValue: 'Attendance history' })}</div>
                <div className="small text-muted">
                  {t('modules.attendanceHistoryHint', { defaultValue: 'Every subject, the teacher who marked it, and your status.' })}
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2 align-items-end">
                <div>
                  <label className="form-label small fw-semibold mb-1" htmlFor="hist-from">{t('modules.from', { defaultValue: 'From' })}</label>
                  <input id="hist-from" type="date" className="form-control form-control-sm" value={from} max={to}
                    onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div>
                  <label className="form-label small fw-semibold mb-1" htmlFor="hist-to">{t('modules.to', { defaultValue: 'To' })}</label>
                  <input id="hist-to" type="date" className="form-control form-control-sm" value={to} min={from}
                    onChange={(e) => setTo(e.target.value)} />
                </div>
                <button className="btn btn-sm btn-outline-secondary" onClick={myRecords.reload}>{t('common.refresh')}</button>
              </div>
            </div>

            {myRecords.loading && !myRecords.data && <Spinner label={t('common.loading')} />}
            {myRecords.error && <ErrorState error={myRecords.error} onRetry={myRecords.reload} />}
            {!myRecords.loading && !myRecords.error && !historyRecords.length && (
              <EmptyState title={t('modules.noAttendanceYet', { defaultValue: 'No attendance recorded in this range' })} />
            )}
            {historyRecords.length > 0 && (
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle mb-0">
                  <thead className="bg-white">
                    <tr>
                      <th>{t('common.date')}</th>
                      <th>{t('modules.subject', { defaultValue: 'Subject' })}</th>
                      <th>{t('modules.teacher', { defaultValue: 'Teacher' })}</th>
                      <th>{t('common.status')}</th>
                      <th>{t('modules.remarks', { defaultValue: 'Remarks' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRecords.map((r) => (
                      <tr key={r.id}>
                        <td className="small tabular-nums">{r.date}</td>
                        <td className="small fw-semibold">{r.subject || t('modules.dailyAttendance', { defaultValue: 'Daily attendance' })}</td>
                        <td>
                          {r.teacher ? (
                            <span className="teacher-cell">
                              <span className="teacher-avatar">
                                {r.teacher_avatar ? <img src={r.teacher_avatar} alt="" /> : initials(r.teacher)}
                              </span>
                              <span className="small">{r.teacher}</span>
                            </span>
                          ) : <span className="small text-muted">—</span>}
                        </td>
                        <td><StatusBadge value={r.status} /></td>
                        <td className="small text-muted">{r.remarks || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {myRecords.data?.range && (
              <div className="small text-muted mt-2">
                {t('modules.attendanceRateLine', {
                  defaultValue: 'Attendance rate {{rate}} · {{total}} sessions',
                  rate: myRecords.data.range.rate == null ? '—' : `${myRecords.data.range.rate}%`,
                  total: myRecords.data.range.total,
                })}
              </div>
            )}
          </div>
        </>
      )}

      {!personal && (
      <div className="card-soft p-3 mb-3">
        <div className="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-2">
          <div className="fw-semibold">{t('modules.periodSummary', { defaultValue: 'Period summary' })}</div>
          <div className="d-flex flex-wrap gap-2 align-items-end">
            <div>
              <label className="form-label small fw-semibold mb-1" htmlFor="sum-from">{t('modules.from', { defaultValue: 'From' })}</label>
              <input id="sum-from" type="date" className="form-control form-control-sm" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="form-label small fw-semibold mb-1" htmlFor="sum-to">{t('modules.to', { defaultValue: 'To' })}</label>
              <input id="sum-to" type="date" className="form-control form-control-sm" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button className="btn btn-sm btn-outline-secondary" onClick={summary.reload}>{t('common.retry')}</button>
          </div>
        </div>

        {!classId && !focusStudent && (
          <EmptyState title={personal
            ? t('modules.noLinkedStudent', { defaultValue: 'No student linked to this account' })
            : t('modules.summaryNeedsContext', { defaultValue: 'Choose a class (or open a student) to see the summary' })} />
        )}
        {summary.loading && !summary.data && <Spinner label={t('common.loading')} />}
        {summary.error && <ErrorState error={summary.error} onRetry={summary.reload} />}
        {(classId || focusStudent) && !summary.loading && !summary.error && !summaryRows.length && (
          <EmptyState title={t('modules.noAttendanceYet', { defaultValue: 'No attendance recorded in this range' })} />
        )}
        {summaryRows.length > 0 && (
          <div className="table-responsive">
            <table className="table table-sm table-hover align-middle mb-0">
              <thead className="bg-white">
                <tr>
                  <th>{t('modules.student', { defaultValue: 'Student' })}</th>
                  {STATUSES.map((status) => (
                    <th key={status} className="text-end">{t(STATUS_LABEL_KEY[status], { defaultValue: STATUS_FALLBACK[status] })}</th>
                  ))}
                  <th className="text-end">{t('modules.sessions', { defaultValue: 'Sessions' })}</th>
                  <th style={{ width: 160 }}>{t('modules.rate', { defaultValue: 'Rate' })}</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="fw-semibold small">{r.name}</div>
                      {r.admission_number && <div className="text-muted small">{r.admission_number}</div>}
                    </td>
                    {STATUSES.map((status) => <td key={status} className="text-end tabular-nums">{r[status] ?? 0}</td>)}
                    <td className="text-end tabular-nums">{r.total ?? 0}</td>
                    <td>
                      <div className="progress" style={{ height: 8 }} role="progressbar"
                        aria-valuenow={Number(r.rate ?? 0)} aria-valuemin={0} aria-valuemax={100}
                        aria-label={t('modules.rate', { defaultValue: 'Rate' })}>
                        <div className={`progress-bar ${r.rate >= 85 ? 'bg-success' : r.rate >= 70 ? 'bg-warning' : 'bg-danger'}`}
                          style={{ width: `${Math.min(100, Number(r.rate ?? 0))}%` }} />
                      </div>
                      <div className="small text-muted">{r.rate == null ? '—' : `${r.rate}%`}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {(personal || can('attendance.create')) && (
        <div className="card-soft p-3 mb-3">
          <div className="fw-semibold mb-2">{t('modules.requestCorrection', { defaultValue: 'Request a correction' })}</div>
          <p className="small text-muted">{t('modules.requestCorrectionHint', { defaultValue: 'Corrections apply to a date that already has an attendance record; a reviewer has to approve them.' })}</p>
          <div className="row g-2">
            <div className="col-12 col-md-4">
              {personal ? (
                <input className="form-control form-control-sm bg-light" readOnly
                  value={child?.full_name || t('modules.thisStudent', { defaultValue: 'This student' })}
                  aria-label={t('modules.student', { defaultValue: 'Student' })} />
              ) : (
                <select className="form-select form-select-sm" value={request.student_id} aria-label={t('modules.student', { defaultValue: 'Student' })}
                  onChange={(e) => setRequest((prev) => ({ ...prev, student_id: e.target.value }))}>
                  <option value="">{classId ? t('modules.selectStudent', { defaultValue: 'Select a student' }) : t('modules.pickClassFirstShort', { defaultValue: 'Choose a class first' })}</option>
                  {students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              )}
            </div>
            <div className="col-6 col-md-2">
              <input type="date" className="form-control form-control-sm" value={request.attendance_date} max={localDate()}
                aria-label={t('common.date')}
                onChange={(e) => setRequest((prev) => ({ ...prev, attendance_date: e.target.value }))} />
            </div>
            <div className="col-6 col-md-2">
              <select className="form-select form-select-sm" value={request.requested_status} aria-label={t('modules.requestedStatus', { defaultValue: 'Requested status' })}
                onChange={(e) => setRequest((prev) => ({ ...prev, requested_status: e.target.value }))}>
                {STATUSES.map((status) => <option key={status} value={status}>{t(STATUS_LABEL_KEY[status], { defaultValue: STATUS_FALLBACK[status] })}</option>)}
              </select>
            </div>
            <div className="col-12 col-md-2">
              <button className="btn btn-outline-primary btn-sm w-100 d-flex align-items-center justify-content-center gap-1"
                onClick={sendCorrection} disabled={requestBusy}>
                <Send size={14} /> {requestBusy ? '…' : t('modules.send', { defaultValue: 'Send' })}
              </button>
            </div>
            <div className="col-12">
              <textarea className="form-control form-control-sm" rows={2} value={request.reason}
                placeholder={t('modules.correctionReasonPlaceholder', { defaultValue: 'Why should this record change?' })}
                onChange={(e) => setRequest((prev) => ({ ...prev, reason: e.target.value }))} />
            </div>
          </div>
        </div>
      )}

      {can('attendance.approve') && (
        <div className="card-soft p-3">
          <div className="fw-semibold mb-2"><ShieldCheck size={15} className="me-1" />{t('modules.pendingCorrections', { defaultValue: 'Pending corrections' })}</div>
          {corrections.loading && !corrections.data && <Spinner label={t('common.loading')} />}
          {corrections.error && (
            <div className="small text-muted">
              {t('modules.correctionsUnavailable', { defaultValue: 'The correction queue could not be loaded from the API yet.' })}
              <span className="d-block text-danger small mt-1">{corrections.error.message}</span>
              <button className="btn btn-sm btn-outline-secondary mt-2" onClick={corrections.reload}>{t('common.retry')}</button>
            </div>
          )}
          {!corrections.loading && !corrections.error && !(corrections.data || []).length && (
            <EmptyState title={t('modules.noPendingCorrections', { defaultValue: 'No correction requests waiting' })} />
          )}
          {(corrections.data || []).length > 0 && (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead className="bg-white">
                  <tr>
                    <th>{t('modules.student', { defaultValue: 'Student' })}</th>
                    <th>{t('modules.change', { defaultValue: 'Change' })}</th>
                    <th>{t('modules.reason', { defaultValue: 'Reason' })}</th>
                    <th>{t('common.status')}</th>
                    <th className="text-end">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(corrections.data || []).map((c) => (
                    <tr key={c.id}>
                      <td className="small">
                        <div className="fw-semibold">{(students.find((s) => s.id === c.student_id)?.full_name) || c.student_id}</div>
                        <div className="text-muted">{String(c.created_at || '').slice(0, 10)}</div>
                      </td>
                      <td className="small text-nowrap">
                        <StatusBadge value={c.original_status} /> → <StatusBadge value={c.requested_status} />
                      </td>
                      <td className="small text-muted">{c.reason}</td>
                      <td><StatusBadge value={c.status} /></td>
                      <td className="text-end text-nowrap">
                        <button className="btn btn-sm btn-outline-success me-1" disabled={Boolean(reviewBusy)}
                          onClick={() => review(c.id, 'approve')}>
                          {t('modules.approve', { defaultValue: 'Approve' })}
                        </button>
                        <button className="btn btn-sm btn-outline-danger" disabled={Boolean(reviewBusy)}
                          onClick={() => review(c.id, 'reject')}>
                          {t('modules.reject', { defaultValue: 'Reject' })}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
