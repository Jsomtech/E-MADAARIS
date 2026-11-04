import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  ClipboardSignature, PenSquare, FileCheck2, Send, Plus, CalendarClock,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPost } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import {
  PageHeader, StatCard, StatusBadge, Badge, Spinner, ErrorState, EmptyState, dateOnly,
} from '../../components/ui/Basics.jsx';
import { ChartCard, DoughnutView } from '../../components/ui/Charts.jsx';

/**
 * Examination officer home: marks entry progress from GET /school/dashboard, the exam list with an
 * inline publish action (POST /examinations/:id/publish) and the approvals still blocking it.
 */
export default function ExamOfficerDashboard() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/school/dashboard');
  const approvals = useApi('/result-approvals', { status: 'pending', pageSize: 10 }, can('results.view'));
  const [publishing, setPublishing] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const marks = data?.marksStatus || {};
  const exams = data?.examinations || [];
  const pendingCount = approvals.total ?? data?.pendingApprovals ?? 0;
  const canPublish = can('results.publish');

  const publish = async () => {
    if (!publishing) return;
    setBusy(true);
    try {
      await apiPost(`/examinations/${publishing.id}/publish`, {});
      toast.success(t('dashboards.published', { defaultValue: 'Results published' }));
      setPublishing(null);
      reload();
    } catch (e) {
      // 409 "All results must be reviewed before publication" surfaces here as-is.
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const marksTotal = ['draft', 'submitted', 'approved', 'rejected'].reduce((s, k) => s + (marks[k] || 0), 0);

  return (
    <>
      <PageHeader
        title={t('dashboards.examOfficerHome', { defaultValue: 'Examinations overview' })}
        subtitle={`${data?.school?.school_name || ''} · ${data?.subscription?.plan?.name || data?.subscription?.plan || ''}`}
        actions={(
          <>
            <Link to="/m/examinations" className="btn btn-sm btn-primary d-flex align-items-center gap-1">
              <Plus size={14} /> {t('modules.examinations')}
            </Link>
            <Link to="/m/marks" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1">
              <PenSquare size={14} /> {t('modules.marks')}
            </Link>
          </>
        )}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.examsCreated', { defaultValue: 'Examinations' })} value={exams.length} icon={ClipboardSignature} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.marksAwaitingApproval', { defaultValue: 'Approvals pending' })} value={pendingCount} icon={FileCheck2} tone={pendingCount ? 'warn' : 'brand'} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.marksEntered', { defaultValue: 'Marks entered' })} value={marksTotal} icon={PenSquare}
            hint={`${marks.approved ?? 0} ${t('dashboards.approvedShort', { defaultValue: 'approved' })}`} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.publishedExams', { defaultValue: 'Published' })} value={exams.filter((e) => e.status === 'published').length} icon={Send} />
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-4">
          <ChartCard title={t('dashboards.marksProgress', { defaultValue: 'Marks by approval state' })}
            subtitle={`${marksTotal} ${t('common.rows')}`}>
            {marksTotal === 0 && <EmptyState title={t('common.none')} hint={t('dashboards.noMarksHint', { defaultValue: 'No marks have been entered yet.' })} />}
            {marksTotal > 0 && (
              <DoughnutView
                labels={[
                  t('dashboards.draft', { defaultValue: 'Draft' }),
                  t('dashboards.submitted', { defaultValue: 'Submitted' }),
                  t('dashboards.approved', { defaultValue: 'Approved' }),
                  t('dashboards.rejected', { defaultValue: 'Rejected' }),
                ]}
                data={[marks.draft || 0, marks.submitted || 0, marks.approved || 0, marks.rejected || 0]}
                height={220}
              />
            )}
            <div className="d-flex flex-wrap gap-2 small text-muted mt-2">
              <span>{t('dashboards.draft', { defaultValue: 'Draft' })}: {marks.draft ?? 0}</span>
              <span>{t('dashboards.submitted', { defaultValue: 'Submitted' })}: {marks.submitted ?? 0}</span>
              <span>{t('dashboards.approved', { defaultValue: 'Approved' })}: {marks.approved ?? 0}</span>
              <span>{t('dashboards.rejected', { defaultValue: 'Rejected' })}: {marks.rejected ?? 0}</span>
            </div>
          </ChartCard>
        </div>

        <div className="col-12 col-lg-8">
          <div className="card-soft p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><CalendarClock size={15} className="me-1" /> {t('dashboards.examList', { defaultValue: 'Examinations' })}</div>
              <Link to="/m/examinations" className="small">{t('common.viewAll')}</Link>
            </div>
            {exams.length === 0 && <EmptyState title={t('common.none')} hint={t('dashboards.createExamHint', { defaultValue: 'Create one to start collecting marks.' })} />}
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0 small">
                {exams.length > 0 && (
                  <thead className="bg-white">
                    <tr>
                      <th>{t('common.name')}</th>
                      <th>{t('common.status')}</th>
                      <th>{t('common.date')}</th>
                      <th className="text-end">{t('common.actions')}</th>
                    </tr>
                  </thead>
                )}
                <tbody>
                  {exams.map((e) => (
                    <tr key={e.id}>
                      <td className="text-truncate fw-semibold">{e.name || e.title || e.id}</td>
                      <td><StatusBadge value={e.status} /></td>
                      <td className="text-muted">{dateOnly(e.created_at)}</td>
                      <td className="text-end white-space-nowrap">
                        {canPublish && e.status !== 'published' && (
                          <button className="btn btn-sm btn-outline-primary" onClick={() => setPublishing(e)}>
                            <Send size={14} className="me-1" />{t('dashboards.publish', { defaultValue: 'Publish results' })}
                          </button>
                        )}
                        {(!canPublish || e.status === 'published') && (
                          <span className="text-muted">{e.status === 'published' ? t('dashboards.alreadyPublished', { defaultValue: 'Published' }) : '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12">
          <div className="card-soft p-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="fw-semibold"><FileCheck2 size={15} className="me-1" /> {t('dashboards.blockingPublication', { defaultValue: 'Approvals blocking publication' })}
                {pendingCount ? <Badge tone="warn" className="ms-2">{pendingCount}</Badge> : null}
              </div>
              <Link to="/m/results" className="small">{t('modules.results')}</Link>
            </div>
            {(approvals.data || []).length === 0 ? (
              <EmptyState title={t('dashboards.noPendingApprovals', { defaultValue: 'No results awaiting approval' })} />
            ) : (
              (approvals.data || []).map((a) => (
                <div key={a.id} className="d-flex justify-content-between align-items-center border-bottom py-2 small">
                  <span className="text-truncate me-2">
                    {a.examinations?.name || a.examination_name || `${t('modules.examinations')} ${String(a.examination_id || '').slice(0, 8)}`}
                    <span className="text-muted"> · {a.classes?.name || a.class_name || t('dashboards.allClasses', { defaultValue: 'whole class' })}</span>
                  </span>
                  <span className="d-flex align-items-center gap-2 text-muted white-space-nowrap">
                    <StatusBadge value={a.status} /> {dateOnly(a.created_at)}
                  </span>
                </div>
              ))
            )}
            {approvals.error && (
              <p className="small text-muted mb-0">{t('dashboards.approvalsUnavailable', { defaultValue: 'The approval queue is not visible to your account; the count above comes from the dashboard.' })}</p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(publishing)}
        danger={false}
        title={t('dashboards.publishConfirm', { defaultValue: 'Publish this examination?' })}
        message={`${publishing?.name || publishing?.id || ''} — ${pendingCount
          ? t('dashboards.publishBlocked', { defaultValue: `${pendingCount} approvals are still pending; publishing will be refused until they are reviewed.` })
          : t('dashboards.publishOk', { defaultValue: 'All marks are reviewed, so the results will become visible to students and parents.' })}`}
        confirmLabel={t('dashboards.publish', { defaultValue: 'Publish results' })}
        busy={busy}
        onConfirm={publish}
        onClose={() => { if (!busy) setPublishing(null); }}
      />
    </>
  );
}
