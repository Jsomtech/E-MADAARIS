/**
 * Platform oversight of every school's student council elections.
 *
 * A Super Admin switches the module on or off per school, watches turnout and leaders across
 * tenants, suspends or closes an election when asked, and can force the opening/closing clock to
 * run now. What this screen cannot do is touch a number: there is no endpoint here that writes a
 * vote, edits a candidate or deletes a ballot, so an intervention can change the state of a window
 * but never the result inside it. Each school's rows stay in its own lane.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  Activity, Ban, Clock3, Flag, Loader2, Pause, Play, RefreshCw, ShieldCheck, Trophy, Users, Vote, X,
} from 'lucide-react';
import { apiPatch, apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import {
  Badge, EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge, dateTime,
} from '../../components/ui/Basics.jsx';
import { Modal } from '../../components/ui/Modal.jsx';

const PLATFORM_FILE = 'supabase/migrations/0022_elections.sql';

function ReasonModal({ open, title, subtitle, label, confirmLabel, danger, busy, onCancel, onConfirm }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  if (!open) return null;
  return (
    <Modal open onClose={() => (busy ? null : onCancel())} size="sm" icon={danger ? ShieldCheck : undefined}
      title={title} subtitle={subtitle}
      footer={(
        <>
          <button type="button" className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
          <button type="button" className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}
            onClick={() => {
              if (reason.trim().length < 3) {
                toast.error(t('platformElections.reasonNeeded', { defaultValue: 'Write a short reason — it goes into the audit trail.' }));
                return;
              }
              onConfirm(reason.trim());
            }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} {confirmLabel}
          </button>
        </>
      )}>
      <label className="form-label small fw-semibold" htmlFor="platform-reason">{label}</label>
      <textarea id="platform-reason" className="form-control form-control-sm" rows={3} disabled={busy}
        value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="small text-muted mt-2">
        {t('platformElections.reasonNote', { defaultValue: 'The reason is stored with your user id in the platform audit trail. Learners and school staff see the effect, not this box.' })}
      </div>
    </Modal>
  );
}

export default function PlatformElectionsPage() {
  const { t } = useTranslation();
  const overview = useApi('/platform/elections/overview');
  const [schoolId, setSchoolId] = useState('');
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);

  const detail = useApi(schoolId ? `/platform/elections/schools/${schoolId}/elections` : null, null, Boolean(schoolId));
  const rows = overview.data?.schools || [];
  const scheduler = overview.data?.scheduler || {};
  const byStatus = overview.data?.elections_by_status || {};
  const openNow = overview.data?.open_now || [];
  const awaiting = overview.data?.awaiting_results_publication || [];
  const school = useMemo(() => rows.find((s) => s.school_id === schoolId) || null, [rows, schoolId]);
  const detailElections = detail.data?.elections || [];

  const run = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      if (message) toast.success(message);
      setPending(null);
      overview.refetch();
      if (schoolId) detail.refetch();
    } catch (error) {
      toast.error(error.message || String(error));
    } finally {
      setBusy(false);
    }
  };

  const setConfig = ({ schoolId: targetId, patch }, reason) => run(
    () => apiPatch(`/platform/elections/schools/${targetId}`, { ...patch, reason }),
    patch.enabled !== undefined
      ? (patch.enabled
        ? t('platformElections.enabledForSchool', { defaultValue: 'The election module is now on for this school.' })
        : t('platformElections.disabledForSchool', { defaultValue: 'The election module is now off for this school.' }))
      : (patch.auto_publish_results
        ? t('platformElections.autoPublishOn', { defaultValue: 'Results publish to learners as soon as voting closes.' })
        : t('platformElections.autoPublishOff', { defaultValue: 'Results stay held until an officer publishes them.' })),
  );

  const intervene = (action, target, reason) => run(
    () => apiPost(`/platform/elections/elections/${target.id}/intervene`, { action, reason }),
    t(`platformElections.did.${action}`, {
      defaultValue: action === 'suspend'
        ? 'The election is suspended — learners cannot vote until it is resumed.'
        : action === 'resume' ? 'The election is open again for that school.' : 'The election is closed and the tally is final.',
    }),
  );

  const tickNow = () => run(async () => {
    const res = await apiPost('/platform/elections/scheduler/tick', {});
    const result = res.data?.result || {};
    toast.success(t('platformElections.ticked', {
      defaultValue: 'Clock ran: {{opened}} opened, {{closed}} closed.',
      opened: result.opened ?? 0, closed: result.closed ?? 0,
    }));
  }, '');

  if (overview.loading && !overview.data) {
    return (
      <>
        <PageHeader title={t('platformElections.title', { defaultValue: 'Election oversight' })} />
        <Spinner />
      </>
    );
  }
  if (overview.error) {
    return (
      <>
        <PageHeader title={t('platformElections.title', { defaultValue: 'Election oversight' })} />
        <div className="card-soft p-4">
          <div className="small text-muted mb-2">{/0022_elections\.sql/.test(String(overview.error.message || ''))
            ? t('platformElections.setupHint', { defaultValue: 'Apply {{file}} in the Supabase SQL editor once, then press Retry.', file: PLATFORM_FILE })
            : null}</div>
          <ErrorState error={overview.error} onRetry={overview.reload} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('platformElections.title', { defaultValue: 'Election oversight' })}
        subtitle={t('platformElections.subtitle', { defaultValue: 'Switch the module per school, watch every tenant’s elections, and act on a window when a school asks. Vote counts are never editable from here.' })}
        actions={(
          <>
            <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={overview.reload}>
              <RefreshCw size={14} /> {t('common.refresh', { defaultValue: 'Refresh' })}
            </button>
            <button type="button" className="btn btn-sm btn-primary d-flex align-items-center gap-1" disabled={busy} onClick={tickNow}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Clock3 size={14} />}
              {t('platformElections.runClock', { defaultValue: 'Run the open/close clock' })}
            </button>
          </>
        )}
      />

      <div className="row g-3 mb-3">
        <div className="col-6 col-md-4 col-xl-3"><StatCard label={t('platformElections.stats.elections', { defaultValue: 'Elections on the platform' })} value={overview.data?.total_elections ?? 0} icon={Vote} tone="brand" /></div>
        <div className="col-6 col-md-4 col-xl-3"><StatCard label={t('platformElections.stats.ballots', { defaultValue: 'Ballots recorded' })} value={overview.data?.total_ballots_recorded ?? 0} icon={Users} tone="info" /></div>
        <div className="col-6 col-md-4 col-xl-3"><StatCard label={t('platformElections.stats.schools', { defaultValue: 'Schools with elections' })} value={overview.data?.schools_with_elections ?? 0} icon={ShieldCheck} tone="brand" /></div>
        <div className="col-6 col-md-4 col-xl-3"><StatCard label={t('platformElections.stats.active', { defaultValue: 'Voting open now' })} value={openNow.length} icon={Activity} tone={openNow.length ? 'ok' : 'neutral'} /></div>
        <div className="col-6 col-md-4 col-xl-3"><StatCard label={t('platformElections.stats.enabled', { defaultValue: 'Module on for' })} value={overview.data?.module_enabled_for ?? 0} icon={Play} tone="ok" /></div>
        <div className="col-6 col-md-4 col-xl-3"><StatCard label={t('platformElections.stats.disabled', { defaultValue: 'Module off for' })} value={overview.data?.module_disabled_for ?? 0} icon={Ban} tone={(overview.data?.module_disabled_for ?? 0) ? 'warn' : 'neutral'} /></div>
        <div className="col-6 col-md-4 col-xl-3"><StatCard label={t('platformElections.stats.pendingResults', { defaultValue: 'Closed, results not published' })} value={awaiting.length} icon={Flag} tone={awaiting.length ? 'warn' : 'neutral'} /></div>
        <div className="col-6 col-md-4 col-xl-3">
          <StatCard label={t('platformElections.stats.scheduler', { defaultValue: 'Clock rounds' })} value={scheduler.rounds ?? 0} icon={Clock3} tone={scheduler.last_error ? 'danger' : 'neutral'}
            hint={scheduler.last_round_at ? `${t('platformElections.lastRound', { defaultValue: 'last round' })} ${dateTime(scheduler.last_round_at)}` : t('platformElections.clockIdle', { defaultValue: 'no round yet since boot' })}
            footer={scheduler.last_error ? <span className="text-danger small">{String(scheduler.last_error)}</span> : null} />
        </div>
      </div>

      <div className="card-soft p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center gap-2 mb-2 flex-wrap">
          <div>
            <div className="fw-semibold">{t('platformElections.openNow', { defaultValue: 'Elections voting right now' })}</div>
            <div className="small text-muted">{t('platformElections.openHint', { defaultValue: 'Suspending pauses the window for that school only. A reason is mandatory and audited.' })}</div>
          </div>
          <div className="small text-muted">
            {Object.entries(byStatus).map(([status, count]) => <Badge key={status} tone="neutral" className="me-1">{status}: {count}</Badge>)}
          </div>
        </div>
        {openNow.length === 0
          ? <EmptyState icon={Vote} title={t('platformElections.noneOpen', { defaultValue: 'No election is open anywhere on the platform.' })} />
          : (
            <div className="table-responsive">
              <table className="table mb-0 small align-middle">
                <thead><tr className="text-muted"><th>{t('platformElections.election', { defaultValue: 'Election' })}</th><th>{t('platformElections.school', { defaultValue: 'School' })}</th><th>{t('platformElections.window', { defaultValue: 'Window' })}</th><th>{t('platformElections.actions', { defaultValue: 'Actions' })}</th></tr></thead>
                <tbody>
                  {openNow.map((row) => (
                    <tr key={row.id}>
                      <td className="fw-semibold">{row.title}</td>
                      <td>
                        <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setSchoolId(row.school_id)}>{row.school_id.slice(0, 8)}</button>
                      </td>
                      <td className="text-muted">{dateTime(row.start_at)} → {dateTime(row.end_at)} · {row.timezone}</td>
                      <td>
                        <div className="d-flex gap-1 justify-content-end">
                          <button type="button" className="btn btn-sm btn-outline-warning d-inline-flex align-items-center gap-1" disabled={busy}
                            onClick={() => setPending({ kind: 'intervene', action: 'suspend', target: row })}>
                            <Pause size={13} /> {t('platformElections.suspend', { defaultValue: 'Suspend' })}
                          </button>
                          <button type="button" className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1" disabled={busy}
                            onClick={() => setPending({ kind: 'intervene', action: 'close', target: row })}>
                            <Flag size={13} /> {t('platformElections.close', { defaultValue: 'Close now' })}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <div className="card-soft p-3 mb-3">
        <div className="fw-semibold">{t('platformElections.schoolsTitle', { defaultValue: 'Every school' })}</div>
        <div className="small text-muted mb-2">{t('platformElections.schoolsHint', { defaultValue: 'Off means learners see nothing and the ballot is refused, even while a window is open. Candidates and schedules are kept.' })}</div>
        {rows.length === 0 ? <EmptyState title={t('platformElections.noSchools', { defaultValue: 'No school has created an election yet.' })} /> : (
          <div className="table-responsive">
            <table className="table mb-0 small align-middle">
              <thead>
                <tr className="text-muted">
                  <th>{t('platformElections.school', { defaultValue: 'School' })}</th>
                  <th>{t('platformElections.elections', { defaultValue: 'Elections' })}</th>
                  <th>{t('platformElections.ballotsColumn', { defaultValue: 'Ballots' })}</th>
                  <th>{t('platformElections.module', { defaultValue: 'Module' })}</th>
                  <th>{t('platformElections.autoPublish', { defaultValue: 'Auto-publish results' })}</th>
                  <th className="text-end">{t('platformElections.inspect', { defaultValue: 'Look inside' })}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.school_id} className={row.school_id === schoolId ? 'table-active' : ''}>
                    <td>
                      <div className="fw-semibold">{row.school_name}</div>
                      <div className="small text-muted">{row.config.updated_at ? dateTime(row.config.updated_at) : t('platformElections.neverChanged', { defaultValue: 'never changed by the platform' })}</div>
                    </td>
                    <td>
                      {row.elections_total}
                      <span className="small text-muted"> · {row.elections_active} open · {row.elections_closed} closed</span>
                    </td>
                    <td className="tabular-nums">{row.ballots_recorded}</td>
                    <td>
                      {row.config.enabled
                        ? <Badge tone="ok">{t('platformElections.on', { defaultValue: 'on' })}</Badge>
                        : <Badge tone="danger">{t('platformElections.off', { defaultValue: 'off' })}</Badge>}
                    </td>
                    <td>
                      {row.config.auto_publish_results
                        ? <Badge tone="ok">{t('platformElections.yes', { defaultValue: 'yes' })}</Badge>
                        : <Badge tone="neutral">{t('platformElections.no', { defaultValue: 'no' })}</Badge>}
                    </td>
                    <td className="text-end">
                      <div className="d-flex gap-1 justify-content-end">
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setSchoolId(row.school_id === schoolId ? '' : row.school_id)}>
                          {t('platformElections.view', { defaultValue: 'View' })}
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" disabled={busy}
                          onClick={() => setPending({ kind: 'module', schoolId: row.school_id, patch: { enabled: !row.config.enabled }, school: row.school_name })}>
                          {row.config.enabled ? <Ban size={13} /> : <Play size={13} />}
                          {row.config.enabled ? t('platformElections.switchOff', { defaultValue: 'Switch off' }) : t('platformElections.switchOn', { defaultValue: 'Switch on' })}
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={busy}
                          onClick={() => setPending({ kind: 'module', schoolId: row.school_id, patch: { auto_publish_results: !row.config.auto_publish_results }, school: row.school_name })}>
                          <Trophy size={13} /> {row.config.auto_publish_results ? t('platformElections.stopAuto', { defaultValue: 'Stop auto-publish' }) : t('platformElections.startAuto', { defaultValue: 'Auto-publish' })}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {schoolId && (
        <div className="card-soft p-3 mb-3">
          <div className="d-flex justify-content-between align-items-start gap-2 mb-2 flex-wrap">
            <div>
              <div className="fw-semibold">{school?.school_name || schoolId}</div>
              <div className="small text-muted">{t('platformElections.detailHint', { defaultValue: 'One school only. Nothing here reaches another tenant’s learners, and no ballot or voter is listed.' })}</div>
            </div>
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => detail.reload()}>{t('common.refresh', { defaultValue: 'Refresh' })}</button>
              <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={() => setSchoolId('')}><X size={14} /> {t('platformElections.closePanel', { defaultValue: 'Close' })}</button>
            </div>
          </div>
          {detail.loading && !detail.data ? <Spinner /> : null}
          {detail.error ? <ErrorState error={detail.error} onRetry={detail.reload} /> : null}
          {detail.data && detailElections.length === 0 && (
            <EmptyState title={t('platformElections.schoolNone', { defaultValue: 'This school has no election yet.' })} />
          )}
          {detailElections.map((row) => (
            <div key={row.id} className="border rounded p-3 mb-2">
              <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                <div>
                  <div className="fw-semibold">{row.title}</div>
                  <div className="small text-muted">{dateTime(row.start_at)} → {dateTime(row.end_at)} · {row.timezone}</div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <StatusBadge value={row.status} />
                  {row.results_published && <Badge tone="ok">{t('platformElections.published', { defaultValue: 'published' })}</Badge>}
                  {(row.tied_positions || []).length > 0 && <Badge tone="warn">{t('platformElections.tie', { defaultValue: 'tie: {{names}}', names: row.tied_positions.join(', ') })}</Badge>}
                  {['scheduled', 'active', 'paused'].includes(row.status) && (
                    <>
                      {row.status === 'paused' && (
                        <button type="button" className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1" disabled={busy}
                          onClick={() => setPending({ kind: 'intervene', action: 'resume', target: row })}>
                          <Play size={13} /> {t('platformElections.resume', { defaultValue: 'Resume' })}
                        </button>
                      )}
                      {row.status === 'active' && (
                        <button type="button" className="btn btn-sm btn-outline-warning d-inline-flex align-items-center gap-1" disabled={busy}
                          onClick={() => setPending({ kind: 'intervene', action: 'suspend', target: row })}>
                          <Pause size={13} /> {t('platformElections.suspend', { defaultValue: 'Suspend' })}
                        </button>
                      )}
                      <button type="button" className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1" disabled={busy}
                        onClick={() => setPending({ kind: 'intervene', action: 'close', target: row })}>
                        <Flag size={13} /> {t('platformElections.close', { defaultValue: 'Close now' })}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="row g-2 small mt-2">
                <div className="col-6 col-md-3"><span className="text-muted">{t('platformElections.turnout', { defaultValue: 'Turnout' })}: </span>{row.turnout?.voted ?? 0}/{row.turnout?.eligible ?? 0} ({row.turnout?.percentage ?? 0}%)</div>
                <div className="col-6 col-md-3"><span className="text-muted">{t('platformElections.candidates', { defaultValue: 'Candidates' })}: </span>{row.candidates_total}</div>
                {row.leaders.map((leader) => (
                  <div className="col-12 col-md-6" key={leader.position_key}>
                    <span className="text-muted">{leader.position_name}: </span>
                    {leader.leader ? `${leader.leader.full_name} — ${leader.leader.votes} (${leader.leader.percentage}%)` : t('platformElections.noVotes', { defaultValue: 'no votes yet' })}
                    {leader.tied && <Badge tone="warn" className="ms-1">{t('platformElections.tiedBadge', { defaultValue: 'TIED' })}</Badge>}
                  </div>
                ))}
              </div>
              {row.cancel_reason && <div className="small text-danger mt-2">{row.cancel_reason}</div>}
              {row.resolution_note && <div className="small text-muted mt-2">{t('platformElections.resolution', { defaultValue: 'Resolution' })}: {row.resolution_note}</div>}
            </div>
          ))}
        </div>
      )}

      <ReasonModal
        open={Boolean(pending)}
        busy={busy}
        danger={pending?.kind === 'intervene' && pending.action !== 'resume'}
        title={pending?.kind === 'module'
          ? t('platformElections.configTitle', { defaultValue: 'Change the election module for this school' })
          : t(`platformElections.interveneTitle.${pending?.action}`, { defaultValue: 'Intervene in this election' })}
        subtitle={pending?.school || pending?.target?.title}
        label={t('platformElections.reasonLabel', { defaultValue: 'Why? (kept in the platform audit trail)' })}
        confirmLabel={t('common.confirm', { defaultValue: 'Confirm' })}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => (pending?.kind === 'module'
          ? setConfig(pending, reason)
          : intervene(pending.action, pending.target, reason))}
      />
    </>
  );
}
