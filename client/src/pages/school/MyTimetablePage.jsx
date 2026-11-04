// Student-facing weekly timetable: SN, course, teacher and class time for every lesson.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Clock, DoorOpen, LayoutGrid, RefreshCw, UserRound } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { Badge, EmptyState, ErrorState, PageHeader, Spinner } from '../../components/ui/Basics.jsx';

const DAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DAY_SHORT = { Saturday: 'Sat', Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri' };
const DAY_LABEL = {
  Saturday: 'sections.daySat', Sunday: 'sections.daySun', Monday: 'sections.dayMon',
  Tuesday: 'sections.dayTue', Wednesday: 'sections.dayWed', Thursday: 'sections.dayThu', Friday: 'sections.dayFri',
};
const todayName = () => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
const timeText = (value) => (value ? String(value).slice(0, 5) : '');
const minuteOfDay = (value) => {
  const text = timeText(value);
  if (!text) return null;
  const [h, m] = text.split(':').map(Number);
  return h * 60 + m;
};
const initials = (name) => (name || '?').split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();

export default function MyTimetablePage() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/school/me/timetable');
  const today = todayName();
  const [view, setView] = useState(today);

  const student = data?.student || null;
  const entries = data?.entries || [];

  const byDay = useMemo(() => {
    const map = Object.fromEntries(DAYS.map((day) => [day, []]));
    for (const entry of entries) (map[entry.day_of_week] ||= []).push(entry);
    return map;
  }, [entries]);

  const nowMinute = (() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  })();
  const todays = byDay[today] || [];
  const current = todays.find((entry) => {
    const start = minuteOfDay(entry.timetable_periods?.start_time);
    const end = minuteOfDay(entry.timetable_periods?.end_time);
    return start != null && end != null && start <= nowMinute && nowMinute < end;
  }) || null;
  const next = todays.find((entry) => (minuteOfDay(entry.timetable_periods?.end_time) ?? Infinity) > nowMinute) || null;
  const visible = view === 'all' ? entries : (byDay[view] || []);

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  if (!student) {
    return (
      <>
        <PageHeader title={t('sections.myTimetable', { defaultValue: 'My timetable' })} />
        <EmptyState
          icon={CalendarDays}
          title={t('sections.noTimetableProfile', { defaultValue: 'Your account is not linked to a student record yet' })}
          hint={t('sections.noTimetableProfileHint', { defaultValue: 'Ask the school office to link this login to your enrolment, then your lessons will appear here.' })}
        />
      </>
    );
  }

  const className = student.classes?.name || t('sections.noClassYet', { defaultValue: 'No class yet' });
  const heroSubject = current || next;
  const heroLabel = current
    ? t('sections.lessonInProgress', { defaultValue: 'In progress now' })
    : t('sections.nextLesson', { defaultValue: 'Next lesson' });

  return (
    <>
      <PageHeader
        title={t('sections.myTimetable', { defaultValue: 'My timetable' })}
        subtitle={t('sections.myTimetableHint', { defaultValue: 'Your weekly lessons, teachers and class times — updated by the school.' })}
        actions={(
          <>
            <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
              onClick={reload} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> {t('common.refresh')}
            </button>
            <Link to="/student" className="btn btn-sm btn-primary">{t('sections.dashboard', { defaultValue: 'Dashboard' })}</Link>
          </>
        )}
      />

      <div className="student-timetable-hero mb-3">
        <span className="hero-icon"><CalendarDays size={22} /></span>
        <div className="min-width-0 flex-grow-1">
          <div className="hero-title text-truncate">
            {className}{student.sections?.name ? ` · ${student.sections.name}` : ''}
          </div>
          <div className="hero-sub">
            {t('sections.timetableSummary', {
              defaultValue: '{{week}} lessons a week · {{today}} today',
              week: entries.length,
              today: todays.length,
            })}
          </div>
        </div>
        {heroSubject ? (
          <div className="next-lesson">
            <span className="label">{heroLabel}</span>
            <span className="fw-semibold text-truncate">{heroSubject.subjects?.name || '—'}</span>
            <span className="small text-muted text-truncate">
              {timeText(heroSubject.timetable_periods?.start_time)} – {timeText(heroSubject.timetable_periods?.end_time)}
              {heroSubject.school_users?.full_name ? ` · ${heroSubject.school_users.full_name}` : ''}
            </span>
          </div>
        ) : (
          <Badge tone="neutral">{t('sections.noMoreLessonsToday', { defaultValue: 'No more lessons today' })}</Badge>
        )}
      </div>

      <div className="timetable-days mb-3">
        <button type="button" className={`timetable-day ${view === 'all' ? 'active' : ''}`}
          onClick={() => setView('all')} aria-pressed={view === 'all'}>
          <span className="d-inline-flex align-items-center gap-1"><LayoutGrid size={13} /> {t('sections.allWeek', { defaultValue: 'All week' })}</span>
          <span className="small">{entries.length}</span>
        </button>
        {DAYS.map((day) => (
          <button type="button" key={day}
            className={`timetable-day ${view === day ? 'active' : ''} ${day === today ? 'is-today' : ''}`}
            onClick={() => setView(day)} aria-pressed={view === day}>
            <span className="fw-semibold">{DAY_SHORT[day]}</span>
            <span className="small">{byDay[day]?.length || 0}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={view === 'all'
            ? t('sections.noTimetableYet', { defaultValue: 'No lessons in your timetable yet' })
            : t('sections.noLessonsThatDay', { defaultValue: 'No lessons on {{day}}', day: DAY_SHORT[view] || view })}
          hint={t('sections.noTimetableHint', { defaultValue: 'When the school builds your class timetable, every lesson shows up here automatically.' })}
        />
      ) : (
        <div className="card-soft overflow-hidden">
          <div className="table-responsive">
            <table className="table align-middle mb-0 student-timetable-table">
              <thead>
                <tr>
                  <th style={{ width: 64 }}>SN</th>
                  {view === 'all' && <th>{t('sections.day', { defaultValue: 'Day' })}</th>}
                  <th>{t('sections.courseName', { defaultValue: 'Course name' })}</th>
                  <th>{t('sections.courseTeacher', { defaultValue: 'Course teacher' })}</th>
                  <th>{t('sections.classTime', { defaultValue: 'Class time' })}</th>
                  <th className="text-end">{t('sections.room', { defaultValue: 'Room' })}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry, index) => {
                  const start = minuteOfDay(entry.timetable_periods?.start_time);
                  const end = minuteOfDay(entry.timetable_periods?.end_time);
                  const isNow = entry.day_of_week === today && start != null && end != null
                    && start <= nowMinute && nowMinute < end;
                  return (
                    <tr key={entry.id} className={isNow ? 'is-now' : undefined}>
                      <td><span className="sn-chip">{index + 1}</span></td>
                      {view === 'all' && (
                        <td>
                          <Badge tone={entry.day_of_week === today ? 'brand' : 'neutral'}>
                            {t(DAY_LABEL[entry.day_of_week] || 'sections.daySat', { defaultValue: DAY_SHORT[entry.day_of_week] || entry.day_of_week })}
                          </Badge>
                        </td>
                      )}
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <span className="fw-semibold">{entry.subjects?.name || '—'}</span>
                          {isNow && <span className="now-pill">{t('sections.now', { defaultValue: 'Now' })}</span>}
                        </div>
                        <div className="small text-muted">{entry.timetable_periods?.name || ''}</div>
                      </td>
                      <td>
                        {entry.school_users?.full_name ? (
                          <span className="teacher-cell">
                            <span className="teacher-avatar">{initials(entry.school_users.full_name)}</span>
                            {entry.school_users.full_name}
                          </span>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td>
                        <span className="time-chip">
                          <Clock size={13} />
                          {timeText(entry.timetable_periods?.start_time) || '—'} – {timeText(entry.timetable_periods?.end_time) || '—'}
                        </span>
                      </td>
                      <td className="text-end">
                        {entry.classrooms?.name
                          ? <span className="d-inline-flex align-items-center gap-1"><DoorOpen size={13} className="text-muted" /> {entry.classrooms.name}</span>
                          : <span className="text-muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="d-flex flex-wrap align-items-center gap-2 small text-muted mt-3">
        <UserRound size={14} />
        {t('sections.myTimetableFooter', { defaultValue: 'Teachers and times are set by your school — talk to the office if something looks wrong.' })}
      </div>
    </>
  );
}
