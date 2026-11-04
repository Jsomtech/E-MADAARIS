/**
 * Platform-level election oversight.
 *
 * A Super Admin switches the module on or off for a school, watches every school's elections in
 * aggregate, suspends or resumes a running election when a school asks them to, and can force the
 * opening/closing clock to tick right now. There is deliberately no endpoint here that writes a
 * vote count, edits a candidate or deletes a ballot: results come out of election_ballot_selections
 * through the same service the school uses, so a platform intervention can never change an outcome.
 *
 * Schools stay separate. Every per-school read here takes a school id and filters by it; the
 * cross-school view returns one row per school and nothing that mixes two tenants' learners.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireDb } from '../../config/supabase.js';
import { ApiError } from '../../middleware/error.js';
import { requireSuperAdmin } from '../../middleware/rbac.js';
import { audit } from '../../services/audit.js';
import { electionsSchemaReady } from '../../services/schemaSupport.js';
import {
  buildResults, eligibleStudents, electionPositions, participationStats, saveResults, votableStudents, votedStudentIds,
} from '../../services/elections.js';
import { electionSchedulerState, runElectionTick } from '../../services/electionScheduler.js';

export const platformElectionsRouter = Router();

const uuid = z.string().uuid();

async function gate(req, res, next) {
  try {
    if (!(await electionsSchemaReady())) {
      throw new ApiError(503, 'Student council elections need supabase/migrations/0022_elections.sql applied first.');
    }
    next();
  } catch (e) { next(e); }
}

platformElectionsRouter.use(requireSuperAdmin, gate);

/** The school's election switches, with defaults filled in so the UI never has to guess. */
function readElectionConfig(raw) {
  const config = raw || {};
  return {
    enabled: config.enabled !== false,
    auto_publish_results: config.auto_publish_results !== false,
    updated_at: config.updated_at || null,
  };
}

async function schoolConfigRow(supabase, schoolId) {
  const { data, error } = await supabase.from('school_settings')
    .select('id, election_configuration').eq('school_id', schoolId).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'School settings missing for that school');
  return data;
}

/** Aggregate counts for one election — never a ballot, never a voter. */
async function electionSummary(supabase, election) {
  const [positions, roll, voted] = await Promise.all([
    electionPositions(supabase, election.id),
    eligibleStudents(supabase, election.school_id),
    votedStudentIds(supabase, election.school_id, election.id),
  ]);
  const scoreboard = await buildResults(supabase, { schoolId: election.school_id, election, positions });
  const turnout = participationStats(votableStudents(roll), voted);
  return {
    ...election,
    turnout,
    candidates_total: scoreboard.reduce((sum, p) => sum + p.candidates.length, 0),
    tied_positions: scoreboard.filter((p) => p.tied).map((p) => p.position_name),
    leaders: scoreboard.map((p) => ({
      position_name: p.position_name,
      position_key: p.position_key,
      total_valid_votes: p.total_valid_votes,
      tied: p.tied,
      leader: p.candidates[0] ? { full_name: p.candidates[0].full_name, votes: p.candidates[0].votes, percentage: p.candidates[0].percentage } : null,
    })),
  };
}

platformElectionsRouter.get('/overview', async (req, res, next) => {
  try {
    const supabase = requireDb();
    const [{ data: elections, error }, { data: settings }, { count: ballotsTotal, error: ballotError }, { data: participation }] = await Promise.all([
      supabase.from('elections')
        .select('id, school_id, title, status, start_at, end_at, opened_at, closed_at, results_published, student_live_results_enabled, timezone')
        .order('start_at', { ascending: false }).limit(2000),
      supabase.from('school_settings').select('school_id, election_configuration').limit(5000),
      supabase.from('election_ballots').select('id', { count: 'exact', head: true }),
      supabase.from('election_voter_participation').select('election_id, school_id').limit(200000),
    ]);
    if (error) throw new ApiError(500, error.message);
    if (ballotError) throw new ApiError(500, ballotError.message);

    const rows = elections || [];
    const byStatus = {};
    for (const row of rows) byStatus[row.status] = (byStatus[row.status] || 0) + 1;

    const configs = new Map((settings || []).map((s) => [s.school_id, readElectionConfig(s.election_configuration)]));
    const ballotsBySchool = new Map();
    for (const row of participation || []) ballotsBySchool.set(row.school_id, (ballotsBySchool.get(row.school_id) || 0) + 1);

    const schoolIds = [...new Set(rows.map((e) => e.school_id))];
    const { data: schools } = schoolIds.length
      ? await supabase.from('schools').select('id, school_name, status').in('id', schoolIds).limit(1000)
      : { data: [] };

    res.json({
      data: {
        scheduler: electionSchedulerState(),
        schools_with_elections: schoolIds.length,
        module_enabled_for: [...configs.values()].filter((c) => c.enabled).length,
        module_disabled_for: [...configs.values()].filter((c) => !c.enabled).length,
        total_elections: rows.length,
        total_ballots_recorded: ballotsTotal ?? 0,
        elections_by_status: byStatus,
        open_now: rows.filter((e) => e.status === 'active'),
        awaiting_results_publication: rows.filter((e) => e.status === 'closed' && !e.results_published),
        schools: (schools || []).map((school) => {
          const own = rows.filter((e) => e.school_id === school.id);
          return {
            school_id: school.id,
            school_name: school.school_name,
            school_status: school.status,
            config: configs.get(school.id) || { enabled: true, auto_publish_results: true, updated_at: null },
            elections_total: own.length,
            elections_active: own.filter((e) => e.status === 'active').length,
            elections_closed: own.filter((e) => e.status === 'closed').length,
            ballots_recorded: ballotsBySchool.get(school.id) || 0,
          };
        }),
      },
    });
  } catch (e) { next(e); }
});

platformElectionsRouter.patch('/schools/:schoolId', async (req, res, next) => {
  try {
    const { schoolId } = z.object({ schoolId: uuid }).parse(req.params);
    const body = z.object({
      enabled: z.boolean().optional(),
      auto_publish_results: z.boolean().optional(),
      reason: z.string().trim().min(3).max(500),
    }).parse(req.body);

    const supabase = requireDb();
    const current = await schoolConfigRow(supabase, schoolId);
    const nextConfig = {
      ...readElectionConfig(current.election_configuration),
      ...body.enabled !== undefined ? { enabled: body.enabled } : {},
      ...body.auto_publish_results !== undefined ? { auto_publish_results: body.auto_publish_results } : {},
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('school_settings')
      .update({ election_configuration: nextConfig }).eq('id', current.id);
    if (error) throw new ApiError(500, error.message);

    await audit(req, {
      module: 'elections', action: 'platform_module_configured', recordId: schoolId,
      summary: `Election module for school ${schoolId}: enabled=${nextConfig.enabled}, auto_publish_results=${nextConfig.auto_publish_results}`,
      metadata: { config: nextConfig, reason: body.reason },
    });
    res.json({ data: { school_id: schoolId, config: nextConfig } });
  } catch (e) { next(e); }
});

platformElectionsRouter.get('/schools/:schoolId/elections', async (req, res, next) => {
  try {
    const { schoolId } = z.object({ schoolId: uuid }).parse(req.params);
    const supabase = requireDb();
    const [{ data: elections, error }, configRow] = await Promise.all([
      supabase.from('elections')
        .select('id, school_id, title, description, start_at, end_at, timezone, status, opened_at, closed_at, results_published, cancel_reason, resolution_note, academic_year_id')
        .eq('school_id', schoolId).order('start_at', { ascending: false }).limit(200),
      schoolConfigRow(supabase, schoolId),
    ]);
    if (error) throw new ApiError(500, error.message);
    const summaries = [];
    for (const election of elections || []) summaries.push(await electionSummary(supabase, election));
    res.json({ data: { school_id: schoolId, config: readElectionConfig(configRow.election_configuration), elections: summaries } });
  } catch (e) { next(e); }
});

platformElectionsRouter.get('/elections/:electionId', async (req, res, next) => {
  try {
    const { electionId } = z.object({ electionId: uuid }).parse(req.params);
    const supabase = requireDb();
    const { data: election, error } = await supabase.from('elections')
      .select('id, school_id, title, description, start_at, end_at, timezone, status, opened_at, closed_at, results_published, cancel_reason, resolution_note, academic_year_id')
      .eq('id', electionId).maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!election) throw new ApiError(404, 'Election not found');
    res.json({ data: await electionSummary(supabase, election) });
  } catch (e) { next(e); }
});

/**
 * Suspending and resuming is the one write a platform user may make to a running election, and it
 * only ever changes the window's state — never a tally. A reason is mandatory and audited.
 */
const PLATFORM_TRANSITIONS = {
  suspend: { from: ['scheduled', 'active'], to: 'paused' },
  resume: { from: ['paused'], to: 'active' },
  close: { from: ['active', 'paused'], to: 'closed' },
};

platformElectionsRouter.post('/elections/:electionId/intervene', async (req, res, next) => {
  try {
    const { electionId } = z.object({ electionId: uuid }).parse(req.params);
    const body = z.object({
      action: z.enum(['suspend', 'resume', 'close']),
      reason: z.string().trim().min(3).max(500),
    }).parse(req.body);

    const supabase = requireDb();
    const { data: election, error: readError } = await supabase.from('elections')
      .select('id, school_id, title, status, end_at').eq('id', electionId).maybeSingle();
    if (readError) throw new ApiError(500, readError.message);
    if (!election) throw new ApiError(404, 'Election not found');

    const rule = PLATFORM_TRANSITIONS[body.action];
    if (!rule.from.includes(election.status)) {
      throw new ApiError(409, `An election that is ${election.status} cannot be ${body.action === 'close' ? 'closed' : body.action + 'ed'} from the platform.`);
    }
    if (body.action === 'resume' && new Date(election.end_at) <= new Date()) {
      throw new ApiError(422, 'The closing time has already passed, so this election can only be closed.');
    }

    const patch = { status: rule.to };
    if (body.action === 'close') patch.closed_at = new Date().toISOString();
    const { data, error } = await supabase.from('elections').update(patch).eq('id', election.id)
      .select('id, status, closed_at').single();
    if (error) throw new ApiError(500, error.message);

    if (body.action === 'close') {
      const positions = await electionPositions(supabase, election.id);
      await saveResults(supabase, { schoolId: election.school_id, election: { ...election, ...patch }, positions, status: 'final' });
    }

    await audit(req, {
      module: 'elections', action: `platform_election_${body.action}`, recordId: election.id,
      summary: `Platform ${body.action}ed ${election.title} (${election.school_id})`,
      metadata: { reason: body.reason, previous_status: election.status },
    });
    res.json({ data });
  } catch (e) { next(e); }
});

/** Runs the open/close clock immediately instead of waiting for the next ten-second tick. */
platformElectionsRouter.post('/scheduler/tick', async (req, res, next) => {
  try {
    const result = await runElectionTick();
    await audit(req, {
      module: 'elections', action: 'platform_scheduler_tick',
      summary: `Manual election tick: opened ${result.opened ?? 0}, closed ${result.closed ?? 0}`,
      metadata: result,
    });
    res.json({ data: { result, scheduler: electionSchedulerState() } });
  } catch (e) { next(e); }
});
