import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Megaphone, CalendarClock, ClipboardSignature, Users, Bell,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiGet } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  PageHeader, StatCard, Spinner, ErrorState, EmptyState, StatusBadge, Badge, dateOnly,
} from '../../components/ui/Basics.jsx';

/**
 * Invigilator home: the server only returns the generic staff payload, so the exam schedule and the
 * invigilator assignments are read here from their CRUD lists. Nothing is invented — unknown columns
 * render as an em dash, and duties are only labelled "mine" once the account can be matched.
 */
export default function InvigilatorDashboard() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const feed = useApi('/school/dashboard');
  const schedules = useApi('/examination-schedules', { pageSize: 50 });
  const duties = useApi('/examination-invigilators', { pageSize: 50 });
  const [mySchoolUserId, setMySchoolUserId] = useState(null);

  // examination_invigilators.school_user_id references school_users.id, not the auth user id, so the
  // two only match through the users directory. Best effort: silently skip when it is not visible.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profile?.userId) return;
      try {
        const res = await apiGet('/school/users', { pageSize: 200, q: profile.email || undefined });
        const rows = res?.data || [];
        const me = rows.find((u) => u.auth_user_id === profile.userId);
        if (!cancelled && me) setMySchoolUserId(me.id);
      } catch {
        /* the list is not readable for this role — the card falls back to an unfiltered view */
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.userId, profile?.email]);

  if (feed.loading && !feed.data) return <Spinner label={t('common.loading')} />;
  if (feed.error) return <ErrorState error={feed.error} onRetry={feed.reload} />;

  const announcements = feed.data?.announcements || [];
  const scheduleRows = [...(schedules.data || [])].sort((a, b) => String(b.exam_date || '').localeCompare(String(a.exam_date || '')));
  const scheduleById = new Map(scheduleRows.map((s) => [s.id, s]));
  const dutyRows = (duties.data || []).filter((d) => !mySchoolUserId || d.school_user_id === mySchoolUserId);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = scheduleRows.filter((s) => !s.exam_date || s.exam_date >= today);
  const nameOf = (row) => row.exam_class_subjects?.classes?.name || row.class_name || row.class?.name || null;
  const roomOf = (row) => row.classrooms?.name || row.classroom_name || row.room || row.location || null;
  const subjectOf = (row) => row.exam_class_subjects?.subjects?.name || row.subject_name || null;

  return (
    <>
      <PageHeader
        title={t('dashboards.invigilatorHome', { defaultValue: 'Invigilator overview' })}
        subtitle={`${feed.data?.school?.school_name || ''} · ${profile?.fullName || ''}`}
        actions={(
          <>
            <Link to="/m/examination-schedules" className="btn btn-sm btn-primary d-flex align-items-center gap-1">
              <CalendarClock size={14} /> {t('modules.examination-schedules')}
            </Link>
            <Link to="/m/announcements" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1">
              <Megaphone size={14} /> {t('modules.announcements')}
            </Link>
          </>
        )}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.scheduledSessions', { defaultValue: 'Published sessions' })} value={schedules.data?.length ?? null} icon={CalendarClock} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.upcomingSessions', { defaultValue: 'Still to come' })} value={upcoming.length} icon={ClipboardSignature} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.myDuties', { defaultValue: 'My invigilation duties' })} value={mySchoolUserId ? dutyRows.length : null} icon={Users}
            hint={mySchoolUserId ? undefined : t('dashboards.dutiesUnmatchedHint', { defaultValue: 'Not matched to your account yet' })} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('modules.announcements')} value={announcements.length} icon={Megaphone} />
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-7">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><CalendarClock size={15} className="me-1" /> {t('dashboards.examSchedule', { defaultValue: 'Examination schedule' })}</div>
              <Link to="/m/examination-schedules" className="small">{t('common.viewAll')}</Link>
            </div>
            {schedules.error && (
              <p className="small text-warning">{t('dashboards.scheduleUnavailable', { defaultValue: 'The schedule list could not be loaded.' })}</p>
            )}
            {scheduleRows.length === 0 && !schedules.error && (
              <EmptyState title={t('dashboards.noSchedules', { defaultValue: 'No examination sessions published yet' })}
                hint={t('dashboards.noSchedulesHint', { defaultValue: 'They appear here once the examination officer schedules them.' })} />
            )}
            {scheduleRows.length > 0 && (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0 small">
                  <thead className="bg-white">
                    <tr>
                      <th>{t('common.date')}</th>
                      <th>{t('dashboards.time', { defaultValue: 'Time' })}</th>
                      <th>{t('dashboards.room', { defaultValue: 'Room' })}</th>
                      <th>{t('dashboards.subjectClass', { defaultValue: 'Class / subject' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleRows.slice(0, 12).map((s) => (
                      <tr key={s.id}>
                        <td className="white-space-nowrap">{dateOnly(s.exam_date || s.date)}</td>
                        <td className="white-space-nowrap text-muted">
                          {s.start_time || s.end_time
                            ? `${String(s.start_time || '—').slice(0, 5)} – ${String(s.end_time || '—').slice(0, 5)}`
                            : '—'}
                        </td>
                        <td>{roomOf(s) || '—'}</td>
                        <td className="text-truncate">{[nameOf(s), subjectOf(s)].filter(Boolean).join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="col-12 col-lg-5">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><Users size={15} className="me-1" /> {t('dashboards.myDuties', { defaultValue: 'My invigilation duties' })}</div>
              <Link to="/m/examination-invigilators" className="small">{t('modules.examination-invigilators')}</Link>
            </div>
            {duties.error && <p className="small text-warning">{t('dashboards.dutiesUnavailable', { defaultValue: 'The assignment list could not be loaded.' })}</p>}
            {!duties.error && dutyRows.length === 0 && (
              <EmptyState title={mySchoolUserId
                ? t('dashboards.noDutiesAssigned', { defaultValue: 'No session has been assigned to you yet' })
                : t('dashboards.noDutiesVisible', { defaultValue: 'Assignments are not linked to your account here' })}
                hint={mySchoolUserId
                  ? t('dashboards.noDutiesAssignedHint', { defaultValue: 'The examination officer adds invigilators per session.' })
                  : t('dashboards.noDutiesVisibleHint', { defaultValue: 'The assignment table stores no addressable user for your sign-in, so the full list is shown in the module page.' })} />
            )}
            {dutyRows.map((d) => {
              const s = scheduleById.get(d.schedule_id);
              return (
                <div key={d.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                  <span className="text-truncate me-2">
                    {s ? dateOnly(s.exam_date || s.date) : t('dashboards.sessionUnlinked', { defaultValue: 'Session not loaded' })}
                    {s?.start_time ? <span className="text-muted"> · {String(s.start_time).slice(0, 5)}</span> : null}
                  </span>
                  <span className="text-muted white-space-nowrap">
                    {s ? (roomOf(s) || nameOf(s) || '—') : String(d.schedule_id || '').slice(0, 8)}
                  </span>
                </div>
              );
            })}
            {mySchoolUserId && dutyRows.length > 0 && (
              <p className="small text-muted mb-0 mt-2">{t('dashboards.matchedAccount', { defaultValue: 'Filtered to your staff record.' })}</p>
            )}
          </div>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12">
          <div className="card-soft p-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><Bell size={15} className="me-1" /> {t('modules.announcements')}</div>
              <Link to="/m/announcements" className="small">{t('common.viewAll')}</Link>
            </div>
            {announcements.length === 0 && <EmptyState title={t('common.none')} />}
            {announcements.map((a) => (
              <div key={a.id} className="border-bottom py-2">
                <div className="d-flex justify-content-between align-items-center gap-2">
                  <span className="small fw-semibold">{a.title || t('dashboards.untitled', { defaultValue: 'Untitled' })}</span>
                  <span className="d-flex align-items-center gap-2 text-muted small white-space-nowrap">
                    {a.status ? <StatusBadge value={a.status} /> : <Badge tone="neutral">{t('dashboards.publishedLabel', { defaultValue: 'published' })}</Badge>}
                    {dateOnly(a.published_at || a.created_at)}
                  </span>
                </div>
                {a.body && <div className="small text-muted mt-1">{String(a.body).slice(0, 180)}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
