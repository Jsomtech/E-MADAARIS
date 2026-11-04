import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { RefreshCw, Search, Trash2, RotateCcw, Recycle } from 'lucide-react';
import { apiGet, apiPost, apiDelete, apiSweep } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { Badge, EmptyState, ErrorState, PageHeader, dateTime } from '../../components/ui/Basics.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/** Recycle bin: deleted rows are snapshotted in audit_logs and can be restored or purged. */
export default function TrashPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(null);
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { kind: 'purge'|'empty', row? }

  const mayManage = can('school.edit');

  const load = useCallback(async () => {
    if (!mayManage) return;
    setLoading(true);
    setError(null);
    try {
      const body = await apiGet('/school/trash', { page, pageSize: 25, q: q || undefined });
      setRows(body.data || []);
      setTotal(body.total ?? 0);
    } catch (e) {
      setError(e);
      setRows(null);
    } finally { setLoading(false); }
  }, [mayManage, page, q]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setTimeout(() => { setQ(queryInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(id);
  }, [queryInput]);

  const restore = async (row) => {
    setBusy(true);
    try {
      await apiSweep(`/school/trash/${row.id}/restore`);
      toast.success(t('sections.trashRestored', { defaultValue: '“{{name}}” was restored', name: row.label }));
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const confirmAction = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'empty') {
        const body = await apiPost('/school/trash/empty');
        toast.success(t('sections.trashEmptied', { defaultValue: '{{count}} item(s) permanently removed', count: body.data?.purged ?? 0 }));
      } else {
        await apiDelete(`/school/trash/${confirm.row.id}`);
        toast.success(t('sections.trashPurged', { defaultValue: '“{{name}}” was permanently removed', name: confirm.row.label }));
      }
      setConfirm(null);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const columns = useMemo(() => [
    {
      key: 'deleted_at', label: t('common.date'), width: 180,
      render: (r) => <span className="small tabular-nums">{dateTime(r.deleted_at)}</span>,
    },
    {
      key: 'label', label: t('sections.deletedRecord', { defaultValue: 'Deleted record' }),
      render: (r) => (
        <div className="small">
          <div className="fw-semibold">{r.label || r.record_id || '—'}</div>
          <div className="text-muted">
            {r.bulk
              ? t('sections.bulkRows', { defaultValue: '{{rows}} rows across all modules', rows: r.rows ?? '—' })
              : `${r.table}${r.has_related ? ` · ${t('sections.withChildRows', { defaultValue: 'with child rows' })}` : ''}`}
          </div>
        </div>
      ),
    },
    {
      key: 'module', label: t('sections.module', { defaultValue: 'Module' }), width: 140,
      render: (r) => <Badge tone="neutral">{r.module || '—'}</Badge>,
    },
    {
      key: 'actions', label: t('common.actions'), width: 220,
      render: (r) => (
        <div className="d-flex gap-2">
          <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
            onClick={() => restore(r)} disabled={busy}>
            <RotateCcw size={14} /> {t('sections.restore', { defaultValue: 'Restore' })}
          </button>
          <button type="button" className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
            onClick={() => setConfirm({ kind: 'purge', row: r })} disabled={busy}>
            <Trash2 size={14} /> {t('common.delete')}
          </button>
        </div>
      ),
    },
  ], [t, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mayManage) {
    return (
      <>
        <PageHeader title={t('sections.trashTitle', { defaultValue: 'Recycle bin' })} />
        <div className="card-soft">
          <EmptyState icon={Recycle} title={t('sections.trashNoAccessTitle', { defaultValue: 'Needs school.edit' })}
            hint={t('sections.trashNoAccess', { defaultValue: 'Only school administrators can restore deleted records.' })} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('sections.trashTitle', { defaultValue: 'Recycle bin' })}
        subtitle={t('sections.trashSubtitle', { defaultValue: 'Restore records deleted anywhere in this school, or remove them for good.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <button className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
              onClick={() => setConfirm({ kind: 'empty' })} disabled={!rows?.length}>
              <Trash2 size={14} /> {t('sections.emptyTrash', { defaultValue: 'Empty bin' })}
            </button>
          </>
        )}
      />

      <div className="card-soft p-2 mb-3">
        <div className="input-group input-group-sm">
          <span className="input-group-text bg-white"><Search size={14} /></span>
          <input className="form-control" value={queryInput} onChange={(e) => setQueryInput(e.target.value)}
            placeholder={t('sections.searchTrash', { defaultValue: 'Search deleted records…' })} />
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={load} />}

      <DataTable columns={columns} rows={rows} total={total} page={page} pageSize={25} onPage={setPage}
        loading={loading} error={null} dense
        empty={t('sections.trashEmpty', { defaultValue: 'Nothing has been deleted recently.' })} />

      <div className="small text-muted mt-2 d-flex align-items-center gap-1">
        <Recycle size={13} />
        {t('sections.trashHint', { defaultValue: 'Deleted records stay here until you restore them or empty the bin. Restoring puts the original row back with the same identifier.' })}
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind === 'empty'
          ? t('sections.emptyTrash', { defaultValue: 'Empty bin' })
          : t('sections.deleteForever', { defaultValue: 'Delete permanently' })}
        message={confirm?.kind === 'empty'
          ? t('sections.emptyTrashConfirm', { defaultValue: 'Permanently remove every item in the recycle bin? This cannot be undone.' })
          : t('sections.purgeConfirm', { defaultValue: 'Permanently remove “{{name}}” from the recycle bin?', name: confirm?.row?.label })}
        confirmLabel={t('sections.deleteForever', { defaultValue: 'Delete permanently' })}
        onClose={() => setConfirm(null)} onConfirm={confirmAction} busy={busy}
      />
    </>
  );
}
