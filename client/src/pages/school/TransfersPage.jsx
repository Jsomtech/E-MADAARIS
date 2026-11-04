// School-side student transfers: an administrator sends a learner to another E-MADAARIS school and
// decides requests coming in. Approving at the destination re-admits the student and clears them here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  ArrowRightLeft, Eye, Loader2, Plus, RefreshCw, ShieldX, XCircle,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiGet, apiPost, downloadFile } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Field from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import StudentPackPanel from '../../components/transfers/StudentPackPanel.jsx';
import { EmptyState, PageHeader, StatusBadge, dateOnly } from '../../components/ui/Basics.jsx';

const fullStudentName = (s) => s.full_name || [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ');

export default function SchoolTransfersPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const schoolId = profile?.school?.id || profile?.schoolId;
  const enabled = useApi('/school/transfers/enabled');
  const [tab, setTab] = useState('incoming');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailRow, setDetailRow] = useState(null);

  const list = useApi('/school/transfers');
  const rows = useMemo(() => list.data || [], [list.data]);
  const incoming = useMemo(() => rows.filter((r) => r.to_school_id === schoolId), [rows, schoolId]);
  const outgoing = useMemo(() => rows.filter((r) => r.from_school_id === schoolId), [rows, schoolId]);

  const notEnabled = !enabled.loading && enabled.data && enabled.data.enabled === false;

  const makeColumns = (direction) => [
    { key: 'student_name', label: t('transfers.student', { defaultValue: 'Student' }), render: (r) => (
      <div>
        <div className="fw-semibold">{r.student_name}</div>
        <div className="small text-muted">{r.admission_number || '—'}</div>
      </div>
    ) },
    {
      key: 'route', label: t('transfers.route', { defaultValue: 'Direction' }), render: (r) => (
        direction === 'incoming'
          ? <span className="small">{t('transfers.from', { defaultValue: 'From' })} {r.payload?.from_school_name || t('transfers.anotherSchool', { defaultValue: 'another school' })}</span>
          : <span className="small">{t('transfers.to', { defaultValue: 'To' })} {r.payload?.to_school_name || t('transfers.anotherSchool', { defaultValue: 'another school' })}</span>
      ),
    },
    { key: 'reason', label: t('transfers.reason', { defaultValue: 'Reason' }), render: (r) => <span className="small text-truncate" style={{ maxWidth: 260 }}>{r.reason}</span> },
    { key: 'status', label: t('common.status'), type: 'status', width: 130 },
    { key: 'created_at', label: t('transfers.requested', { defaultValue: 'Requested' }), type: 'date', width: 120 },
    {
      key: 'actions', label: t('common.actions'), width: 150, className: 'text-end', render: (r) => (
        <div className="d-inline-flex gap-1">
          <button type="button" className="btn btn-icon sm" title={t('transfers.view', { defaultValue: 'View' })} onClick={() => setDetailRow(r)}>
            <Eye size={14} />
          </button>
          {direction === 'incoming' && r.status === 'requested' && (
            <button type="button" className="btn btn-icon sm text-danger" title={t('transfers.reject', { defaultValue: 'Reject' })} onClick={() => setDetailRow({ ...r, decide: 'reject' })}>
              <XCircle size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('transfers.title', { defaultValue: 'Student transfers' })}
        subtitle={t('transfers.subtitle', { defaultValue: 'Move a learner between E-MADAARIS schools. Only a school administrator can start or decide a transfer.' })}
        actions={(
          <>
            <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={list.reload} disabled={notEnabled}>
              <RefreshCw size={14} /> {t('common.refresh', { defaultValue: 'Refresh' })}
            </button>
            <button type="button" className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={() => setCreateOpen(true)} disabled={notEnabled}>
              <Plus size={14} /> {t('transfers.newRequest', { defaultValue: 'New transfer' })}
            </button>
          </>
        )}
      />

      {notEnabled && (
        <div className="alert alert-warning small">
          <ShieldX size={15} className="me-1 align-text-bottom" />
          {t('transfers.notEnabled', { defaultValue: 'Transfers are not enabled yet. Ask the platform owner to run migration 0020 in Supabase.' })}
        </div>
      )}

      <div className="nav nav-pills gap-1 mb-3 flex-wrap">
        <button type="button" className={`btn btn-sm ${tab === 'incoming' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab('incoming')}>
          {t('transfers.incoming', { defaultValue: 'Incoming' })} ({incoming.length})
        </button>
        <button type="button" className={`btn btn-sm ${tab === 'outgoing' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab('outgoing')}>
          {t('transfers.outgoing', { defaultValue: 'Outgoing' })} ({outgoing.length})
        </button>
      </div>

      <DataTable
        columns={makeColumns(tab)}
        rows={tab === 'incoming' ? incoming : outgoing}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        empty={tab === 'incoming'
          ? t('transfers.noIncoming', { defaultValue: 'No schools have asked to transfer a student to you.' })
          : t('transfers.noOutgoing', { defaultValue: 'You have not requested any transfers yet.' })}
      />

      <CreateTransferModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); list.reload(); }} />
      <TransferDetailModal row={detailRow} onClose={() => setDetailRow(null)} onChanged={() => { setDetailRow(null); list.reload(); }} />
    </>
  );
}

// ── Create request ──────────────────────────────────────────────
function CreateTransferModal({ open, onClose, onSaved }) {
  const { t } = useTranslation();
  const [students, setStudents] = useState([]);
  const [schools, setSchools] = useState([]);
  const [values, setValues] = useState({ student_id: '', to_school_id: '', reason: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues({ student_id: '', to_school_id: '', reason: '' });
    setErrors({});
    setLoading(true);
    Promise.all([apiGet('/school/transfers/students'), apiGet('/school/transfers/directory')])
      .then(([s, d]) => { setStudents(s.data || []); setSchools(d.data || []); })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  const studentOptions = students.map((s) => ({ value: s.id, label: `${fullStudentName(s)} · ${s.admission_number}${s.classes?.name ? ` · ${s.classes.name}` : ''}` }));
  const schoolOptions = schools.map((s) => ({ value: s.id, label: `${s.school_name}${[s.city, s.country].filter(Boolean).length ? ` · ${[s.city, s.country].filter(Boolean).join(', ')}` : ''}` }));

  const submit = useCallback(async () => {
    const missing = {};
    if (!values.student_id) missing.student_id = t('common.required');
    if (!values.to_school_id) missing.to_school_id = t('common.required');
    if (String(values.reason || '').trim().length < 3) missing.reason = t('transfers.reasonTooShort', { defaultValue: 'Give a reason (at least 3 characters).' });
    setErrors(missing);
    if (Object.keys(missing).length) return;
    setBusy(true);
    try {
      await apiPost('/school/transfers', {
        student_id: values.student_id, to_school_id: values.to_school_id, reason: String(values.reason).trim(),
      });
      toast.success(t('transfers.requestSent', { defaultValue: 'Transfer requested. The destination school will be notified.' }));
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }, [values, onSaved, t]);

  return (
    <Modal open={open} size="md" icon={ArrowRightLeft}
      title={t('transfers.newRequest', { defaultValue: 'New transfer' })}
      subtitle={t('transfers.newRequestSubtitle', { defaultValue: 'Choose the student, the school they are moving to and why.' })}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={submit} disabled={busy || loading}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            {busy ? t('common.loading') : t('transfers.sendRequest', { defaultValue: 'Send request' })}
          </button>
        </>
      )}>
      {loading && <div className="text-muted small mb-2"><Loader2 size={14} className="animate-spin me-1" />{t('common.loading')}</div>}
      <div className="row">
        <Field field={{ name: 'student_id', type: 'select', required: true, col: 12, label: t('transfers.student', { defaultValue: 'Student' }), placeholder: 'Select a student' }}
          options={studentOptions} value={values.student_id} error={errors.student_id}
          onChange={(v) => setValues((p) => ({ ...p, student_id: v }))} />
        <Field field={{ name: 'to_school_id', type: 'select', required: true, col: 12, label: t('transfers.destination', { defaultValue: 'Destination school' }), placeholder: 'Select a school' }}
          options={schoolOptions} value={values.to_school_id} error={errors.to_school_id}
          onChange={(v) => setValues((p) => ({ ...p, to_school_id: v }))} />
        <Field field={{ name: 'reason', type: 'textarea', required: true, col: 12, rows: 3, label: t('transfers.reason', { defaultValue: 'Reason for transfer' }), placeholder: 'e.g. Family relocating to another city' }}
          value={values.reason} error={errors.reason} onChange={(v) => setValues((p) => ({ ...p, reason: v }))} />
      </div>
      <div className="alert alert-info small mt-2 mb-0">
        {t('transfers.createHint', { defaultValue: 'On approval, the student is re-admitted at the destination school and cleared from this one. Their history (guardians, marks, attendance, fees, documents) is shared with the receiving school.' })}
      </div>
    </Modal>
  );
}

// ── Detail / decide / cancel ────────────────────────────────────
function TransferDetailModal({ row, onClose, onChanged }) {
  const { t } = useTranslation();
  const { profile, can } = useAuth();
  const schoolId = profile?.school?.id || profile?.schoolId;
  const [full, setFull] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (!row) { setFull(null); setNote(''); return; }
    setNote('');
    setLoading(true);
    apiGet(`/school/transfers/${row.id}`)
      .then(({ data }) => setFull(data))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [row]);

  const record = full || row || {};
  // The sending school's own learners can be papered; the receiving school reads the shared pack.
  const pack = record.payload?.pack;
  const mayDownload = Boolean(pack) && record.from_school_id === schoolId
    && record.status === 'requested' && record.student_id && can('students.export');

  const downloadClearance = useCallback(async () => {
    setPdfBusy(true);
    try {
      await downloadFile(`/school/clearance/${record.student_id}/document?purpose=transfer`,
        `${record.admission_number || 'student'}-clearance.pdf`);
    } catch (e) { toast.error(e.message); } finally { setPdfBusy(false); }
  }, [record.student_id, record.admission_number]);

  const act = useCallback(async (body) => {
    setBusy(true);
    try {
      await apiPost(`/school/transfers/${record.id}/decide`, body);
      toast.success(body.decision === 'approve'
        ? t('transfers.approved', { defaultValue: 'Transfer completed. The student is now enrolled at your school.' })
        : t('transfers.rejected', { defaultValue: 'Transfer rejected.' }));
      onChanged();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }, [record.id, onChanged, t]);

  const cancel = useCallback(async () => {
    setBusy(true);
    try {
      await apiPost(`/school/transfers/${record.id}/cancel`, {});
      toast.success(t('transfers.cancelled', { defaultValue: 'Transfer request cancelled.' }));
      onChanged();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }, [record.id, onChanged, t]);

  const footer = () => {
    if (record.status !== 'requested') {
      return <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</button>;
    }
    if (row?.decide === 'reject') {
      return (
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-danger d-inline-flex align-items-center gap-2" onClick={() => act({ decision: 'reject', note: note.trim() || undefined })} disabled={busy}>
            {busy && <Loader2 size={15} className="animate-spin" />}{t('transfers.confirmReject', { defaultValue: 'Reject transfer' })}
          </button>
        </>
      );
    }
    return (
      <>
        <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn btn-outline-danger" onClick={cancel} disabled={busy}>{t('transfers.cancel', { defaultValue: 'Cancel request' })}</button>
        <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={() => act({ decision: 'approve', note: note.trim() || undefined })} disabled={busy}>
          {busy && <Loader2 size={15} className="animate-spin" />}{t('transfers.approve', { defaultValue: 'Approve & admit' })}
        </button>
      </>
    );
  };

  return (
    <Modal open={Boolean(row)} size="lg" icon={ArrowRightLeft}
      title={`${t('transfers.request', { defaultValue: 'Transfer' })} · ${record.student_name || ''}`}
      subtitle={`${t('transfers.from', { defaultValue: 'From' })} ${record.payload?.from_school_name || '—'} → ${t('transfers.to', { defaultValue: 'To' })} ${record.payload?.to_school_name || '—'}`}
      onClose={onClose} footer={footer()}>
      <div className="d-flex align-items-center gap-2 mb-3">
        <StatusBadge value={record.status} />
        <span className="small text-muted">{dateOnly(record.created_at)}</span>
        {record.admission_number && <span className="small text-muted">· {record.admission_number}</span>}
      </div>

      <div className="card-soft p-3 mb-3">
        <div className="fw-semibold small mb-1">{t('transfers.reason', { defaultValue: 'Reason' })}</div>
        <div className="small">{record.reason}</div>
        {record.requested_by_name && <div className="small text-muted mt-1">{t('transfers.requestedBy', { defaultValue: 'Requested by' })} {record.requested_by_name}</div>}
        {record.decided_by_name && <div className="small text-muted mt-1">{t('transfers.decidedBy', { defaultValue: 'Decided by' })} {record.decided_by_name}{record.decision_note ? ` · ${record.decision_note}` : ''}</div>}
        {record.new_student_id && <div className="small text-success mt-1">{t('transfers.admitted', { defaultValue: 'The student has been admitted at the destination.' })}</div>}
      </div>

      <StudentPackPanel pack={pack} loading={loading} onDownload={mayDownload ? downloadClearance : undefined} downloadBusy={pdfBusy} />

      {!loading && !pack && record.status === 'requested' && (
        <div className="alert alert-warning small">
          {t('transfers.noPack', { defaultValue: 'The sending school no longer holds this record, so there is nothing to review. Reject or cancel the request.' })}
        </div>
      )}

      {record.status === 'requested' && (
        <Field field={{ name: 'decision_note', type: 'textarea', col: 12, rows: 2, label: t('transfers.decisionNote', { defaultValue: 'Note for the other school (optional)' }) }}
          value={note} onChange={setNote} />
      )}
    </Modal>
  );
}
