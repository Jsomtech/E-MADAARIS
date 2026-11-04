// Teacher home: today's schedule, attendance sessions and open assignments from GET /school/dashboard.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Users, CalendarClock, ClipboardList, PenSquare, BookOpen, CheckCircle2 } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader, StatCard, Spinner, ErrorState, EmptyState, Badge, StatusBadge, dateOnly } from '../../components/ui/Basics.jsx';

export default function TeacherDashboard() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/school/dashboard');

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const myClasses = data?.myClasses || [];
  const timetable = [...(data?.todayTimetable || [])].sort((a, b) =>
    String(a.timetable_periods?.start_time || '').localeCompare(String(b.timetable_periods?.start_time || '')));
  const sessions = data?.attendanceSessionsToday || [];
  const assignments = data?.myAssignments || [];
  const classCount = new Set(myClasses.map((c) => c.class_id).filter(Boolean)).size;

  return (
    <>
      <PageHeader
        title={t('dashboards.teacherHome', { defaultValue: 'Teacher dashboard' })}
        subtitle={`${data?.school?.school_name || ''} · ${data?.subscription?.plan?.name || data?.subscription?.plan || ''}`}
        actions={(
          <>
            <Link to="/m/marks" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"><PenSquare size={14} /> {t('modules.marks')}</Link>
            <Link to="/m/learning-materials" className="btn btn-sm btn-primary d-flex align-items-center gap-1"><BookOpen size={14} /> {t('modules.learning-materials')}</Link>
          </>
        )}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-4"><StatCard label={t('dashboards.classesTaught', { defaultValue: 'Classes taught' })} value={classCount} icon={Users} hint={`${myClasses.length} ${t('dashboards.activeSubjects', { defaultValue: 'active subjects' })}`} /></div>
        <div className="col-6 col-lg-4"><StatCard label={t('dashboards.todayPeriods', { defaultValue: "Today's periods" })} value={timetable.length} icon={CalendarClock} /></div>
        <div className="col-12 col-lg-4"><StatCard label={t('dashboards.openAssignments', { defaultValue: 'Open assignments' })} value={assignments.length} icon={ClipboardList} /></div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><CalendarClock size={15} className="me-1" /> {t('dashboards.todaySchedule', { defaultValue: "Today's schedule" })}</div>
              <Link to="/m/timetable-entries" className="small">{t('common.viewAll')}</Link>
            </div>
            {timetable.length === 0 && <EmptyState title={t('dashboards.noPeriodsToday', { defaultValue: 'No periods scheduled today' })} />}
            {timetable.map((p) => (
              <div key={p.id} className="d-flex justify-content-between border-bottom py-2 small">
                <div>
                  <span className="fw-semibold">{p.subjects?.name || '—'}</span>
                  <span className="text-muted"> · {p.classrooms?.name || '—'}</span>
                </div>
                <span className="text-muted tabular-nums">{p.timetable_periods?.start_time || '—'} – {p.timetable_periods?.end_time || '—'}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><CheckCircle2 size={15} className="me-1" /> {t('dashboards.attendanceSessions', { defaultValue: "Today's attendance sessions" })}</div>
              <Link to="/m/attendance" className="btn btn-sm btn-primary">{t('dashboards.takeAttendance', { defaultValue: 'Take attendance' })}</Link>
            </div>
            {sessions.length === 0 && <EmptyState title={t('dashboards.noSessionsToday', { defaultValue: 'No attendance sessions today' })} />}
            {sessions.map((s) => (
              <div key={s.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <span className="fw-semibold">{s.classes?.name || '—'}</span>
                <span className="d-flex align-items-center gap-2">
                  <StatusBadge value={s.status} />
                  <Link to="/m/attendance" className="text-decoration-none small">{t('dashboards.takeAttendance', { defaultValue: 'Take attendance' })}</Link>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12">
          <div className="card-soft p-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><ClipboardList size={15} className="me-1" /> {t('dashboards.myAssignments', { defaultValue: 'My open assignments' })}</div>
              <Link to="/m/assignments" className="small">{t('common.viewAll')}</Link>
            </div>
            {assignments.length === 0 && <EmptyState title={t('common.none')} />}
            {assignments.map((a) => (
              <div key={a.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <span className="text-truncate me-2"><span className="fw-semibold">{a.title}</span> <span className="text-muted">· {a.classes?.name || '—'}</span></span>
                <DueBadge due={a.due_date} t={t} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function DueBadge({ due, t }) {
  if (!due) return <span className="text-muted">—</span>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = new Date(due) < today;
  return (
    <Badge tone={overdue ? 'danger' : 'info'}>
      {overdue ? t('dashboards.overdue', { defaultValue: 'Overdue' }) : t('dashboards.due', { defaultValue: 'Due' })} {dateOnly(due)}
    </Badge>
  );
}
