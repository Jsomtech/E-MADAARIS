import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  GraduationCap, Users, ClipboardList, BookOpen, ShieldAlert, CalendarDays, Megaphone,
  BarChart3, FileCheck2,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import {
  PageHeader, StatCard, StatusBadge, Spinner, ErrorState, EmptyState, Badge, dateOnly,
} from '../../components/ui/Basics.jsx';
import { ChartCard, DoughnutView } from '../../components/ui/Charts.jsx';

/**
 * Vice Principal home: same role-aware payload as the principal, oriented to attendance and
 * discipline follow-up. Approvals are read-only here — the head teacher signs results off.
 */
export default function VicePrincipalDashboard() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/school/dashboard');

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const att = data?.attendanceToday || {};
  const approvals = data?.pendingResultApprovals || [];
  const exams = data?.upcomingExaminations || [];
  const absentees = (att.absent || 0) + (att.excused || 0);

  return (
    <>
      <PageHeader
        title={t('dashboards.vicePrincipalHome', { defaultValue: 'Vice Principal overview' })}
        subtitle={`${data?.school?.school_name || ''} · ${t('dashboards.disciplineFocus', { defaultValue: 'Attendance & discipline' })}`}
        actions={(
          <>
            <Link to="/m/discipline-records" className="btn btn-sm btn-primary d-flex align-items-center gap-1">
              <ShieldAlert size={14} /> {t('modules.discipline-records')}
            </Link>
            <Link to="/school/reports" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1">
              <BarChart3 size={14} /> {t('modules.reports')}
            </Link>
          </>
        )}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-3"><StatCard label={t('modules.students')} value={data?.students} icon={GraduationCap} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.teachers')} value={data?.teachers} icon={Users} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.classes')} value={data?.classes} icon={ClipboardList} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.subjects')} value={data?.subjects} icon={BookOpen} /></div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-5">
          <ChartCard title={t('dashboards.todayAttendance', { defaultValue: "Today's attendance" })}
            subtitle={`${att.total ?? 0} ${t('dashboards.recordsToday', { defaultValue: 'records today' })}`}>
            <div className="d-flex align-items-baseline gap-2 mb-2">
              <span className="fs-2 fw-bold">{att.rate != null ? `${att.rate}%` : '—'}</span>
              <Badge tone={absentees ? 'warn' : 'ok'}>
                {absentees} {t('dashboards.markedAway', { defaultValue: 'absent or excused' })}
              </Badge>
            </div>
            <DoughnutView
              labels={[
                t('dashboards.present', { defaultValue: 'Present' }),
                t('dashboards.absent', { defaultValue: 'Absent' }),
                t('dashboards.late', { defaultValue: 'Late' }),
                t('dashboards.excused', { defaultValue: 'Excused' }),
              ]}
              data={[att.present || 0, att.absent || 0, att.late || 0, att.excused || 0]}
              height={200}
            />
            <div className="d-flex gap-2 mt-2">
              <Link to="/m/attendance" className="btn btn-sm btn-outline-primary">{t('modules.attendance')}</Link>
              <Link to="/m/discipline-records" className="btn btn-sm btn-outline-secondary">{t('modules.discipline-records')}</Link>
            </div>
          </ChartCard>
        </div>

        <div className="col-12 col-lg-7">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><FileCheck2 size={15} className="me-1" /> {t('dashboards.pendingResultApprovals', { defaultValue: 'Results waiting for review' })}</div>
              <Link to="/m/results" className="small">{t('common.viewAll')}</Link>
            </div>
            {approvals.length === 0 && <EmptyState title={t('dashboards.noPendingApprovals', { defaultValue: 'No results awaiting approval' })} />}
            {approvals.map((a) => (
              <div key={a.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <span className="text-truncate me-2">
                  {a.examinations?.name || a.examination_name || `${t('modules.examinations')} ${String(a.examination_id || '').slice(0, 8)}`}
                  <span className="text-muted"> · {a.classes?.name || a.class_name || (a.class_id ? String(a.class_id).slice(0, 8) : t('dashboards.allClasses', { defaultValue: 'whole class' }))}</span>
                </span>
                <span className="d-flex align-items-center gap-2 text-muted white-space-nowrap">
                  <StatusBadge value={a.status} /> {dateOnly(a.created_at)}
                </span>
              </div>
            ))}
            <p className="small text-muted mb-0 mt-2">{t('dashboards.approvalsHint', { defaultValue: 'The Principal or an administrator signs these off.' })}</p>
          </div>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><CalendarDays size={15} className="me-1" /> {t('dashboards.upcomingExams', { defaultValue: 'Upcoming examinations' })}</div>
              <Link to="/m/examinations" className="small">{t('common.viewAll')}</Link>
            </div>
            {exams.length === 0 && <EmptyState title={t('common.none')} />}
            {exams.map((e) => (
              <div key={e.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <span className="text-truncate me-2">{e.name || e.title || e.id}</span>
                <span className="d-flex align-items-center gap-2 text-muted white-space-nowrap">
                  <StatusBadge value={e.status} /> {dateOnly(e.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-12 col-lg-6">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2"><Megaphone size={15} className="me-1" /> {t('dashboards.followUp', { defaultValue: 'Follow-up' })}</div>
            <div className="list-group list-group-flush">
              <Link to="/m/timetable-entries" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <CalendarDays size={16} /> {t('modules.timetable-entries')}
              </Link>
              <Link to="/m/announcements" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <Megaphone size={16} /> {t('modules.announcements')}
              </Link>
              <Link to="/m/students" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <GraduationCap size={16} /> {t('modules.students')}
              </Link>
              <Link to="/school/reports" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <BarChart3 size={16} /> {t('modules.reports')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
