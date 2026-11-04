// HR home: staff headcount and pending leave requests with approve/reject.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Briefcase, CalendarClock, Users } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPatch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, StatCard, Spinner, ErrorState, EmptyState, StatusBadge, dateOnly } from '../../components/ui/Basics.jsx';
import DataTable from '../../components/ui/DataTable.jsx';

export default function HrDashboard() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/school/dashboard');
  const staff = useApi('/staff-profiles', { pageSize: 5 });
  const leaves = useApi('/leave-requests', { pageSize: 10, status: 'pending' });
  const canReview = can('staff.approve') || can('staff.edit');

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const setStatus = async (id, status) => {
    try {
      await apiPatch(`/leave-requests/${id}`, { status });
      toast.success(t('common.saved'));
      leaves.reload();
    } catch (e) { toast.error(e.message); }
  };

  const columns = [
    { key: 'school_user_id', label: t('dashboards.staffMember', { defaultValue: 'Staff' }), render: (r) => <span className="text-muted small">{String(r.school_user_id || '').slice(0, 8) || '—'}</span> },
    { key: 'leave_type', label: t('dashboards.leaveType', { defaultValue: 'Type' }), render: (r) => String(r.leave_type || '—').replace(/_/g, ' ') },
    { key: 'start_date', label: t('dashboards.from', { defaultValue: 'From' }), render: (r) => dateOnly(r.start_date) },
    { key: 'end_date', label: t('dashboards.to', { defaultValue: 'To' }), render: (r) => dateOnly(r.end_date) },
    { key: 'status', label: t('common.status'), render: (r) => <StatusBadge value={r.status} /> },
    {
      key: 'actions',
      label: '',
      className: 'text-end',
      render: (r) => (canReview ? (
        <span className="d-inline-flex gap-1">
          <button className="btn btn-sm btn-outline-success" onClick={() => setStatus(r.id, 'approved')}>{t('dashboards.approve', { defaultValue: 'Approve' })}</button>
          <button className="btn btn-sm btn-outline-danger" onClick={() => setStatus(r.id, 'rejected')}>{t('dashboards.reject', { defaultValue: 'Reject' })}</button>
        </span>
      ) : null),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('dashboards.hrHome', { defaultValue: 'Human resources' })}
        subtitle={data?.school?.school_name}
        actions={<Link to="/school/users" className="btn btn-sm btn-primary d-flex align-items-center gap-1"><Users size={14} /> {t('modules.users')}</Link>}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-4"><StatCard label={t('dashboards.staffProfiles', { defaultValue: 'Staff profiles' })} value={staff.total ?? '—'} icon={Briefcase} /></div>
        <div className="col-6 col-lg-4"><StatCard label={t('dashboards.pendingLeave', { defaultValue: 'Pending leave requests' })} value={leaves.total ?? (leaves.data || []).length} icon={CalendarClock} /></div>
        <div className="col-12 col-lg-4">
          <div className="card-soft p-3 h-100 d-flex flex-column justify-content-center gap-2">
            <Link to="/m/staff-profiles" className="btn btn-sm btn-outline-secondary">{t('modules.staff-profiles')}</Link>
            <Link to="/m/departments" className="btn btn-sm btn-outline-secondary">{t('modules.departments')}</Link>
          </div>
        </div>
      </div>

      <div className="my-1">
        <div className="fw-semibold mb-2">{t('dashboards.leaveRequestsToReview', { defaultValue: 'Leave requests to review' })}</div>
        <DataTable
          columns={columns}
          rows={leaves.data}
          loading={leaves.loading}
          error={leaves.error}
          onRetry={leaves.reload}
          dense
          empty={t('dashboards.noPendingLeave', { defaultValue: 'No pending leave requests' })}
        />
      </div>

      <div className="card-soft p-3 mt-1">
        <div className="fw-semibold mb-2">{t('modules.announcements')}</div>
        {(data?.announcements || []).length === 0 && <EmptyState title={t('common.none')} />}
        {(data?.announcements || []).map((a) => (
          <div key={a.id} className="border-bottom py-2">
            <div className="small fw-semibold">{a.title}</div>
            <div className="small text-muted">{dateOnly(a.created_at)}</div>
          </div>
        ))}
      </div>
    </>
  );
}
