import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  GraduationCap, Users, ClipboardList, BookOpen, CheckCircle2, XCircle, FileCheck2, CalendarClock,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiGet, apiPost } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import {
  PageHeader, StatCard, StatusBadge, Spinner, ErrorState, EmptyState, dateOnly,
} from '../../components/ui/Basics.jsx';
import { ChartCard, DoughnutView } from '../../components/ui/Charts.jsx';

/**
 * Principal home: today's attendance, school size and the pending result approvals the head
 * teacher can sign off inline (GET /school/dashboard + POST /examinations/results/:id/review).
 */
export default function PrincipalDashboard() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/school/dashboard');
  const [names, setNames] = useState({ examinations: {}, classes: {}, subjects: {} });
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const approvals = data?.pendingResultApprovals || [];
  const canReview = can('results.approve') || can('results.reject');

  // Labels for the approval rows: result_approvals only stores ids, so resolve names best-effort.
  useEffect(() => {
    if (!canReview || approvals.length === 0) return undefined;
    let cancelled = false;
    (async () => {
      const [exams, classes, subjects] = await Promise.all([
        apiGet('/examinations', { pageSize: 100 }).catch(() => null),
        apiGet('/classes', { pageSize: 100 }).catch(() => null),
        apiGet('/subjects', { pageSize: 100 }).catch(() => null),
      ]);
      if (cancelled) return;
      const byId = (rows) => Object.fromEntries((rows || []).map((r) => [r.id, r.name || r.title || r.code || r.id]));
      setNames({
        examinations: byId(exams?.data),
        classes: byId(classes?.data),
        subjects: byId(subjects?.data),
      });
    })();
    return () => { cancelled = true; };
  }, [canReview, approvals.length]);

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const att = data?.attendanceToday || {};
  const exams = data?.upcomingExaminations || [];
  const labelFor = (kind, id, row, key) => row[key] || names[kind][id] || (id ? String(id).slice(0, 8) : '—');

  const approve = async (row) => {
    setBusy(true);
    try {
      await apiPost(`/examinations/results/${row.id}/review`, { action: 'approve' });
      toast.success(t('dashboards.approvalGranted', { defaultValue: 'Result approved' }));
      reload();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      await apiPost(`/examinations/results/${rejecting.id}/review`, { action: 'reject', reason: reason.trim() });
      toast.success(t('dashboards.approvalRejected', { defaultValue: 'Result rejected' }));
      setRejecting(null);
      setReason('');
      reload();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { key: 'examination_id', label: t('modules.examinations'), render: (r) => labelFor('examinations', r.examination_id, r, 'examination_name') },
    { key: 'class_id', label: t('modules.classes'), render: (r) => labelFor('classes', r.class_id, r, 'class_name') },
    { key: 'subject_id', label: t('modules.subjects'), render: (r) => (r.subject_id ? labelFor('subjects', r.subject_id, r, 'subject_name') : t('dashboards.allSubjects', { defaultValue: 'All subjects' })) },
    { key: 'status', label: t('common.status'), type: 'status' },
    { key: 'created_at', label: t('common.date'), type: 'date' },
    {
      key: 'actions',
      label: t('common.actions'),
      className: 'text-end white-space-nowrap',
      render: (r) => (
        <>
          {can('results.approve') && (
            <button className="btn btn-sm btn-outline-success me-1" disabled={busy} onClick={() => approve(r)}
              title={t('common.confirm')}>
              <CheckCircle2 size={14} className="me-1" />{t('dashboards.approve', { defaultValue: 'Approve' })}
            </button>
          )}
          {can('results.reject') && (
            <button className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => { setRejecting(r); setReason(''); }}>
              <XCircle size={14} className="me-1" />{t('dashboards.reject', { defaultValue: 'Reject' })}
            </button>
          )}
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('dashboards.principalHome', { defaultValue: 'Principal overview' })}
        subtitle={`${data?.school?.school_name || ''} · ${data?.subscription?.plan?.name || data?.subscription?.plan || ''}`}
        actions={(
          <>
            <Link to="/m/results" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1">
              <FileCheck2 size={14} /> {t('modules.results')}
            </Link>
            <Link to="/m/examinations" className="btn btn-sm btn-primary d-flex align-items-center gap-1">
              <CalendarClock size={14} /> {t('modules.examinations')}
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
            subtitle={`${att.present ?? 0}/${att.total ?? 0} ${t('dashboards.recorded', { defaultValue: 'recorded' })}`}>
            <div className="d-flex align-items-baseline gap-2 mb-2">
              <span className="fs-2 fw-bold">{att.rate != null ? `${att.rate}%` : '—'}</span>
              <span className="small text-muted">{t('dashboards.presentOrLate', { defaultValue: 'present or late' })}</span>
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
            <div className="d-flex flex-wrap gap-2 small text-muted mt-2">
              <span>{t('dashboards.present', { defaultValue: 'Present' })}: {att.present ?? 0}</span>
              <span>{t('dashboards.absent', { defaultValue: 'Absent' })}: {att.absent ?? 0}</span>
              <span>{t('dashboards.late', { defaultValue: 'Late' })}: {att.late ?? 0}</span>
              <span>{t('dashboards.excused', { defaultValue: 'Excused' })}: {att.excused ?? 0}</span>
            </div>
            <Link to="/m/attendance" className="btn btn-sm btn-outline-primary mt-2">{t('modules.attendance')}</Link>
          </ChartCard>
        </div>

        <div className="col-12 col-lg-7">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><CalendarClock size={15} className="me-1" /> {t('dashboards.upcomingExams', { defaultValue: 'Upcoming examinations' })}</div>
              <Link to="/m/examinations" className="small">{t('common.viewAll')}</Link>
            </div>
            {exams.length === 0 && <EmptyState title={t('common.none')} hint={t('dashboards.noExamsHint', { defaultValue: 'Nothing is scheduled yet.' })} />}
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
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="fw-semibold"><FileCheck2 size={15} className="me-1" /> {t('dashboards.pendingResultApprovals', { defaultValue: 'Results waiting for your review' })} <CountPill count={approvals.length} /></div>
            <Link to="/m/results" className="small">{t('common.viewAll')}</Link>
          </div>
          {!canReview && approvals.length > 0 && (
            <p className="small text-muted">{t('dashboards.readOnlyApprovals', { defaultValue: 'You can see the queue but not sign results off.' })}</p>
          )}
          {approvals.length === 0 ? (
            <div className="card-soft p-3"><EmptyState title={t('dashboards.noPendingApprovals', { defaultValue: 'No results awaiting approval' })} /></div>
          ) : (
            <DataTable columns={canReview ? columns : columns.slice(0, 5)} rows={approvals} dense empty={t('common.empty')} />
          )}
        </div>
      </div>

      <Modal
        open={Boolean(rejecting)}
        size="sm"
        title={t('dashboards.rejectReason', { defaultValue: 'Why are you rejecting this result?' })}
        onClose={() => { setRejecting(null); setReason(''); }}
        footer={(
          <>
            <button className="btn btn-outline-secondary" onClick={() => { setRejecting(null); setReason(''); }}>{t('common.cancel')}</button>
            <button className="btn btn-danger" disabled={busy || reason.trim().length === 0} onClick={confirmReject}>
              {t('dashboards.reject', { defaultValue: 'Reject' })}
            </button>
          </>
        )}
      >
        <div className="small text-muted mb-2">
          {rejecting ? `${labelFor('examinations', rejecting.examination_id, rejecting, 'examination_name')} · ${labelFor('classes', rejecting.class_id, rejecting, 'class_name')}` : ''}
        </div>
        <label className="form-label small fw-semibold" htmlFor="reject-reason">{t('dashboards.rejectReason', { defaultValue: 'Why are you rejecting this result?' })}</label>
        <textarea id="reject-reason" className="form-control" rows={4} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={t('dashboards.rejectPlaceholder', { defaultValue: 'The teacher must fix this before it can be published.' })} />
      </Modal>
    </>
  );
}

function CountPill({ count }) {
  if (!count) return null;
  return <span className="badge rounded-pill text-bg-warning align-middle ms-1">{count}</span>;
}
