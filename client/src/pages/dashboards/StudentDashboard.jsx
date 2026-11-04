// Student home: profile banner, attendance, timetable, pending assignments and fee balance.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Wallet, BookOpen, ClipboardList, ShieldAlert, Users, Clock } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, StatCard, Spinner, ErrorState, EmptyState, Badge, money, dateOnly } from '../../components/ui/Basics.jsx';
import { DoughnutView } from '../../components/ui/Charts.jsx';
import BrandLogo from '../../components/brand/BrandLogo.jsx';

export default function StudentDashboard() {
  const { t } = useTranslation();
  const { hasRole, profile } = useAuth();
  const { data, loading, error, reload } = useApi('/school/dashboard');

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const student = data?.student || null;
  if (!student) {
    return (
      <>
        <PageHeader title={t('dashboards.studentHome', { defaultValue: 'My learning' })} subtitle={data?.school?.school_name} />
        <EmptyState
          icon={Users}
          title={t('dashboards.noStudentProfile', { defaultValue: 'Your account is not linked to a student record yet' })}
          hint={t('dashboards.noStudentProfileHint', { defaultValue: 'Contact your school office so they can link this login to your enrolment.' })}
        />
      </>
    );
  }

  const att = data?.attendance || {};
  const pending = data?.pendingAssignments || [];
  const timetable = [...(data?.todayTimetable || [])].sort((a, b) =>
    String(a.timetable_periods?.start_time || '').localeCompare(String(b.timetable_periods?.start_time || '')));
  const currency = data?.school?.currency;
  const name = student.full_name || `${student.first_name || ''} ${student.last_name || ''}`.trim();

  return (
    <>
      <PageHeader
        title={t('dashboards.studentHome', { defaultValue: 'My learning' })}
        subtitle={data?.school?.school_name}
        actions={<Link to="/m/learning-materials" className="btn btn-sm btn-primary d-flex align-items-center gap-1"><BookOpen size={14} /> {t('modules.learning-materials')}</Link>}
      />

      {profile?.mustChangePassword && (
        <div className="alert alert-warning small d-flex align-items-start gap-2">
          <ShieldAlert size={16} className="mt-1" />
          <div>
            {t('dashboards.mustChangePassword', { defaultValue: 'You are still signing in with your student ID as the password. Set your own password now — it takes a minute.' })}{' '}
            <Link to="/account" className="fw-semibold">{t('account.security', { defaultValue: 'Password & security' })}</Link>
          </div>
        </div>
      )}

      <div className="school-hero mb-3">
        <div className="school-hero-logo">
          <BrandLogo school={data?.school} alt={`${data?.school?.school_name || 'School'} logo`} />
        </div>
        <div className="min-width-0 flex-grow-1">
          <div className="school-hero-name text-truncate">{data?.school?.school_name || 'E-MADAARIS'}</div>
          <div className="small text-muted text-truncate">
            {name || '—'} · {student.admission_number || '—'} · {student.classes?.name || '—'}{student.sections?.name ? ` / ${student.sections.name}` : ''}
          </div>
        </div>
        <Avatar name={name} url={student.photo_url} />
      </div>

      <div className="row g-3 my-1">
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.attendanceRate', { defaultValue: 'Attendance rate' })} value={att.rate != null ? `${att.rate}%` : '—'} hint={`${att.present ?? 0}/${att.total ?? 0}`} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.openAssignments', { defaultValue: 'Open assignments' })} value={pending.length} icon={ClipboardList} /></div>
        <div className="col-12 col-lg-6"><StatCard label={t('dashboards.feeBalance', { defaultValue: 'Fee balance' })} value={money(data?.feeBalance, currency)} icon={Wallet} footer={<Link to="/school/my-fees" className="small">{t('dashboards.viewFees', { defaultValue: 'View my fees' })}</Link>} /></div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-5">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2">{t('dashboards.myAttendance', { defaultValue: 'My attendance' })}</div>
            <DoughnutView
              labels={[
                t('dashboards.present', { defaultValue: 'Present' }),
                t('dashboards.absent', { defaultValue: 'Absent' }),
                t('dashboards.late', { defaultValue: 'Late' }),
                t('dashboards.excused', { defaultValue: 'Excused' }),
              ]}
              data={[att.present || 0, att.absent || 0, att.late || 0, att.excused || 0]}
              height={220}
            />
          </div>
        </div>
        <div className="col-12 col-lg-7">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold">{t('dashboards.pendingAssignments', { defaultValue: 'Pending assignments' })}</div>
              <Link to="/m/assignments" className="small">{t('common.viewAll')}</Link>
            </div>
            {pending.length === 0 && <EmptyState title={t('dashboards.allCaughtUp', { defaultValue: 'You are all caught up' })} />}
            {pending.map((a) => (
              <div key={a.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                <div className="text-truncate me-2">
                  <span className="fw-semibold">{a.title}</span>
                  {a.classes?.name && <span className="text-muted"> · {a.classes.name}</span>}
                </div>
                <DueBadge due={a.due_date} t={t} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12">
          <div className="card-soft p-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold">{t('dashboards.todaySchedule', { defaultValue: "Today's schedule" })}</div>
              <Link to="/school/my-timetable" className="small">{t('sections.fullTimetable', { defaultValue: 'Full timetable' })}</Link>
            </div>
            {timetable.length === 0 ? (
              <EmptyState title={t('dashboards.noPeriodsToday', { defaultValue: 'No periods scheduled today' })} />
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0 student-timetable-table">
                  <thead>
                    <tr>
                      <th style={{ width: 56 }}>SN</th>
                      <th>{t('sections.courseName', { defaultValue: 'Course name' })}</th>
                      <th>{t('sections.courseTeacher', { defaultValue: 'Course teacher' })}</th>
                      <th className="text-end">{t('sections.classTime', { defaultValue: 'Class time' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timetable.map((p, index) => (
                      <tr key={p.id}>
                        <td><span className="sn-chip">{index + 1}</span></td>
                        <td>
                          <div className="fw-semibold">{p.subjects?.name || '—'}</div>
                          <div className="small text-muted">{p.timetable_periods?.name || ''}</div>
                        </td>
                        <td>{p.school_users?.full_name || <span className="text-muted">—</span>}</td>
                        <td className="text-end">
                          <span className="time-chip">
                            <Clock size={13} />
                            {String(p.timetable_periods?.start_time || '').slice(0, 5) || '—'} – {String(p.timetable_periods?.end_time || '').slice(0, 5) || '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {hasRole('parent') && (
        <div className="mt-3">
          <Link to="/school/my-children" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"><Users size={14} /> {t('nav.myFamily')}</Link>
        </div>
      )}
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

function Avatar({ name, url }) {
  const initials = (name || '?').split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
  return url
    ? <img src={url} alt="" className="rounded-circle" style={{ width: 48, height: 48, objectFit: 'cover' }} />
    : <div className="rounded-circle bg-secondary text-white d-flex align-items-center justify-content-center fw-semibold" style={{ width: 48, height: 48 }}>{initials}</div>;
}
