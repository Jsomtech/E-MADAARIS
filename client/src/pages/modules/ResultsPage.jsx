/**
 * Results approval queue: review submitted marks per class + subject, then publish an
 * examination once nothing is pending any more.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Check, Megaphone, RefreshCw, X } from 'lucide-react';
import { apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge, dateOnly, dateTime } from '../../components/ui/Basics.jsx';
import { ConfirmDialog, Modal } from '../../components/ui/Modal.jsx';

const TABS = ['pending', 'approved', 'rejected'];

export default function ResultsPage({ query = {} }) {
  const { t } = useTranslation();
  const { can } = useAuth();

  const [tab, setTab] = useState(query.status || 'pending');
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [approving, setApproving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rowErrors, setRowErrors] = useState({});
  const [publishErrors, setPublishErrors] = useState({});

  const approvals = useApi('/result-approvals', { status: tab, pageSize: 100 });
  const classes = useApi('/classes', { pageSize: 200 });
  const subjects = useApi('/subjects', { pageSize: 200 });
  const examinations = useApi('/examinations', { pageSize: 200 });

  const nameOf = (rows, id, join, fallback) => join || (rows || []).find((x) => x.id === id)?.name || id || fallback;

  const rows = useMemo(() => (approvals.data || []).map((a) => ({
    ...a,
    examName: a.examinations?.name || (examinations.data || []).find((e) => e.id === a.examination_id)?.name
      || `${t('modules.examinationFallback', { defaultValue: 'Examination' })} ${String(a.examination_id).slice(0, 8)}`,
    className: a.classes?.name || nameOf(classes.data, a.class_id, null, t('modules.allClasses', { defaultValue: 'All classes' })),
    subjectName: a.subjects?.name || nameOf(subjects.data, a.subject_id, null, t('modules.allSubjects', { defaultValue: 'All subjects' })),
  })), [approvals.data, classes.data, subjects.data, examinations.data, t]);

  const publishable = (examinations.data || []).filter((e) => e.status !== 'published');

  const review = async (row, action) => {
    setBusy(true);
    setRowErrors((prev) => ({ ...prev, [row.id]: null }));
    try {
      await apiPost(`/examinations/results/${row.id}/review`, {
        action,
        ...(action === 'reject' && reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast.success(action === 'approve'
        ? t('modules.resultsApproved', { defaultValue: 'Results approved' })
        : t('modules.resultsRejected', { defaultValue: 'Results rejected' }));
      setApproving(null);
      setRejecting(null);
      setReason('');
      approvals.reload();
      examinations.reload();
    } catch (error) {
      setRowErrors((prev) => ({ ...prev, [row.id]: error.message }));
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const publish = async (exam) => {
    setBusy(true);
    setPublishErrors((prev) => ({ ...prev, [exam.id]: null }));
    try {
      await apiPost(`/examinations/${exam.id}/publish`, {});
      toast.success(t('modules.resultsPublished', { defaultValue: 'Results published' }));
      examinations.reload();
      approvals.reload();
    } catch (error) {
      setPublishErrors((prev) => ({ ...prev, [exam.id]: error.message }));
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('modules.results', { defaultValue: 'Results & approvals' })}
        subtitle={t('modules.resultsHint', { defaultValue: 'Review the marks a teacher submitted, then publish the examination. A submitter cannot approve their own submission.' })}
        actions={(
          <button className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
            onClick={() => { approvals.reload(); examinations.reload(); }}>
            <RefreshCw size={14} /> {t('common.refresh')}
          </button>
        )}
      />

      <div className="card-soft p-2 mb-3">
        <div className="nav nav-pills gap-1">
          {TABS.map((key) => (
            <button key={key} className={`nav-link ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              {t(`statuses.${key}`, { defaultValue: key.charAt(0).toUpperCase() + key.slice(1) })}
            </button>
          ))}
        </div>
      </div>

      <div className="card-soft overflow-hidden mb-3">
        <div className="table-responsive">
          {approvals.loading && !approvals.data && <div className="p-3"><Spinner label={t('common.loading')} /></div>}
          {approvals.error && <div className="p-3"><ErrorState error={approvals.error} onRetry={approvals.reload} /></div>}
          {!approvals.loading && !approvals.error && !rows.length && (
            <EmptyState title={t('modules.noApprovalsHere', { defaultValue: 'Nothing in this queue' })} />
          )}
          {rows.length > 0 && (
            <table className="table table-hover align-middle mb-0">
              <thead className="bg-white">
                <tr>
                  <th>{t('modules.examination', { defaultValue: 'Examination' })}</th>
                  <th>{t('modules.class', { defaultValue: 'Class' })}</th>
                  <th>{t('modules.subject', { defaultValue: 'Subject' })}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('modules.submitted', { defaultValue: 'Submitted' })}</th>
                  <th className="text-end">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="small fw-semibold">{row.examName}</td>
                    <td className="small">{row.className}</td>
                    <td className="small">{row.subjectName}</td>
                    <td>
                      <StatusBadge value={row.status} />
                      {row.reason && <div className="small text-muted mt-1">{row.reason}</div>}
                    </td>
                    <td className="small text-muted">
                      {row.reviewed_by ? `${t('modules.reviewed', { defaultValue: 'Reviewed' })} ${dateTime(row.updated_at)}` : dateTime(row.created_at)}
                      {row.submitted_by && <div className="text-truncate" style={{ maxWidth: 160 }}>{String(row.submitted_by).slice(0, 8)}</div>}
                    </td>
                    <td className="text-end text-nowrap">
                      {tab === 'pending' && can('results.approve') && (
                        <button className="btn btn-sm btn-outline-success me-1 d-inline-flex align-items-center gap-1"
                          disabled={busy} onClick={() => setApproving(row)}>
                          <Check size={14} /> {t('modules.approve', { defaultValue: 'Approve' })}
                        </button>
                      )}
                      {tab === 'pending' && can('results.reject') && (
                        <button className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                          disabled={busy} onClick={() => { setRejecting(row); setReason(''); }}>
                          <X size={14} /> {t('modules.reject', { defaultValue: 'Reject' })}
                        </button>
                      )}
                      {tab !== 'pending' && <span className="text-muted small">{dateOnly(row.updated_at)}</span>}
                      {!can('results.approve') && !can('results.reject') && (
                        <span className="text-muted small">{t('modules.readOnly', { defaultValue: 'Read only' })}</span>
                      )}
                      {rowErrors[row.id] && <div className="small text-danger mt-1">{rowErrors[row.id]}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {can('results.publish') && (
        <div className="card-soft p-3">
          <div className="fw-semibold mb-1"><Megaphone size={15} className="me-1" />{t('modules.publishPanel', { defaultValue: 'Publish results' })}</div>
          <p className="small text-muted">{t('modules.publishHint', { defaultValue: 'Publication is refused (409) while any approval is still pending.' })}</p>
          {examinations.loading && !examinations.data && <Spinner label={t('common.loading')} />}
          {examinations.error && (
            <div className="small text-muted">
              {t('modules.examListError', { defaultValue: 'Could not load the examinations.' })}
              <span className="d-block text-danger small">{examinations.error.message}</span>
            </div>
          )}
          {!examinations.loading && !examinations.error && !publishable.length && (
            <EmptyState title={t('modules.nothingToPublish', { defaultValue: 'Every examination is already published' })} />
          )}
          {publishable.length > 0 && (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead className="bg-white">
                  <tr>
                    <th>{t('modules.examination', { defaultValue: 'Examination' })}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('modules.created', { defaultValue: 'Created' })}</th>
                    <th className="text-end">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {publishable.map((exam) => (
                    <tr key={exam.id}>
                      <td className="small fw-semibold">{exam.name || exam.title || `${t('modules.examinationFallback', { defaultValue: 'Examination' })} ${String(exam.id).slice(0, 8)}`}</td>
                      <td><StatusBadge value={exam.status} /></td>
                      <td className="small text-muted">{dateOnly(exam.created_at)}</td>
                      <td className="text-end">
                        <button className="btn btn-sm btn-dark" disabled={busy} onClick={() => publish(exam)}>
                          {t('modules.publish', { defaultValue: 'Publish' })}
                        </button>
                        {publishErrors[exam.id] && <div className="small text-danger mt-1">{publishErrors[exam.id]}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog open={Boolean(approving)} danger={false} busy={busy}
        title={t('modules.approveResults', { defaultValue: 'Approve results' })}
        message={`${t('modules.approveBody', { defaultValue: 'Approving marks these entries as final for' })} ${approving?.className || ''} · ${approving?.subjectName || ''}.`}
        confirmLabel={t('modules.approve', { defaultValue: 'Approve' })}
        onConfirm={() => review(approving, 'approve')} onClose={() => setApproving(null)} />

      <Modal open={Boolean(rejecting)} size="md" onClose={() => setRejecting(null)}
        title={t('modules.rejectResults', { defaultValue: 'Reject results' })}
        footer={(
          <>
            <button className="btn btn-outline-secondary" onClick={() => setRejecting(null)}>{t('common.cancel')}</button>
            <button className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => review(rejecting, 'reject')}>
              {t('modules.reject', { defaultValue: 'Reject' })}
            </button>
          </>
        )}>
        <p className="small text-muted">{t('modules.rejectNeedsReason', { defaultValue: 'A reason is required so the teacher knows what to fix.' })}</p>
        <textarea className="form-control" rows={3} value={reason} autoFocus
          placeholder={t('modules.reasonPlaceholder', { defaultValue: 'e.g. Marks for 4 students exceed the maximum' })}
          onChange={(e) => setReason(e.target.value)} />
        {reason.trim().length > 0 && reason.trim().length < 3 && (
          <div className="form-text text-danger small">{t('modules.reasonTooShort', { defaultValue: 'Give a reason (at least 3 characters)' })}</div>
        )}
      </Modal>
    </>
  );
}
