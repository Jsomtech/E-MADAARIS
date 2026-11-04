/**
 * Student Council Elections — the election officer's console.
 *
 * One election at a time: schedule it, take candidate applications against real learner records,
 * approve and publish them, then watch turnout and the tally while the clock runs the window. The
 * ballot itself is somewhere else (the learner's own screen); this page is only ever shown counts,
 * which is what keeps the secret ballot secret even from the administrator sitting at this desk.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  BarChart3, Ban, CheckCircle2, ClipboardList, Download, FileSpreadsheet, FileText, Flag,
  ImagePlus, Loader2, Lock, Megaphone, Pause, Play, RefreshCw, Search, ShieldCheck, SquareUser,
  Timer, Trophy, Undo2, Unlock, Users, Vote, X,
} from 'lucide-react';
import { apiDelete, apiPatch, apiPost, apiPut, apiUpload, downloadFile } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  Badge, EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge, dateTime,
} from '../../components/ui/Basics.jsx';
import { BarView, ChartCard, DoughnutView } from '../../components/ui/Charts.jsx';
import { Modal, ConfirmDialog } from '../../components/ui/Modal.jsx';

const ELECTION_FILE = 'supabase/migrations/0022_elections.sql';
const isMigrationGap = (error) => /0022_elections\.sql/.test(String(error?.message || ''));

const TABS = ['overview', 'candidates', 'schedule', 'live', 'participation', 'reports', 'history', 'audit'];
const TIMEZONES = ['Africa/Mogadishu', 'Africa/Nairobi', 'Africa/Djibouti', 'Africa/Khartoum', 'Europe/London', 'UTC', 'Asia/Dubai'];
const POSITION_LABEL = { president: 'Student Council President', vice_president: 'Student Council Vice President' };

const toLocalInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (value) => (value ? new Date(value).toISOString() : '');
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

/** A missing migration is a setup step, not a crash: name the file and offer Retry. */
function GapNotice({ error, onRetry, t }) {
  if (!isMigrationGap(error)) return <ErrorState error={error} onRetry={onRetry} />;
  return (
    <div className="card-soft p-4">
      <div className="d-flex gap-3 align-items-start">
        <div className="stat-icon tone-warn flex-shrink-0"><ShieldCheck size={20} /></div>
        <div className="min-width-0">
          <div className="fw-semibold">{t('elections.setupTitle', { defaultValue: 'Elections are not switched on in the database yet' })}</div>
          <div className="small text-muted mt-1">
            {t('elections.setupHint', {
              defaultValue: 'Run {{file}} once in the Supabase SQL editor. It creates the election tables, the one-vote rule and the clock that opens and closes voting, then press Retry here.',
              file: ELECTION_FILE,
            })}
          </div>
          <div className="small font-monospace text-muted mt-2">{ELECTION_FILE}</div>
          <button type="button" className="btn btn-sm btn-outline-primary mt-3" onClick={onRetry}>{t('common.retry', { defaultValue: 'Retry' })}</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, actions, children, className }) {
  return (
    <div className={`card-soft p-3 mb-3 ${className || ''}`}>
      <div className="d-flex justify-content-between align-items-start gap-2 mb-2 flex-wrap">
        <div className="min-width-0">
          <div className="fw-semibold">{title}</div>
          {subtitle && <div className="small text-muted">{subtitle}</div>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export default function ElectionsPage({ query = {} }) {
  const { t } = useTranslation();
  const { can } = useAuth();

  const [tab, setTab] = useState(TABS.includes(query.tab) ? query.tab : 'overview');
  const [selectedId, setSelectedId] = useState(query.election_id || '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [candidateModal, setCandidateModal] = useState(null);
  const [decision, setDecision] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const allowed = Boolean(can('elections.view'));
  const list = useApi(allowed ? '/school/elections' : null, null, allowed);
  const elections = list.data?.elections || [];
  const currentId = useMemo(() => {
    if (selectedId && elections.some((e) => e.id === selectedId)) return selectedId;
    const live = elections.find((e) => e.status === 'active') || elections[0];
    return live?.id || '';
  }, [elections, selectedId]);

  const overview = useApi(allowed && currentId ? `/school/elections/${currentId}/overview` : null, null, allowed && Boolean(currentId));
  const candidates = useApi(allowed && currentId ? `/school/elections/${currentId}/candidates` : null, null, allowed && Boolean(currentId));
  const participation = useApi(allowed && currentId ? `/school/elections/${currentId}/participation` : null, null, allowed && Boolean(currentId));
  const auditTrail = useApi(allowed && currentId && tab === 'audit' ? `/school/elections/${currentId}/audit` : null, null, allowed && Boolean(currentId) && tab === 'audit');

  const election = overview.data?.election || elections.find((e) => e.id === currentId) || null;
  const stats = overview.data?.stats || {};
  const positions = overview.data?.positions || [];
  const scoreboard = overview.data?.results || [];
  const turnout = participation.data || overview.data?.turnout || {};

  const canManage = Boolean(can('elections.manage'));
  const canCreate = Boolean(can('elections.create'));
  const canApprove = Boolean(can('elections.approve'));
  const canPublish = Boolean(can('elections.publish'));
  const canExport = Boolean(can('elections.export'));
  const locked = Boolean(election?.opened_at) || ['active', 'paused', 'closed', 'cancelled'].includes(election?.status);

  /** The window runs itself, but the officer's screen should not need a manual refresh. */
  useEffect(() => {
    if (!election || (election.status !== 'active' && election.status !== 'scheduled')) return undefined;
    const timer = setInterval(() => { overview.refetch(); participation.refetch(); }, 15_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [election?.id, election?.status]);

  const reloadAll = () => { list.reload(); overview.reload(); candidates.reload(); participation.reload(); };

  const call = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      if (message) toast.success(message);
      reloadAll();
      return true;
    } catch (error) {
      toast.error(error.message || String(error));
      return false;
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const setStatus = (action, reason) => call(
    () => apiPost(`/school/elections/${currentId}/status`, { action, ...(reason ? { reason } : {}) }),
    t('elections.windowUpdated', { defaultValue: 'The voting window was updated.' }),
  );

  if (!allowed) {
    return (
      <>
        <PageHeader title={t('elections.title', { defaultValue: 'Student council elections' })} />
        <div className="alert alert-warning small">
          {t('elections.noView', { defaultValue: 'Your role cannot read elections (elections.view).' })}
        </div>
      </>
    );
  }

  const firstError = list.error || overview.error;

  return (
    <>
      <PageHeader
        title={t('elections.title', { defaultValue: 'Student council elections' })}
        subtitle={t('elections.subtitle', { defaultValue: 'Two seats — President and Vice President — voted for once by every eligible learner. The clock opens and closes voting on its own.' })}
        actions={(
          <>
            <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={reloadAll}>
              <RefreshCw size={14} /> {t('common.refresh', { defaultValue: 'Refresh' })}
            </button>
            {canCreate && (
              <button type="button" className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={() => setCreating(true)}>
                <Vote size={14} /> {t('elections.newElection', { defaultValue: 'New election' })}
              </button>
            )}
          </>
        )}
      />

      {list.loading && !elections.length ? <Spinner /> : null}
      {firstError && list.data?.enabled !== false ? <div className="mb-3"><GapNotice error={firstError} onRetry={list.reload} t={t} /></div> : null}

      {list.data?.enabled === false && (
        <div className="alert alert-warning small d-flex gap-2 align-items-start">
          <ShieldCheck size={16} className="flex-shrink-0 mt-1" />
          <div className="min-width-0">
            <div className="fw-semibold">{t('elections.disabledTitle', { defaultValue: 'The election module is switched off for this school' })}</div>
            <div>
              {t('elections.disabledHint', { defaultValue: 'The platform administrator controls this. Learners cannot see candidates or cast a ballot until it is turned back on — the schedule and the candidates you have entered are kept.' })}
            </div>
          </div>
        </div>
      )}

      {!list.loading && !firstError && !elections.length && list.data?.enabled !== false && (
        <Section title={t('elections.noneYet', { defaultValue: 'No election yet' })}
          subtitle={t('elections.noneYetHint', { defaultValue: 'Create one, add candidates against real learner records, approve and publish them, then set the voting window going.' })}>
          {canCreate
            ? <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>{t('elections.newElection', { defaultValue: 'New election' })}</button>
            : <div className="small text-muted">{t('elections.needCreate', { defaultValue: 'Creating an election needs the elections.create permission.' })}</div>}
        </Section>
      )}

      {elections.length > 0 && list.data?.enabled !== false && (
        <>
          <div className="nav nav-pills gap-1 mb-3 flex-wrap">
            {TABS.map((key) => (
              <button type="button" key={key} className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab(key)}>
                {t(`elections.tabs.${key}`, { defaultValue: key })}
              </button>
            ))}
          </div>

          <Section
            title={election ? election.title : t('elections.pickElection', { defaultValue: 'Choose an election' })}
            subtitle={election ? `${election.status.toUpperCase()} · ${dateTime(election.start_at)} → ${dateTime(election.end_at)} · ${election.timezone}` : ''}
            actions={(
              <select className="form-select form-select-sm" style={{ maxWidth: '18rem' }} value={currentId} onChange={(e) => setSelectedId(e.target.value)}>
                {elections.map((e) => (
                  <option key={e.id} value={e.id}>{e.title} — {e.status}</option>
                ))}
              </select>
            )}
          >
            {election && (
              <div className="d-flex flex-wrap gap-2 align-items-center">
                <Badge tone={election.status === 'active' ? 'ok' : election.status === 'paused' ? 'warn' : election.status === 'cancelled' ? 'danger' : 'info'}>
                  {election.status}
                </Badge>
                {election.opened_at && <Badge tone="brand"><Lock size={11} /> {t('elections.locked', { defaultValue: 'candidate details locked' })}</Badge>}
                {election.results_published && <Badge tone="ok"><Trophy size={11} /> {t('elections.resultsPublished', { defaultValue: 'results published' })}</Badge>}
                {election.student_live_results_enabled
                  ? <Badge tone="info">{t('elections.studentsSeeLive', { defaultValue: 'learners see live counts' })}</Badge>
                  : <Badge tone="neutral">{t('elections.studentsSeeFinal', { defaultValue: 'learners see results only after closing' })}</Badge>}
                <span className="small text-muted ms-auto">
                  {t('elections.ballotsCount', { defaultValue: '{{voted}} of {{eligible}} learners have voted', voted: turnout.voted ?? 0, eligible: turnout.eligible ?? 0 })}
                </span>
              </div>
            )}
          </Section>

          {tab === 'overview' && <OverviewTab stats={stats} election={election} turnout={turnout} scoreboard={scoreboard} t={t} />}
          {tab === 'candidates' && (
            <CandidatesTab
              election={election} positions={positions} rows={candidates.data?.candidates || []} loading={candidates.loading}
              error={candidates.error} locked={locked} busy={busy}
              canCreate={canCreate} canApprove={canApprove} canPublish={canPublish}
              onOpenCreate={() => setCandidateModal({ mode: 'create' })}
              onOpenEdit={(row) => setCandidateModal({ mode: 'edit', row })}
              onDecision={(row, kind) => setDecision({ row, kind })}
              onDelete={(row) => setConfirming({
                title: t('elections.removeCandidate', { defaultValue: 'Remove this candidate?' }),
                message: `${row.full_name} — ${POSITION_LABEL[positions.find((p) => p.id === row.position_id)?.position_key] || ''}`,
                action: () => apiDelete(`/school/elections/candidates/${row.id}`),
                done: t('elections.candidateRemoved', { defaultValue: 'Candidate removed.' }),
              })}
              onReload={candidates.reload}
              t={t}
            />
          )}
          {tab === 'schedule' && (
            <ScheduleTab
              election={election} canManage={canManage} canEdit={Boolean(can('elections.edit'))} busy={busy}
              onEdit={() => setEditing(election)} onStatus={setStatus}
              onCancel={() => setCancelOpen(true)}
              onPublish={() => call(() => apiPost(`/school/elections/${currentId}/publish`, {}), t('elections.resultsPublishedToast', { defaultValue: 'Results published to learners.' }))}
              t={t}
            />
          )}
          {tab === 'live' && <LiveTab scoreboard={scoreboard} turnout={turnout} election={election} loading={overview.loading} t={t} />}
          {tab === 'participation' && <ParticipationTab turnout={turnout} loading={participation.loading} t={t} />}
          {tab === 'reports' && (
            <ReportsTab election={election} canExport={canExport} scoreboard={scoreboard} t={t} />
          )}
          {tab === 'history' && <HistoryTab elections={elections} t={t} />}
          {tab === 'audit' && <AuditTab entries={auditTrail.data?.entries || []} loading={auditTrail.loading} error={auditTrail.error} onRetry={auditTrail.reload} t={t} />}
        </>
      )}

      {creating && (
        <ElectionFormModal state={{ mode: 'create' }} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); list.reload(); }} t={t} />
      )}
      {editing && (
        <ElectionFormModal state={{ mode: 'edit', row: editing }} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reloadAll(); }} t={t} />
      )}
      {candidateModal && currentId && (
        <CandidateFormModal
          state={{ ...candidateModal, electionId: currentId }} positions={positions} locked={locked}
          onClose={() => setCandidateModal(null)}
          onSaved={() => { setCandidateModal(null); candidates.reload(); overview.reload(); }}
          t={t}
        />
      )}
      {decision && (
        <DecisionModal
          state={decision} positions={positions}
          onClose={() => setDecision(null)}
          onSaved={() => { setDecision(null); candidates.reload(); overview.reload(); }}
          t={t}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirming)}
        title={confirming?.title}
        message={confirming?.message}
        busy={busy}
        onClose={() => setConfirming(null)}
        onConfirm={() => call(() => confirming.action(), confirming.done)}
      />
      {cancelOpen && (
        <CancelElectionModal
          election={election}
          onClose={() => setCancelOpen(false)}
          onDone={() => { setCancelOpen(false); reloadAll(); }}
          t={t}
        />
      )}
    </>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

function OverviewTab({ stats, election, turnout, scoreboard, t }) {
  const remaining = Number(stats.milliseconds_remaining || 0);
  const untilOpen = Number(stats.milliseconds_until_open || 0);
  const countdown = election?.status === 'scheduled' && untilOpen > 0
    ? `${t('elections.opensIn', { defaultValue: 'opens in' })} ${humanGap(untilOpen)}`
    : remaining > 0 && election?.status === 'active'
      ? `${t('elections.closesIn', { defaultValue: 'closes in' })} ${humanGap(remaining)}`
      : election?.status === 'closed' ? t('elections.votingClosed', { defaultValue: 'voting closed' }) : '—';

  const cards = [
    ['registeredLearners', 'Registered learners', stats.registered_learners, Users, 'brand'],
    ['eligibleVoters', 'Eligible voters', stats.eligible_voters, ShieldCheck, 'info'],
    ['presidentCandidates', 'President candidates', stats.president_candidates, SquareUser, 'brand'],
    ['vicePresidentCandidates', 'Vice-president candidates', stats.vice_president_candidates, SquareUser, 'brand'],
    ['approvedCandidates', 'Approved candidates', stats.approved_candidates, CheckCircle2, 'ok'],
    ['awaitingDecision', 'Awaiting decision', stats.pending_candidates, ClipboardList, 'warn'],
    ['publishedCandidates', 'Published to learners', stats.published_candidates, Megaphone, 'ok'],
    ['ballotsRecorded', 'Ballots recorded', stats.votes_cast, Vote, 'brand'],
    ['notVotingYet', 'Learners not voting', stats.learners_not_voted, Ban, 'danger'],
    ['turnout', 'Turnout', `${stats.participation_percentage ?? 0}%`, BarChart3, 'info'],
  ];
  return (
    <>
      <div className="row g-3 mb-3">
        {cards.map(([key, label, value, Icon, tone]) => (
          <div className="col-6 col-md-4 col-xl-3" key={key}>
            <StatCard label={t(`elections.stats.${key}`, { defaultValue: label })} value={value ?? 0} icon={Icon} tone={tone} />
          </div>
        ))}
        <div className="col-6 col-md-4 col-xl-3">
          <StatCard label={t('elections.stats.window', { defaultValue: 'Voting window' })} value={countdown} icon={Timer} tone="warn"
            hint={election ? `${dateTime(election.start_at)} → ${dateTime(election.end_at)}` : ''} />
        </div>
        <div className="col-6 col-md-4 col-xl-3">
          <StatCard label={t('elections.stats.ties', { defaultValue: 'Tied seats' })} value={(stats.tied_positions || []).length} icon={Trophy}
            tone={(stats.tied_positions || []).length ? 'danger' : 'neutral'}
            hint={(stats.tied_positions || []).join(', ') || t('elections.noTies', { defaultValue: 'no tie to resolve' })} />
        </div>
      </div>
      {Number(stats.learners_without_accounts || 0) > 0 && (
        <div className="alert alert-warning small d-flex align-items-start gap-2">
          <ShieldCheck size={15} className="mt-1 flex-shrink-0" />
          <div>
            {t('elections.noAccountWarning', {
              defaultValue: '{{n}} active learner(s) have no sign-in account yet, so they cannot be given a ballot and are not counted among the eligible voters. Create their accounts under Students before the voting window opens.',
              n: Number(stats.learners_without_accounts),
            })}
          </div>
        </div>
      )}
      {turnout.last_vote_at && (
        <div className="small text-muted mb-3">
          <Timer size={13} className="me-1" />
          {t('elections.lastBallotAt', { defaultValue: 'Last ballot recorded' })}: {dateTime(turnout.last_vote_at)}
        </div>
      )}
      {scoreboard.length === 0 && <EmptyState title={t('elections.noTallyYet', { defaultValue: 'No votes counted yet' })} />}
      {scoreboard.map((position) => (
        <Section key={position.position_id} title={position.position_name}
          subtitle={`${t('elections.validVotes', { defaultValue: 'valid votes' })}: ${position.total_valid_votes}${position.tied ? ` · ${t('elections.tied', { defaultValue: 'TIED' })}` : ''}`}>
          {position.candidates.length === 0
            ? <EmptyState title={t('elections.noCandidatesHere', { defaultValue: 'No candidate stands for this seat yet.' })} />
            : (
              <div className="d-flex flex-column gap-2">
                {position.candidates.map((candidate) => (
                  <div key={candidate.candidate_id} className="d-flex align-items-center gap-2">
                    <div className="flex-grow-1 min-width-0">
                      <div className="d-flex justify-content-between small">
                        <span className="fw-semibold text-truncate">{candidate.full_name}</span>
                        <span className="text-muted">{candidate.votes} · {candidate.percentage}%</span>
                      </div>
                      <div className="progress mt-1" style={{ height: 6 }}>
                        <div className="progress-bar" style={{ width: `${Math.min(100, candidate.percentage)}%` }} />
                      </div>
                    </div>
                    {candidate.status === 'tied' && <Badge tone="warn">{t('elections.tied', { defaultValue: 'TIED' })}</Badge>}
                    {candidate.status === 'winner' && <Badge tone="ok"><Trophy size={11} /> {t('elections.elected', { defaultValue: 'leading' })}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </Section>
      ))}
    </>
  );
}

function humanGap(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/* ── Candidates ───────────────────────────────────────────────────────────── */

function CandidatesTab({ election, positions, rows, loading, error, locked, canCreate, canApprove, canPublish, onOpenCreate, onOpenEdit, onDecision, onDelete, onReload, t }) {
  if (error) return <GapNotice error={error} onRetry={onReload} t={t} />;
  if (loading && !rows.length) return <Spinner />;
  const byPosition = positions.map((position) => ({
    position,
    list: rows.filter((row) => row.position_id === position.id),
  }));
  return (
    <>
      {locked && (
        <div className="alert alert-warning small d-flex align-items-center gap-2">
          <Lock size={14} />
          {t('elections.lockedNote', { defaultValue: 'Voting has begun, so candidate details and manifestos are locked. They cannot be edited until the election is closed.' })}
        </div>
      )}
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <div className="small text-muted">{t('elections.candidatesHint', { defaultValue: 'Every candidate is a real enrolled learner — the list is picked, never typed.' })}</div>
        {canCreate && !locked && (
          <button type="button" className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={onOpenCreate}>
            <SquareUser size={14} /> {t('elections.addCandidate', { defaultValue: 'Register candidate' })}
          </button>
        )}
      </div>
      {byPosition.map(({ position, list }) => (
        <Section key={position.id} title={position.position_name} subtitle={`${list.length} ${t('elections.candidatesCount', { defaultValue: 'candidate(s)' })}`}>
          {list.length === 0
            ? <EmptyState title={t('elections.noCandidatesHere', { defaultValue: 'No candidate stands for this seat yet.' })} />
            : (
              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead>
                    <tr className="small text-muted">
                      <th>{t('elections.candidate', { defaultValue: 'Candidate' })}</th>
                      <th>{t('elections.learner', { defaultValue: 'Learner record' })}</th>
                      <th>{t('elections.promises', { defaultValue: 'Manifesto' })}</th>
                      <th>{t('elections.status', { defaultValue: 'Status' })}</th>
                      <th className="text-end">{t('elections.actions', { defaultValue: 'Actions' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <span className="avatar">{row.photograph_url ? <img src={row.photograph_url} alt="" /> : initials(row.full_name)}</span>
                            <div className="min-width-0">
                              <div className="fw-semibold text-truncate">{row.full_name}</div>
                              {row.campaign_title && <div className="small text-muted text-truncate">“{row.campaign_title}”</div>}
                            </div>
                          </div>
                        </td>
                        <td className="small">
                          <div>{row.admission_number || '—'}</div>
                          <div className="text-muted">{row.class_name || '—'} · {row.gender || '—'}</div>
                        </td>
                        <td className="small" style={{ maxWidth: '22rem' }}>
                          {(row.manifestos || []).length
                            ? <ul className="mb-0 ps-3">{row.manifestos.map((m) => <li key={m.id}>{m.promise_text}</li>)}</ul>
                            : <span className="text-muted">{t('elections.noPromises', { defaultValue: 'none written yet' })}</span>}
                        </td>
                        <td>
                          <StatusBadge value={row.application_status} />
                          {row.is_published ? <Badge tone="ok" className="ms-1">{t('elections.live', { defaultValue: 'visible' })}</Badge> : <Badge tone="neutral" className="ms-1">{t('elections.hidden', { defaultValue: 'hidden' })}</Badge>}
                          {row.decision_reason && <div className="small text-muted mt-1">{row.decision_reason}</div>}
                        </td>
                        <td className="text-end">
                          <div className="btn-group btn-group-sm">
                            {!locked && <button type="button" className="btn btn-outline-secondary" onClick={() => onOpenEdit(row)} title={t('common.edit')}><i className="bi bi-pencil" />edit</button>}
                            {canApprove && !locked && row.application_status !== 'approved' && (
                              <button type="button" className="btn btn-outline-success d-inline-flex align-items-center gap-1" onClick={() => onDecision(row, 'approve')}>
                                <CheckCircle2 size={13} /> {t('elections.approve', { defaultValue: 'approve' })}
                              </button>
                            )}
                            {canApprove && !locked && row.application_status !== 'rejected' && (
                              <button type="button" className="btn btn-outline-danger d-inline-flex align-items-center gap-1" onClick={() => onDecision(row, 'reject')}>
                                <X size={13} /> {t('elections.reject', { defaultValue: 'reject' })}
                              </button>
                            )}
                            {canApprove && row.application_status === 'approved' && !locked && (
                              <button type="button" className="btn btn-outline-warning d-inline-flex align-items-center gap-1" onClick={() => onDecision(row, 'suspend')}>
                                <Pause size={13} /> {t('elections.suspend', { defaultValue: 'suspend' })}
                              </button>
                            )}
                            {canPublish && row.application_status === 'approved' && (
                              <button type="button" className="btn btn-outline-primary d-inline-flex align-items-center gap-1"
                                onClick={() => onDecision(row, row.is_published ? 'unpublish' : 'publish')}>
                                <Megaphone size={13} /> {row.is_published ? t('elections.unpublish', { defaultValue: 'hide' }) : t('elections.publish', { defaultValue: 'publish' })}
                              </button>
                            )}
                            {!locked && (
                              <button type="button" className="btn btn-outline-danger" onClick={() => onDelete(row)} title={t('common.delete')}>
                                <Undo2 size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Section>
      ))}
    </>
  );
}

/* ── Candidate form ───────────────────────────────────────────────────────── */

function CandidateFormModal({ state, onClose, onSaved, locked, positions, t }) {
  const isEdit = state.mode === 'edit';
  const [values, setValues] = useState(() => {
    const row = state.row || {};
    return {
      student_id: row.student_id || '',
      position_id: row.position_id || positions[0]?.id || '',
      campaign_title: row.campaign_title || '',
      introduction: row.introduction || '',
      photograph_url: row.photograph_url || '',
      points: (row.manifestos || []).map((m) => m.promise_text),
    };
  });
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(isEdit ? { id: state.row.student_id, full_name: state.row.full_name } : null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const eligible = useApi(isEdit ? null : `/school/elections/${state.electionId}/eligible-candidates`, { search: search || undefined }, !isEdit);

  const set = (key) => (event) => setValues((v) => ({ ...v, [key]: event.target.value }));
  const setPoint = (index, value) => setValues((v) => ({ ...v, points: v.points.map((p, i) => (i === index ? value : p)) }));
  const addPoint = () => setValues((v) => ({ ...v, points: [...v.points, ''] }));
  const dropPoint = (index) => setValues((v) => ({ ...v, points: v.points.filter((_, i) => i !== index) }));

  const uploadPhoto = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await apiUpload(`/school/elections/${state.electionId}/candidates/photo`, body);
      setValues((v) => ({ ...v, photograph_url: data.url }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    const points = values.points.map((p) => p.trim()).filter(Boolean);
    if (!isEdit && !picked) {
      toast.error(t('elections.pickLearner', { defaultValue: 'Choose the learner who is standing.' }));
      return;
    }
    if (points.some((p) => p.length < 4)) {
      toast.error(t('elections.shortPromise', { defaultValue: 'Each promise needs at least a few words — or delete the empty line.' }));
      return;
    }
    setBusy(true);
    try {
      const payload = {
        campaign_title: values.campaign_title.trim() || null,
        introduction: values.introduction.trim() || null,
        photograph_url: values.photograph_url || null,
      };
      if (isEdit) {
        await apiPatch(`/school/elections/candidates/${state.row.id}`, { ...payload, position_id: undefined, position_key: positions.find((p) => p.id === values.position_id)?.position_key });
        await apiPut(`/school/elections/candidates/${state.row.id}/manifesto`, { points });
      } else {
        await apiPost(`/school/elections/${state.electionId}/candidates`, {
          ...payload, student_id: picked.id, position_key: positions.find((p) => p.id === values.position_id)?.position_key, manifestos: points,
        });
      }
      toast.success(isEdit ? t('elections.candidateSaved', { defaultValue: 'Candidate saved.' }) : t('elections.candidateAdded', { defaultValue: 'Candidate registered.' }));
      onSaved();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg"
      title={isEdit ? t('elections.editCandidate', { defaultValue: 'Edit candidate' }) : t('elections.addCandidate', { defaultValue: 'Register candidate' })}
      subtitle={t('elections.candidateSource', { defaultValue: 'Candidates are enrolled learners. Never a name typed into a box.' })}
      footer={(
        <>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>{busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {t('common.save', { defaultValue: 'Save' })}</button>
        </>
      )}>
      <div className="row g-3">
        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold">{t('elections.seat', { defaultValue: 'Standing for' })}</label>
          <select className="form-select form-select-sm" value={values.position_id} onChange={set('position_id')} disabled={locked}>
            {positions.map((p) => <option key={p.id} value={p.id}>{p.position_name}</option>)}
          </select>
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold">{isEdit ? t('elections.learner', { defaultValue: 'Learner record' }) : t('elections.findLearner', { defaultValue: 'Find the learner' })}</label>
          {isEdit
            ? <input className="form-control form-control-sm" value={state.row.full_name} disabled />
            : (
              <>
                <div className="input-group input-group-sm mb-2">
                  <span className="input-group-text"><Search size={13} /></span>
                  <input className="form-control" placeholder={t('elections.searchLearner', { defaultValue: 'Name or admission number' })} value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                {picked && <div className="alert alert-success py-2 small d-flex justify-content-between align-items-center">{picked.full_name}<button type="button" className="btn-close" style={{ fontSize: '.6rem' }} onClick={() => setPicked(null)} /></div>}
                {!picked && (
                  <div className="list-group list-group-flush" style={{ maxHeight: '12rem', overflowY: 'auto' }}>
                    {eligible.loading && <Spinner />}
                    {eligible.error && <div className="small text-danger">{eligible.error.message}</div>}
                    {(eligible.data || []).map((learner) => (
                      <button type="button" key={learner.id} className="list-group-item list-group-item-action small"
                        onClick={() => setPicked(learner)}>
                        <span className="fw-semibold">{learner.full_name}</span>
                        <span className="text-muted"> · {learner.admission_number || '—'} · {learner.class_name || '—'}</span>
                      </button>
                    ))}
                    {!eligible.loading && (eligible.data || []).length === 0 && (
                      <div className="small text-muted p-2">{t('elections.noEligible', { defaultValue: 'No learner in this school is available — everyone either already stands or is not active.' })}</div>
                    )}
                  </div>
                )}
              </>
            )}
        </div>

        <div className="col-12 col-md-8">
          <label className="form-label small fw-semibold">{t('elections.campaignTitle', { defaultValue: 'Campaign title or slogan' })}</label>
          <input className="form-control form-control-sm" maxLength={120} value={values.campaign_title} onChange={set('campaign_title')} disabled={locked} />
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold">{t('elections.photo', { defaultValue: 'Campaign photo' })}</label>
          <div className="d-flex align-items-center gap-2">
            <span className="avatar">{values.photograph_url ? <img src={values.photograph_url} alt="" /> : <ImagePlus size={16} />}</span>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="form-control form-control-sm" disabled={locked || uploading}
              onChange={(e) => uploadPhoto(e.target.files?.[0])} />
            {uploading && <Loader2 size={14} className="animate-spin" />}
          </div>
        </div>

        <div className="col-12">
          <label className="form-label small fw-semibold">{t('elections.introduction', { defaultValue: 'Short introduction shown on the card' })}</label>
          <textarea className="form-control form-control-sm" rows={2} maxLength={4000} value={values.introduction} onChange={set('introduction')} disabled={locked} />
        </div>

        <div className="col-12">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <label className="form-label small fw-semibold mb-0">{t('elections.manifesto', { defaultValue: 'Manifesto — one promise per line' })}</label>
            {!locked && <button type="button" className="btn btn-sm btn-outline-primary" onClick={addPoint}>{t('elections.addPromise', { defaultValue: 'Add promise' })}</button>}
          </div>
          {values.points.length === 0 && <div className="small text-muted mb-2">{t('elections.noPromises', { defaultValue: 'none written yet' })}</div>}
          <div className="d-flex flex-column gap-2">
            {values.points.map((point, index) => (
              <div className="input-group input-group-sm" key={index}>
                <span className="input-group-text">{index + 1}</span>
                <textarea className="form-control" rows={2} maxLength={600} value={point} disabled={locked} onChange={(e) => setPoint(index, e.target.value)} />
                {!locked && <button type="button" className="btn btn-outline-danger" onClick={() => dropPoint(index)}><X size={14} /></button>}
              </div>
            ))}
          </div>
          {locked && <div className="small text-muted mt-2"><Lock size={12} className="me-1" />{t('elections.lockedNote', { defaultValue: 'Voting has begun, so candidate details and manifestos are locked. They cannot be edited until the election is closed.' })}</div>}
        </div>
      </div>
    </Modal>
  );
}

function DecisionModal({ state, onClose, onSaved, positions, t }) {
  const { row, kind } = state;
  const needsReason = kind === 'reject' || kind === 'suspend';
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const labels = {
    approve: t('elections.approveTitle', { defaultValue: 'Approve this candidacy' }),
    reject: t('elections.rejectTitle', { defaultValue: 'Reject this candidacy' }),
    suspend: t('elections.suspendTitle', { defaultValue: 'Suspend this candidacy' }),
    publish: t('elections.publishTitle', { defaultValue: 'Show this candidate to learners' }),
    unpublish: t('elections.unpublishTitle', { defaultValue: 'Hide this candidate from learners' }),
  };
  const submit = async () => {
    if (needsReason && reason.trim().length < 3) {
      toast.error(t('elections.reasonNeeded', { defaultValue: 'A reason of at least three characters is required.' }));
      return;
    }
    setBusy(true);
    try {
      await apiPost(`/school/elections/candidates/${row.id}/decision`, { decision: kind, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      toast.success(`${row.full_name}: ${kind}`);
      onSaved();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={labels[kind] || kind}
      subtitle={`${row.full_name} · ${positions.find((p) => p.id === row.position_id)?.position_name || ''}`}
      footer={(
        <>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={submit}>{busy ? <Loader2 size={14} className="animate-spin" /> : null}{t('common.confirm', { defaultValue: 'Confirm' })}</button>
        </>
      )}>
      {needsReason
        ? (
          <>
            <label className="form-label small fw-semibold">{t('elections.reasonLabel', { defaultValue: 'Reason (shown to the candidate and kept in the audit trail)' })}</label>
            <textarea className="form-control form-control-sm" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </>
        )
        : <div className="small text-muted">{t('elections.noReasonNeeded', { defaultValue: 'No reason is needed for this one. It is recorded in the audit trail.' })}</div>}
    </Modal>
  );
}

/* ── Schedule ─────────────────────────────────────────────────────────────── */

function ScheduleTab({ election, canManage, canEdit, busy, onEdit, onStatus, onCancel, onPublish, t }) {
  if (!election) return <Spinner />;
  const status = election.status;
  const button = (action, label, Icon, tone, enabled) => (
    <button type="button" className={`btn btn-sm btn-outline-${tone} d-inline-flex align-items-center gap-1`} disabled={!enabled || busy} onClick={() => onStatus(action)}>
      <Icon size={14} /> {label}
    </button>
  );
  return (
    <>
      <Section title={t('elections.window', { defaultValue: 'Voting window' })}
        subtitle={t('elections.windowHint', { defaultValue: 'The database clock opens and closes this on its own — nobody has to be signed in when it happens.' })}
        actions={canEdit && <button type="button" className="btn btn-sm btn-outline-primary" onClick={onEdit}>{t('elections.changeTimes', { defaultValue: 'Change dates and times' })}</button>}>
        <div className="row g-3 small">
          <div className="col-6 col-md-3"><div className="text-muted">{t('elections.opens', { defaultValue: 'Opens' })}</div><div className="fw-semibold">{dateTime(election.start_at)}</div></div>
          <div className="col-6 col-md-3"><div className="text-muted">{t('elections.closes', { defaultValue: 'Closes' })}</div><div className="fw-semibold">{dateTime(election.end_at)}</div></div>
          <div className="col-6 col-md-3"><div className="text-muted">{t('elections.openedAt', { defaultValue: 'Actually opened' })}</div><div className="fw-semibold">{election.opened_at ? dateTime(election.opened_at) : t('elections.notYet', { defaultValue: 'not yet' })}</div></div>
          <div className="col-6 col-md-3"><div className="text-muted">{t('elections.closedAt', { defaultValue: 'Actually closed' })}</div><div className="fw-semibold">{election.closed_at ? dateTime(election.closed_at) : t('elections.notYet', { defaultValue: 'not yet' })}</div></div>
          <div className="col-6 col-md-3"><div className="text-muted">{t('elections.timezone', { defaultValue: 'Timezone' })}</div><div className="fw-semibold">{election.timezone}</div></div>
          <div className="col-6 col-md-3"><div className="text-muted">{t('elections.status', { defaultValue: 'Status' })}</div><div className="fw-semibold">{status}</div></div>
          {election.cancel_reason && <div className="col-12"><div className="text-muted">{t('elections.cancelReason', { defaultValue: 'Cancellation reason' })}</div><div className="fw-semibold">{election.cancel_reason}</div></div>}
          {election.resolution_note && <div className="col-12"><div className="text-muted">{t('elections.resolution', { defaultValue: 'Tie resolution recorded' })}</div><div className="fw-semibold">{election.resolution_note}</div></div>}
        </div>
      </Section>

      {canManage && (
        <Section title={t('elections.manualControl', { defaultValue: 'Manual control' })}
          subtitle={t('elections.manualHint', { defaultValue: 'Every button here is audited. Leaving it alone is fine — the clock does the same thing on time.' })}>
          <div className="d-flex flex-wrap gap-2">
            {button('open', t('elections.openNow', { defaultValue: 'Open voting now' }), Play, 'success', ['scheduled', 'paused'].includes(status))}
            {button('pause', t('elections.pause', { defaultValue: 'Pause' }), Pause, 'warning', status === 'active')}
            {button('resume', t('elections.resume', { defaultValue: 'Resume' }), Play, 'success', status === 'paused')}
            {button('close', t('elections.closeNow', { defaultValue: 'Close and tally' }), Flag, 'danger', ['scheduled', 'active', 'paused'].includes(status))}
            <button type="button" className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1" disabled={busy || status === 'closed' || status === 'cancelled'} onClick={onCancel}>
              <Ban size={14} /> {t('elections.cancel', { defaultValue: 'Cancel election' })}
            </button>
            <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" disabled={busy || status !== 'closed' || election.results_published} onClick={onPublish}>
              <Unlock size={14} /> {t('elections.publishResults', { defaultValue: 'Publish results to learners' })}
            </button>
          </div>
        </Section>
      )}
    </>
  );
}

/** Cancelling needs a reason the audit trail can show; a bare button click is not enough. */
function CancelElectionModal({ election, onClose, onDone, t }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (reason.trim().length < 3) {
      toast.error(t('elections.reasonNeeded', { defaultValue: 'A reason of at least three characters is required.' }));
      return;
    }
    setBusy(true);
    try {
      await apiPost(`/school/elections/${election.id}/status`, { action: 'cancel', reason: reason.trim() });
      toast.success(t('elections.electionCancelled', { defaultValue: 'The election is cancelled and recorded in the history.' }));
      onDone();
    } catch (error) {
      toast.error(error.message || String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" icon={Ban}
      title={t('elections.cancelTitle', { defaultValue: 'Cancel this election?' })}
      subtitle={election.title}
      footer={(
        <>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={submit}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}{t('elections.cancelConfirm', { defaultValue: 'Cancel election' })}
          </button>
        </>
      )}>
      <div className="small text-muted mb-2">
        {t('elections.cancelHint', { defaultValue: 'Ballots already cast are kept for the record but the election produces no winner. Learners are told, and the reason is written into the audit trail.' })}
      </div>
      <label className="form-label small fw-semibold" htmlFor="cancel-reason">
        {t('elections.reasonLabel', { defaultValue: 'Reason (shown to the candidate and kept in the audit trail)' })}
      </label>
      <textarea id="cancel-reason" className="form-control form-control-sm" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

function ElectionFormModal({ state, onClose, onSaved, t }) {
  const isEdit = state.mode === 'edit';
  const row = state.row || {};
  const years = useApi('/academic-years', { pageSize: 50 }, true);
  const [values, setValues] = useState({
    title: row.title || '',
    description: row.description || '',
    academic_year_id: row.academic_year_id || '',
    start_at: toLocalInput(row.start_at || new Date(Date.now() + 86400000).toISOString()),
    end_at: toLocalInput(row.end_at || new Date(Date.now() + 3 * 86400000).toISOString()),
    timezone: row.timezone || 'Africa/Mogadishu',
    student_live_results_enabled: row.student_live_results_enabled !== false,
  });
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setValues((v) => ({ ...v, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const save = async () => {
    if (values.title.trim().length < 3) {
      toast.error(t('elections.titleNeeded', { defaultValue: 'Give the election a name.' }));
      return;
    }
    if (!values.start_at || !values.end_at || new Date(values.end_at) <= new Date(values.start_at)) {
      toast.error(t('elections.windowNeeded', { defaultValue: 'The closing time must be after the opening time.' }));
      return;
    }
    const body = {
      title: values.title.trim(),
      description: values.description.trim() || null,
      academic_year_id: values.academic_year_id || null,
      start_at: fromLocalInput(values.start_at),
      end_at: fromLocalInput(values.end_at),
      timezone: values.timezone,
      student_live_results_enabled: values.student_live_results_enabled,
    };
    setBusy(true);
    try {
      if (isEdit) await apiPatch(`/school/elections/${row.id}`, body);
      else await apiPost('/school/elections', body);
      toast.success(isEdit ? t('elections.saved', { defaultValue: 'Election updated.' }) : t('elections.created', { defaultValue: 'Election created with both seats.' }));
      onSaved();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg"
      title={isEdit ? t('elections.editElection', { defaultValue: 'Edit election' }) : t('elections.newElection', { defaultValue: 'New election' })}
      subtitle={t('elections.twoSeats', { defaultValue: 'Both seats — President and Vice President — are created together and counted separately.' })}
      footer={(
        <>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>{busy ? <Loader2 size={14} className="animate-spin" /> : null}{t('common.save', { defaultValue: 'Save' })}</button>
        </>
      )}>
      <div className="row g-3">
        <div className="col-12">
          <label className="form-label small fw-semibold">{t('elections.electionName', { defaultValue: 'Election name' })}</label>
          <input className="form-control form-control-sm" value={values.title} onChange={set('title')} placeholder={t('elections.exampleName', { defaultValue: 'Student Council Election 2026/2027' })} />
        </div>
        <div className="col-12">
          <label className="form-label small fw-semibold">{t('elections.description', { defaultValue: 'What learners should know about it' })}</label>
          <textarea className="form-control form-control-sm" rows={2} value={values.description} onChange={set('description')} />
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold">{t('elections.year', { defaultValue: 'Academic year' })}</label>
          <select className="form-select form-select-sm" value={values.academic_year_id} onChange={set('academic_year_id')}>
            <option value="">—</option>
            {(years.data || []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold">{t('elections.opens', { defaultValue: 'Opens' })}</label>
          <input type="datetime-local" className="form-control form-control-sm" value={values.start_at} onChange={set('start_at')} />
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold">{t('elections.closes', { defaultValue: 'Closes' })}</label>
          <input type="datetime-local" className="form-control form-control-sm" value={values.end_at} onChange={set('end_at')} />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold">{t('elections.timezone', { defaultValue: 'Timezone' })}</label>
          <select className="form-select form-select-sm" value={values.timezone} onChange={set('timezone')}>
            {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </div>
        <div className="col-12 col-md-6 d-flex align-items-center">
          <div className="form-check">
            <input className="form-check-input" type="checkbox" id="election-live-results" checked={values.student_live_results_enabled} onChange={set('student_live_results_enabled')} />
            <label className="form-check-label small" htmlFor="election-live-results">
              {t('elections.showLiveToStudents', { defaultValue: 'Learners may see live vote counts while voting is open' })}
            </label>
            <div className="small text-muted">{t('elections.showLiveHint', { defaultValue: 'Off until after closing if unchecked. Turnout counts stay visible either way.' })}</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── Live, participation, reports, history, audit ─────────────────────────── */

function LiveTab({ scoreboard, turnout, election, loading, t }) {
  if (!election) return <Spinner />;
  if (loading && !scoreboard.length) return <Spinner />;
  const hideForStudents = election.status === 'active' && !election.student_live_results_enabled;
  return (
    <>
      {hideForStudents && (
        <div className="alert alert-info small d-flex align-items-center gap-2">
          <ShieldCheck size={14} />
          {t('elections.liveOffForStudents', { defaultValue: 'You can see these live counts. Learners will only see them if you allow live results, or after voting closes.' })}
        </div>
      )}
      <div className="row g-3">
        {scoreboard.map((position) => (
          <div className="col-12 col-xl-6" key={position.position_id}>
            <ChartCard title={t('elections.votesBar', { defaultValue: 'Votes' })} subtitle={position.position_name}>
              <BarView labels={position.candidates.map((c) => c.full_name)}
                datasets={[{ label: t('elections.votes', { defaultValue: 'Votes' }), data: position.candidates.map((c) => c.votes) }]} />
            </ChartCard>
          </div>
        ))}
        {scoreboard.map((position) => (
          <div className="col-12 col-xl-6" key={`share-${position.position_id}`}>
            <ChartCard title={t('elections.shareDonut', { defaultValue: 'Share of valid votes' })} subtitle={position.position_name}>
              <DoughnutView labels={position.candidates.map((c) => c.full_name)} data={position.candidates.map((c) => c.votes)} />
            </ChartCard>
          </div>
        ))}
        <div className="col-12 col-xl-6">
          <ChartCard title={t('elections.participationChart', { defaultValue: 'Participation' })}
            subtitle={`${turnout.voted ?? 0} / ${turnout.eligible ?? 0}`}>
            <DoughnutView labels={[t('elections.voted', { defaultValue: 'Voted' }), t('elections.notVoted', { defaultValue: 'Not voted' })]}
              data={[turnout.voted ?? 0, turnout.not_voted ?? 0]} />
          </ChartCard>
        </div>
        <div className="col-12 col-xl-6">
          <ChartCard title={t('elections.positionCompare', { defaultValue: 'Valid votes per seat' })}>
            <BarView labels={scoreboard.map((p) => p.position_name)}
              datasets={[{ label: t('elections.votes', { defaultValue: 'Votes' }), data: scoreboard.map((p) => p.total_valid_votes), backgroundColor: '#4c1fe0' }]} />
          </ChartCard>
        </div>
        <div className="col-12 col-xl-6">
          <ChartCard title={t('elections.classTurnout', { defaultValue: 'Turnout by class' })}>
            <BarView labels={(turnout.by_class || []).map((row) => row.name || '—')}
              datasets={[
                { label: t('elections.eligible', { defaultValue: 'Eligible' }), data: (turnout.by_class || []).map((row) => row.eligible), backgroundColor: '#64748b' },
                { label: t('elections.voted', { defaultValue: 'Voted' }), data: (turnout.by_class || []).map((row) => row.voted), backgroundColor: '#22c55e' },
              ]} />
          </ChartCard>
        </div>
        <div className="col-12 col-xl-6">
          <ChartCard title={t('elections.genderTurnout', { defaultValue: 'Turnout by gender' })}>
            <DoughnutView labels={(turnout.by_gender || []).map((row) => row.group || '—')} data={(turnout.by_gender || []).map((row) => row.voted)} />
          </ChartCard>
        </div>
      </div>
    </>
  );
}

function ParticipationTab({ turnout, loading, t }) {
  if (loading && !turnout.eligible) return <Spinner />;
  const rows = [...(turnout.by_class || []), ...(turnout.by_gender || [])];
  return (
    <>
      <div className="row g-3 mb-3">
        <div className="col-6 col-md-3"><StatCard label={t('elections.eligible', { defaultValue: 'Eligible' })} value={turnout.eligible ?? 0} icon={Users} /></div>
        <div className="col-6 col-md-3"><StatCard label={t('elections.voted', { defaultValue: 'Voted' })} value={turnout.voted ?? 0} icon={Vote} tone="ok" /></div>
        <div className="col-6 col-md-3"><StatCard label={t('elections.notVoted', { defaultValue: 'Not voted' })} value={turnout.not_voted ?? 0} icon={Ban} tone="danger" /></div>
        <div className="col-6 col-md-3"><StatCard label={t('elections.turnout', { defaultValue: 'Turnout' })} value={`${turnout.percentage ?? 0}%`} icon={BarChart3} tone="info" /></div>
      </div>
      <Section title={t('elections.groupsTitle', { defaultValue: 'Turnout by group' })}
        subtitle={t('elections.secrecyNote', { defaultValue: 'Groups only. Nothing here connects a learner to a choice — that is how the ballot stays secret.' })}>
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead><tr className="small text-muted"><th>{t('elections.group', { defaultValue: 'Group' })}</th><th>{t('elections.eligible', { defaultValue: 'Eligible' })}</th><th>{t('elections.voted', { defaultValue: 'Voted' })}</th><th>{t('elections.turnout', { defaultValue: 'Turnout' })}</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="text-muted small">{t('elections.nothingToCount', { defaultValue: 'Nothing to count yet.' })}</td></tr>}
              {rows.map((row, index) => (
                <tr key={`${row.group}-${index}`}>
                  <td className="small fw-semibold">{row.name || row.group}</td>
                  <td className="small">{row.eligible}</td>
                  <td className="small">{row.voted}</td>
                  <td style={{ minWidth: '9rem' }}>
                    <div className="d-flex align-items-center gap-2">
                      <div className="progress flex-grow-1" style={{ height: 6 }}>
                        <div className="progress-bar" style={{ width: `${Math.min(100, row.percentage)}%` }} />
                      </div>
                      <span className="small text-muted">{row.percentage}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

const REPORTS = [
  ['results.pdf', 'Result sheet (PDF)', FileText, 'elections/export-results-pdf'],
  ['full-report.pdf', 'Full report with manifestos (PDF)', FileText, 'elections/export-full-pdf'],
  ['declaration.pdf', 'Declaration of officeholders (PDF)', Trophy, 'elections/export-declaration-pdf'],
  ['participation.pdf', 'Participation report (PDF)', Users, 'elections/export-participation-pdf'],
  ['results.csv', 'Results (CSV)', FileSpreadsheet, 'elections/export-results-csv'],
  ['candidates.csv', 'Candidate list (CSV)', SquareUser, 'elections/export-candidates-csv'],
  ['participation.csv', 'Participation (CSV)', FileSpreadsheet, 'elections/export-participation-csv'],
  ['audit.csv', 'Audit trail (CSV)', ClipboardList, 'elections/export-audit-csv'],
  ['workbook.xlsx', 'Everything in one spreadsheet', FileSpreadsheet, 'elections/export-workbook'],
];

function ReportsTab({ election, canExport, scoreboard, t }) {
  const [saving, setSaving] = useState('');
  if (!election) return <Spinner />;
  const download = async (file) => {
    setSaving(file);
    try {
      await downloadFile(`/school/elections/${election.id}/reports/${file}`, `${String(election.id).slice(0, 8)}-${file}`);
    } catch (error) {
      toast.error(error.message || String(error));
    } finally {
      setSaving('');
    }
  };
  const print = () => window.print();
  return (
    <>
      {scoreboard.map((position) => (
        <Section key={position.position_id} title={`${position.position_name} — ${position.total_valid_votes} ${t('elections.validVotes', { defaultValue: 'valid votes' })}`}
          subtitle={t('elections.reportNote', { defaultValue: 'School name, election title, candidates, votes, percentages and totals. Never a voter.' })}>
          <div className="table-responsive">
            <table className="table mb-0 small align-middle">
              <thead><tr className="text-muted"><th>#</th><th>{t('elections.candidate', { defaultValue: 'Candidate' })}</th><th>{t('elections.class', { defaultValue: 'Class' })}</th><th>{t('elections.votes', { defaultValue: 'Votes' })}</th><th>%</th><th>{t('elections.result', { defaultValue: 'Result' })}</th></tr></thead>
              <tbody>
                {position.candidates.map((candidate) => (
                  <tr key={candidate.candidate_id}>
                    <td>{candidate.ranking ?? '—'}</td>
                    <td className="fw-semibold">{candidate.full_name}</td>
                    <td>{candidate.class_name || '—'}</td>
                    <td>{candidate.votes}</td>
                    <td>{candidate.percentage}%</td>
                    <td>{candidate.status === 'tied' ? <Badge tone="warn">{t('elections.tied', { defaultValue: 'TIED' })}</Badge>
                      : candidate.status === 'winner' ? <Badge tone="ok">{t('elections.electedFinal', { defaultValue: 'ELECTED' })}</Badge>
                        : <Badge tone="neutral">{t('elections.notElected', { defaultValue: 'not elected' })}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}
      <Section title={t('elections.exports', { defaultValue: 'Export and print' })}
        subtitle={canExport ? t('elections.exportsHint', { defaultValue: 'Each file carries the school name and mark, the election title and window, and the same totals you see here.' })
          : t('elections.exportsLocked', { defaultValue: 'Exporting needs the elections.export permission.' })}>
        <div className="d-flex flex-wrap gap-2">
          {REPORTS.map(([file, label, Icon, key]) => (
            <button type="button" key={file} className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
              disabled={!canExport || saving === file} onClick={() => download(file)}>
              {saving === file ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
              {t(key, { defaultValue: label })}
            </button>
          ))}
          <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={print}>
            <Download size={14} /> {t('elections.print', { defaultValue: 'Print this page' })}
          </button>
        </div>
      </Section>
    </>
  );
}

function HistoryTab({ elections, t }) {
  const past = elections.filter((e) => e.status === 'closed' || e.status === 'cancelled');
  if (!past.length) return <EmptyState title={t('elections.noHistory', { defaultValue: 'No finished election yet' })} />;
  return (
    <Section title={t('elections.historyTitle', { defaultValue: 'Past elections' })} subtitle={t('elections.historyHint', { defaultValue: 'The tally is stored, so a finished election keeps its numbers even if the ballots are later archived.' })}>
      <div className="table-responsive">
        <table className="table mb-0 small align-middle">
          <thead><tr className="text-muted"><th>{t('elections.election', { defaultValue: 'Election' })}</th><th>{t('elections.status', { defaultValue: 'Status' })}</th><th>{t('elections.closedAt', { defaultValue: 'Closed' })}</th><th>{t('elections.ballots', { defaultValue: 'Ballots' })}</th><th>{t('elections.turnout', { defaultValue: 'Turnout' })}</th><th>{t('elections.resultsPublishedQ', { defaultValue: 'Published' })}</th></tr></thead>
          <tbody>
            {past.map((row) => (
              <tr key={row.id}>
                <td className="fw-semibold">{row.title}</td>
                <td><StatusBadge value={row.status} /></td>
                <td>{row.closed_at ? dateTime(row.closed_at) : '—'}</td>
                <td>{row.votes_cast}</td>
                <td>{row.turnout_percentage}%</td>
                <td>{row.results_published ? <Badge tone="ok">{t('common.yes', { defaultValue: 'yes' })}</Badge> : <Badge tone="neutral">{t('common.no', { defaultValue: 'no' })}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function AuditTab({ entries, loading, error, onRetry, t }) {
  if (error) return <GapNotice error={error} onRetry={onRetry} t={t} />;
  if (loading && !entries.length) return <Spinner />;
  return (
    <Section title={t('elections.auditTitle', { defaultValue: 'Everything that happened, in order' })}
      subtitle={t('elections.auditHint', { defaultValue: 'Who opened, paused, closed or cancelled the window, which decisions were taken and which reports were exported. Ballots are never listed here — only the fact that one was accepted.' })}>
      {entries.length === 0 ? <EmptyState title={t('elections.noAudit', { defaultValue: 'Nothing recorded yet.' })} /> : (
        <div className="table-responsive">
          <table className="table mb-0 small align-middle">
            <thead><tr className="text-muted"><th>{t('elections.at', { defaultValue: 'When' })}</th><th>{t('elections.action', { defaultValue: 'Action' })}</th><th>{t('elections.summary', { defaultValue: 'Summary' })}</th><th>{t('elections.actor', { defaultValue: 'Actor' })}</th></tr></thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="text-nowrap">{dateTime(entry.created_at)}</td>
                  <td><Badge tone={entry.status === 'success' ? 'neutral' : 'danger'}>{entry.action}</Badge></td>
                  <td>{entry.summary}</td>
                  <td className="text-muted">{entry.user_scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
