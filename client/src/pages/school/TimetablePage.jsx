/**
 * Class timetable builder. Pick a class and a day, then fill the periods in order
 * (1st Arabic, 2nd English …). Each select saves immediately; clearing a subject
 * removes that day's lesson. Periods are shared by every class and managed here too.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  CalendarDays, Check, Clock, DoorOpen, Loader2, Pencil, Plus, RefreshCw, ShieldAlert, Trash2, X,
} from 'lucide-react';
import { apiDelete, apiPatch, apiPost, apiSweep } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ConfirmDialog, Modal } from '../../components/ui/Modal.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../../components/ui/Basics.jsx';

// The database comment reads "Sat..Fri", so the Somali week starts on Saturday.
const DAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DAY_LABEL = {
  Saturday: 'sections.daySat', Sunday: 'sections.daySun', Monday: 'sections.dayMon',
  Tuesday: 'sections.dayTue', Wednesday: 'sections.dayWed', Thursday: 'sections.dayThu', Friday: 'sections.dayFri',
};
const DAY_SHORT = { Saturday: 'Sat', Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri' };

const todayName = () => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
const timeText = (value) => (value ? String(value).slice(0, 5) : '');

const periodTime = (period) => {
  const span = [timeText(period?.start_time), timeText(period?.end_time)].filter(Boolean).join(' – ');
  return span || '—';
};

const periodLabel = (period) => {
  const span = [timeText(period?.start_time), timeText(period?.end_time)].filter(Boolean).join('–');
  return span ? `${period.name} · ${span}` : period.name;
};

const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export default function TimetablePage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();

  const mayWrite = can('school.edit') || can('timetable.manage')
    || can('timetable.create') || can('timetable.edit');
  const mayDelete = can('school.edit') || can('timetable.manage') || can('timetable.delete');
  const canAddSubject = mayWrite && (can('students.create') || can('students.edit')
    || can('students.manage') || can('school.edit'));

  const [classId, setClassId] = useState(params.get('class') || '');
  const [day, setDay] = useState(() => (DAYS.includes(todayName()) ? todayName() : DAYS[0]));
  const [saving, setSaving] = useState('');
  const [periodsOpen, setPeriodsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [newSubjectFor, setNewSubjectFor] = useState(null);
  const [lessonTarget, setLessonTarget] = useState(null);
  const [newClassroomFor, setNewClassroomFor] = useState(null);

  const classes = useApi('/classes', { pageSize: 200 });
  const periods = useApi('/timetable-periods', { pageSize: 200 });
  const subjects = useApi('/subjects', { pageSize: 200 });
  const classrooms = useApi('/classrooms', { pageSize: 200 });
  const users = useApi('/school/teachers', undefined, mayWrite);
  const classSubjects = useApi('/class-subjects', { class_id: classId || undefined, pageSize: 200 }, Boolean(classId));
  const years = useApi('/academic-years', { pageSize: 50 });

  const entries = useApi('/timetable-entries', { class_id: classId || undefined, pageSize: 200 }, Boolean(classId));

  const classRows = classes.data || [];
  const periodRows = periods.data || [];
  const entryRows = entries.data || [];

  const sortedPeriods = useMemo(() => [...periodRows].sort((a, b) => {
    const at = timeText(a.start_time) || '99:99';
    const bt = timeText(b.start_time) || '99:99';
    return at.localeCompare(bt) || (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
  }), [periodRows]);

  // class-subjects embeds only subjects(name), so the id must come from the link row.
  const subjectOptions = useMemo(() => {
    const linkedIds = new Set((classSubjects.data || []).map((row) => row.subject_id).filter(Boolean));
    const byId = new Map();
    for (const subject of subjects.data || []) {
      if (!subject?.id) continue;
      byId.set(subject.id, {
        value: subject.id,
        label: subject.code ? `${subject.name} · ${subject.code}` : subject.name,
        linked: linkedIds.has(subject.id),
      });
    }
    for (const row of classSubjects.data || []) {
      if (!row?.subject_id) continue;
      const current = byId.get(row.subject_id);
      byId.set(row.subject_id, {
        value: row.subject_id,
        label: current?.label || row.subjects?.name || row.subject_id,
        linked: true,
      });
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [classSubjects.data, subjects.data]);

  // Only teaching staff are offered. Anyone already scheduled stays selectable so an old
  // assignment is not silently dropped from the dropdown.
  const teacherOptions = useMemo(() => {
    const list = (users.data || []).map((u) => ({ value: u.id, label: u.full_name }));
    const known = new Set(list.map((o) => o.value));
    for (const entry of entryRows) {
      if (!entry.teacher_id || known.has(entry.teacher_id)) continue;
      known.add(entry.teacher_id);
      list.push({
        value: entry.teacher_id,
        label: entry.school_users?.full_name
          || t('sections.assignedTeacher', { defaultValue: 'Current assignee' }),
      });
    }
    return list;
  }, [users.data, entryRows, t]);

  const classroomOptions = useMemo(() => (classrooms.data || []).map((c) => ({ value: c.id, label: c.name })), [classrooms.data]);

  const currentYearId = useMemo(() => {
    const list = years.data || [];
    return (list.find((y) => y.is_current) || list[0])?.id || '';
  }, [years.data]);

  const grid = useMemo(() => {
    const map = new Map();
    for (const entry of entryRows) map.set(`${entry.day_of_week}|${entry.period_id}`, entry);
    return map;
  }, [entryRows]);

  const lessonsForDay = useMemo(
    () => sortedPeriods.filter((p) => grid.has(`${day}|${p.id}`)).length,
    [sortedPeriods, grid, day],
  );

  // Keep the URL shareable: /school/timetable?class=<uuid>.
  useEffect(() => {
    if (!classId) return;
    if (params.get('class') !== classId) {
      const next = new URLSearchParams(params);
      next.set('class', classId);
      setParams(next, { replace: true });
    }
  }, [classId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (classId || !classRows.length) return;
    const fromUrl = params.get('class');
    setClassId(classRows.some((c) => c.id === fromUrl) ? fromUrl : classRows[0].id);
  }, [classRows, classId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedClass = classRows.find((c) => c.id === classId) || null;
  const loading = classes.loading || periods.loading;
  const error = classes.error || periods.error;

  const reloadAll = useCallback(() => {
    entries.reload();
    periods.reload();
  }, [entries.reload, periods.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveField = async (period, field, value) => {
    if (!classId) return;
    const entry = grid.get(`${day}|${period.id}`);
    setSaving(`${period.id}:${field}`);
    try {
      if (field === 'subject_id') {
        if (!value) {
          if (entry) await apiDelete(`/timetable-entries/${entry.id}`);
        } else if (entry) {
          await apiPatch(`/timetable-entries/${entry.id}`, { subject_id: value });
        } else {
          await apiPost('/timetable-entries', {
            class_id: classId,
            subject_id: value,
            day_of_week: day,
            period_id: period.id,
            ...(currentYearId ? { academic_year_id: currentYearId } : {}),
          });
        }
      } else if (entry) {
        await apiPatch(`/timetable-entries/${entry.id}`, { [field]: value || null });
      }
      entries.reload();
    } catch (err) {
      if (err.status === 409 || /duplicate|unique/i.test(err.message)) {
        toast.error(t('sections.lessonConflict', {
          defaultValue: 'That day and period already has a lesson for this class.',
        }));
      } else { toast.error(err.message); }
    } finally { setSaving(''); }
  };

  const removeEntry = async () => {
    if (!removeTarget) return;
    setSaving(`${removeTarget.id}:remove`);
    try {
      await apiDelete(`/timetable-entries/${removeTarget.id}`);
      toast.success(t('sections.lessonRemoved', { defaultValue: 'Lesson removed.' }));
      setRemoveTarget(null);
      entries.reload();
    } catch (err) { toast.error(err.message); } finally { setSaving(''); }
  };

  if (loading && !classes.data) return <div className="card-soft p-4"><Spinner label={t('common.loading')} /></div>;
  if (error) return <ErrorState error={error} onRetry={() => { classes.reload(); periods.reload(); }} />;

  return (
    <>
      <PageHeader
        title={t('sections.timetableBuilder', { defaultValue: 'Class timetable' })}
        subtitle={t('sections.timetableBuilderHint', {
          defaultValue: 'Choose a class and a day, then give every period its subject. Changes save as you pick.',
        })}
        actions={(
          <>
            <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
              onClick={reloadAll} disabled={entries.loading}>
              <RefreshCw size={14} className={entries.loading ? 'animate-spin' : undefined} /> {t('common.refresh')}
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
              onClick={() => setPeriodsOpen(true)}>
              <Clock size={14} /> {t('sections.managePeriods', { defaultValue: 'Periods' })}
            </button>
            {mayDelete && classId && entryRows.length > 0 && (
              <button type="button" className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                onClick={() => setClearOpen(true)}>
                <Trash2 size={14} /> {t('sections.deleteAll', { defaultValue: 'Delete all' })}
              </button>
            )}
          </>
        )}
      />

      <div className="card-soft p-2 p-md-3 mb-3 d-flex flex-wrap align-items-center gap-2">
        <label className="small fw-semibold mb-0" htmlFor="timetable-class">{t('sections.class', { defaultValue: 'Class' })}</label>
        <select id="timetable-class" className="form-select form-select-sm" style={{ maxWidth: 320 }}
          value={classId} onChange={(e) => setClassId(e.target.value)}>
          {classRows.length === 0 && <option value="">{t('sections.noClassesYet', { defaultValue: 'No classes yet' })}</option>}
          {classRows.map((cls) => <option key={cls.id} value={cls.id}>{cls.name}</option>)}
        </select>
        {selectedClass && (
          <span className="small text-muted">
            {entryRows.length} {t('sections.lessonsScheduled', { defaultValue: entryRows.length === 1 ? 'lesson scheduled this week' : 'lessons scheduled this week' })}
          </span>
        )}
        <span className="small text-muted ms-auto">
          {sortedPeriods.length} {t('sections.periodsLower', { defaultValue: sortedPeriods.length === 1 ? 'period' : 'periods' })}
        </span>
      </div>

      {classRows.length === 0 && (
        <div className="card-soft p-3">
          <EmptyState icon={CalendarDays}
            title={t('sections.timetableNeedsClass', { defaultValue: 'Create a class first' })}
            hint={t('sections.timetableNeedsClassHint', {
              defaultValue: 'A timetable belongs to a class. Add one in Classes & sections, then come back here.',
            })} />
        </div>
      )}

      {classRows.length > 0 && sortedPeriods.length === 0 && (
        <div className="card-soft p-3">
          <EmptyState icon={Clock}
            title={t('sections.timetableNeedsPeriods', { defaultValue: 'Add the school periods first' })}
            hint={t('sections.timetableNeedsPeriodsHint', {
              defaultValue: 'Periods are the lesson slots (1st 08:00–08:45, 2nd 08:45–09:30…). Add them once, then every class uses them.',
            })} />
          <div className="text-center pb-3">
            <button type="button" className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1" onClick={() => setPeriodsOpen(true)}>
              <Plus size={15} /> {t('sections.addPeriods', { defaultValue: 'Add periods' })}
            </button>
          </div>
        </div>
      )}

      {classRows.length > 0 && sortedPeriods.length > 0 && (
        <>
          <div className="timetable-days mb-3" role="tablist" aria-label={t('sections.day', { defaultValue: 'Day' })}>
            {DAYS.map((name) => {
              const count = sortedPeriods.filter((p) => grid.has(`${name}|${p.id}`)).length;
              return (
                <button key={name} type="button" role="tab" aria-selected={day === name}
                  className={`timetable-day ${day === name ? 'active' : ''}`}
                  onClick={() => setDay(name)}>
                  <span className="fw-semibold">{t(DAY_LABEL[name], { defaultValue: DAY_SHORT[name] })}</span>
                  <span className="small">{count}/{sortedPeriods.length}</span>
                </button>
              );
            })}
          </div>

          <div className="card-soft p-0 overflow-hidden">
            <div className="d-flex flex-wrap align-items-center gap-2 p-3 border-bottom">
              <div className="fw-semibold">
                {selectedClass?.name} · {t(DAY_LABEL[day], { defaultValue: DAY_SHORT[day] })}
              </div>
              <span className="small text-muted">
                {t('sections.dayLessons', { defaultValue: '{{count}} of {{total}} periods have a lesson', count: lessonsForDay, total: sortedPeriods.length })}
              </span>
            </div>

            {entries.error && <div className="p-3"><ErrorState error={entries.error} onRetry={entries.reload} /></div>}
            {!entries.error && (
              <div className="table-responsive">
                <table className="table align-middle mb-0 timetable-day-table">
                  <thead className="bg-white">
                    <tr>
                      <th style={{ minWidth: 120 }}>{t('sections.period', { defaultValue: 'Period' })}</th>
                      <th style={{ minWidth: 220 }}>{t('sections.subject', { defaultValue: 'Subject' })}</th>
                      <th style={{ minWidth: 180 }}>{t('sections.teacher', { defaultValue: 'Teacher' })}</th>
                      <th style={{ minWidth: 140 }}>{t('sections.classroom', { defaultValue: 'Classroom' })}</th>
                      {mayWrite && <th className="text-end" style={{ width: 96 }}>{t('common.actions')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPeriods.map((period) => {
                      const entry = grid.get(`${day}|${period.id}`);
                      const rowBusy = saving.startsWith(`${period.id}:`);
                      return (
                        <tr key={period.id} className={entry ? '' : 'timetable-row-empty'}>
                          <td>
                            <div className="fw-semibold">{period.name}</div>
                            <div className="small text-muted tabular-nums">{periodTime(period)}</div>
                          </td>
                          <td>
                            {mayWrite ? (
                              <select className="form-select form-select-sm" value={entry?.subject_id || ''} disabled={rowBusy}
                                aria-label={`${period.name} ${t('sections.subject', { defaultValue: 'Subject' })}`}
                                onChange={(e) => {
                                  if (e.target.value === '__new') { setNewSubjectFor(period); return; }
                                  saveField(period, 'subject_id', e.target.value);
                                }}>
                                <option value="">{t('sections.noLesson', { defaultValue: '— no lesson —' })}</option>
                                {subjectOptions.some((o) => o.linked) && (
                                  <optgroup label={t('sections.classSubjects', { defaultValue: 'Subjects for this class' })}>
                                    {subjectOptions.filter((o) => o.linked).map((o) => (
                                      <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                  </optgroup>
                                )}
                                {(subjectOptions.some((o) => !o.linked) || subjectOptions.length === 0) && (
                                  <optgroup label={t('sections.allSubjects', { defaultValue: 'All school subjects' })}>
                                    {subjectOptions.filter((o) => !o.linked).map((o) => (
                                      <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                    {subjectOptions.length === 0 && (
                                      <option value="" disabled>{t('sections.noSubjectsYet', { defaultValue: 'No subjects yet' })}</option>
                                    )}
                                  </optgroup>
                                )}
                                {canAddSubject && (
                                  <option value="__new">{t('sections.addNewSubject', { defaultValue: '＋ Add new subject…' })}</option>
                                )}
                              </select>
                            ) : <span>{entry?.subjects?.name || '—'}</span>}
                          </td>
                          <td>
                            {mayWrite ? (
                              <select className="form-select form-select-sm" value={entry?.teacher_id || ''} disabled={!entry || rowBusy}
                                aria-label={`${period.name} ${t('sections.teacher', { defaultValue: 'Teacher' })}`}
                                onChange={(e) => saveField(period, 'teacher_id', e.target.value)}>
                                <option value="">{t('sections.noneOption', { defaultValue: '— none —' })}</option>
                                {teacherOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            ) : <span>{entry?.school_users?.full_name || '—'}</span>}
                          </td>
                          <td>
                            {mayWrite ? (
                              <select className="form-select form-select-sm" value={entry?.classroom_id || ''} disabled={!entry || rowBusy}
                                aria-label={`${period.name} ${t('sections.classroom', { defaultValue: 'Classroom' })}`}
                                onChange={(e) => {
                                  if (e.target.value === '__new') { setNewClassroomFor({ period, entry }); return; }
                                  saveField(period, 'classroom_id', e.target.value);
                                }}>
                                <option value="">{t('sections.noneOption', { defaultValue: '— none —' })}</option>
                                {classroomOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                <option value="__new">{t('sections.addNewClassroom', { defaultValue: '＋ Add new classroom…' })}</option>
                              </select>
                            ) : <span>{entry?.classrooms?.name || '—'}</span>}
                          </td>
                          {mayWrite && (
                            <td className="text-end text-nowrap">
                              <button type="button" className="btn-icon sm me-1" disabled={rowBusy}
                                aria-label={entry ? t('common.edit', { defaultValue: 'Edit' }) : t('sections.addLesson', { defaultValue: 'Add lesson' })}
                                title={entry ? t('common.edit', { defaultValue: 'Edit' }) : t('sections.addLesson', { defaultValue: 'Add lesson' })}
                                onClick={() => setLessonTarget({ period, entry })}>
                                <Pencil size={14} />
                              </button>
                              {entry ? (
                                <button type="button" className="btn-icon sm text-danger" disabled={rowBusy}
                                  aria-label={t('common.delete')} title={t('common.delete')}
                                  onClick={() => setRemoveTarget(entry)}>
                                  {rowBusy ? <Loader2 size={14} className="animate-spin" /> : <X size={15} />}
                                </button>
                              ) : null}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="small text-muted mt-2">
            {t('sections.timetableDayHint', {
              defaultValue: 'Pick a subject for each period — 1st Arabic, 2nd English, 3rd Somali and so on. Leave a period empty for a break or free lesson.',
            })}
          </div>
          {classroomOptions.length === 0 && (
            <div className="small text-muted mt-1">
              {t('sections.noClassroomsHint', {
                defaultValue: 'No classrooms yet — choose “＋ Add new classroom…” in any row, or add them under Classrooms in the Academics menu.',
              })}
            </div>
          )}
        </>
      )}

      <LessonModal
        open={Boolean(lessonTarget)}
        target={lessonTarget}
        day={day}
        classId={classId}
        subjects={subjectOptions}
        teachers={teacherOptions}
        classrooms={classroomOptions}
        currentYearId={currentYearId}
        onClassroomCreated={() => classrooms.reload()}
        onClose={() => setLessonTarget(null)}
        onSaved={() => entries.reload()}
      />

      <NewClassroomModal
        open={Boolean(newClassroomFor)}
        onClose={() => setNewClassroomFor(null)}
        onCreated={(room) => {
          const target = newClassroomFor;
          classrooms.reload();
          setNewClassroomFor(null);
          if (target?.entry) saveField(target.period, 'classroom_id', room.id);
        }}
      />

      <PeriodsModal
        open={periodsOpen}
        periods={sortedPeriods}
        mayWrite={mayWrite}
        onClose={() => setPeriodsOpen(false)}
        onChanged={() => { periods.reload(); entries.reload(); }}
      />

      <ClearTimetableModal
        open={clearOpen}
        rows={entryRows.length}
        onClose={() => setClearOpen(false)}
        onCleared={() => { setClearOpen(false); entries.reload(); }}
      />

      <NewSubjectModal
        open={Boolean(newSubjectFor)}
        classId={classId}
        className={selectedClass?.name}
        onClose={() => setNewSubjectFor(null)}
        onCreated={(subject) => {
          const period = newSubjectFor;
          setNewSubjectFor(null);
          subjects.reload();
          classSubjects.reload();
          if (period && subject?.id) saveField(period, 'subject_id', subject.id);
        }}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={t('sections.removeLesson', { defaultValue: 'Remove lesson' })}
        message={t('sections.removeLessonConfirm', {
          defaultValue: 'Remove {{subject}} from {{day}}?',
          subject: removeTarget?.subjects?.name || t('sections.lesson', { defaultValue: 'this lesson' }),
          day: t(DAY_LABEL[removeTarget?.day_of_week] || 'sections.daySat', { defaultValue: DAY_SHORT[removeTarget?.day_of_week] || '' }),
        })}
        confirmLabel={t('common.remove', { defaultValue: 'Remove' })}
        busy={Boolean(saving)}
        onConfirm={removeEntry}
        onClose={() => setRemoveTarget(null)}
      />
    </>
  );
}

// ── One lesson as a form: subject, teacher and classroom together ─
function LessonModal({
  open, target, day, classId, subjects, teachers, classrooms, currentYearId,
  onClassroomCreated, onClose, onSaved,
}) {
  const { t } = useTranslation();
  const period = target?.period || null;
  const entry = target?.entry || null;
  const [form, setForm] = useState({ subject_id: '', teacher_id: '', classroom_id: '' });
  const [extraRooms, setExtraRooms] = useState([]);
  const [roomOpen, setRoomOpen] = useState(false);
  const [roomDraft, setRoomDraft] = useState({ name: '', capacity: '' });
  const [roomBusy, setRoomBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      subject_id: entry?.subject_id || '',
      teacher_id: entry?.teacher_id || '',
      classroom_id: entry?.classroom_id || '',
    });
    setExtraRooms([]);
    setRoomOpen(false);
    setRoomDraft({ name: '', capacity: '' });
  }, [open, entry]);

  const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const roomOptions = useMemo(() => {
    const list = [...classrooms];
    const known = new Set(list.map((o) => o.value));
    for (const room of extraRooms) if (!known.has(room.id)) list.push({ value: room.id, label: room.name });
    return list;
  }, [classrooms, extraRooms]);

  const createRoom = async () => {
    if (!roomDraft.name.trim()) { toast.error(t('common.required')); return; }
    setRoomBusy(true);
    try {
      const { data } = await apiPost('/classrooms', {
        name: roomDraft.name.trim(),
        ...(roomDraft.capacity === '' ? {} : { capacity: Number(roomDraft.capacity) }),
      });
      setExtraRooms((prev) => [...prev, data]);
      setField('classroom_id', data.id);
      setRoomDraft({ name: '', capacity: '' });
      setRoomOpen(false);
      onClassroomCreated?.();
      toast.success(t('sections.classroomAdded', { defaultValue: '{{name}} added to the classroom list.', name: data.name }));
    } catch (error) { toast.error(error.message); } finally { setRoomBusy(false); }
  };

  const submit = async () => {
    if (!classId || !period) return;
    if (!form.subject_id) {
      toast.error(t('sections.pickSubjectFirst', { defaultValue: 'Pick a subject before saving this lesson.' }));
      return;
    }
    setBusy(true);
    try {
      const payload = {
        subject_id: form.subject_id,
        teacher_id: form.teacher_id || null,
        classroom_id: form.classroom_id || null,
      };
      if (entry?.id) await apiPatch(`/timetable-entries/${entry.id}`, payload);
      else {
        await apiPost('/timetable-entries', {
          class_id: classId,
          day_of_week: day,
          period_id: period.id,
          ...(currentYearId ? { academic_year_id: currentYearId } : {}),
          ...payload,
        });
      }
      toast.success(t('sections.lessonSaved', { defaultValue: 'Lesson saved.' }));
      onSaved();
      onClose();
    } catch (error) {
      if (error.status === 409 || /duplicate|unique/i.test(error.message)) {
        toast.error(t('sections.lessonConflict', {
          defaultValue: 'That day and period already has a lesson for this class.',
        }));
      } else { toast.error(error.message); }
    } finally { setBusy(false); }
  };

  return (
    <>
      <Modal open={open} size="md" icon={Pencil}
        title={period ? `${period.name} · ${t(DAY_LABEL[day] || 'sections.daySat', { defaultValue: DAY_SHORT[day] || day })}` : t('sections.editLesson', { defaultValue: 'Edit lesson' })}
        subtitle={period ? periodTime(period) : ''}
        onClose={onClose}
        footer={(
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={submit} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {t('common.save')}
            </button>
          </>
        )}>
        <div className="mb-3">
          <label className="form-label small fw-semibold" htmlFor="lesson-subject">
            {t('sections.subject', { defaultValue: 'Subject' })} <span className="text-danger">*</span>
          </label>
          <select id="lesson-subject" className="form-select" value={form.subject_id}
            onChange={(e) => setField('subject_id', e.target.value)}>
            <option value="">{t('sections.chooseSubject', { defaultValue: '— choose a subject —' })}</option>
            {subjects.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="mb-3">
          <label className="form-label small fw-semibold" htmlFor="lesson-teacher">
            {t('sections.teacher', { defaultValue: 'Teacher' })}
          </label>
          <select id="lesson-teacher" className="form-select" value={form.teacher_id}
            onChange={(e) => setField('teacher_id', e.target.value)}>
            <option value="">{t('sections.noneOption', { defaultValue: '— none —' })}</option>
            {teachers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <div className="d-flex align-items-center justify-content-between mb-1">
            <label className="form-label small fw-semibold mb-0" htmlFor="lesson-classroom">
              {t('sections.classroom', { defaultValue: 'Classroom' })}
            </label>
            <button type="button" className="btn btn-link btn-sm p-0 d-inline-flex align-items-center gap-1"
              onClick={() => setRoomOpen((prev) => !prev)}>
              <Plus size={13} /> {t('sections.newClassroom', { defaultValue: 'New classroom' })}
            </button>
          </div>
          <select id="lesson-classroom" className="form-select" value={form.classroom_id}
            onChange={(e) => setField('classroom_id', e.target.value)}>
            <option value="">{t('sections.noneOption', { defaultValue: '— none —' })}</option>
            {roomOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {roomOpen && (
            <div className="mt-2 p-2 rounded-3 border" style={{ background: '#fafaff' }}>
              <div className="d-flex align-items-end gap-2">
                <div className="flex-grow-1">
                  <label className="form-label small mb-1" htmlFor="lesson-room-name">
                    {t('sections.name', { defaultValue: 'Name' })}
                  </label>
                  <input id="lesson-room-name" className="form-control form-control-sm" autoFocus value={roomDraft.name}
                    placeholder={t('sections.classroomNamePlaceholder', { defaultValue: 'e.g. Room 1' })}
                    onChange={(e) => setRoomDraft((prev) => ({ ...prev, name: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createRoom(); } }} />
                </div>
                <div style={{ width: 110 }}>
                  <label className="form-label small mb-1" htmlFor="lesson-room-capacity">
                    {t('sections.capacity', { defaultValue: 'Capacity' })}
                  </label>
                  <input id="lesson-room-capacity" type="number" min="1" className="form-control form-control-sm"
                    value={roomDraft.capacity} placeholder="40"
                    onChange={(e) => setRoomDraft((prev) => ({ ...prev, capacity: e.target.value }))} />
                </div>
                <button type="button" className="btn btn-sm btn-primary" onClick={createRoom} disabled={roomBusy}
                  aria-label={t('common.save', { defaultValue: 'Save' })} title={t('common.save', { defaultValue: 'Save' })}>
                  {roomBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                </button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setRoomOpen(false)}
                  disabled={roomBusy} aria-label={t('common.cancel', { defaultValue: 'Cancel' })} title={t('common.cancel', { defaultValue: 'Cancel' })}>
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
          {roomOptions.length === 0 && !roomOpen && (
            <div className="small text-muted mt-1">
              {t('sections.noClassroomsYet', { defaultValue: 'No classrooms yet — create the first one with “New classroom”.' })}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

// ── Create a classroom without leaving the timetable ────────────
function NewClassroomModal({ open, onClose, onCreated }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!open) { setName(''); setCapacity(''); } }, [open]);

  const submit = async () => {
    if (!name.trim()) { toast.error(t('common.required', { defaultValue: 'This field is required.' })); return; }
    setBusy(true);
    try {
      const { data } = await apiPost('/classrooms', {
        name: name.trim(),
        ...(capacity === '' ? {} : { capacity: Number(capacity) }),
      });
      toast.success(t('sections.classroomAdded', { defaultValue: '{{name}} added to the classroom list.', name: data.name }));
      onCreated(data);
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} size="sm" icon={DoorOpen}
      title={t('sections.addNewClassroomTitle', { defaultValue: 'Add new classroom' })}
      subtitle={t('sections.addNewClassroomHint', {
        defaultValue: 'Classrooms are shared by every class and can be picked in any timetable row.',
      })}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            {t('common.save')}
          </button>
        </>
      )}>
      <div className="row g-2">
        <div className="col-8">
          <label className="form-label small fw-semibold" htmlFor="new-classroom-name">
            {t('sections.name', { defaultValue: 'Name' })} <span className="text-danger">*</span>
          </label>
          <input id="new-classroom-name" className="form-control" value={name} autoFocus
            placeholder={t('sections.classroomNamePlaceholder', { defaultValue: 'e.g. Room 1' })}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        </div>
        <div className="col-4">
          <label className="form-label small fw-semibold" htmlFor="new-classroom-capacity">
            {t('sections.capacity', { defaultValue: 'Capacity' })}
          </label>
          <input id="new-classroom-capacity" className="form-control" type="number" min="1" value={capacity}
            placeholder="40" onChange={(e) => setCapacity(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

// ── Periods modal ───────────────────────────────────────────────
function PeriodsModal({ open, periods, mayWrite, onClose, onChanged }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ name: '', start_time: '', end_time: '', sort_order: '' });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [clearText, setClearText] = useState('');
  const [editId, setEditId] = useState(null);
  const [row, setRow] = useState({ name: '', start_time: '', end_time: '', sort_order: '' });
  const [rowBusy, setRowBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setDraft({ name: '', start_time: '', end_time: '', sort_order: '' });
      setClearing(false);
      setClearText('');
      setEditId(null);
      setRowBusy(false);
    }
  }, [open]);

  const set = (name, value) => setDraft((prev) => ({ ...prev, [name]: value }));
  const setRowField = (name, value) => setRow((prev) => ({ ...prev, [name]: value }));

  const beginEdit = (period) => {
    setEditId(period.id);
    setRow({
      name: period.name || '',
      start_time: timeText(period.start_time),
      end_time: timeText(period.end_time),
      sort_order: period.sort_order ?? '',
    });
  };

  const cancelEdit = () => { setEditId(null); setRowBusy(false); };

  const saveRow = async () => {
    const period = periods.find((p) => p.id === editId);
    if (!period) { cancelEdit(); return; }
    const name = row.name.trim();
    if (!name) { toast.error(t('common.required')); return; }
    // Only the fields that actually changed go to the server; blank times keep the old value.
    const patch = {};
    if (name !== period.name) patch.name = name;
    const start = row.start_time.trim();
    const end = row.end_time.trim();
    if (start && start !== timeText(period.start_time)) patch.start_time = start;
    if (end && end !== timeText(period.end_time)) patch.end_time = end;
    if (row.sort_order !== '' && Number(row.sort_order) !== Number(period.sort_order)) {
      patch.sort_order = Number(row.sort_order);
    }
    if (!Object.keys(patch).length) { cancelEdit(); return; }
    setRowBusy(true);
    try {
      await apiPatch(`/timetable-periods/${period.id}`, patch);
      toast.success(t('sections.periodUpdated', { defaultValue: 'Period updated. Every class sees the new name.' }));
      setEditId(null);
      onChanged();
    } catch (error) { toast.error(error.message); } finally { setRowBusy(false); }
  };

  const add = async () => {
    if (!draft.name.trim()) { toast.error(t('common.required')); return; }
    setBusy(true);
    try {
      await apiPost('/timetable-periods', {
        name: draft.name.trim(),
        ...(draft.start_time ? { start_time: draft.start_time } : {}),
        ...(draft.end_time ? { end_time: draft.end_time } : {}),
        sort_order: draft.sort_order === '' ? periods.length + 1 : Number(draft.sort_order),
      });
      setDraft({ name: '', start_time: '', end_time: '', sort_order: '' });
      toast.success(t('sections.periodAdded', { defaultValue: 'Period added.' }));
      onChanged();
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };

  const addSeven = async () => {
    setBusy(true);
    try {
      const existing = new Set(periods.map((p) => String(p.name).toLowerCase()));
      const start = 8 * 60;
      let created = 0;
      for (let i = 1; i <= 7; i += 1) {
        const name = `P${i}`;
        if (existing.has(name.toLowerCase())) continue;
        await apiPost('/timetable-periods', {
          name,
          start_time: clock(start + (i - 1) * 45),
          end_time: clock(start + i * 45),
          sort_order: i,
        });
        created += 1;
      }
      toast.success(t('sections.periodsAdded', { defaultValue: 'Added {{count}} periods.', count: created }));
      onChanged();
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await apiDelete(`/timetable-periods/${removing.id}`);
      toast.success(t('sections.periodRemoved', { defaultValue: 'Period removed.' }));
      setRemoving(null);
      onChanged();
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      const { data } = await apiSweep('/timetable-periods/delete-all', { confirm: clearText });
      toast.success(t('sections.periodsCleared', {
        defaultValue: 'Deleted {{rows}} periods and their lessons. The recycle bin keeps a restorable snapshot.',
        rows: data?.rows ?? 0,
      }));
      setClearing(false);
      setClearText('');
      onChanged();
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };

  return (
    <>
      <Modal open={open} size="lg" icon={Clock} title={t('sections.managePeriods', { defaultValue: 'Periods' })}
        subtitle={t('sections.managePeriodsHint', { defaultValue: 'The daily lesson slots shared by every class. Removing a period also removes the lessons sitting in it.' })}
        onClose={onClose}
        footer={<button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.close')}</button>}>
        {periods.length === 0 ? (
          <div className="small text-muted mb-3">{t('sections.noPeriodsYet', { defaultValue: 'No periods yet — add the first slot below.' })}</div>
        ) : (
          <div className="table-responsive mb-3">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th>{t('sections.name', { defaultValue: 'Name' })}</th>
                  <th>{t('sections.start', { defaultValue: 'Start' })}</th>
                  <th>{t('sections.end', { defaultValue: 'End' })}</th>
                  <th>{t('sections.order', { defaultValue: 'Order' })}</th>
                  {mayWrite && <th className="text-end">{t('common.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => {
                  const isEditing = editId === p.id;
                  return isEditing ? (
                    <tr key={p.id} className="table-active">
                      <td>
                        <input className="form-control form-control-sm" value={row.name} autoFocus
                          aria-label={t('sections.name', { defaultValue: 'Name' })}
                          onChange={(e) => setRowField('name', e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRow();
                            if (e.key === 'Escape') cancelEdit();
                          }} />
                      </td>
                      <td>
                        <input className="form-control form-control-sm" style={{ maxWidth: 100 }} placeholder="08:00" value={row.start_time}
                          aria-label={t('sections.start', { defaultValue: 'Start' })}
                          onChange={(e) => setRowField('start_time', e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveRow(); if (e.key === 'Escape') cancelEdit(); }} />
                      </td>
                      <td>
                        <input className="form-control form-control-sm" style={{ maxWidth: 100 }} placeholder="08:45" value={row.end_time}
                          aria-label={t('sections.end', { defaultValue: 'End' })}
                          onChange={(e) => setRowField('end_time', e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveRow(); if (e.key === 'Escape') cancelEdit(); }} />
                      </td>
                      <td>
                        <input className="form-control form-control-sm" style={{ maxWidth: 80 }} type="number" min="1" value={row.sort_order}
                          aria-label={t('sections.order', { defaultValue: 'Order' })}
                          onChange={(e) => setRowField('sort_order', e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveRow(); if (e.key === 'Escape') cancelEdit(); }} />
                      </td>
                      <td className="text-end text-nowrap">
                        <button type="button" className="btn-icon sm text-success me-1" disabled={rowBusy}
                          aria-label={t('common.save', { defaultValue: 'Save' })} title={t('common.save', { defaultValue: 'Save' })}
                          onClick={saveRow}>
                          {rowBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        </button>
                        <button type="button" className="btn-icon sm" disabled={rowBusy}
                          aria-label={t('common.cancel', { defaultValue: 'Cancel' })} title={t('common.cancel', { defaultValue: 'Cancel' })}
                          onClick={cancelEdit}>
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={p.id} className={editId ? 'opacity-75' : undefined}>
                      <td className="fw-semibold">{p.name}</td>
                      <td className="tabular-nums">{timeText(p.start_time) || '—'}</td>
                      <td className="tabular-nums">{timeText(p.end_time) || '—'}</td>
                      <td className="tabular-nums">{p.sort_order ?? '—'}</td>
                      {mayWrite && (
                        <td className="text-end text-nowrap">
                          <button type="button" className="btn-icon sm me-1" aria-label={t('common.edit', { defaultValue: 'Edit' })}
                            title={t('common.edit', { defaultValue: 'Edit' })} disabled={Boolean(editId)}
                            onClick={() => beginEdit(p)}>
                            <Pencil size={14} />
                          </button>
                          <button type="button" className="btn-icon sm text-danger" aria-label={t('common.delete')}
                            title={t('common.delete')} disabled={Boolean(editId)} onClick={() => setRemoving(p)}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {mayWrite && (
          <>
            <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
              <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                onClick={addSeven} disabled={busy}>
                <Plus size={14} /> {t('sections.quickSeven', { defaultValue: 'Add 7 periods (08:00, 45 min each)' })}
              </button>
              <span className="small text-muted">{t('sections.quickSevenHint', { defaultValue: 'P1–P7, Saturday to Friday. Use the pencil to rename a period, change its time or reorder it.' })}</span>
            </div>

            <div className="row align-items-end">
              <div className="col-6 col-md-3 mb-2">
                <label className="form-label small" htmlFor="period-name">{t('sections.name', { defaultValue: 'Name' })}</label>
                <input id="period-name" className="form-control form-control-sm" placeholder="P1" value={draft.name}
                  onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="col-6 col-md-3 mb-2">
                <label className="form-label small" htmlFor="period-start">{t('sections.start', { defaultValue: 'Start' })}</label>
                <input id="period-start" className="form-control form-control-sm" placeholder="08:00" value={draft.start_time}
                  onChange={(e) => set('start_time', e.target.value)} />
              </div>
              <div className="col-6 col-md-3 mb-2">
                <label className="form-label small" htmlFor="period-end">{t('sections.end', { defaultValue: 'End' })}</label>
                <input id="period-end" className="form-control form-control-sm" placeholder="08:45" value={draft.end_time}
                  onChange={(e) => set('end_time', e.target.value)} />
              </div>
              <div className="col-6 col-md-2 mb-2">
                <label className="form-label small" htmlFor="period-order">{t('sections.order', { defaultValue: 'Order' })}</label>
                <input id="period-order" type="number" className="form-control form-control-sm" value={draft.sort_order}
                  onChange={(e) => set('sort_order', e.target.value)} />
              </div>
              <div className="col-12 col-md-1 mb-2">
                <button type="button" className="btn btn-sm btn-primary w-100" onClick={add} disabled={busy}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                </button>
              </div>
            </div>
          </>
        )}

        {mayWrite && periods.length > 0 && (
          <div className="border-top mt-3 pt-3">
            {!clearing ? (
              <button type="button" className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                onClick={() => setClearing(true)}>
                <Trash2 size={14} /> {t('sections.deleteAllPeriods', { defaultValue: 'Delete all periods' })}
              </button>
            ) : (
              <div className="rounded-3 border border-danger-subtle p-3" style={{ background: '#fff5f5' }}>
                <div className="d-flex align-items-start gap-2 mb-2">
                  <ShieldAlert size={16} className="text-danger mt-1 flex-shrink-0" />
                  <div>
                    <div className="small fw-semibold text-danger">
                      {t('sections.deleteAllPeriodsConfirm', { defaultValue: 'Delete all {{count}} periods?', count: periods.length })}
                    </div>
                    <div className="small text-muted">
                      {t('sections.deleteAllPeriodsHint', {
                        defaultValue: 'Every period and every lesson sitting in it is removed for the whole school. A restorable snapshot is kept in the recycle bin.',
                      })}
                    </div>
                  </div>
                </div>
                <div className="d-flex flex-wrap gap-2">
                  <input className="form-control form-control-sm" style={{ maxWidth: 200 }} value={clearText}
                    placeholder="DELETE ALL" autoComplete="off" aria-label={t('sections.typeDeleteAll', { defaultValue: 'Type “DELETE ALL” to confirm' })}
                    onChange={(e) => setClearText(e.target.value)} />
                  <button type="button" className="btn btn-sm btn-danger d-inline-flex align-items-center gap-1"
                    onClick={clearAll} disabled={busy || clearText.trim().toUpperCase() !== 'DELETE ALL'}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    {t('sections.deleteAll', { defaultValue: 'Delete all' })}
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-secondary"
                    onClick={() => { setClearing(false); setClearText(''); }}>
                    {t('common.cancel', { defaultValue: 'Cancel' })}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        title={t('sections.removePeriod', { defaultValue: 'Remove period' })}
        message={t('sections.removePeriodConfirm', {
          defaultValue: 'Remove {{name}}? Any lesson in this period is removed from the timetable too.',
          name: removing?.name || '',
        })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        busy={busy}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}

// ── Create a subject without leaving the timetable ──────────────
function NewSubjectModal({ open, classId, className, onClose, onCreated }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!open) { setName(''); setCode(''); } }, [open]);

  const submit = async () => {
    if (!name.trim()) { toast.error(t('common.required', { defaultValue: 'This field is required.' })); return; }
    setBusy(true);
    try {
      const { data: subject } = await apiPost('/subjects', {
        name: name.trim(),
        ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
      });
      if (classId) {
        try { await apiPost('/class-subjects', { class_id: classId, subject_id: subject.id }); }
        catch (error) { if (error.status !== 409) throw error; }
      }
      toast.success(t('sections.subjectAdded', { defaultValue: '{{name}} added to the subject list.', name: subject.name }));
      onCreated(subject);
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} size="sm" icon={Plus}
      title={t('sections.addNewSubjectTitle', { defaultValue: 'Add new subject' })}
      subtitle={className
        ? t('sections.addNewSubjectHint', { defaultValue: 'It is created once for the school and linked to {{class}} automatically.', class: className })
        : t('sections.addNewSubjectHintNoClass', { defaultValue: 'It is created once for the school and can be used in any class.' })}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            {t('sections.createAndAssign', { defaultValue: 'Create & assign' })}
          </button>
        </>
      )}>
      <div className="row g-2">
        <div className="col-8">
          <label className="form-label small fw-semibold" htmlFor="new-subject-name">
            {t('sections.subjectName', { defaultValue: 'Subject name' })}
          </label>
          <input id="new-subject-name" className="form-control" value={name} autoFocus
            placeholder={t('sections.subjectNamePlaceholder', { defaultValue: 'e.g. Arabic' })}
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="col-4">
          <label className="form-label small fw-semibold" htmlFor="new-subject-code">
            {t('sections.code', { defaultValue: 'Code' })}
          </label>
          <input id="new-subject-code" className="form-control" value={code} autoComplete="off"
            placeholder="ARB" onChange={(e) => setCode(e.target.value)} />
        </div>
      </div>
      <div className="small text-muted mt-2">
        {t('sections.subjectCodeHint', { defaultValue: 'The code is optional and helps on report cards.' })}
      </div>
    </Modal>
  );
}

// ── Delete all lessons ──────────────────────────────────────────
function ClearTimetableModal({ open, rows, onClose, onCleared }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!open) setText(''); }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await apiSweep('/timetable-entries/delete-all', { confirm: text });
      toast.success(t('sections.sectionCleared', {
        defaultValue: 'Deleted {{rows}} rows from this section. The recycle bin keeps a restorable snapshot.',
        rows: data?.rows ?? 0,
      }));
      onCleared();
    } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} size="sm" icon={Trash2}
      title={t('sections.clearTimetable', { defaultValue: 'Delete the whole timetable' })}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-danger d-inline-flex align-items-center gap-2"
            onClick={submit} disabled={busy || text.trim().toUpperCase() !== 'DELETE ALL'}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            {t('sections.deleteAll', { defaultValue: 'Delete all' })}
          </button>
        </>
      )}>
      <p className="small text-muted">
        {t('sections.clearTimetableHint', {
          defaultValue: 'This removes all {{rows}} lessons for the whole school, not just this class. The recycle bin keeps a restorable copy for each class involved.',
          rows,
        })}
      </p>
      <label className="form-label small fw-semibold" htmlFor="clear-timetable-confirm">
        {t('sections.typeDeleteAll', { defaultValue: 'Type “DELETE ALL” to confirm' })}
      </label>
      <input id="clear-timetable-confirm" className="form-control" value={text} autoComplete="off"
        placeholder="DELETE ALL" onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}
