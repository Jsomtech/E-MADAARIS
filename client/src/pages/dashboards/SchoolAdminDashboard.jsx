import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Users, GraduationCap, ClipboardList, Wallet, CalendarClock, Megaphone, UserPlus, CreditCard,
  BadgeCheck, School, DatabaseBackup, Recycle, ShieldAlert, Trash2, Loader2, CalendarDays,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiSweep, sweepFailure } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { PageHeader, StatCard, Spinner, ErrorState, EmptyState, money, dateOnly } from '../../components/ui/Basics.jsx';
import { ChartCard, DoughnutView } from '../../components/ui/Charts.jsx';

/**
 * Reference dashboard for the config-driven app: reads the aggregated payload from
 * GET /school/dashboard (computed server-side per role) and renders cards, charts and lists.
 */
export default function SchoolAdminDashboard() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { data, loading, error, reload } = useApi('/school/dashboard');
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [clearing, setClearing] = useState(false);
  const schoolName = profile?.school?.school_name || '';

  const clearAllData = async () => {
    setClearing(true);
    try {
      const result = await apiSweep('/school/data/clear', { confirm: confirmName });
      setDangerOpen(false);
      setConfirmName('');
      toast.success(t('sections.dataClearedRecoverable', {
        defaultValue: 'School cleared ({{tables}} tables, {{rows}} rows, {{users}} logins removed). Your administrator login stays, and everything is restorable from the recycle bin.',
        tables: result.data?.tables ?? 0, rows: result.data?.rows ?? 0, users: result.data?.users ?? 0,
      }));
      reload();
    } catch (e) {
      toast.error(sweepFailure(e));
    } finally { setClearing(false); }
  };

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const usage = data?.usage || {};
  const attendance = data?.attendanceToday || {};
  const plan = profile?.subscription?.plan;

  return (
    <>
      <PageHeader
        title={t('dashboards.schoolAdmin', { defaultValue: 'School administration' })}
        subtitle={`${profile?.school?.school_name || ''} · ${profile?.subscription?.plan?.name || ''} plan`}
        actions={(
          <>
            <Link to="/school/admissions" className="btn btn-sm btn-primary d-flex align-items-center gap-1">
              <UserPlus size={14} /> {t('sections.admitStudent', { defaultValue: 'Admit a student' })}
            </Link>
            <Link to="/school/users?new=1" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1">
              <Users size={14} /> {t('sections.addStaff', { defaultValue: 'Add staff' })}
            </Link>
          </>
        )}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-3"><StatCard label={t('modules.students')} value={data?.students} icon={GraduationCap} hint={`${data?.studentsWithoutClass ?? 0} ${t('dashboards.withoutClass', { defaultValue: 'without a class' })}`} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.teachers')} value={data?.teachers} icon={Users} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.staff')} value={data?.staff} icon={Users} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.classes')} value={data?.classes} icon={ClipboardList} hint={`${data?.subjects ?? 0} ${t('modules.subjects').toLowerCase()}`} /></div>
      </div>

      <div className="row g-3 my-1">
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.todayAttendance', { defaultValue: "Today's attendance" })} value={attendance.rate != null ? `${attendance.rate}%` : '—'} hint={`${attendance.present ?? 0}/${attendance.total ?? 0}`} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.outstandingFees', { defaultValue: 'Outstanding fees' })} value={money(data?.outstandingFees)} icon={Wallet} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.monthCollected', { defaultValue: 'Collected this month' })} value={money(data?.monthCollections)} icon={Wallet} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('dashboards.pendingAdmissions', { defaultValue: 'Students without a class' })} value={data?.studentsWithoutClass} icon={UserPlus} /></div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-4">
          <ChartCard title={t('dashboards.subscriptionUsage', { defaultValue: 'Subscription usage' })} subtitle={plan ? `${plan.name} plan` : ''}>
            <DoughnutView
              labels={[t('modules.students'), t('modules.staff')]}
              data={[usage.students || 0, usage.staff || 0]}
              height={200}
            />
            <div className="small text-muted mt-2">
              {usage.students || 0} / {plan?.max_students ?? '∞'} {t('modules.students').toLowerCase()} · {usage.staff || 0} / {plan?.max_staff ?? '∞'} {t('modules.staff').toLowerCase()}
            </div>
            <Link to="/school/subscription" className="btn btn-sm btn-outline-primary mt-2">{t('modules.subscription')}</Link>
          </ChartCard>
        </div>

        <div className="col-12 col-lg-4">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><CalendarClock size={15} className="me-1" /> {t('dashboards.upcomingExams', { defaultValue: 'Upcoming examinations' })}</div>
              <Link to="/m/examinations" className="small">{t('common.viewAll')}</Link>
            </div>
            {(data?.upcomingExaminations || []).length === 0 && <EmptyState title={t('common.none')} />}
            {(data?.upcomingExaminations || []).slice(0, 6).map((e) => (
              <div key={e.id} className="d-flex justify-content-between border-bottom py-2 small">
                <span>{e.name || e.title}</span>
                <span className="text-muted">{dateOnly(e.created_at)} · {String(e.status).replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-12 col-lg-4">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><Megaphone size={15} className="me-1" /> {t('modules.announcements')}</div>
              <Link to="/m/announcements" className="small">{t('common.viewAll')}</Link>
            </div>
            {(data?.announcements || []).length === 0 && <EmptyState title={t('common.none')} />}
            {(data?.announcements || []).slice(0, 5).map((a) => (
              <div key={a.id} className="border-bottom py-2">
                <div className="small fw-semibold">{a.title}</div>
                <div className="small text-muted">{dateOnly(a.published_at || a.created_at)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-4">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2"><Wallet size={15} className="me-1" /> {t('dashboards.recentPayments', { defaultValue: 'Recent fee payments' })}</div>
            {(data?.recentPayments || []).length === 0 && <EmptyState title={t('common.none')} />}
            {(data?.recentPayments || []).slice(0, 6).map((p) => (
              <div key={p.id} className="d-flex justify-content-between border-bottom py-2 small">
                <span className="text-truncate me-2">{p.students?.full_name || p.student_id}</span>
                <span className="text-muted">{money(p.amount, p.currency)} · {dateOnly(p.paid_at)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="col-12 col-lg-4">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2"><ClipboardList size={15} className="me-1" /> {t('dashboards.quickLinks', { defaultValue: 'Quick links' })}</div>
            <div className="list-group list-group-flush">
              <Link to="/school/admissions" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <UserPlus size={16} /> {t('sections.admitStudent', { defaultValue: 'Admit a student' })}
              </Link>
              <Link to="/school/users?new=1" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <Users size={16} /> {t('sections.addStaff', { defaultValue: 'Add staff' })}
              </Link>
              <Link to="/school/id-cards" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <BadgeCheck size={16} /> {t('dashboards.idCards', { defaultValue: 'Student ID cards' })}
              </Link>
              <Link to="/m/finance-payments" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <Wallet size={16} /> {t('sections.recordPayment', { defaultValue: 'Record a fee payment' })}
              </Link>
              <Link to="/m/announcements" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <Megaphone size={16} /> {t('sections.publishAnnouncement', { defaultValue: 'Publish an announcement' })}
              </Link>
              <Link to="/m/classes" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <School size={16} /> {t('sections.manageClasses', { defaultValue: 'Manage classes & sections' })}
              </Link>
              <Link to="/school/timetable" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <CalendarDays size={16} /> {t('sections.timetableBuilder', { defaultValue: 'Class timetable' })}
              </Link>
              <Link to="/school/backups" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <DatabaseBackup size={16} /> {t('sections.backupsTitle', { defaultValue: 'Backups' })}
              </Link>
              <Link to="/school/trash" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <Recycle size={16} /> {t('sections.trashTitle', { defaultValue: 'Recycle bin' })}
              </Link>
            </div>
          </div>
        </div>
        <div className="col-12 col-lg-4">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2"><CreditCard size={15} className="me-1" /> {t('dashboards.planStatus', { defaultValue: 'Plan & status' })}</div>
            <div className="row g-2 small">
              <Detail label={t('modules.plans')} value={plan?.name} />
              <Detail label={t('common.status')} value={profile?.subscription?.status} />
              <Detail label={t('dashboards.expiresOn', { defaultValue: 'Expires on' })} value={dateOnly(profile?.subscription?.end_date)} />
              <Detail label={t('modules.students')} value={`${usage.students || 0} / ${plan?.max_students ?? '—'}`} />
            </div>
            <div className="d-flex gap-2 mt-3">
              <Link to="/school/support" className="btn btn-sm btn-outline-secondary"><Megaphone size={14} className="me-1" />{t('common.support')}</Link>
              <Link to="/school/reports" className="btn btn-sm btn-outline-secondary">{t('modules.reports')}</Link>
            </div>
          </div>
        </div>
        <div className="col-12 col-lg-4">
          <div className="card-soft p-3 h-100 border-danger-subtle">
            <div className="fw-semibold mb-2 text-danger"><ShieldAlert size={15} className="me-1" /> {t('sections.dangerZone', { defaultValue: 'Danger zone' })}</div>
            <p className="small text-muted mb-2">
              {t('sections.dashboardDangerHint', { defaultValue: 'Back up or restore deleted records first. Clearing removes every student, class, exam, fee and attendance record — logins and settings stay.' })}
            </p>
            <div className="d-flex flex-wrap gap-2">
              <Link to="/school/backups" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1">
                <DatabaseBackup size={14} /> {t('sections.backupsTitle', { defaultValue: 'Backups' })}
              </Link>
              <Link to="/school/trash" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1">
                <Recycle size={14} /> {t('sections.trashTitle', { defaultValue: 'Recycle bin' })}
              </Link>
              <button type="button" className="btn btn-sm btn-danger d-inline-flex align-items-center gap-1"
                onClick={() => { setConfirmName(''); setDangerOpen(true); }}>
                <Trash2 size={14} /> {t('sections.deleteAllData', { defaultValue: 'Delete all data' })}
              </button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={dangerOpen}
        title={t('sections.clearAllData', { defaultValue: 'Delete all school data' })}
        icon={ShieldAlert}
        size="md"
        onClose={() => { setDangerOpen(false); setConfirmName(''); }}
        footer={(
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={() => { setDangerOpen(false); setConfirmName(''); }}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-danger d-inline-flex align-items-center gap-2"
              onClick={clearAllData} disabled={clearing || confirmName !== schoolName}>
              {clearing ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              {t('sections.clearAllData', { defaultValue: 'Delete all school data' })}
            </button>
          </>
        )}
      >
        <p className="small text-muted">
          {t('sections.clearDataHint', { defaultValue: 'Deletes every student, class, exam, fee, attendance, learning and operations record, and every staff, student and parent login account. Your own administrator login, the school profile, branding, roles and subscription stay, so you can sign in and start over. Everything is snapshotted into the recycle bin first, so the Super Admin can restore it.' })}
        </p>
        <label className="form-label small fw-semibold" htmlFor="danger-confirm">
          {t('sections.typeSchoolName', { defaultValue: 'Type “{{name}}” to confirm', name: schoolName })}
        </label>
        <input id="danger-confirm" className="form-control" value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)} placeholder={schoolName} autoComplete="off" />
      </Modal>
    </>
  );
}

function Detail({ label, value }) {
  return (
    <div className="col-6">
      <div className="text-muted">{label}</div>
      <div className="fw-semibold text-capitalize">{String(value ?? '—').replace(/_/g, ' ')}</div>
    </div>
  );
}
