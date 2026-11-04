/**
 * Examination clearances: the fee pipeline writes these rows automatically, this screen lets a
 * bursar confirm or block a student before an exam.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
import { CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge, dateTime, money } from '../../components/ui/Basics.jsx';

const STATUSES = ['pending_verification', 'unpaid', 'partially_paid', 'paid', 'cleared', 'blocked', 'not_required'];

export default function ClearancesPage({ query = {} }) {
  const { t } = useTranslation();
  const { can } = useAuth();

  const [status, setStatus] = useState(query.status || '');
  const [busy, setBusy] = useState('');

  const list = useApi('/finance/clearances', status ? { status } : {});

  const rows = useMemo(() => (list.data || []).map((c) => ({
    ...c,
    name: c.students?.full_name || c.student_id,
    admission: c.students?.admission_number,
    outstanding: Math.max(0, Math.round((Number(c.required_amount || 0) - Number(c.paid_amount || 0)) * 100) / 100),
  })), [list.data]);

  const counts = useMemo(() => ({
    total: rows.length,
    cleared: rows.filter((r) => r.status === 'cleared').length,
    waiting: rows.filter((r) => r.status === 'pending_verification').length,
    blocked: rows.filter((r) => r.status === 'blocked').length,
  }), [rows]);

  const verify = async (row, action) => {
    setBusy(`${row.id}:${action}`);
    try {
      await apiPost(`/finance/clearances/${row.id}/verify`, { action });
      toast.success(action === 'clear'
        ? t('modules.studentCleared', { defaultValue: 'Student cleared for examinations' })
        : t('modules.studentBlocked', { defaultValue: 'Student blocked' }));
      list.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <PageHeader
        title={t('modules.clearances', { defaultValue: 'Examination clearances' })}
        subtitle={t('modules.clearancesHint', { defaultValue: 'A clearance follows the fee status automatically: once every examination fee is paid the row moves to pending verification, and a bursar clears or blocks it here.' })}
        actions={(
          <>
            <Link className="btn btn-outline-secondary btn-sm" to="/m/finance-payments">{t('modules.finance-payments', { defaultValue: 'Fee payments' })}</Link>
            <button className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1" onClick={list.reload}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
          </>
        )}
      />

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3"><StatCard label={t('modules.shown', { defaultValue: 'Rows shown' })} value={counts.total} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.cleared', { defaultValue: 'Cleared' })} value={counts.cleared} tone="ok" icon={ShieldCheck} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.awaitingCheck', { defaultValue: 'Awaiting verification' })} value={counts.waiting} tone="warn" icon={ShieldAlert} /></div>
        <div className="col-6 col-lg-3"><StatCard label={t('modules.blocked', { defaultValue: 'Blocked' })} value={counts.blocked} tone="danger" icon={ShieldAlert} /></div>
      </div>

      <div className="card-soft p-2 mb-3">
        <div className="row g-2 align-items-end">
          <div className="col-12 col-md-4">
            <label className="form-label small fw-semibold" htmlFor="clr-status">{t('common.status')}</label>
            <select id="clr-status" className="form-select form-select-sm" value={status}
              onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`, { defaultValue: String(s).replace(/_/g, ' ') })}</option>)}
            </select>
          </div>
          <div className="col-12 col-md-8 text-md-end small text-muted">
            {t('modules.clearanceFilterHint', { defaultValue: 'Filtering happens on the server; the list is capped at 1000 rows.' })}
          </div>
        </div>
      </div>

      {list.loading && !list.data && <div className="card-soft p-4"><Spinner label={t('common.loading')} /></div>}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}

      {!list.loading && !list.error && (
        <div className="card-soft overflow-hidden">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="bg-white">
                <tr>
                  <th>{t('modules.student', { defaultValue: 'Student' })}</th>
                  <th>{t('modules.admissionNumber', { defaultValue: 'Admission no.' })}</th>
                  <th className="text-end">{t('modules.required', { defaultValue: 'Required' })}</th>
                  <th className="text-end">{t('modules.paid', { defaultValue: 'Paid' })}</th>
                  <th className="text-end">{t('modules.outstanding', { defaultValue: 'Outstanding' })}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('modules.updated', { defaultValue: 'Updated' })}</th>
                  <th className="text-end">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="small fw-semibold text-truncate" style={{ maxWidth: 220 }}>{row.name}</td>
                    <td className="small text-muted">{row.admission || '—'}</td>
                    <td className="text-end tabular-nums small">{money(row.required_amount)}</td>
                    <td className="text-end tabular-nums small">{money(row.paid_amount)}</td>
                    <td className="text-end tabular-nums small">{row.outstanding ? <span className="text-danger">{money(row.outstanding)}</span> : money(0)}</td>
                    <td><StatusBadge value={row.status} /></td>
                    <td className="small text-muted">{dateTime(row.updated_at)}</td>
                    <td className="text-end text-nowrap">
                      {can('finance.approve') ? (
                        <>
                          <button className="btn btn-sm btn-outline-success me-1 d-inline-flex align-items-center gap-1"
                            disabled={Boolean(busy) || row.status === 'cleared'} onClick={() => verify(row, 'clear')}>
                            <CheckCircle2 size={13} /> {t('modules.clear', { defaultValue: 'Clear' })}
                          </button>
                          <button className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                            disabled={Boolean(busy) || row.status === 'blocked'} onClick={() => verify(row, 'block')}>
                            <ShieldAlert size={13} /> {t('modules.block', { defaultValue: 'Block' })}
                          </button>
                        </>
                      ) : <span className="text-muted small">{t('modules.readOnly', { defaultValue: 'Read only' })}</span>}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState title={t('modules.noClearances', { defaultValue: 'No clearance rows for this filter' })}
                        hint={t('modules.noClearancesHint', { defaultValue: 'Rows appear once a fee category flagged as an examination fee is assigned to the student.' })} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="d-flex justify-content-between align-items-center px-3 py-2 border-top bg-white small">
            <span className="text-muted">{list.total ?? rows.length} {t('common.rows')}</span>
            <Link className="text-muted" to="/m/fee-categories">{t('modules.editExamFeeCategories', { defaultValue: 'Which categories gate the clearance' })}</Link>
          </div>
        </div>
      )}
    </>
  );
}
