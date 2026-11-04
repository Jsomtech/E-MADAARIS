/**
 * Class management: a card grid of every class for the school, and a detail view where
 * the roster can be inspected and students without a class can be assigned in one go.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  ArrowLeft, CalendarDays, DoorOpen, GraduationCap, Layers, Loader2, Pencil, Plus, RefreshCw, Search,
  School, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import { apiDelete, apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import {
  EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge,
} from '../../components/ui/Basics.jsx';
import StudentFormModal from '../school/StudentFormModal.jsx';
import ClassFormModal from './ClassFormModal.jsx';

const initials = (value) => String(value || '')
  .trim().split(/\s+/).filter(Boolean).slice(0, 2)
  .map((part) => part[0]?.toUpperCase() || '').join('') || '?';

const pct = (part, whole) => (whole ? Math.min(100, Math.round((part / whole) * 100)) : 0);

function attendanceTone(value) {
  if (value === null || value === undefined) return 'neutral';
  if (value >= 75) return 'ok';
  if (value >= 50) return 'warn';
  return 'danger';
}

function Avatar({ student, size = 38 }) {
  return (
    <span className="class-student-avatar" style={{ width: size, height: size }}>
      {student.photo_url
        ? <img src={student.photo_url} alt="" />
        : initials(student.full_name || `${student.first_name || ''} ${student.last_name || ''}`)}
    </span>
  );
}

export default function ClassManagementPage() {
  const { t } = useTranslation();
  const { can } = useAuth();

  const mayView = can('students.view');
  const mayCreate = can('students.create');
  const mayEdit = can('students.edit');
  const mayDelete = can('students.delete');
  const mayAssign = can('students.assign') || mayEdit;
  const mayTimetable = can('timetable.view');

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState({ open: false, initial: null });

  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), 320);
    return () => clearTimeout(id);
  }, [query]);

  const overview = useApi('/school/classes/overview', { q: search || undefined }, mayView);
  const data = overview.data || {};
  const classes = useMemo(() => data.classes || [], [data.classes]);
  const stats = data.stats || {};

  const reloadAll = () => overview.reload();

  if (selectedId) {
    return (
      <ClassDetail
        classId={selectedId}
        teachers={data.teachers || []}
        allClasses={classes}
        onBack={() => { setSelectedId(null); reloadAll(); }}
        onChanged={reloadAll}
        mayCreate={mayCreate}
        mayEdit={mayEdit}
        mayDelete={mayDelete}
        mayAssign={mayAssign}
        mayGuardian={can('guardians.create')}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={t('sections.classManagement', { defaultValue: 'Class Management' })}
        subtitle={t('sections.classManagementHint', {
          defaultValue: 'Every class in your school, its homeroom teacher, room and sections. Open a class to see its students and assign the ones still waiting.',
        })}
        actions={(
          <>
            <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
              onClick={reloadAll} disabled={overview.loading}>
              <RefreshCw size={14} className={overview.loading ? 'animate-spin' : undefined} /> {t('common.refresh')}
            </button>
            {mayCreate && (
              <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1"
                onClick={() => setModal({ open: true, initial: null })}>
                <Plus size={15} /> {t('sections.addClass', { defaultValue: 'Add Class' })}
              </button>
            )}
          </>
        )}
      />

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3"><StatCard label={t('sections.classes', { defaultValue: 'Classes' })} value={stats.classes ?? '—'} icon={School} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('sections.sections', { defaultValue: 'Sections' })} value={stats.sections ?? '—'} icon={Layers} tone="info" /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('sections.enrolledStudents', { defaultValue: 'Students in classes' })} value={stats.students ?? '—'} icon={Users} tone="ok" /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('sections.unassignedStudents', { defaultValue: 'No class yet' })} value={stats.unassigned ?? '—'} icon={UserPlus} tone={Number(stats.unassigned) > 0 ? 'warn' : 'neutral'} /></div>
      </div>

      <div className="card-soft p-2 p-md-3 mb-3 d-flex flex-wrap align-items-center gap-2">
        <div className="input-group input-group-sm class-search">
          <span className="input-group-text bg-white"><Search size={15} /></span>
          <input className="form-control" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t('sections.searchClass', { defaultValue: 'Search classes by name' })}
            aria-label={t('sections.searchClass', { defaultValue: 'Search classes by name' })} />
          {query && (
            <button type="button" className="btn btn-outline-secondary" onClick={() => setQuery('')} aria-label={t('common.clear')}>
              <X size={14} />
            </button>
          )}
        </div>
        <div className="small text-muted ms-auto">
          {classes.length} {t('sections.classesLower', { defaultValue: classes.length === 1 ? 'class' : 'classes' })}
          {stats.seats ? ` · ${stats.students || 0}/${stats.seats} ${t('sections.seatsUsed', { defaultValue: 'seats used' })}` : ''}
        </div>
      </div>

      {overview.loading && !overview.data && <div className="card-soft p-4"><Spinner label={t('common.loading')} /></div>}
      {overview.error && <ErrorState error={overview.error} onRetry={reloadAll} />}

      {!overview.loading && !overview.error && classes.length === 0 && (
        <div className="card-soft p-3">
          <EmptyState icon={School}
            title={search
              ? t('sections.noClassMatches', { defaultValue: 'No class matches that search' })
              : t('sections.noClassesYet', { defaultValue: 'No classes yet' })}
            hint={mayCreate
              ? t('sections.noClassesHint', { defaultValue: 'Add your first class — Form Four, Grade 1, whatever your school uses — then split it into sections.' })
              : t('sections.noClassesAskAdmin', { defaultValue: 'A school administrator or registrar can create the first class.' })} />
          {mayCreate && !search && (
            <div className="text-center pb-3">
              <button type="button" className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1"
                onClick={() => setModal({ open: true, initial: null })}>
                <Plus size={15} /> {t('sections.addClass', { defaultValue: 'Add Class' })}
              </button>
            </div>
          )}
        </div>
      )}

      {classes.length > 0 && (
        <div className="class-grid">
          {classes.map((cls) => {
            const used = Number(cls.student_count) || 0;
            const capacity = Number(cls.capacity) || 0;
            const fill = pct(used, capacity);
            return (
              <article key={cls.id} className="class-card">
                <div className="class-card-top">
                  <span className="class-avatar">{initials(cls.name)}</span>
                  <div className="min-width-0 flex-grow-1">
                    <div className="class-card-name text-truncate">{cls.name}</div>
                    <div className="class-card-meta">
                      {cls.level ? t('sections.gradeLevelShort', { defaultValue: 'Grade {{level}}', level: cls.level }) : t('sections.allGrades', { defaultValue: 'All levels' })}
                      {' · '}
                      {cls.sections?.length || 0} {t('sections.sectionsLower', { defaultValue: cls.sections?.length === 1 ? 'section' : 'sections' })}
                    </div>
                  </div>
                  {mayEdit && (
                    <button type="button" className="btn-icon sm" aria-label={t('sections.editClass', { defaultValue: 'Edit class' })}
                      onClick={() => setModal({ open: true, initial: cls })}>
                      <Pencil size={15} />
                    </button>
                  )}
                </div>

                <div className="d-flex flex-column gap-1">
                  <div className="class-meta-line">
                    <GraduationCap size={14} />
                    <span className="text-truncate">{cls.teacher_name || t('sections.noTeacher', { defaultValue: 'No homeroom teacher' })}</span>
                  </div>
                  <div className="class-meta-line">
                    <DoorOpen size={14} />
                    <span>{cls.room || t('sections.noRoom', { defaultValue: 'Room not set' })}</span>
                  </div>
                </div>

                {cls.sections?.length > 0 && (
                  <div className="class-chip-row">
                    {cls.sections.slice(0, 4).map((section) => (
                      <span className="class-chip" key={section.id}>{section.name}</span>
                    ))}
                    {cls.sections.length > 4 && <span className="class-chip class-chip-muted">+{cls.sections.length - 4}</span>}
                  </div>
                )}

                <div>
                  <div className="d-flex justify-content-between small text-muted mb-1">
                    <span>{used} {t('sections.studentsLower', { defaultValue: used === 1 ? 'student' : 'students' })}</span>
                    <span>{capacity ? `${fill}%` : t('sections.noCapacity', { defaultValue: 'no cap' })}</span>
                  </div>
                  <div className="class-util"><span style={{ width: `${capacity ? fill : 0}%` }} /></div>
                </div>

                <div className="class-card-foot">
                  <span className="small text-muted">{capacity ? `${used}/${capacity}` : used}</span>
                  <div className="d-inline-flex gap-1">
                    {mayTimetable && (
                      <Link to={`/school/timetable?class=${cls.id}`} className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
                        title={t('sections.classTimetable', { defaultValue: 'Class timetable' })}>
                        <CalendarDays size={14} /> {t('sections.timetable', { defaultValue: 'Timetable' })}
                      </Link>
                    )}
                    <button type="button" className="btn btn-sm btn-outline-primary"
                      onClick={() => setSelectedId(cls.id)}>
                      {t('sections.viewStudents', { defaultValue: 'View students' })}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ClassFormModal
        open={modal.open}
        initial={modal.initial}
        teachers={data.teachers || []}
        capabilities={data.capabilities}
        onClose={() => setModal({ open: false, initial: null })}
        onSaved={reloadAll}
      />
    </>
  );
}

/* ── Detail: roster + assign panel + sections ─────────────────── */
function ClassDetail({
  classId, teachers, allClasses, onBack, onChanged,
  mayCreate, mayEdit, mayDelete, mayAssign, mayGuardian,
}) {
  const { t } = useTranslation();
  const detail = useApi(`/school/classes/${classId}`);
  const [studentQuery, setStudentQuery] = useState('');
  const [poolQuery, setPoolQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [savingSection, setSavingSection] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [sectionTarget, setSectionTarget] = useState(null);
  const [removingSection, setRemovingSection] = useState(false);
  const [studentOpen, setStudentOpen] = useState(false);

  const data = detail.data;
  const cls = data?.class;
  const sections = data?.sections || [];
  const students = data?.students || [];
  const unassigned = data?.unassigned || [];
  const capabilities = data?.capabilities || { room: true, teacher: true };

  const years = useApi('/school/students/academic-years', undefined, mayCreate && studentOpen);

  const currentYearId = useMemo(() => {
    const list = years.data || [];
    return (list.find((y) => y.is_current) || list[0])?.id || '';
  }, [years.data]);

  const visibleStudents = useMemo(() => {
    const term = studentQuery.trim().toLowerCase();
    if (!term) return students;
    return students.filter((s) => `${s.full_name || ''} ${s.admission_number || ''}`.toLowerCase().includes(term));
  }, [students, studentQuery]);

  const visiblePool = useMemo(() => {
    const term = poolQuery.trim().toLowerCase();
    if (!term) return unassigned;
    return unassigned.filter((s) => `${s.full_name || ''} ${s.admission_number || ''}`.toLowerCase().includes(term));
  }, [unassigned, poolQuery]);

  const attendanceAvg = useMemo(() => {
    const values = students.map((s) => s.attendance_percent).filter((v) => v !== null && v !== undefined);
    if (!values.length) return null;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }, [students]);

  const sectionCounts = useMemo(() => {
    const counts = {};
    for (const s of students) if (s.section_id) counts[s.section_id] = (counts[s.section_id] || 0) + 1;
    return counts;
  }, [students]);

  const toggle = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allVisibleSelected = visiblePool.length > 0 && visiblePool.every((s) => selected.includes(s.id));

  const assign = async () => {
    if (!selected.length) return;
    setAssigning(true);
    try {
      const { data: result } = await apiPost(`/school/classes/${classId}/students`, {
        student_ids: selected,
        section_id: sectionId || null,
      });
      toast.success(t('sections.studentsAssigned', {
        defaultValue: '{{count}} student(s) assigned to {{name}}.',
        count: result.assigned, name: cls?.name || '',
      }));
      setSelected([]);
      setPoolQuery('');
      detail.reload();
      onChanged?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setAssigning(false);
    }
  };

  const removeStudent = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await apiDelete(`/school/classes/${classId}/students/${removeTarget.id}`);
      toast.success(t('sections.studentRemoved', { defaultValue: '{{name}} removed from {{class}}.', name: removeTarget.full_name, class: cls?.name || '' }));
      setRemoveTarget(null);
      detail.reload();
      onChanged?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRemoving(false);
    }
  };

  const addSection = async () => {
    const value = sectionName.trim();
    if (!value) return;
    setSavingSection(true);
    try {
      await apiPost(`/school/classes/${classId}/sections`, { name: value });
      setSectionName('');
      toast.success(t('sections.sectionAdded', { defaultValue: 'Section {{name}} added.', name: value }));
      detail.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingSection(false);
    }
  };

  const removeSection = async () => {
    if (!sectionTarget) return;
    setRemovingSection(true);
    try {
      await apiDelete(`/school/classes/${classId}/sections/${sectionTarget.id}`);
      toast.success(t('sections.sectionRemoved', { defaultValue: 'Section {{name}} removed.', name: sectionTarget.name }));
      setSectionTarget(null);
      detail.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRemovingSection(false);
    }
  };

  const deleteClass = async () => {
    setDeleting(true);
    try {
      await apiDelete(`/school/classes/${classId}`);
      toast.success(t('sections.classDeleted', { defaultValue: '{{name}} deleted.', name: cls?.name || '' }));
      setDeleteOpen(false);
      onBack?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDeleting(false);
    }
  };

  const refreshDetail = () => { detail.reload(); onChanged?.(); };

  if (detail.loading && !data) {
    return <div className="card-soft p-4"><Spinner label={t('common.loading')} /></div>;
  }
  if (detail.error) {
    return (
      <>
        <button type="button" className="btn btn-sm btn-outline-secondary mb-3 d-inline-flex align-items-center gap-1" onClick={onBack}>
          <ArrowLeft size={15} /> {t('common.back', { defaultValue: 'Back' })}
        </button>
        <ErrorState error={detail.error} onRetry={detail.reload} />
      </>
    );
  }
  if (!cls) return null;

  const used = students.length;
  const capacity = Number(cls.capacity) || 0;
  const fill = pct(used, capacity);

  return (
    <>
      <button type="button" className="btn btn-sm btn-outline-secondary mb-3 d-inline-flex align-items-center gap-1" onClick={onBack}>
        <ArrowLeft size={15} /> {t('sections.allClasses', { defaultValue: 'All classes' })}
      </button>

      <PageHeader
        title={cls.name}
        subtitle={[
          cls.level ? t('sections.gradeLevelShort', { defaultValue: 'Grade {{level}}', level: cls.level }) : null,
          `${used} ${t('sections.studentsLower2', { defaultValue: 'students' })}`,
          cls.teacher_name || t('sections.noTeacher', { defaultValue: 'No homeroom teacher' }),
        ].filter(Boolean).join(' · ')}
        actions={(
          <>
            {mayCreate && (
              <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={() => setStudentOpen(true)}>
                <UserPlus size={15} /> {t('sections.addStudent', { defaultValue: 'Add student' })}
              </button>
            )}
            {mayEdit && (
              <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={() => setEditOpen(true)}>
                <Pencil size={14} /> {t('common.edit', { defaultValue: 'Edit' })}
              </button>
            )}
            {mayDelete && (
              <button type="button" className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={14} /> {t('common.delete', { defaultValue: 'Delete' })}
              </button>
            )}
          </>
        )}
      />

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3"><StatCard label={t('sections.enrolled', { defaultValue: 'Enrolled' })} value={used} icon={Users} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('sections.capacity', { defaultValue: 'Capacity' })} value={capacity || '—'} icon={School} tone="info" /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('sections.sections', { defaultValue: 'Sections' })} value={sections.length} icon={Layers} tone="brand" /></div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('sections.attendanceAvg', { defaultValue: 'Attendance (avg)' })} icon={GraduationCap}
            value={attendanceAvg === null ? '—' : `${attendanceAvg}%`} tone={attendanceTone(attendanceAvg)} />
        </div>
      </div>

      <div className="row g-3">
        <div className="col-12 col-xl-8">
          <div className="card-soft p-0 overflow-hidden">
            <div className="d-flex flex-wrap align-items-center gap-2 p-3 border-bottom">
              <div className="fw-semibold d-flex align-items-center gap-2">
                <Users size={16} /> {t('sections.enrolledStudents', { defaultValue: 'Enrolled students' })}
                <span className="badge-soft tone-neutral">{students.length}</span>
              </div>
              <div className="input-group input-group-sm ms-auto" style={{ maxWidth: 280 }}>
                <span className="input-group-text bg-white"><Search size={14} /></span>
                <input className="form-control" value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)}
                  placeholder={t('sections.searchStudents', { defaultValue: 'Search students' })} />
              </div>
            </div>

            {students.length === 0 ? (
              <EmptyState icon={Users}
                title={t('sections.noStudentsInClass', { defaultValue: 'No students in this class yet' })}
                hint={t('sections.assignFromPanel', { defaultValue: 'Use the panel on the right to assign students who do not have a class.' })} />
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="bg-white">
                    <tr>
                      <th>{t('sections.student', { defaultValue: 'Student' })}</th>
                      <th>{t('sections.section', { defaultValue: 'Section' })}</th>
                      <th>{t('sections.attendance', { defaultValue: 'Attendance' })}</th>
                      <th>{t('common.status')}</th>
                      {mayAssign && <th className="text-end">{t('common.actions', { defaultValue: 'Actions' })}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStudents.map((student) => {
                      const section = sections.find((s) => s.id === student.section_id);
                      return (
                        <tr key={student.id}>
                          <td>
                            <div className="d-flex align-items-center gap-2">
                              <Avatar student={student} />
                              <div className="min-width-0">
                                <div className="fw-semibold text-truncate" style={{ maxWidth: 220 }}>{student.full_name}</div>
                                <div className="small text-muted">{student.admission_number || '—'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="small">{section ? <span className="class-chip">{section.name}</span> : <span className="text-muted">—</span>}</td>
                          <td>
                            {student.attendance_percent === null || student.attendance_percent === undefined ? (
                              <span className="text-muted small">{t('sections.noAttendance', { defaultValue: 'No records' })}</span>
                            ) : (
                              <div className="attendance-cell">
                                <div className={`small fw-semibold tone-text-${attendanceTone(student.attendance_percent)}`}>{student.attendance_percent}%</div>
                                <div className="att-track"><span className={`tone-bg-${attendanceTone(student.attendance_percent)}`} style={{ width: `${student.attendance_percent}%` }} /></div>
                              </div>
                            )}
                          </td>
                          <td><StatusBadge value={student.status} /></td>
                          {mayAssign && (
                            <td className="text-end">
                              <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setRemoveTarget(student)}>
                                {t('sections.remove', { defaultValue: 'Remove' })}
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
          </div>
        </div>

        <div className="col-12 col-xl-4">
          <div className="assign-panel d-flex flex-column gap-3">
            <div className="card-soft p-3">
              <div className="fw-semibold d-flex align-items-center gap-2 mb-1">
                <UserPlus size={16} /> {t('sections.assignStudents', { defaultValue: 'Assign students' })}
                {unassigned.length > 0 && <span className="badge-soft tone-warn">{unassigned.length}</span>}
              </div>
              <p className="small text-muted mb-2">
                {t('sections.assignStudentsHint', { defaultValue: 'Pick students who have no class yet, then add them to {{name}}.', name: cls.name })}
              </p>

              {unassigned.length === 0 ? (
                <div className="small text-muted border rounded-3 p-3 text-center">
                  {t('sections.nobodyUnassigned', { defaultValue: 'Every active student already belongs to a class.' })}
                </div>
              ) : (
                <>
                  <div className="input-group input-group-sm mb-2">
                    <span className="input-group-text bg-white"><Search size={14} /></span>
                    <input className="form-control" value={poolQuery} onChange={(e) => setPoolQuery(e.target.value)}
                      placeholder={t('sections.searchUnassigned', { defaultValue: 'Search unassigned students' })} />
                  </div>

                  <div className="d-flex align-items-center justify-content-between mb-1">
                    <button type="button" className="btn btn-link btn-sm p-0"
                      onClick={() => setSelected(allVisibleSelected ? [] : visiblePool.map((s) => s.id))}>
                      {allVisibleSelected
                        ? t('sections.clearSelection', { defaultValue: 'Clear selection' })
                        : t('sections.selectAll', { defaultValue: 'Select all' })}
                    </button>
                    <span className="small text-muted">{selected.length} {t('sections.selected', { defaultValue: 'selected' })}</span>
                  </div>

                  <div className="assign-list mb-2">
                    {visiblePool.length === 0 ? (
                      <div className="small text-muted p-3 text-center">{t('sections.noPoolMatches', { defaultValue: 'No match' })}</div>
                    ) : visiblePool.map((student) => (
                      <label className="assign-row" key={student.id}>
                        <input type="checkbox" className="form-check-input mt-0" checked={selected.includes(student.id)}
                          onChange={() => toggle(student.id)} />
                        <Avatar student={student} size={32} />
                        <span className="min-width-0 flex-grow-1">
                          <span className="d-block small fw-semibold text-truncate">{student.full_name}</span>
                          <span className="d-block small text-muted">{student.admission_number || '—'}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  {sections.length > 0 && (
                    <select className="form-select form-select-sm mb-2" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                      <option value="">{t('sections.noSectionOption', { defaultValue: 'No section (whole class)' })}</option>
                      {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                    </select>
                  )}

                  <button type="button" className="btn btn-primary btn-sm w-100 d-inline-flex align-items-center justify-content-center gap-1"
                    onClick={assign} disabled={!selected.length || assigning}>
                    {assigning ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                    {assigning
                      ? t('common.loading')
                      : t('sections.assignCount', { defaultValue: 'Assign {{count}} student(s)', count: selected.length })}
                  </button>
                </>
              )}

              {mayCreate && (
                <button type="button" className="btn btn-link btn-sm w-100 mt-2" onClick={() => setStudentOpen(true)}>
                  {t('sections.createNewStudent', { defaultValue: 'Create a new student instead' })}
                </button>
              )}
            </div>

            <div className="card-soft p-3">
              <div className="fw-semibold d-flex align-items-center gap-2 mb-2">
                <Layers size={16} /> {t('sections.sections', { defaultValue: 'Sections' })}
              </div>
              {sections.length === 0 ? (
                <div className="small text-muted mb-2">{t('sections.noSectionsDetail', { defaultValue: 'This class has no sections.' })}</div>
              ) : (
                <div className="class-chip-row mb-2">
                  {sections.map((section) => (
                    <span className="class-chip" key={section.id}>
                      {section.name}
                      {sectionCounts[section.id] ? ` · ${sectionCounts[section.id]}` : ''}
                      {mayEdit && (
                        <button type="button" className="chip-x" aria-label={t('common.remove')} onClick={() => setSectionTarget(section)}>
                          <X size={11} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {mayEdit && (
                <div className="d-flex gap-1">
                  <input className="form-control form-control-sm" value={sectionName} onChange={(e) => setSectionName(e.target.value)}
                    placeholder={t('sections.sectionNameExample', { defaultValue: 'Section A' })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSection(); } }} />
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={addSection} disabled={savingSection || !sectionName.trim()}>
                    {savingSection ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  </button>
                </div>
              )}
            </div>

            {capabilities.room === false && (
              <div className="alert alert-light border small py-2 mb-0">
                {t('sections.roomMigration', { defaultValue: 'Room needs migration 0019. Classes, sections and the homeroom teacher work without it.' })}
              </div>
            )}
          </div>
        </div>
      </div>

      <ClassFormModal
        open={editOpen}
        initial={{ ...cls, sections }}
        teachers={teachers}
        capabilities={capabilities}
        onClose={() => setEditOpen(false)}
        onSaved={refreshDetail}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={t('sections.deleteClass', { defaultValue: 'Delete class' })}
        message={t('sections.deleteClassConfirm', {
          defaultValue: 'Delete {{name}}? Only empty classes can be deleted, so move its students to another class first. This cannot be undone.',
          name: cls.name,
        })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        busy={deleting}
        onConfirm={deleteClass}
        onClose={() => setDeleteOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={t('sections.removeStudent', { defaultValue: 'Remove student from class' })}
        message={t('sections.removeStudentConfirm', {
          defaultValue: 'Remove {{name}} from {{class}}? They become unassigned and can be added to another class.',
          name: removeTarget?.full_name || '', class: cls.name,
        })}
        confirmLabel={t('sections.remove', { defaultValue: 'Remove' })}
        busy={removing}
        onConfirm={removeStudent}
        onClose={() => setRemoveTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(sectionTarget)}
        title={t('sections.removeSection', { defaultValue: 'Remove section' })}
        message={t('sections.removeSectionConfirm', {
          defaultValue: 'Remove section {{name}}? A section can only be removed when no student is in it.',
          name: sectionTarget?.name || '',
        })}
        confirmLabel={t('sections.remove', { defaultValue: 'Remove' })}
        busy={removingSection}
        onConfirm={removeSection}
        onClose={() => setSectionTarget(null)}
      />

      <StudentFormModal
        open={studentOpen}
        onClose={() => { setStudentOpen(false); refreshDetail(); }}
        years={years.data || []}
        defaultYearId={currentYearId}
        classes={allClasses}
        classesLoading={false}
        defaultClassId={cls.id}
        mayGuardian={mayGuardian}
        onClassesChanged={onChanged}
        onCreated={() => { detail.reload(); onChanged?.(); }}
      />
    </>
  );
}
