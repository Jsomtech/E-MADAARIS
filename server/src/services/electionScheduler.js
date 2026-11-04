/**
 * Elections run on the clock, not on somebody being logged in.
 *
 * Every few seconds the API asks Postgres to flip scheduled elections whose start time has passed
 * and active/paused ones whose end time has passed. election_tick() does both flips in one
 * statement each and returns only the rows it actually changed, so two API processes ticking at the
 * same moment never close the same election twice — and if the API restarts, or no administrator
 * ever opens the page, the window still closes on time.
 *
 * Closing is what makes the tally official: the final scoreboard is written to election_results
 * and learners are told, using the same service functions the administrator's buttons use, so a
 * clock-driven close and a manual close cannot produce different numbers.
 */
import { db } from '../config/supabase.js';
import { logger } from '../middleware/error.js';
import { electionsSchemaReady } from './schemaSupport.js';
import {
  adminUserIds, electionPositions, notifyRecipients, saveResults, studentUserIds,
} from './elections.js';

const TICK_MS = 10_000;

let running = false;
let stats = { rounds: 0, opened: 0, closed: 0, last_round_at: null, last_error: null };

async function systemAudit({ schoolId, recordId, action, summary, metadata = {} }) {
  try {
    await db().from('audit_logs').insert({
      school_id: schoolId,
      user_id: null,
      user_scope: 'system',
      action,
      module: 'elections',
      record_id: String(recordId),
      summary,
      ip_address: null,
      metadata,
      status: 'success',
    });
  } catch (err) {
    logger.warn(`elections audit entry not written (${err.message})`);
  }
}

/** One sentence per seat, built only from aggregate counts. */
function resultsSummary(scoreboard) {
  return scoreboard.map((position) => {
    if (position.tied) {
      return `${position.position_name}: tied on ${position.total_valid_votes} votes — the school must record how the tie is resolved.`;
    }
    const winner = position.winner;
    if (!winner) return `${position.position_name}: no votes were cast.`;
    return `${position.position_name}: ${winner.full_name} — ${winner.votes} votes (${winner.percentage}%)`;
  }).join('\n');
}

async function handleOpened(supabase, ids) {
  if (!ids.length) return;
  const { data: elections } = await supabase.from('elections')
    .select('id, school_id, title, end_at').in('id', ids).limit(200);
  for (const election of elections || []) {
    await notifyRecipients(supabase, await studentUserIds(supabase, election.school_id), {
      schoolId: election.school_id, category: 'elections',
      title: `Voting is open: ${election.title}`,
      body: 'Cast your ballot now — each learner votes once.',
      link: '/school/student-elections',
    });
    await systemAudit({
      schoolId: election.school_id, recordId: election.id, action: 'election_auto_opened',
      summary: `Voting opened automatically for ${election.title}`, metadata: { end_at: election.end_at },
    });
    stats.opened += 1;
    logger.info(`elections: voting opened automatically for ${election.title}`);
  }
}

async function handleClosed(supabase, ids) {
  if (!ids.length) return;
  const { data: elections } = await supabase.from('elections')
    .select('id, school_id, title, status, results_published').in('id', ids).limit(200);
  for (const election of elections || []) {
    const schoolId = election.school_id;
    const positions = await electionPositions(supabase, election.id);
    const scoreboard = await saveResults(supabase, { schoolId, election, positions, status: 'final' });
    const summary = resultsSummary(scoreboard);
    const tied = scoreboard.filter((p) => p.tied);

    // A final tally is only useful if somebody can see it, so the clock publishes it too. A school
    // that wants to hold results back switches auto_publish_results off in its election settings;
    // the administrator can then publish by hand whenever they choose.
    const { data: settings } = await supabase.from('school_settings')
      .select('election_configuration').eq('school_id', schoolId).maybeSingle();
    const autoPublish = (settings?.election_configuration || {}).auto_publish_results !== false;
    if (autoPublish) {
      const { error } = await supabase.from('elections').update({ results_published: true })
        .eq('id', election.id).eq('school_id', schoolId);
      if (error) logger.warn(`elections: results not published for ${election.title} (${error.message})`);
    }

    await notifyRecipients(supabase, await adminUserIds(supabase, schoolId), {
      schoolId, category: 'elections', title: `Voting closed: ${election.title}`,
      body: `${summary}\n\n${tied.length ? 'A seat is tied — record the resolution before announcing the council.' : 'Results are ready to review and export.'}`,
      link: '/m/elections',
    });
    if (autoPublish) {
      await notifyRecipients(supabase, await studentUserIds(supabase, schoolId), {
        schoolId, category: 'elections', title: `Election results are out: ${election.title}`,
        body: tied.length ? 'One seat is tied and needs a decision from the school.' : 'See who was elected.',
        link: '/school/student-elections',
      });
    }
    await systemAudit({
      schoolId, recordId: election.id, action: 'election_auto_closed',
      summary: `Voting closed automatically for ${election.title}`,
      metadata: { results_published: autoPublish, tied_positions: tied.map((p) => p.position_name), positions: scoreboard.map((p) => ({ position: p.position_name, total_valid_votes: p.total_valid_votes })) },
    });
    stats.closed += 1;
    logger.info(`elections: ${election.title} closed on the clock; final tally saved`);
  }
}

export async function runElectionTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    if (!(await electionsSchemaReady())) return { skipped: true, reason: 'schema' };
    const supabase = db();
    const { data: verdict, error } = await supabase.rpc('election_tick');
    if (error) throw new Error(error.message);
    const opened = Array.isArray(verdict?.opened_ids) ? verdict.opened_ids : [];
    const closed = Array.isArray(verdict?.closed_ids) ? verdict.closed_ids : [];
    stats.last_round_at = new Date().toISOString();
    if (!opened.length && !closed.length) return { ...verdict };
    await handleOpened(supabase, opened);
    await handleClosed(supabase, closed);
    return { opened: opened.length, closed: closed.length };
  } finally {
    stats.rounds += 1;
    running = false;
  }
}

/**
 * Recalculates the stored tally for elections that are already closed. The tick only ever returns
 * elections it flipped itself, so a tally written before the last ballot arrived needs a second
 * pass; the numbers always come from election_ballot_selections, never from what was stored.
 */
export async function reconcileClosedElections({ limit = 200 } = {}) {
  if (!(await electionsSchemaReady())) return { checked: 0 };
  const supabase = db();
  const { data: elections } = await supabase.from('elections')
    .select('id, school_id, title, status, results_published')
    .in('status', ['closed', 'cancelled'])
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: false }).limit(limit);
  let checked = 0;
  for (const election of elections || []) {
    const positions = await electionPositions(supabase, election.id);
    await saveResults(supabase, { schoolId: election.school_id, election, positions, status: 'final' });
    checked += 1;
  }
  return { checked };
}

export function electionSchedulerState() {
  return { ...stats, interval_ms: TICK_MS, running };
}

export function startElectionScheduler() {
  const timer = setInterval(() => {
    runElectionTick().catch((err) => {
      stats.last_error = err.message;
      logger.warn(`elections scheduler: ${err.message}`);
    });
  }, TICK_MS);
  timer.unref?.();
  return timer;
}
