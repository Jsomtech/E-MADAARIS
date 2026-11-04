/**
 * The learner's election screen.
 *
 * Everything here is read from one endpoint that already knows the rules: only approved and
 * published candidates appear, only the signed-in learner's own participation is returned, and the
 * tally is included only when the school has allowed learners to see it. What this screen never
 * gets is the pairing of a learner with a choice — once a ballot is cast, not even its owner can
 * read it back. That is the secret ballot, enforced by what the API returns rather than by CSS.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  Award, Ban, CheckCircle2, Clock3, Eye, Flag, Loader2, Lock, Megaphone, RefreshCw,
  ShieldCheck, Trophy, Users, Vote, X,
} from 'lucide-react';
import { apiPost } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import {
  Badge, EmptyState, ErrorState, PageHeader, Spinner, dateTime,
} from '../../components/ui/Basics.jsx';
import { BarView, ChartCard } from '../../components/ui/Charts.jsx';
import { Modal } from '../../components/ui/Modal.jsx';

const ENDED_MESSAGE = 'Voting has officially ended. The election submission period is now closed. You can view the election results.';

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

/** Short, readable countdown — a learner should know how much of the window is left. */
function humanGap(ms) {
  const total = Math.max(0, Math.floor(ms));
  const days = Math.floor(total / 86_400_000);
  const hours = Math.floor((total % 86_400_000) / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * The server sends `now` with the window. Keeping the difference between the server clock and the
 * browser clock means the countdown flips at the same instant the database opens or closes voting,
 * even on a learner's device with a wrong clock.
 */
function useClock(nowIso) {
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    if (nowIso) setOffset(new Date(nowIso).getTime() - Date.now());
  }, [nowIso]);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return tick + offset;
}

export default function StudentElectionsPage() {
  const { t } = useTranslation();
  const view = useApi('/school/elections/current');
  const [selected, setSelected] = useState({});
  const [profile, setProfile] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sealed, setSealed] = useState(null);

  const data = view.data || {};
  const election = data.election || null;
  const positions = data.positions || [];
  const candidates = data.candidates || [];
  const myBallot = sealed || data.my_ballot || null;
  const results = data.results || [];
  const now = useClock(election?.now);

  /* A new election (or a refresh after voting) replaces the local "sealed" flag. */
  useEffect(() => {
    if (data.my_ballot) setSealed(data.my_ballot);
  }, [data.my_ballot]);

  useEffect(() => {
    setSelected({});
    setSealed(null);
  }, [election?.id]);

  /** Live counts move without a refresh, the same way the officer's screen does. */
  useEffect(() => {
    if (!election || election.status !== 'active') return undefined;
    const timer = setInterval(() => view.refetch(), 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [election?.id, election?.status]);

  const isOpen = election?.status === 'active' && new Date(election.start_at) <= new Date(now) && new Date(election.end_at) > new Date(now);
  const hasVoted = Boolean(myBallot?.has_voted);
  const canVote = Boolean(isOpen && !hasVoted);
  const ended = Boolean(election && (election.status === 'closed' || election.status === 'cancelled'
    || (election.status === 'active' && new Date(election.end_at) <= new Date(now))));

  const byPosition = useMemo(() => positions.map((position) => ({
    position,
    rows: candidates.filter((c) => c.position_id === position.id),
  })), [positions, candidates]);

  const answered = positions.filter((p) => selected[p.id]).length;
  const complete = answered === positions.length && positions.length > 0;

  const cast = async () => {
    setBusy(true);
    try {
      const res = await apiPost(`/school/elections/${election.id}/ballot`, {
        selections: positions.map((p) => ({ position_id: p.id, candidate_id: selected[p.id] })),
      });
      const receipt = res?.data || {};
      setSealed({ student_id: myBallot?.student_id || null, has_voted: true, submitted_at: receipt.submitted_at || new Date().toISOString() });
      setReviewOpen(false);
      setSelected({});
      toast.success(receipt.message || t('elections.voteRecorded', { defaultValue: 'Your ballot is recorded.' }));
      view.refetch();
    } catch (error) {
      // The backend rejects a late or duplicate ballot; say what it said rather than guess.
      setReviewOpen(false);
      toast.error(error.message || String(error));
      if (/already recorded|officially ended/i.test(String(error.message || ''))) view.refetch();
    } finally {
      setBusy(false);
    }
  };

  if (view.loading && !election) {
    return (
      <>
        <PageHeader title={t('elections.voteTitle', { defaultValue: 'Student council election' })} />
        <Spinner />
      </>
    );
  }
  if (view.error) {
    return (
      <>
        <PageHeader title={t('elections.voteTitle', { defaultValue: 'Student council election' })} />
        <ErrorState error={view.error} onRetry={view.reload} />
      </>
    );
  }
  if (!election) {
    return (
      <>
        <PageHeader title={t('elections.voteTitle', { defaultValue: 'Student council election' })} />
        <EmptyState
          icon={Vote}
          title={t('elections.noElectionLearner', { defaultValue: 'There is no election running' })}
          hint={t('elections.noElectionLearnerHint', { defaultValue: 'When your school opens a student council election, the candidates and the ballot appear here.' })}
        />
      </>
    );
  }

  const statusTone = election.status === 'active' ? 'ok' : election.status === 'paused' ? 'warn' : election.status === 'cancelled' ? 'danger' : 'info';
  const untilOpen = new Date(election.start_at).getTime() - now;
  const untilClose = new Date(election.end_at).getTime() - now;

  return (
    <>
      <PageHeader
        title={election.title}
        subtitle={election.description || t('elections.voteSubtitle', { defaultValue: 'One ballot, two seats, one vote for every eligible learner.' })}
        actions={(
          <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={view.reload}>
            <RefreshCw size={14} /> {t('common.refresh', { defaultValue: 'Refresh' })}
          </button>
        )}
      />

      <div className="card-soft p-3 mb-3">
        <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
          <Badge tone={statusTone}>{election.status}</Badge>
          {isOpen && <Badge tone="ok"><Clock3 size={11} /> {t('elections.closesIn', { defaultValue: 'closes in' })} {humanGap(untilClose)}</Badge>}
          {election.status === 'scheduled' && untilOpen > 0 && (
            <Badge tone="info"><Clock3 size={11} /> {t('elections.opensIn', { defaultValue: 'opens in' })} {humanGap(untilOpen)}</Badge>
          )}
          {hasVoted && <Badge tone="brand"><Lock size={11} /> {t('elections.yourVoteIn', { defaultValue: 'your ballot is sealed' })}</Badge>}
          <span className="small text-muted ms-auto">
            {t('elections.windowShort', {
              defaultValue: '{{open}} → {{close}} ({{zone}})',
              open: dateTime(election.start_at),
              close: dateTime(election.end_at),
              zone: election.timezone,
            })}
          </span>
        </div>
        <div className="small text-muted">
          {t('elections.secretNote', { defaultValue: 'Your ballot is secret. The school records that you voted, and the tallies below come from all ballots together — nobody, including the administrators, can see who you chose.' })}
        </div>
      </div>

      {election.status === 'paused' && (
        <div className="alert alert-warning small d-flex gap-2 align-items-start">
          <ShieldCheck size={16} className="flex-shrink-0 mt-1" />
          <div>{t('elections.pausedLearner', { defaultValue: 'Voting is paused by the school right now. The candidates are still shown — nothing you have read is lost, and the ballot reopens when they resume.' })}</div>
        </div>
      )}
      {election.status === 'cancelled' && (
        <div className="alert alert-danger small d-flex gap-2 align-items-start">
          <Ban size={16} className="flex-shrink-0 mt-1" />
          <div>
            <div className="fw-semibold">{t('elections.cancelledLearner', { defaultValue: 'This election was cancelled' })}</div>
            <div>{election.cancel_reason || t('elections.cancelledNoReason', { defaultValue: 'The school did not publish a reason.' })}</div>
          </div>
        </div>
      )}

      <WinnersBanner results={results} visible={data.rankings_visible && election.status === 'closed' && election.results_published} t={t} />

      {ended && !(data.rankings_visible && results.length) && (
        <div className="alert alert-secondary small d-flex gap-2 align-items-start">
          <Flag size={16} className="flex-shrink-0 mt-1" />
          <div>{election.status === 'cancelled' ? t('elections.cancelledBallot', { defaultValue: 'This election was cancelled, so no ballot can be accepted.' }) : t('elections.ended', { defaultValue: ENDED_MESSAGE })}</div>
        </div>
      )}

      {candidates.length === 0 && (
        <EmptyState
          icon={Megaphone}
          title={t('elections.noCandidatesYet', { defaultValue: 'No candidate has been published yet' })}
          hint={t('elections.noCandidatesYetHint', { defaultValue: 'Learners only see candidates the school has approved and published. Check back closer to the voting window.' })}
        />
      )}

      {candidates.length > 0 && (
        <>
          <div className="d-flex justify-content-between align-items-center gap-2 mb-2 flex-wrap">
            <div className="fw-semibold d-flex align-items-center gap-2">
              <Users size={16} /> {t('elections.meetCandidates', { defaultValue: 'The candidates' })}
            </div>
            {canVote && (
              <div className="small text-muted">
                {t('elections.pickOneEach', { defaultValue: 'Choose one learner for each seat, then confirm.' })}
              </div>
            )}
          </div>

          {byPosition.map(({ position, rows }) => (
            <div key={position.id} className="mb-4">
              <div className="elections-position-heading">
                {String(position.position_name || '').toUpperCase()} CANDIDATES
              </div>
              {rows.length === 0 ? (
                <div className="small text-muted mb-2">{t('elections.noStanding', { defaultValue: 'No one is standing for this seat yet.' })}</div>
              ) : (
                <div className="candidate-card-grid">
                  {rows.map((row) => (
                    <CandidateCard
                      key={row.id}
                      row={row}
                      position={position}
                      selectable={canVote}
                      selected={selected[position.id] === row.id}
                      onSelect={() => setSelected((current) => ({ ...current, [position.id]: row.id }))}
                      onProfile={() => setProfile({ row, position })}
                      votes={results.find((r) => r.position_id === position.id)?.candidates.find((c) => c.candidate_id === row.id) || null}
                      showVotes={Boolean(data.rankings_visible)}
                      t={t}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {canVote && (
        <div className="elections-ballot-bar">
          <div className="min-width-0">
            <div className="fw-semibold small">
              {t('elections.answeredSeats', { defaultValue: '{{done}} of {{total}} seats chosen', done: answered, total: positions.length })}
            </div>
            <div className="small text-muted">{t('elections.oneVoteOnly', { defaultValue: 'Once confirmed, a ballot cannot be changed — each learner votes once.' })}</div>
          </div>
          <button type="button" className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1" disabled={!complete} onClick={() => setReviewOpen(true)}>
            <Vote size={14} /> {t('elections.reviewBallot', { defaultValue: 'Review my ballot' })}
          </button>
        </div>
      )}

      {hasVoted && (
        <div className="card-soft p-4 mb-3 text-center">
          <div className="d-inline-flex align-items-center justify-content-center rounded-circle bg-success-subtle mb-2" style={{ width: 52, height: 52 }}>
            <CheckCircle2 size={26} className="text-success" />
          </div>
          <div className="fw-semibold">{t('elections.thankYou', { defaultValue: 'Your ballot is recorded' })}</div>
          <div className="small text-muted mt-1">
            {t('elections.sealedAt', { defaultValue: 'Submitted {{at}}. It is sealed — the school keeps the count, not your choices.', at: dateTime(myBallot?.submitted_at) })}
          </div>
        </div>
      )}

      {data.rankings_visible && results.length > 0 && (
        <>
          {results.map((position) => (
            <ChartCard
              key={position.position_id}
              title={`${position.position_name} — ${t('elections.liveTally', { defaultValue: 'votes' })}`}
              subtitle={t('elections.percentFormula', { defaultValue: 'Percentage is candidate votes divided by the valid votes for this seat.' })}
            >
              <BarView
                labels={position.candidates.map((c) => c.full_name)}
                datasets={[{ label: t('elections.votes', { defaultValue: 'Votes' }), data: position.candidates.map((c) => c.votes) }]}
              />
              <div className="mt-2">
                {position.candidates.map((c) => (
                  <div key={c.candidate_id} className="d-flex justify-content-between align-items-center small py-1 border-bottom">
                    <span className="fw-semibold">{c.full_name}</span>
                    <span className="d-flex align-items-center gap-2">
                      <span className="tabular-nums">{c.votes}</span>
                      <span className="tabular-nums text-muted">{c.percentage}%</span>
                      {c.status === 'tied' && <Badge tone="warn">{t('elections.tied', { defaultValue: 'TIED' })}</Badge>}
                      {c.status === 'winner' && <Badge tone="ok">{t('elections.leading', { defaultValue: 'leading' })}</Badge>}
                    </span>
                  </div>
                ))}
              </div>
            </ChartCard>
          ))}
          <div className="card-soft p-3 mb-3 small text-muted d-flex align-items-center gap-2">
            <Users size={14} />
            {t('elections.turnoutLine', {
              defaultValue: '{{voted}} of {{eligible}} eligible learners have voted ({{pct}}%).',
              voted: data.turnout?.voted ?? 0,
              eligible: data.turnout?.eligible ?? 0,
              pct: data.turnout?.percentage ?? 0,
            })}
          </div>
        </>
      )}

      {!data.rankings_visible && !ended && (
        <div className="alert alert-light border small d-flex gap-2 align-items-start">
          <Eye size={15} className="flex-shrink-0 mt-1" />
          <div>{t('elections.resultsLater', { defaultValue: 'Counts stay hidden from learners until the school publishes the results.' })}</div>
        </div>
      )}

      {profile && <ProfileModal state={profile} onClose={() => setProfile(null)} t={t} />}

      {reviewOpen && (
        <Modal open onClose={() => (busy ? null : setReviewOpen(false))} size="md" icon={ShieldCheck}
          title={t('elections.reviewTitle', { defaultValue: 'Check your ballot before you confirm' })}
          subtitle={t('elections.reviewHint', { defaultValue: 'This is the last look. A confirmed ballot is sealed and cannot be changed by you or by the school.' })}
          footer={(
            <>
              <button type="button" className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => setReviewOpen(false)}>
                <X size={14} className="me-1" /> {t('common.cancel')}
              </button>
              <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" disabled={busy || !complete} onClick={cast}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {t('elections.confirmBallot', { defaultValue: 'Confirm and cast my ballot' })}
              </button>
            </>
          )}>
          {positions.map((position) => {
            const chosen = candidates.find((c) => c.id === selected[position.id]);
            return (
              <div key={position.id} className="d-flex justify-content-between align-items-start gap-3 py-2 border-bottom">
                <div className="small text-muted">{position.position_name}</div>
                <div className="text-end">
                  <div className="fw-semibold">{chosen?.full_name || '—'}</div>
                  <div className="small text-muted">{chosen?.campaign_title || chosen?.class_name || ''}</div>
                </div>
              </div>
            );
          })}
        </Modal>
      )}
    </>
  );
}

function CandidateCard({ row, position, selectable, selected, onSelect, onProfile, votes, showVotes, t }) {
  const shortIntro = String(row.introduction || '').slice(0, 150);
  return (
    <div className={`candidate-card ${selected ? 'is-selected' : ''}`} role={selectable ? 'button' : undefined} tabIndex={selectable ? 0 : -1}
      onKeyDown={(e) => { if (selectable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(); } }}
      onClick={selectable ? onSelect : undefined}>
      <div className="d-flex gap-3 align-items-start">
        <div className="avatar lg flex-shrink-0">
          {row.photograph_url ? <img src={row.photograph_url} alt="" /> : initials(row.full_name)}
        </div>
        <div className="min-width-0 flex-grow-1">
          <div className="fw-semibold text-truncate">{row.full_name}</div>
          <div className="small text-muted">
            {[row.class_name, row.gender].filter(Boolean).join(' · ') || t('elections.classUnknown', { defaultValue: 'class not recorded' })}
          </div>
          <div className="small text-muted">{position.position_name}</div>
        </div>
        {selectable && (
          <span className={`elections-radio ${selected ? 'is-on' : ''}`} aria-hidden="true">
            {selected ? <CheckCircle2 size={18} /> : <CirclePlaceholder />}
          </span>
        )}
      </div>

      {row.campaign_title && (
        <div className="elections-campaign-title mt-2">
          <Megaphone size={13} /> {row.campaign_title}
        </div>
      )}
      {shortIntro && <div className="small text-muted mt-2 elections-clamp">{shortIntro}{String(row.introduction || '').length > 150 ? '…' : ''}</div>}

      {(row.manifestos || []).length > 0 && (
        <ul className="elections-manifesto mt-2">
          {row.manifestos.slice(0, 3).map((point, index) => <li key={index}>{point}</li>)}
          {row.manifestos.length > 3 && <li className="text-muted">{t('elections.morePromises', { defaultValue: '+{{n}} more in the full profile', n: row.manifestos.length - 3 })}</li>}
        </ul>
      )}

      {showVotes && votes && (
        <div className="d-flex justify-content-between align-items-center mt-2 small">
          <span className="fw-semibold tabular-nums">{votes.votes} {t('elections.votes', { defaultValue: 'votes' })}</span>
          <span className="tabular-nums text-muted">{votes.percentage}%</span>
        </div>
      )}

      <button type="button" className="btn btn-sm btn-outline-secondary w-100 mt-2 d-inline-flex align-items-center justify-content-center gap-1" onClick={(e) => { e.stopPropagation(); onProfile(); }}>
        <Eye size={14} /> {t('elections.viewFullProfile', { defaultValue: 'View full profile' })}
      </button>
    </div>
  );
}

function CirclePlaceholder() {
  return <span className="elections-radio-empty" aria-hidden="true" />;
}

function ProfileModal({ state, onClose, t }) {
  const { row, position } = state;
  return (
    <Modal open onClose={onClose} size="md" icon={Award} title={row.full_name} subtitle={`${position.position_name} · ${row.class_name || t('elections.classUnknown', { defaultValue: 'class not recorded' })}`}
      footer={<button type="button" className="btn btn-sm btn-primary" onClick={onClose}>{t('common.close')}</button>}>
      <div className="d-flex gap-3 align-items-center mb-3">
        <div className="avatar lg">{row.photograph_url ? <img src={row.photograph_url} alt="" /> : initials(row.full_name)}</div>
        <div className="small text-muted">
          <div>{[row.class_name, row.gender].filter(Boolean).join(' · ')}</div>
          {row.campaign_title && <div className="fw-semibold text-body mt-1">{row.campaign_title}</div>}
        </div>
      </div>

      {row.introduction && (
        <>
          <div className="fw-semibold small mb-1">{t('elections.aboutCandidate', { defaultValue: 'About this candidate' })}</div>
          <div className="small text-muted mb-3" style={{ whiteSpace: 'pre-line' }}>{row.introduction}</div>
        </>
      )}

      <div className="fw-semibold small mb-1">{t('elections.manifesto', { defaultValue: 'Campaign promises' })}</div>
      {(row.manifestos || []).length
        ? (
          <ol className="elections-manifesto-list">
            {row.manifestos.map((point, index) => <li key={index}>{point}</li>)}
          </ol>
        )
        : <div className="small text-muted">{t('elections.noManifesto', { defaultValue: 'This candidate has not published any points yet.' })}</div>}
    </Modal>
  );
}

function WinnersBanner({ results, visible, t }) {
  if (!visible) return null;
  const winners = results.map((position) => {
    const leader = position.candidates.find((c) => c.status === 'winner');
    const tied = position.candidates.filter((c) => c.status === 'tied');
    return { position, leader, tied };
  });
  if (!winners.some((w) => w.leader || w.tied.length)) return null;
  return (
    <div className="card-soft p-3 mb-3">
      <div className="fw-semibold d-flex align-items-center gap-2 mb-2"><Trophy size={16} /> {t('elections.electedOfficers', { defaultValue: 'The elected student council' })}</div>
      <div className="row g-3">
        {winners.map(({ position, leader, tied }) => (
          <div className="col-12 col-md-6" key={position.position_id}>
            {leader ? (
              <div className="elections-winner">
                <div className="avatar lg flex-shrink-0">
                  {leader.photograph_url ? <img src={leader.photograph_url} alt="" /> : initials(leader.full_name)}
                </div>
                <div className="min-width-0">
                  <div className="small text-muted">{position.position_name}</div>
                  <div className="fw-semibold">{leader.full_name}</div>
                  <div className="small text-muted">
                    {leader.class_name ? `${leader.class_name} · ` : ''}
                    {t('elections.winnerTally', { defaultValue: '{{votes}} votes ({{pct}}%)', votes: leader.votes, pct: leader.percentage })}
                  </div>
                </div>
                <Badge tone="ok" className="ms-auto"><Award size={11} /> {t('elections.electedFinal', { defaultValue: 'ELECTED' })}</Badge>
              </div>
            ) : tied.length ? (
              <div className="elections-winner is-tied">
                <div className="min-width-0">
                  <div className="small text-muted">{position.position_name}</div>
                  <div className="fw-semibold">{t('elections.tieTitle', { defaultValue: 'No winner yet — the seats are tied' })}</div>
                  <div className="small text-muted">{tied.map((c) => `${c.full_name} (${c.votes})`).join(' · ')}</div>
                </div>
                <Badge tone="warn" className="ms-auto">{t('elections.tied', { defaultValue: 'TIED' })}</Badge>
              </div>
            ) : (
              <div className="small text-muted">{position.position_name}: {t('elections.noValidVotes', { defaultValue: 'no valid votes recorded' })}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
