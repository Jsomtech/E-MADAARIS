// Super-admin oversight of every cross-school student transfer on the platform (read-only).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, Eye, Loader2, RefreshCw } from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { apiGet } from '../../api/client.js';
import { toast } from 'react-toastify';
import DataTable from '../../components/ui/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { PageHeader, StatusBadge, dateOnly } from '../../components/ui/Basics.jsx';

const STATUSES = ['requested', 'completed', 'rejected', 'cancelled'];

export default function PlatformTransfersPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [detailRow, setDetailRow] = useState(null);

  const params = useMemo(() => ({ page, pageSize: 50, status: status || undefined }), [page, status]);
  const list = useApi('/platform/transfers', params);

  const columns = [
    { key: 'student_name', label: t('transfers.student', { defaultValue: 'Student' }), render: (r) => (
      <div>
        <div className="fw-semibold">{r.student_name}</div>
        <div className="small text-muted">{r.admission_number || '—'}</div>
      </div>
    ) },
    {
      key: 'route', label: t('transfers.route', { defaultValue: 'Route' }), render: (r) => (
        <span className="small">
          {r.payload?.from_school_name || '—'} <ArrowRightLeft size={12} className="mx-1 align-text-bottom" /> {r.payload?.to_school_name || '—'}
        </span>
      ),
    },
    { key: 'reason', label: t('transfers.reason', { defaultValue: 'Reason' }), render: (r) => <span className="small text-truncate" style={{ maxWidth: 240 }}>{r.reason}</span> },
    { key: 'status', label: t('common.status'), type: 'status', width: 130 },
    { key: 'requested_by_name', label: t('transfers.requestedBy', { defaultValue: 'Requested by' }), render: (r) => <span className="small">{r.requested_by_name || '—'}</span> },
    { key: 'created_at', label: t('transfers.requested', { defaultValue: 'Requested' }), type: 'date', width: 120 },
    {
      key: 'actions', label: t('common.actions'), width: 70, className: 'text-end', render: (r) => (
        <button type="button" className="btn btn-icon sm" title={t('transfers.view', { defaultValue: 'View' })} onClick={() => setDetailRow(r)}>
          <Eye size={14} />
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('transfers.platformTitle', { defaultValue: 'Student transfers' })}
        subtitle={t('transfers.platformSubtitle', { defaultValue: 'Every transfer request between schools on the platform.' })}
        actions={(
          <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={list.reload}>
            <RefreshCw size={14} /> {t('common.refresh', { defaultValue: 'Refresh' })}
          </button>
        )}
      />

      <div className="nav nav-pills gap-1 mb-3 flex-wrap">
        <button type="button" className={`btn btn-sm ${status === '' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => { setStatus(''); setPage(1); }}>{t('common.all')}</button>
        {STATUSES.map((s) => (
          <button type="button" key={s} className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => { setStatus(s); setPage(1); }}>
            {t(`transfers.status.${s}`, { defaultValue: s })}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={list.data}
        total={list.total}
        page={page}
        pageSize={50}
        onPage={setPage}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        empty={t('transfers.none', { defaultValue: 'No transfers to show.' })}
      />

      <TransferDetailModal row={detailRow} onClose={() => setDetailRow(null)} />
    </>
  );
}

function TransferDetailModal({ row, onClose }) {
  const { t } = useTranslation();
  const [full, setFull] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!row) { setFull(null); return; }
    setLoading(true);
    apiGet(`/platform/transfers/${row.id}`)
      .then(({ data }) => setFull(data))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [row]);

  const record = full || row || {};
  const dossier = record.payload?.dossier;

  return (
    <Modal open={Boolean(row)} size="lg" icon={ArrowRightLeft}
      title={`${t('transfers.request', { defaultValue: 'Transfer' })} · ${record.student_name || ''}`}
      subtitle={`${record.payload?.from_school_name || '—'} → ${record.payload?.to_school_name || '—'}`}
      onClose={onClose}
      footer={<button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</button>}>
      <div className="d-flex align-items-center gap-2 mb-3">
        <StatusBadge value={record.status} />
        <span className="small text-muted">{dateOnly(record.created_at)}</span>
      </div>
      <div className="card-soft p-3 mb-3">
        <div className="small"><span className="text-muted">{t('transfers.reason', { defaultValue: 'Reason' })}: </span>{record.reason}</div>
        {record.requested_by_name && <div className="small text-muted mt-1">{t('transfers.requestedBy', { defaultValue: 'Requested by' })} {record.requested_by_name}</div>}
        {record.decided_by_name && <div className="small text-muted mt-1">{t('transfers.decidedBy', { defaultValue: 'Decided by' })} {record.decided_by_name}{record.decision_note ? ` · ${record.decision_note}` : ''}</div>}
      </div>
      {loading && <div className="text-muted small"><Loader2 size={14} className="animate-spin me-1" />{t('common.loading')}</div>}
      {dossier && (
        <div className="row g-2 small">
          <Col label={t('transfers.guardians', { defaultValue: 'Guardians' })} value={dossier.guardians?.length || 0} />
          <Col label={t('transfers.documents', { defaultValue: 'Documents' })} value={dossier.documents?.length || 0} />
          <Col label={t('transfers.marks', { defaultValue: 'Marks' })} value={dossier.marks?.length || 0} />
          <Col label={t('transfers.attendance', { defaultValue: 'Attendance' })} value={dossier.attendance?.records?.length || 0} />
          <Col label={t('transfers.invoices', { defaultValue: 'Invoices' })} value={dossier.fees?.invoices?.length || 0} />
        </div>
      )}
    </Modal>
  );
}

function Col({ label, value }) {
  return (
    <div className="col-4">
      <div className="card-soft p-2 text-center">
        <div className="fs-5 fw-semibold tabular-nums">{value}</div>
        <div className="text-muted" style={{ fontSize: 12 }}>{label}</div>
      </div>
    </div>
  );
}
