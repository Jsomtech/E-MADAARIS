// School registration queue: review, approve (provisions the tenant) or reject applications.
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { CheckCircle2, Inbox, RefreshCw, Search, ShieldAlert, XCircle } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiPost } from '../../api/client.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge, dateTime } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/** school_registrations.status values (see supabase/migrations/0003_schools.sql). */
const REG_STATUSES = ['submitted', 'under_review', 'approved', 'rejected'];

export default function ApplicationsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isSuperAdmin = profile?.primaryRole === 'super_admin' || (profile?.roles || []).includes('super_admin');

  const [status, setStatus] = useState('submitted');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [approving, setApproving] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = useApi('/platform/applications', { status: status || undefined });

  const rows = useMemo(() => {
    const all = list.data || [];
    const term = query.trim().toLowerCase();
    if (!term) return all;
    return all.filter((r) => [r.school_name, r.admin_email, r.school_email, r.country, r.city]
      .some((v) => String(v || '').toLowerCase().includes(term)));
  }, [list.data, query]);

  const approve = useCallback(async (row) => {
    setBusy(true);
    try {
      const { data } = await apiPost(`/platform/applications/${row.id}/approve`, {});
      toast.success(t('platform.applicationApproved', { defaultValue: 'Tenant provisioned for {{school}}', school: data?.school?.school_name || row.school_name }));
      setApproving(null);
      setDetail(null);
      list.reload();
    } catch (error) {
      if (error.status === 403) toast.error(t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }));
      else if (error.status === 409) toast.error(t('platform.alreadyApproved', { defaultValue: 'This application was already approved.' }));
      else toast.error(error.message);
    } finally { setBusy(false); }
  }, [list, t]);

  const reject = useCallback(async (row, reason) => {
    setBusy(true);
    try {
      await apiPost(`/platform/applications/${row.id}/reject`, { reason });
      toast.success(t('platform.applicationRejected', { defaultValue: 'Application rejected and the applicant was emailed.' }));
      setRejecting(null);
      setDetail(null);
      list.reload();
    } catch (error) {
      if (error.status === 403) toast.error(t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' }));
      else toast.error(error.message);
    } finally { setBusy(false); }
  }, [list, t]);

  const label = (value) => t(`platform.status.${value}`, { defaultValue: String(value).replace(/_/g, ' ') });

  return (
    <>
      <PageHeader
        title={t('platform.applications', { defaultValue: 'School applications' })}
        subtitle={t('platform.applicationsSubtitle', { defaultValue: 'Self-service registrations waiting for a platform decision.' })}
        actions={(
          <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={list.reload}>
            <RefreshCw size={14} /> {t('common.refresh')}
          </button>
        )}
      />

      {!isSuperAdmin && (
        <div className="alert alert-warning d-flex align-items-start gap-2 small">
          <ShieldAlert size={16} className="mt-1" />
          <div>{t('platform.approveSupportHint', { defaultValue: 'You can review applications, but approving or rejecting one requires a Super Admin.' })}</div>
        </div>
      )}

      <div className="card-soft p-2 mb-3">
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <div className="input-group input-group-sm" style={{ maxWidth: 320 }}>
            <span className="input-group-text bg-white"><Search size={14} /></span>
            <input className="form-control" value={query} placeholder={t('platform.applicationsSearch', { defaultValue: 'Filter by school, admin, country…' })} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="nav nav-pills gap-1 flex-wrap">
            <button className={`btn btn-sm ${status === '' ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setStatus('')}>{t('common.all')}</button>
            {REG_STATUSES.map((s) => (
              <button key={s} className={`btn btn-sm ${status === s ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setStatus(s)}>{label(s)}</button>
            ))}
          </div>
        </div>
      </div>

      {list.loading && !list.data && <Spinner label={t('common.loading')} />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}

      {list.data && !list.loading && (
        rows.length === 0
          ? <div className="card-soft"><EmptyState title={t('platform.noApplications', { defaultValue: 'No applications in this queue' })} icon={Inbox} /></div>
          : (
            <div className="row g-3">
              {rows.map((row) => (
                <div className="col-12 col-md-6 col-xl-4" key={row.id}>
                  <div className="card-soft p-3 h-100 d-flex flex-column">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div className="fw-semibold">{row.school_name}</div>
                      <StatusBadge value={row.status} />
                    </div>
                    <div className="small text-muted mt-1">{row.school_type?.replace(/_/g, ' ')} · {row.country || '—'}{row.city ? ` · ${row.city}` : ''}</div>
                    <div className="small mt-2">{row.admin_full_name}</div>
                    <div className="small text-muted">{row.admin_email}</div>
                    <div className="small text-muted mb-2">{row.subscription_plans?.name ? `${t('platform.plan', { defaultValue: 'Plan' })}: ${row.subscription_plans.name}` : t('platform.noPlanChosen', { defaultValue: 'No plan selected' })}</div>
                    <div className="small text-muted mt-auto">{dateTime(row.created_at)}</div>
                    <div className="d-flex gap-2 mt-2">
                      <button className="btn btn-sm btn-outline-secondary flex-grow-1" onClick={() => setDetail(row)}>{t('common.viewAll')}</button>
                      {row.status !== 'approved' && row.status !== 'rejected' && (
                        <button className="btn btn-sm btn-outline-success d-flex align-items-center gap-1" disabled={!isSuperAdmin} onClick={() => setApproving(row)}>
                          <CheckCircle2 size={14} /> {t('platform.approve', { defaultValue: 'Approve' })}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
      )}

      <DetailModal row={detail} isSuperAdmin={isSuperAdmin} busy={busy}
        onClose={() => setDetail(null)} onApprove={(r) => setApproving(r)} onReject={(r) => setRejecting(r)} />

      <ApproveModal row={approving} busy={busy} onClose={() => setApproving(null)} onConfirm={approve} />
      <RejectModal row={rejecting} busy={busy} onClose={() => setRejecting(null)} onConfirm={reject} />
    </>
  );
}

function DetailModal({ row, isSuperAdmin, busy, onClose, onApprove, onReject }) {
  const { t } = useTranslation();
  const labels = [
    [t('platform.schoolName', { defaultValue: 'School name' }), row?.school_name],
    [t('platform.schoolType', { defaultValue: 'School type' }), row?.school_type?.replace(/_/g, ' ')],
    [t('platform.registrationNumber', { defaultValue: 'Registration number' }), row?.registration_number],
    [t('platform.schoolEmail', { defaultValue: 'School email' }), row?.school_email],
    [t('platform.schoolPhone', { defaultValue: 'School phone' }), row?.school_phone],
    [t('platform.country', { defaultValue: 'Country' }), row?.country],
    [t('platform.region', { defaultValue: 'Region' }), row?.region],
    [t('platform.city', { defaultValue: 'City' }), row?.city],
    [t('platform.address', { defaultValue: 'Address' }), row?.address],
    [t('platform.adminName', { defaultValue: 'Initial administrator name' }), row?.admin_full_name],
    [t('platform.adminEmail', { defaultValue: 'Initial administrator email' }), row?.admin_email],
    [t('platform.adminPhone', { defaultValue: 'Administrator phone' }), row?.admin_phone],
    [t('platform.plan', { defaultValue: 'Plan' }), row?.subscription_plans?.name],
    [t('platform.submittedAt', { defaultValue: 'Submitted' }), row ? dateTime(row.created_at) : null],
    [t('platform.reviewedAt', { defaultValue: 'Reviewed' }), row?.reviewed_at ? dateTime(row.reviewed_at) : null],
    [t('platform.rejectionReason', { defaultValue: 'Rejection reason' }), row?.rejection_reason],
  ];

  return (
    <Modal open={Boolean(row)} size="lg" title={t('platform.applicationDetail', { defaultValue: 'Application detail' })} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.close')}</button>
          {row && row.status !== 'approved' && row.status !== 'rejected' && (
            <>
              <button className="btn btn-outline-danger d-flex align-items-center gap-1" disabled={!isSuperAdmin || busy} onClick={() => onReject(row)}>
                <XCircle size={14} /> {t('platform.reject', { defaultValue: 'Reject' })}
              </button>
              <button className="btn btn-success d-flex align-items-center gap-1" disabled={!isSuperAdmin || busy} onClick={() => onApprove(row)}>
                <CheckCircle2 size={14} /> {t('platform.approve', { defaultValue: 'Approve' })}
              </button>
            </>
          )}
        </>
      )}>
      {row && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="fw-semibold fs-5">{row.school_name}</div>
            <StatusBadge value={row.status} />
          </div>
          <div className="row g-2 small">
            {labels.map(([label, value]) => (
              <div className="col-6" key={label}>
                <div className="text-muted">{label}</div>
                <div className="fw-semibold">{value || '—'}</div>
              </div>
            ))}
          </div>
          {row.message && (
            <div className="mt-3">
              <div className="small text-muted">{t('platform.applicantMessage', { defaultValue: 'Message from the applicant' })}</div>
              <div className="small card-soft p-2 mt-1">{row.message}</div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function ApproveModal({ row, busy, onClose, onConfirm }) {
  const { t } = useTranslation();
  return (
    <Modal open={Boolean(row)} size="lg" title={t('platform.approveTitle', { defaultValue: 'Approve this application?' })} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-success" onClick={() => onConfirm(row)} disabled={busy}>{busy ? '…' : t('platform.approveAndProvision', { defaultValue: 'Approve & provision' })}</button>
        </>
      )}>
      {row && (
        <>
          <div className="alert alert-warning small d-flex align-items-start gap-2">
            <ShieldAlert size={16} className="mt-1" />
            <div>{t('platform.provisionWarning', { defaultValue: 'This cannot be undone from here. Approving creates the tenant for {{school}}.', school: row.school_name })}</div>
          </div>
          <div className="small fw-semibold mb-1">{t('platform.serverProvisions', { defaultValue: 'The server will:' })}</div>
          <ul className="small text-muted ps-3 mb-3">
            <li>{t('platform.provisionSchool', { defaultValue: 'Insert the schools row (status "trial") and its school_settings row.' })}</li>
            <li>{t('platform.provisionRoles', { defaultValue: 'Create the system school roles with their default permission grants.' })}</li>
            <li>{t('platform.provisionSub', { defaultValue: 'Open a trial subscription on the selected plan, with trial end and grace period from the plan.' })}</li>
            <li>{t('platform.provisionAdmin', { defaultValue: 'Generate an auth invite for the administrator and email the activation link.' })}</li>
            <li>{t('platform.provisionMark', { defaultValue: 'Mark the registration as approved and write an audit entry.' })}</li>
          </ul>
          <div className="row g-2 small">
            <div className="col-6"><div className="text-muted">{t('platform.adminEmail', { defaultValue: 'Initial administrator email' })}</div><div className="fw-semibold">{row.admin_email}</div></div>
            <div className="col-6"><div className="text-muted">{t('platform.plan', { defaultValue: 'Plan' })}</div><div className="fw-semibold">{row.subscription_plans?.name || '—'}</div></div>
          </div>
        </>
      )}
    </Modal>
  );
}

function RejectModal({ row, busy, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    const trimmed = reason.trim();
    if (trimmed.length < 3 || trimmed.length > 500) {
      setError(t('platform.reasonLength', { defaultValue: 'Give a reason between 3 and 500 characters.' }));
      return;
    }
    setError('');
    onConfirm(row, trimmed);
    setReason('');
  };

  return (
    <Modal open={Boolean(row)} size="sm" title={t('platform.rejectTitle', { defaultValue: 'Reject application' })} onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-danger" onClick={submit} disabled={busy}>{busy ? '…' : t('platform.reject', { defaultValue: 'Reject' })}</button>
        </>
      )}>
      <div className="small mb-2">{t('platform.rejectHint', { defaultValue: 'The reason is emailed to {{email}} and stored on the application.', email: row?.admin_email })}</div>
      <textarea className={`form-control${error ? ' is-invalid' : ''}`} rows={4} maxLength={500} value={reason}
        placeholder={t('platform.reasonPlaceholder', { defaultValue: 'Why is this application rejected?' })}
        onChange={(e) => { setReason(e.target.value); setError(''); }} />
      {error && <div className="form-text text-danger small">{error}</div>}
    </Modal>
  );
}
