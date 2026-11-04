import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { DatabaseBackup, Download, RefreshCw, ShieldAlert, Play, Loader2 } from 'lucide-react';
import { apiGet, apiPost, downloadFile } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { Badge, ErrorState, PageHeader, StatCard, dateTime } from '../../components/ui/Basics.jsx';

const kb = (bytes) => {
  const n = Number(bytes) || 0;
  if (!n) return '—';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

/** Super-admin backup console: 10-second scheduler toggle, platform-wide history, per-school danger zone. */
export default function BackupsPage() {
  const { t } = useTranslation();
  const [body, setBody] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [schools, setSchools] = useState([]);
  const [schoolId, setSchoolId] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBody(await apiGet('/platform/backups', { page, pageSize: 25 }));
    } catch (e) { setError(e); setBody(null); } finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    apiGet('/platform/schools', { pageSize: 200 }).then((res) => setSchools(res.data || [])).catch(() => {});
  }, []);

  const auto = body?.auto;
  const rows = body?.data || [];
  const selected = schools.find((s) => s.id === schoolId);

  const toggleAuto = async () => {
    setBusy(true);
    try {
      const res = await apiPost('/platform/backups/auto', { enabled: !auto?.enabled });
      toast.success(res.data.enabled
        ? t('sections.autoBackupOn', { defaultValue: 'Automatic backups enabled — running every 10 seconds.' })
        : t('sections.autoBackupOff', { defaultValue: 'Automatic backups disabled.' }));
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const runRound = async () => {
    setBusy(true);
    try {
      const res = await apiPost('/platform/backups/run');
      const result = res.data?.lastResult;
      toast.success(t('sections.backupRoundDone', {
        defaultValue: 'Backup round: {{created}} created, {{skipped}} unchanged, {{failed}} failed.',
        created: result?.created ?? 0, skipped: result?.skipped ?? 0, failed: result?.failed ?? 0,
      }));
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const backupSchool = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await apiPost('/platform/backups/run', { school_id: selected.id });
      toast.success(t('sections.backupCreated', {
        defaultValue: 'Backup created · {{rows}} rows ({{size}})',
        rows: res.data?.totalRows ?? 0, size: kb(res.data?.sizeBytes),
      }));
      setPage(1);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const clearSchool = async () => {
    if (!selected) return;
    setClearing(true);
    try {
      const res = await apiPost(`/platform/schools/${selected.id}/clear-data`, { confirm: confirmName });
      toast.success(t('sections.dataClearedRecoverable', {
        defaultValue: 'School cleared ({{tables}} tables, {{rows}} rows, {{users}} accounts). It stays restorable in the recycle bin.',
        tables: res.data?.tables ?? 0, rows: res.data?.rows ?? 0, users: res.data?.users ?? 0,
      }));
      setConfirmName('');
      load();
    } catch (e) { toast.error(e.message); } finally { setClearing(false); }
  };

  const columns = useMemo(() => [
    {
      key: 'school', label: t('modules.schools'), width: 200,
      render: (r) => <span className="small fw-semibold">{r.schools?.school_name || r.metadata?.school_name || '—'}</span>,
    },
    {
      key: 'created_at', label: t('common.date'), width: 180,
      render: (r) => <span className="small tabular-nums">{dateTime(r.created_at)}</span>,
    },
    {
      key: 'kind', label: t('sections.backupKind', { defaultValue: 'Type' }), width: 110,
      render: (r) => (
        <Badge tone={r.metadata?.kind === 'auto' ? 'info' : 'brand'}>
          {r.metadata?.kind === 'auto' ? t('sections.automatic', { defaultValue: 'Automatic' }) : t('sections.manual', { defaultValue: 'Manual' })}
        </Badge>
      ),
    },
    {
      key: 'summary', label: t('sections.contents', { defaultValue: 'Contents' }),
      render: (r) => (
        <div className="small">
          <div>{r.summary}</div>
          <div className="text-muted">{Object.keys(r.metadata?.tables || {}).length} tables · {kb(r.metadata?.size_bytes)}</div>
        </div>
      ),
    },
    {
      key: 'download', label: t('common.actions'), width: 150,
      render: (r) => (
        <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
          onClick={() => downloadFile(`/platform/backups/${r.id}/download`, 'platform-backup.json')
            .catch((e) => toast.error(e.message))}>
          <Download size={14} /> {t('common.download', { defaultValue: 'Download' })}
        </button>
      ),
    },
  ], [t]);

  return (
    <>
      <PageHeader
        title={t('sections.platformBackupsTitle', { defaultValue: 'School backups' })}
        subtitle={t('sections.platformBackupsSubtitle', { defaultValue: 'Stored snapshots for every tenant, plus the automatic 10-second scheduler.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <button className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={runRound} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {t('sections.runRound', { defaultValue: 'Back up all schools now' })}
            </button>
          </>
        )}
      />

      <div className="row g-3 mb-2">
        <div className="col-6 col-lg-3">
          <StatCard label={t('sections.storedBackups', { defaultValue: 'Stored backups' })} value={body?.total ?? '—'} icon={DatabaseBackup} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('sections.lastRound', { defaultValue: 'Last automatic round' })}
            value={auto?.lastRunAt ? dateTime(auto.lastRunAt) : '—'} icon={RefreshCw}
            hint={auto?.lastResult ? `${auto.lastResult.created} created · ${auto.lastResult.skipped} unchanged` : undefined} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('sections.interval', { defaultValue: 'Interval' })}
            value={`${Math.round((auto?.intervalMs || 10000) / 1000)}s`} icon={DatabaseBackup} />
        </div>
        <div className="col-6 col-lg-3">
          <div className="card-soft p-3 h-100">
            <div className="stat-label">{t('sections.automaticBackups', { defaultValue: 'Automatic backups' })}</div>
            <div className="form-check form-switch mt-2">
              <input className="form-check-input" type="checkbox" id="auto-backup" role="switch"
                checked={Boolean(auto?.enabled)} onChange={toggleAuto} disabled={busy || auto?.running} />
              <label className="form-check-label small" htmlFor="auto-backup">
                {auto?.enabled
                  ? t('common.enabled', { defaultValue: 'Enabled' })
                  : t('common.disabled', { defaultValue: 'Disabled' })}
              </label>
            </div>
            <div className="small text-muted mt-1">
              {t('sections.autoBackupHint', { defaultValue: 'Runs every 10 seconds, skips unchanged data, keeps the latest 60 per school.' })}
            </div>
          </div>
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={load} />}

      <DataTable columns={columns} rows={rows} total={body?.total} page={page} pageSize={25} onPage={setPage}
        loading={loading} error={null} dense
        empty={t('sections.backupsEmpty', { defaultValue: 'No backups yet. Run a round to create the first snapshots.' })} />

      <div className="card-soft p-3 mt-4 border-danger-subtle">
        <div className="d-flex align-items-center gap-2 fw-semibold text-danger">
          <ShieldAlert size={17} /> {t('sections.schoolDangerZone', { defaultValue: 'Per-school danger zone' })}
        </div>
        <p className="small text-muted mb-2 mt-1">
          {t('sections.platformClearHint', { defaultValue: 'Back up a school, then clear its data if it needs a fresh start. Every record and every staff, student and parent login is deleted; only the school profile, branding, roles and subscription stay. The wipe is snapshotted into the super-admin recycle bin, so it can be restored while that entry remains.' })}
        </p>
        <div className="row g-2 align-items-end">
          <div className="col-12 col-md-4">
            <label className="form-label small fw-semibold mb-0" htmlFor="backup-school">{t('modules.schools')}</label>
            <select id="backup-school" className="form-select form-select-sm" value={schoolId}
              onChange={(e) => { setSchoolId(e.target.value); setConfirmName(''); }}>
              <option value="">{t('sections.pickSchool', { defaultValue: 'Select a school…' })}</option>
              {schools.map((s) => <option key={s.id} value={s.id}>{s.school_name}</option>)}
            </select>
          </div>
          <div className="col-12 col-md-4">
            <label className="form-label small fw-semibold mb-0" htmlFor="backup-confirm">
              {t('sections.typeSchoolName', { defaultValue: 'Type “{{name}}” to confirm', name: selected?.school_name || '…' })}
            </label>
            <input id="backup-confirm" className="form-control form-control-sm" value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)} disabled={!selected} />
          </div>
          <div className="col-12 col-md-4 d-flex gap-2">
            <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
              onClick={backupSchool} disabled={!selected || busy}>
              <DatabaseBackup size={14} /> {t('sections.backupSchool', { defaultValue: 'Back up' })}
            </button>
            <button type="button" className="btn btn-sm btn-danger d-inline-flex align-items-center gap-1"
              onClick={clearSchool} disabled={!selected || clearing || confirmName !== selected?.school_name}>
              {clearing ? <Loader2 size={14} className="animate-spin" /> : <ShieldAlert size={14} />}
              {t('sections.clearAllData', { defaultValue: 'Delete all school data' })}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
