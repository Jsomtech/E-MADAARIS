/**
 * Student Council Elections.
 *
 * Two kinds of caller use this router. An election officer (school_admin, or a principal with the
 * view grant) runs the election: schedule it, register candidates against real learner records,
 * approve and publish them, watch turnout, close it and publish results. A learner uses the same
 * router to read the candidates and to cast one ballot.
 *
 * What this file never does: put a ballot and a voter in the same response. Turnout is read from
 * election_voter_participation, rankings from election_ballot_selections, and the two are only ever
 * joined inside Postgres, inside election_cast_ballot().
 */
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { requireDb } from '../../config/supabase.js';
import { ApiError } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { audit } from '../../services/audit.js';
import { isPortalOnly } from '../../services/scopes.js';
import { assertSchoolRefs } from '../../services/tenantRefs.js';
import { electionsSchemaReady } from '../../services/schemaSupport.js';
import { IMAGE_MIME, sniffImage } from '../../core/images.js';
import { buildElectionWorkbook, participationRows, positionRows, sendCsv, streamElectionPdf } from '../../services/electionReports.js';
import {
  BALLOT_MESSAGES, DEFAULT_POSITIONS, ELECTION_MIGRATION, POSITION_KEYS, adminUserIds, buildResults,
  eligibleStudents, electionsEnabled, loadElection, electionPositions, notifyRecipients,
  participationStats, saveResults, studentUserIds, votableStudents, votedStudentIds,
} from '../../services/elections.js';

export const electionsRouter = Router();

const uuid = z.string().uuid();
const isoDate = z.string().min(4);
const ELECT_LINK = '/m/elections';

const asUtc = (value, label) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(422, `${label} is not a real date and time.`);
  return date.toISOString();
};

/** The one place that turns the function's verdict into an HTTP answer for the student. */
const ballotFailure = (verdict) => {
  const [message, status] = BALLOT_MESSAGES[verdict] || ['The ballot could not be accepted.', 500];
  return new ApiError(status, message);
};

electionsRouter.use(async (req, res, next) => {
  try {
    if (!(await electionsSchemaReady())) {
      throw new ApiError(503, `Student council elections need ${ELECTION_MIGRATION}. Run that file in the Supabase SQL editor, then reload this page.`);
    }
    next();
  } catch (e) { next(e); }
});

/** A school can be switched off from the platform; nobody in the school can turn it back on. */
async function requireEnabled(supabase, schoolId) {
  if (await electionsEnabled(supabase, schoolId)) return;
  throw new ApiError(403, 'The student council election module is switched off for this school by the platform administrator.');
}

/** Only the school's own election, and only its own positions. */
async function loadScoped(supabase, schoolId, electionId) {
  const election = await loadElection(supabase, schoolId, electionId);
  const positions = await electionPositions(supabase, electionId);
  return { election, positions };
}

const LOCKED = new Set(['active', 'paused', 'closed', 'cancelled']);

/**
 * "Once voting begins, candidate details and manifestos must be locked." A paused or closed
 * election is still past its opening moment, so it stays locked too.
 */
function assertEditable(election, what) {
  if (election.opened_at || LOCKED.has(election.status)) {
    throw new ApiError(409, `${what} are locked — voting for this election has already begun.`);
  }
}

async function turnoutFor(supabase, schoolId, electionIds) {
  if (!electionIds.length) return new Map();
  const { data, error } = await supabase.from('election_voter_participation')
    .select('election_id, student_id').eq('school_id', schoolId).in('election_id', electionIds).limit(50000);
  if (error) throw new ApiError(500, error.message);
  const counts = new Map();
  for (const row of data || []) counts.set(row.election_id, (counts.get(row.election_id) || 0) + 1);
  return counts;
}

// --- The officer's list -----------------------------------------------------------------------

electionsRouter.get('/', requirePermission('elections.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const [{ data: elections, error }, { data: candidates }] = await Promise.all([
      supabase.from('elections')
        .select('id, title, description, academic_year_id, start_at, end_at, timezone, status, student_live_results_enabled, results_published, opened_at, closed_at, created_at')
        .eq('school_id', schoolId).order('start_at', { ascending: false }).limit(200),
      supabase.from('election_candidates').select('election_id, position_id, application_status, is_published')
        .eq('school_id', schoolId).limit(5000),
    ]);
    if (error) throw new ApiError(500, error.message);
    const voted = await turnoutFor(supabase, schoolId, (elections || []).map((e) => e.id));
    const { data: roll } = await supabase.from('students').select('id').eq('school_id', schoolId).eq('status', 'active').limit(10000);
    const eligible = (roll || []).length;

    res.json({
      data: {
        enabled: await electionsEnabled(supabase, schoolId),
        eligible,
        elections: (elections || []).map((e) => {
          const rows = (candidates || []).filter((c) => c.election_id === e.id);
          return {
            ...e,
            candidates_total: rows.length,
            candidates_approved: rows.filter((c) => c.application_status === 'approved').length,
            candidates_pending: rows.filter((c) => c.application_status === 'pending').length,
            candidates_published: rows.filter((c) => c.is_published).length,
            votes_cast: voted.get(e.id) || 0,
            turnout_percentage: eligible ? Math.round(((voted.get(e.id) || 0) / eligible) * 10000) / 100 : 0,
          };
        }),
      },
    });
  } catch (e) { next(e); }
});

// --- What a learner is shown ------------------------------------------------------------------

/**
 * The election a signed-in learner should see: the one that is open now, otherwise the next one
 * scheduled, otherwise the last one that finished. Readable by officers too, which is how the
 * officer's preview uses the same code path a student does.
 */
electionsRouter.get('/current', requirePermission('elections.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    await requireEnabled(supabase, schoolId);

    const { data: rows, error } = await supabase.from('elections')
      .select('id, title, description, academic_year_id, start_at, end_at, timezone, status, student_live_results_enabled, results_published, opened_at, closed_at, cancel_reason')
      .eq('school_id', schoolId)
      .in('status', ['scheduled', 'active', 'paused', 'closed', 'cancelled'])
      .order('status', { ascending: true }).order('start_at', { ascending: false }).limit(20);
    if (error) throw new ApiError(500, error.message);

    // 'active' sorts before 'scheduled' alphabetically; pick by meaning, not by SQL order.
    const ordered = rows || [];
    const election = ordered.find((e) => e.status === 'active')
      || ordered.find((e) => e.status === 'paused')
      || ordered.find((e) => e.status === 'scheduled' && new Date(e.start_at) > new Date())
      || ordered.find((e) => e.status === 'scheduled')
      || ordered.find((e) => e.status === 'closed')
      // A cancelled election stays visible so the learner reads the reason instead of wondering.
      || ordered.find((e) => e.status === 'cancelled')
      || null;
    if (!election) {
      return res.json({ data: { election: null, positions: [], candidates: [], my_ballot: null, school: null, results: [] } });
    }

    const scoped = await loadScoped(supabase, schoolId, election.id);
    const { data: published, error: cErr } = await supabase.from('election_candidates')
      .select('id, position_id, student_id, campaign_title, introduction, photograph_url')
      .eq('election_id', election.id).eq('application_status', 'approved').eq('is_published', true).limit(500);
    if (cErr) throw new ApiError(500, cErr.message);

    const candidateRows = published || [];
    const { data: manifestos } = await supabase.from('candidate_manifestos')
      .select('candidate_id, promise_text, display_order').limit(5000)
      .in('candidate_id', candidateRows.length ? candidateRows.map((c) => c.id) : ['00000000-0000-0000-0000-000000000000']);
    const { data: learnerRows } = await supabase.from('students')
      .select('id, full_name, class_id, gender').eq('school_id', schoolId).limit(10000);
    const { data: classRows } = await supabase.from('classes').select('id, name').eq('school_id', schoolId);
    const learnerById = new Map((learnerRows || []).map((s) => [s.id, s]));
    const classById = new Map((classRows || []).map((c) => [c.id, c.name]));
    const promisesByCandidate = new Map();
    for (const m of manifestos || []) {
      const list = promisesByCandidate.get(m.candidate_id) || [];
      list.push(m);
      promisesByCandidate.set(m.candidate_id, list);
    }

    // A learner's own participation — never anyone else's.
    let myBallot = null;
    let eligibility = null;
    if (isPortalOnly(req.auth) || req.auth.roles?.includes('student')) {
      const { data: mine } = await supabase.from('students').select('id, status').eq('school_id', schoolId).eq('user_id', req.auth.userId).limit(1);
      const studentId = mine?.[0]?.id;
      // The ballot RPC refuses an account that is not an active enrolment. Saying so here, before a
      // learner fills in a ballot they cannot submit, is the difference between a locked screen and
      // a silent one.
      eligibility = { is_learner: true, on_voter_list: Boolean(studentId) && mine[0].status === 'active' };
      if (studentId) {
        const { data: part } = await supabase.from('election_voter_participation')
          .select('submitted_at').eq('election_id', election.id).eq('student_id', studentId).maybeSingle();
        myBallot = { student_id: studentId, has_voted: Boolean(part), submitted_at: part?.submitted_at || null };
      }
    }

    const showRankings = !isPortalOnly(req.auth)
      ? true
      : (election.status === 'closed' && election.results_published)
        || (election.status === 'active' && election.student_live_results_enabled);
    const scoreboard = await buildResults(supabase, { schoolId, election, positions: scoped.positions });
    const roll = votableStudents(await eligibleStudents(supabase, schoolId));
    const voted = await votedStudentIds(supabase, schoolId, election.id);
    const turnout = participationStats(roll, voted);

    res.json({
      data: {
        school: await schoolBranding(supabase, schoolId),
        election: { ...election, now: new Date().toISOString() },
        positions: scoped.positions,
        candidates: candidateRows.map((c) => {
          const learner = learnerById.get(c.student_id) || {};
          return {
            ...c,
            full_name: learner.full_name || '—',
            class_id: learner.class_id || null,
            class_name: classById.get(learner.class_id) || null,
            gender: learner.gender || null,
            manifestos: (promisesByCandidate.get(c.id) || [])
              .sort((a, b) => a.display_order - b.display_order)
              .map((m) => m.promise_text),
          };
        }),
        my_ballot: myBallot,
        eligibility,
        turnout: { eligible: turnout.eligible, voted: turnout.voted, not_voted: turnout.not_voted, percentage: turnout.percentage },
        results: showRankings
          // A learner's scoreboard lists the same people the ballot lists: an application that was
          // rejected, suspended or left unpublished has no place in what a voter is shown.
          ? scoreboard.map((position) => ({
            ...position,
            candidates: position.candidates.filter((c) => c.application_status === 'approved' && c.is_published),
          }))
          : [],
        rankings_visible: showRankings,
      },
    });
  } catch (e) { next(e); }
});

async function schoolBranding(supabase, schoolId) {
  const { data } = await supabase.from('schools').select('id, school_name, logo_url').eq('id', schoolId).maybeSingle();
  return data || null;
}

// --- Creating and configuring ------------------------------------------------------------------

electionsRouter.post('/', requirePermission('elections.create'), async (req, res, next) => {
  try {
    const body = z.object({
      title: z.string().trim().min(3).max(160),
      description: z.string().trim().max(4000).optional().nullable(),
      academic_year_id: uuid.optional().nullable(),
      start_at: isoDate,
      end_at: isoDate,
      timezone: z.string().trim().max(64).default('Africa/Mogadishu'),
      student_live_results_enabled: z.boolean().default(true),
      positions: z.array(z.object({
        key: z.enum(POSITION_KEYS),
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(1000).optional().nullable(),
      })).min(1).max(2).optional(),
    }).parse(req.body);

    const startAt = asUtc(body.start_at, 'Opening time');
    const endAt = asUtc(body.end_at, 'Closing time');
    if (new Date(endAt) <= new Date(startAt)) throw new ApiError(422, 'The closing time must be after the opening time.');

    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    await requireEnabled(supabase, schoolId);
    if (body.academic_year_id) await assertSchoolRefs(schoolId, { academic_year_id: [body.academic_year_id] }, { academic_year_id: 'academic_years' });

    const { data: election, error } = await supabase.from('elections').insert({
      school_id: schoolId,
      title: body.title,
      description: body.description || null,
      academic_year_id: body.academic_year_id || null,
      start_at: startAt,
      end_at: endAt,
      timezone: body.timezone,
      status: 'scheduled',
      student_live_results_enabled: body.student_live_results_enabled,
      created_by: req.auth.userId || null,
    }).select('id, title, description, academic_year_id, start_at, end_at, timezone, status, student_live_results_enabled, results_published, opened_at, closed_at, created_at').single();
    if (error) throw new ApiError(500, error.message);

    const chosen = (body.positions && body.positions.length) ? body.positions : DEFAULT_POSITIONS.map((p) => ({ key: p.key, name: p.name }));
    const unique = [...new Map(chosen.map((p) => [p.key, p])).values()];
    const orderOf = new Map(DEFAULT_POSITIONS.map((p, i) => [p.key, i + 1]));
    const { error: pErr } = await supabase.from('election_positions').insert(
      unique.map((p, index) => ({
        election_id: election.id, position_key: p.key, position_name: p.name,
        description: p.description || null, display_order: orderOf.get(p.key) || index + 1,
      })),
    );
    if (pErr) throw new ApiError(500, pErr.message);

    await audit(req, { module: 'elections', action: 'election_created', recordId: election.id, summary: `Election created: ${election.title}` });
    res.status(201).json({ data: { ...election, positions: await electionPositions(supabase, election.id) } });
  } catch (e) { next(e); }
});

electionsRouter.patch('/:id', requirePermission('elections.edit'), async (req, res, next) => {
  try {
    const body = z.object({
      title: z.string().trim().min(3).max(160).optional(),
      description: z.string().trim().max(4000).nullable().optional(),
      academic_year_id: uuid.nullable().optional(),
      start_at: isoDate.optional(),
      end_at: isoDate.optional(),
      timezone: z.string().trim().max(64).optional(),
      student_live_results_enabled: z.boolean().optional(),
      resolution_note: z.string().trim().max(2000).nullable().optional(),
    }).parse(req.body);

    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election } = await loadScoped(supabase, schoolId, req.params.id);

    const patch = {};
    for (const key of ['title', 'description', 'academic_year_id', 'timezone', 'student_live_results_enabled', 'resolution_note']) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    const opensAt = body.start_at ? asUtc(body.start_at, 'Opening time') : null;
    const closesAt = body.end_at ? asUtc(body.end_at, 'Closing time') : null;
    if (opensAt || closesAt) {
      const startAt = opensAt || election.start_at;
      const endAt = closesAt || election.end_at;
      if (new Date(endAt) <= new Date(startAt)) throw new ApiError(422, 'The closing time must be after the opening time.');
      // Moving the opening moment after learners have started voting would invent a retroactive
      // window; only extending the deadline is allowed once the poll has begun.
      if (election.opened_at && opensAt && new Date(opensAt).getTime() !== new Date(election.start_at).getTime()) {
        throw new ApiError(409, 'Voting has already begun, so the opening time can no longer be moved. Extend the closing time instead.');
      }
      patch.start_at = startAt;
      patch.end_at = endAt;
    }
    if (body.academic_year_id) await assertSchoolRefs(schoolId, { academic_year_id: [body.academic_year_id] }, { academic_year_id: 'academic_years' });

    const { data, error } = await supabase.from('elections').update(patch).eq('id', election.id).eq('school_id', schoolId)
      .select('id, title, description, academic_year_id, start_at, end_at, timezone, status, student_live_results_enabled, results_published, opened_at, closed_at, resolution_note').single();
    if (error) throw new ApiError(500, error.message);

    await audit(req, {
      module: 'elections', action: 'election_updated', recordId: election.id,
      summary: `Election changed: ${Object.keys(patch).join(', ')}`, metadata: { fields: Object.keys(patch) },
    });
    res.json({ data });
  } catch (e) { next(e); }
});

// --- Manual controls over the window -----------------------------------------------------------

// 'open' also accepts 'active' on purpose: an election can be active while its start_at still sits
// in the future (the create form defaults it to tomorrow). The officer asked for voting now, so the
// route must be able to repair that row rather than refuse to touch it.
const TRANSITIONS = {
  open: { from: ['scheduled', 'paused', 'active'], to: 'active' },
  pause: { from: ['active'], to: 'paused' },
  resume: { from: ['paused'], to: 'active' },
  close: { from: ['scheduled', 'active', 'paused'], to: 'closed' },
  cancel: { from: ['scheduled', 'active', 'paused'], to: 'cancelled' },
};

const PARTICIPLES = { open: 'opened', pause: 'paused', resume: 'resumed', close: 'closed', cancel: 'cancelled' };

electionsRouter.post('/:id/status', requirePermission('elections.manage'), async (req, res, next) => {
  try {
    const body = z.object({
      action: z.enum(['open', 'pause', 'resume', 'close', 'cancel']),
      reason: z.string().trim().max(1000).optional(),
    }).parse(req.body);

    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election, positions } = await loadScoped(supabase, schoolId, req.params.id);
    const rule = TRANSITIONS[body.action];
    const participle = PARTICIPLES[body.action];
    if (!rule.from.includes(election.status)) {
      throw new ApiError(409, `An election that is ${election.status} cannot be ${participle}.`);
    }
    if (body.action === 'cancel' && (body.reason || '').length < 3) {
      throw new ApiError(422, 'Say why the election is being cancelled.');
    }

    const now = new Date();
    const patch = { status: rule.to };
    if (body.action === 'open' || body.action === 'resume') {
      // The ballot is enforced by the window in the database, not by this status column. Releasing
      // an election whose closing time has passed, or whose opening time is still ahead, would send
      // a "Voting is open" notification for a ballot the learner then cannot cast.
      if (new Date(election.end_at) <= now) {
        throw new ApiError(422, 'The closing time has already passed. Extend the window on the election first, then open voting again.');
      }
      if (new Date(election.start_at) > now) patch.start_at = now.toISOString();
      if (body.action === 'open') patch.opened_at = election.opened_at || now.toISOString();
    }
    if (body.action === 'close') patch.closed_at = election.closed_at || now.toISOString();
    if (body.action === 'cancel') patch.cancel_reason = body.reason;
    const { data, error } = await supabase.from('elections').update(patch)
      .eq('id', election.id).eq('school_id', schoolId)
      .select('id, title, status, opened_at, closed_at, cancel_reason, start_at, end_at').single();
    if (error) throw new ApiError(500, error.message);

    // Closing by hand must produce the same final tally as the clock doing it.
    if (body.action === 'close' || body.action === 'cancel') {
      await saveResults(supabase, { schoolId, election: { ...election, ...patch }, positions, status: 'final' });
    }
    if (body.action === 'open' || body.action === 'resume') {
      const users = await studentUserIds(supabase, schoolId);
      await notifyRecipients(supabase, users, {
        schoolId, category: 'elections', title: `Voting is open: ${election.title}`,
        body: 'Cast your ballot now — each learner votes once.', link: `/school/student-elections`,
      });
    }
    await audit(req, {
      module: 'elections', action: `election_${body.action}`, recordId: election.id,
      summary: patch.start_at
        ? `Election ${election.title} manually ${participle} (voting window pulled forward to now)`
        : `Election ${election.title} manually ${participle}`,
      metadata: body.reason ? { reason: body.reason } : {},
    });
    res.json({ data });
  } catch (e) { next(e); }
});

electionsRouter.post('/:id/publish', requirePermission('elections.publish'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election, positions } = await loadScoped(supabase, schoolId, req.params.id);
    if (election.status !== 'closed') throw new ApiError(409, 'Results can only be published after voting has closed.');
    const scoreboard = await saveResults(supabase, { schoolId, election, positions, status: 'final' });
    const { data, error } = await supabase.from('elections').update({ results_published: true })
      .eq('id', election.id).eq('school_id', schoolId).select('id, title, results_published').single();
    if (error) throw new ApiError(500, error.message);

    const tied = scoreboard.filter((p) => p.tied);
    const users = await studentUserIds(supabase, schoolId);
    await notifyRecipients(supabase, users, {
      schoolId, category: 'elections', title: `Election results are out: ${election.title}`,
      body: tied.length ? 'One seat is tied and needs a decision from the school.' : 'See who was elected.',
      link: '/school/student-elections',
    });
    await audit(req, { module: 'elections', action: 'results_published', recordId: election.id, summary: `Results published for ${election.title}` });
    res.json({ data: { election: data, results: scoreboard, tied_positions: tied.map((p) => p.position_name) } });
  } catch (e) { next(e); }
});

// --- Candidates --------------------------------------------------------------------------------

electionsRouter.get('/:id/candidates', requirePermission('elections.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election, positions } = await loadScoped(supabase, schoolId, req.params.id);
    const { data: candidates, error } = await supabase.from('election_candidates')
      .select('id, position_id, student_id, campaign_title, introduction, photograph_url, application_status, is_published, decision_reason, approved_at, created_at')
      .eq('election_id', election.id).order('created_at', { ascending: true }).limit(500);
    if (error) throw new ApiError(500, error.message);

    const learnerIds = [...new Set((candidates || []).map((c) => c.student_id))];
    const [{ data: learners }, { data: classes }, { data: manifestos }] = await Promise.all([
      supabase.from('students').select('id, full_name, admission_number, gender, class_id, photo_url, academic_year_id')
        .eq('school_id', schoolId).in('id', learnerIds.length ? learnerIds : ['00000000-0000-0000-0000-000000000000']),
      supabase.from('classes').select('id, name').eq('school_id', schoolId),
      supabase.from('candidate_manifestos').select('id, candidate_id, promise_text, display_order').limit(5000)
        .in('candidate_id', (candidates || []).length ? candidates.map((c) => c.id) : ['00000000-0000-0000-0000-000000000000']),
    ]);
    const learnerById = new Map((learners || []).map((s) => [s.id, s]));
    const classById = new Map((classes || []).map((c) => [c.id, c.name]));
    const pointsByCandidate = new Map();
    for (const m of manifestos || []) {
      const list = pointsByCandidate.get(m.candidate_id) || [];
      list.push(m);
      pointsByCandidate.set(m.candidate_id, list);
    }

    res.json({
      data: {
        election,
        positions,
        candidates: (candidates || []).map((c) => {
          const learner = learnerById.get(c.student_id) || {};
          return {
            ...c,
            full_name: learner.full_name || '—',
            admission_number: learner.admission_number || null,
            gender: learner.gender || null,
            class_name: classById.get(learner.class_id) || null,
            photograph_url: c.photograph_url || learner.photo_url || null,
            manifestos: (pointsByCandidate.get(c.id) || []).sort((a, b) => a.display_order - b.display_order),
          };
        }),
      },
    });
  } catch (e) { next(e); }
});

/** Learners available to stand: real enrolments, so no candidate is ever a typed-in name. */
electionsRouter.get('/:id/eligible-candidates', requirePermission('elections.create'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election } = await loadScoped(supabase, schoolId, req.params.id);
    const search = String(req.query.search || '').trim().toLowerCase();
    const [{ data: learners }, { data: classes }, { data: standing }] = await Promise.all([
      supabase.from('students').select('id, full_name, admission_number, gender, class_id, photo_url')
        .eq('school_id', schoolId).eq('status', 'active').order('full_name').limit(5000),
      supabase.from('classes').select('id, name').eq('school_id', schoolId),
      supabase.from('election_candidates').select('student_id').eq('election_id', election.id).limit(1000),
    ]);
    if (!learners) throw new ApiError(500, 'Learners could not be read');
    const classById = new Map((classes || []).map((c) => [c.id, c.name]));
    const taken = new Set((standing || []).map((s) => s.student_id));
    res.json({
      data: (learners || [])
        .filter((s) => !taken.has(s.id))
        .filter((s) => !search || `${s.full_name} ${s.admission_number}`.toLowerCase().includes(search))
        .slice(0, 60)
        .map((s) => ({ ...s, class_name: classById.get(s.class_id) || null })),
    });
  } catch (e) { next(e); }
});

electionsRouter.post('/:id/candidates', requirePermission('elections.create'), async (req, res, next) => {
  try {
    const body = z.object({
      student_id: uuid,
      position_key: z.enum(POSITION_KEYS),
      campaign_title: z.string().trim().max(120).optional().nullable(),
      introduction: z.string().trim().max(4000).optional().nullable(),
      photograph_url: z.string().trim().max(2000).optional().nullable(),
      manifestos: z.array(z.string().trim().min(2).max(600)).max(20).default([]),
    }).parse(req.body);

    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election, positions } = await loadScoped(supabase, schoolId, req.params.id);
    assertEditable(election, 'Candidates');
    const position = positions.find((p) => p.position_key === body.position_key);
    if (!position) throw new ApiError(422, 'This election does not run that position.');
    await assertSchoolRefs(schoolId, { student_id: [body.student_id] }, { student_id: 'students' });

    const { data: learner } = await supabase.from('students').select('id, full_name, class_id, status')
      .eq('id', body.student_id).eq('school_id', schoolId).maybeSingle();
    if (!learner) throw new ApiError(404, 'That learner is not in this school.');
    if (learner.status !== 'active') throw new ApiError(422, `${learner.full_name} is not an active learner, so cannot stand.`);

    const { data: candidate, error } = await supabase.from('election_candidates').insert({
      school_id: schoolId, election_id: election.id, position_id: position.id, student_id: learner.id,
      campaign_title: body.campaign_title || null, introduction: body.introduction || null,
      photograph_url: body.photograph_url || null, application_status: 'pending',
    }).select('id, election_id, position_id, student_id, campaign_title, introduction, photograph_url, application_status, is_published').single();
    if (error) {
      if (/duplicate key|already exists/i.test(error.message)) {
        throw new ApiError(409, `${learner.full_name} already stands in this election — one position per learner.`);
      }
      throw new ApiError(500, error.message);
    }
    if (body.manifestos.length) {
      const { error: mErr } = await supabase.from('candidate_manifestos').insert(
        body.manifestos.map((text, index) => ({ candidate_id: candidate.id, promise_text: text, display_order: index + 1 })),
      );
      if (mErr) throw new ApiError(500, mErr.message);
    }
    const admins = await adminUserIds(supabase, schoolId);
    await notifyRecipients(supabase, admins, {
      schoolId, category: 'elections', title: 'A candidate application needs a decision',
      body: `${learner.full_name} applied for ${position.position_name}.`, link: ELECT_LINK,
    });
    await audit(req, {
      module: 'elections', action: 'candidate_registered', recordId: election.id,
      summary: `${learner.full_name} registered for ${position.position_name}`, metadata: { candidate_id: candidate.id },
    });
    res.status(201).json({ data: candidate });
  } catch (e) { next(e); }
});

async function loadCandidate(supabase, schoolId, candidateId) {
  const { data, error } = await supabase.from('election_candidates')
    .select('id, school_id, election_id, position_id, student_id, application_status, is_published')
    .eq('id', candidateId).eq('school_id', schoolId).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Candidate not found in this school');
  return data;
}

electionsRouter.patch('/candidates/:candidateId', requirePermission('elections.edit'), async (req, res, next) => {
  try {
    const body = z.object({
      position_key: z.enum(POSITION_KEYS).optional(),
      campaign_title: z.string().trim().max(120).nullable().optional(),
      introduction: z.string().trim().max(4000).nullable().optional(),
      photograph_url: z.string().trim().max(2000).nullable().optional(),
    }).parse(req.body);

    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const candidate = await loadCandidate(supabase, schoolId, req.params.candidateId);
    const { election, positions } = await loadScoped(supabase, schoolId, candidate.election_id);
    assertEditable(election, 'Candidate details');

    const patch = {};
    for (const key of ['campaign_title', 'introduction', 'photograph_url']) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.position_key) {
      const position = positions.find((p) => p.position_key === body.position_key);
      if (!position) throw new ApiError(422, 'This election does not run that position.');
      patch.position_id = position.id;
    }
    const { data, error } = await supabase.from('election_candidates').update(patch)
      .eq('id', candidate.id).eq('school_id', schoolId).select('id, position_id, campaign_title, introduction, photograph_url').single();
    if (error) throw new ApiError(500, error.message);
    await audit(req, {
      module: 'elections', action: 'candidate_updated', recordId: election.id,
      summary: `Candidate ${candidate.id} changed`, metadata: { candidate_id: candidate.id, fields: Object.keys(patch) },
    });
    res.json({ data });
  } catch (e) { next(e); }
});

electionsRouter.put('/candidates/:candidateId/manifesto', requirePermission('elections.edit'), async (req, res, next) => {
  try {
    const body = z.object({ points: z.array(z.string().trim().min(2).max(600)).max(20) }).parse(req.body);
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const candidate = await loadCandidate(supabase, schoolId, req.params.candidateId);
    const election = await loadElection(supabase, schoolId, candidate.election_id);
    assertEditable(election, 'Campaign promises');

    const { error: del } = await supabase.from('candidate_manifestos').delete().eq('candidate_id', candidate.id);
    if (del) throw new ApiError(500, del.message);
    if (body.points.length) {
      const { error: ins } = await supabase.from('candidate_manifestos').insert(
        body.points.map((promise_text, index) => ({ candidate_id: candidate.id, promise_text, display_order: index + 1 })),
      );
      if (ins) throw new ApiError(500, ins.message);
    }
    await audit(req, {
      module: 'elections', action: 'manifesto_saved', recordId: election.id,
      summary: `${body.points.length} campaign promises saved`, metadata: { candidate_id: candidate.id },
    });
    res.json({ data: { candidate_id: candidate.id, points: body.points } });
  } catch (e) { next(e); }
});

const DECISIONS = {
  approve: { status: 'approved', perm: 'elections.approve' },
  reject: { status: 'rejected', perm: 'elections.reject' },
  suspend: { status: 'suspended', perm: 'elections.approve' },
};

electionsRouter.post('/candidates/:candidateId/decision', requirePermission('elections.approve', 'elections.reject', 'elections.publish'), async (req, res, next) => {
  try {
    const body = z.object({
      decision: z.enum(['approve', 'reject', 'suspend', 'publish', 'unpublish']),
      reason: z.string().trim().max(1000).optional(),
    }).parse(req.body);

    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const needed = DECISIONS[body.decision]?.perm || 'elections.publish';
    if (!req.auth.permissions.has(needed)) throw new ApiError(403, `This decision needs the ${needed} permission.`);

    const candidate = await loadCandidate(supabase, schoolId, req.params.candidateId);
    const election = await loadElection(supabase, schoolId, candidate.election_id);
    const closing = { approve: 'approved', reject: 'rejected', suspend: 'suspended' };
    const patch = {};

    if (body.decision === 'unpublish') {
      assertEditable(election, 'The candidate list');
      patch.is_published = false;
    } else if (body.decision === 'publish') {
      if (candidate.application_status !== 'approved') throw new ApiError(409, 'Only an approved candidate can be published.');
      patch.is_published = true;
    } else {
      if (LOCKED.has(election.status) && body.decision === 'suspend') {
        throw new ApiError(409, 'A candidate cannot be suspended once voting has begun — their ballots are already counted.');
      }
      if (election.opened_at && body.decision !== 'suspend') {
        throw new ApiError(409, `Candidates are locked once voting has begun; this application can no longer be ${body.decision}d.`);
      }
      patch.application_status = closing[body.decision];
      patch.is_published = body.decision === 'approve';
      patch.approved_by = req.auth.userId || null;
      patch.approved_at = new Date().toISOString();
      patch.decision_reason = body.reason || null;
    }
    if ((body.decision === 'reject' || body.decision === 'suspend') && (body.reason || '').length < 3) {
      throw new ApiError(422, 'Give the reason for this decision — it is shown to the candidate and kept in the audit trail.');
    }

    const { data, error } = await supabase.from('election_candidates').update(patch)
      .eq('id', candidate.id).eq('school_id', schoolId)
      .select('id, application_status, is_published, decision_reason, approved_at').single();
    if (error) throw new ApiError(500, error.message);

    const { data: learnerUser } = await supabase.from('students').select('user_id').eq('id', candidate.student_id).maybeSingle();
    if (learnerUser?.user_id && ['approve', 'reject', 'suspend'].includes(body.decision)) {
      await notifyRecipients(supabase, [learnerUser.user_id], {
        schoolId, category: 'elections',
        title: `Your candidacy was ${body.decision === 'approve' ? 'approved' : body.decision}ed`,
        body: body.reason || `Election: ${election.title}`, link: '/school/student-elections',
      });
    }
    await audit(req, {
      module: 'elections', action: `candidate_${body.decision}`, recordId: election.id,
      summary: `Candidate ${candidate.id} ${body.decision}`,
      metadata: { candidate_id: candidate.id, reason: body.reason || null },
    });
    res.json({ data });
  } catch (e) { next(e); }
});

electionsRouter.delete('/candidates/:candidateId', requirePermission('elections.delete'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const candidate = await loadCandidate(supabase, schoolId, req.params.candidateId);
    const election = await loadElection(supabase, schoolId, candidate.election_id);
    assertEditable(election, 'Candidates');
    const { count } = await supabase.from('election_ballot_selections')
      .select('id', { count: 'exact', head: true }).eq('candidate_id', candidate.id);
    if (count) throw new ApiError(409, 'This candidate already has votes on ballots and cannot be removed.');

    const { error } = await supabase.from('election_candidates').delete().eq('id', candidate.id).eq('school_id', schoolId);
    if (error) throw new ApiError(500, error.message);
    await audit(req, {
      module: 'elections', action: 'candidate_removed', recordId: election.id,
      summary: `Candidate ${candidate.id} removed`, metadata: { candidate_id: candidate.id },
    });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// --- Reading the election ----------------------------------------------------------------------

electionsRouter.get('/:id/overview', requirePermission('elections.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election, positions } = await loadScoped(supabase, schoolId, req.params.id);
    const [roll, voted, { data: candidates }, scoreboard, { data: classes }] = await Promise.all([
      eligibleStudents(supabase, schoolId),
      votedStudentIds(supabase, schoolId, election.id),
      supabase.from('election_candidates').select('id, position_id, application_status, is_published')
        .eq('election_id', election.id).limit(1000),
      buildResults(supabase, { schoolId, election, positions }),
      supabase.from('classes').select('id, name').eq('school_id', schoolId),
    ]);
    if (candidates.error) throw new ApiError(500, candidates.error.message);
    const votable = votableStudents(roll);
    const turnout = participationStats(votable, voted);
    const classById = new Map((classes || []).map((c) => [c.id, c.name]));
    turnout.by_class = turnout.by_class.map((row) => ({ ...row, name: classById.get(row.group) || 'Class not set' }));
    turnout.by_gender = turnout.by_gender.map((row) => ({ ...row, name: row.group }));
    const now = Date.now();
    const rows = candidates.data || [];

    res.json({
      data: {
        election: { ...election, now: new Date(now).toISOString() },
        positions,
        turnout,
        stats: {
          registered_learners: roll.length,
          eligible_voters: turnout.eligible,
          learners_without_accounts: roll.length - votable.length,
          approved_candidates: rows.filter((c) => c.application_status === 'approved').length,
          pending_candidates: rows.filter((c) => c.application_status === 'pending').length,
          published_candidates: rows.filter((c) => c.is_published).length,
          president_candidates: rows.filter((c) => c.position_id === positions.find((p) => p.position_key === 'president')?.id).length,
          vice_president_candidates: rows.filter((c) => c.position_id === positions.find((p) => p.position_key === 'vice_president')?.id).length,
          votes_cast: turnout.voted,
          learners_not_voted: turnout.not_voted,
          participation_percentage: turnout.percentage,
          milliseconds_remaining: Math.max(0, new Date(election.end_at).getTime() - now),
          milliseconds_until_open: Math.max(0, new Date(election.start_at).getTime() - now),
          tied_positions: scoreboard.filter((p) => p.tied).map((p) => p.position_name),
        },
        results: scoreboard,
      },
    });
  } catch (e) { next(e); }
});

electionsRouter.get('/:id/results', requirePermission('elections.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election, positions } = await loadScoped(supabase, schoolId, req.params.id);
    const scoreboard = await buildResults(supabase, { schoolId, election, positions });

    // A learner sees rankings while voting only if the school allows it, and always once the
    // results are published. An officer sees them whenever the election is theirs.
    const learner = isPortalOnly(req.auth);
    const allowed = !learner
      || (election.status === 'closed' && election.results_published)
      || (election.status === 'active' && election.student_live_results_enabled);

    res.json({
      data: {
        election: { id: election.id, title: election.title, status: election.status, results_published: election.results_published },
        rankings_visible: allowed,
        reason: allowed ? null : 'rankings_withheld',
        results: allowed ? scoreboard : [],
      },
    });
  } catch (e) { next(e); }
});

electionsRouter.get('/:id/participation', requirePermission('elections.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election } = await loadScoped(supabase, schoolId, req.params.id);
    const [roll, voted, { data: classes }] = await Promise.all([
      eligibleStudents(supabase, schoolId),
      votedStudentIds(supabase, schoolId, election.id),
      supabase.from('classes').select('id, name').eq('school_id', schoolId),
    ]);
    const turnout = participationStats(votableStudents(roll), voted);
    const classById = new Map((classes || []).map((c) => [c.id, c.name]));
    res.json({
      data: {
        election: { id: election.id, title: election.title, status: election.status },
        ...turnout,
        by_class: turnout.by_class.map((row) => ({ ...row, name: classById.get(row.group) || 'Class not set' })),
        by_gender: turnout.by_gender.map((row) => ({ ...row, name: row.group })),
      },
    });
  } catch (e) { next(e); }
});

electionsRouter.get('/:id/audit', requirePermission('elections.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election } = await loadScoped(supabase, schoolId, req.params.id);
    const { data, error } = await supabase.from('audit_logs')
      .select('id, action, module, summary, status, created_at, metadata, user_id')
      .eq('school_id', schoolId).eq('module', 'elections').eq('record_id', election.id)
      .order('created_at', { ascending: false }).limit(300);
    if (error) throw new ApiError(500, error.message);
    res.json({ data: { election_id: election.id, entries: data || [] } });
  } catch (e) { next(e); }
});

// --- The learner's ballot ----------------------------------------------------------------------

/** Did this learner already vote? Never reveals what they, or anyone else, chose. */
electionsRouter.get('/:id/ballot', requirePermission('elections.view', 'elections.submit'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election } = await loadScoped(supabase, schoolId, req.params.id);
    const { data: mine } = await supabase.from('students').select('id, status').eq('school_id', schoolId)
      .eq('user_id', req.auth.userId).limit(1);
    const studentId = mine?.[0]?.id || null;
    let voted = null;
    if (studentId) {
      const { data: part } = await supabase.from('election_voter_participation').select('submitted_at')
        .eq('election_id', election.id).eq('student_id', studentId).maybeSingle();
      voted = part || null;
    }
    res.json({
      data: {
        election_id: election.id,
        status: election.status,
        is_open: election.status === 'active' && new Date(election.start_at) <= new Date() && new Date(election.end_at) > new Date(),
        eligible: Boolean(studentId) && mine[0].status === 'active',
        has_voted: Boolean(voted),
        submitted_at: voted?.submitted_at || null,
        // A cast ballot is sealed for everyone, including the learner who cast it — that is what
        // makes the ballot secret, so the screen can only confirm that the vote was recorded.
        sealed: Boolean(voted),
      },
    });
  } catch (e) { next(e); }
});

electionsRouter.post('/:id/ballot', requirePermission('elections.submit'), async (req, res, next) => {
  try {
    const body = z.object({
      selections: z.array(z.object({ position_id: uuid, candidate_id: uuid })).min(1).max(2),
    }).parse(req.body);

    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    await requireEnabled(supabase, schoolId);
    const { election } = await loadScoped(supabase, schoolId, req.params.id);

    const { data: verdict, error } = await supabase.rpc('election_cast_ballot', {
      p_election_id: election.id,
      p_school_id: schoolId,
      p_user_id: req.auth.userId,
      p_selections: body.selections,
    });
    if (error) throw new ApiError(500, error.message);
    if (!verdict?.ok) throw ballotFailure(verdict?.error);

    // The audit entry records that a ballot was accepted — never which candidates were chosen.
    await audit(req, {
      module: 'elections', action: 'ballot_cast', recordId: election.id,
      summary: 'A ballot was recorded', metadata: { positions_answered: verdict.positions_answered },
    });
    res.status(201).json({
      data: {
        election_id: election.id,
        submitted_at: verdict.submitted_at,
        message: 'Your ballot is recorded. Each learner votes once, so it cannot be changed.',
      },
    });
  } catch (e) { next(e); }
});

// --- Candidate photographs ---------------------------------------------------------------------

// The learner's own photo bucket is reused: a candidate picture is a student picture, and a second
// public bucket holding the same children's faces would only widen the surface that leaks them.
const PHOTO_BUCKET = 'student-photos';
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ? null : new ApiError(400, 'Photo must be a JPG, PNG or WebP image.'),
    true,
  ),
});

let bucketPromise = null;
async function ensurePhotoBucket(supabase) {
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const { data: buckets, error } = await supabase.storage.listBuckets();
      if (error) throw new ApiError(502, `Storage is not reachable: ${error.message}`);
      if (!(buckets || []).some((b) => b.name === PHOTO_BUCKET)) {
        const { error: createError } = await supabase.storage.createBucket(PHOTO_BUCKET, { public: true, fileSizeLimit: 3 * 1024 * 1024 });
        if (createError && !/already exists/i.test(createError.message)) throw new ApiError(502, createError.message);
      }
    })().catch((error) => { bucketPromise = null; throw error; });
  }
  return bucketPromise;
}

electionsRouter.post('/:id/candidates/photo', requirePermission('elections.create', 'elections.edit'), photoUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, 'Attach a photo file.');
    const ext = sniffImage(req.file.buffer);
    if (!ext) throw new ApiError(400, 'Photo must be a real JPG, PNG or WebP image.');
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election } = await loadScoped(supabase, schoolId, req.params.id);
    assertEditable(election, 'Candidate photographs');
    await ensurePhotoBucket(supabase);
    const path = `${schoolId}/${randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, req.file.buffer, {
      contentType: IMAGE_MIME[ext], cacheControl: '31536000', upsert: false,
    });
    if (error) throw new ApiError(502, `Photo upload failed: ${error.message}`);
    const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    res.status(201).json({ data: { url: data.publicUrl, path } });
  } catch (e) { next(e); }
});

// --- Reports and exports -----------------------------------------------------------------------

/**
 * Everything a report needs, assembled once. Note what is absent: no ballot, no participation row,
 * no learner id paired with a choice. A report is a document a school can print and hand out, so it
 * can only ever contain totals.
 */
async function reportContext(supabase, schoolId, electionId) {
  const { election, positions } = await loadScoped(supabase, schoolId, electionId);
  const [scoreboard, roll, voted, { data: classes }, { data: school }, { data: year }] = await Promise.all([
    buildResults(supabase, { schoolId, election, positions }),
    eligibleStudents(supabase, schoolId),
    votedStudentIds(supabase, schoolId, election.id),
    supabase.from('classes').select('id, name').eq('school_id', schoolId),
    supabase.from('schools').select('id, school_name, logo_url').eq('id', schoolId).maybeSingle(),
    election.academic_year_id
      ? supabase.from('academic_years').select('id, name').eq('id', election.academic_year_id).eq('school_id', schoolId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const turnout = participationStats(votableStudents(roll), voted);
  const classById = new Map((classes || []).map((c) => [c.id, c.name]));
  turnout.by_class = turnout.by_class.map((row) => ({ ...row, name: classById.get(row.group) || 'Class not set' }));
  turnout.by_gender = turnout.by_gender.map((row) => ({ ...row, name: row.group }));
  for (const position of scoreboard) {
    for (const candidate of position.candidates) {
      if (!candidate.class_name) candidate.class_name = classById.get(candidate.class_id) || null;
    }
  }
  return { election: { ...election, academic_year_label: year?.name || null }, positions, scoreboard, turnout, school: school || null };
}

const REPORT_UUID = z.string().uuid();

electionsRouter.get('/:id/reports/results.pdf', requirePermission('elections.export'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const context = await reportContext(supabase, req.auth.schoolId, req.params.id);
    await audit(req, { module: 'elections', action: 'report_exported', recordId: context.election.id, summary: `Result sheet PDF for ${context.election.title}` });
    await streamElectionPdf(res, { kind: 'results', ...context, issuedBy: req.auth.fullName });
  } catch (e) { next(e); }
});

electionsRouter.get('/:id/reports/declaration.pdf', requirePermission('elections.export'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const context = await reportContext(supabase, req.auth.schoolId, req.params.id);
    await audit(req, { module: 'elections', action: 'report_exported', recordId: context.election.id, summary: `Declaration PDF for ${context.election.title}` });
    await streamElectionPdf(res, { kind: 'winners', ...context, issuedBy: req.auth.fullName });
  } catch (e) { next(e); }
});

electionsRouter.get('/:id/reports/participation.pdf', requirePermission('elections.export'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const context = await reportContext(supabase, req.auth.schoolId, req.params.id);
    await audit(req, { module: 'elections', action: 'report_exported', recordId: context.election.id, summary: `Participation PDF for ${context.election.title}` });
    await streamElectionPdf(res, { kind: 'participation', ...context, issuedBy: req.auth.fullName });
  } catch (e) { next(e); }
});

electionsRouter.get('/:id/reports/full-report.pdf', requirePermission('elections.export'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const context = await reportContext(supabase, req.auth.schoolId, req.params.id);
    await audit(req, { module: 'elections', action: 'report_exported', recordId: context.election.id, summary: `Full report PDF for ${context.election.title}` });
    await streamElectionPdf(res, { kind: 'full', ...context, issuedBy: req.auth.fullName });
  } catch (e) { next(e); }
});

electionsRouter.get('/:id/reports/results.csv', requirePermission('elections.export'), async (req, res, next) => {
  try {
    const { id } = z.object({ id: REPORT_UUID }).parse(req.params);
    const supabase = requireDb();
    const context = await reportContext(supabase, req.auth.schoolId, id);
    const { columns, rows } = positionRows(context.scoreboard, String(req.query.position || ''));
    sendCsv(res, `election-${String(context.election.id).slice(0, 8)}-results.csv`, columns, rows);
  } catch (e) { next(e); }
});

electionsRouter.get('/:id/reports/participation.csv', requirePermission('elections.export'), async (req, res, next) => {
  try {
    const { id } = z.object({ id: REPORT_UUID }).parse(req.params);
    const dimension = ['class', 'gender', 'all'].includes(req.query.dimension) ? req.query.dimension : 'all';
    const supabase = requireDb();
    const context = await reportContext(supabase, req.auth.schoolId, id);
    const { columns, rows } = participationRows(context.turnout, dimension);
    sendCsv(res, `election-${String(context.election.id).slice(0, 8)}-participation-${dimension}.csv`, columns, rows);
  } catch (e) { next(e); }
});

electionsRouter.get('/:id/reports/candidates.csv', requirePermission('elections.export'), async (req, res, next) => {
  try {
    const { id } = z.object({ id: REPORT_UUID }).parse(req.params);
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election, positions } = await loadScoped(supabase, schoolId, id);
    const { data: candidates, error } = await supabase.from('election_candidates')
      .select('id, position_id, student_id, campaign_title, introduction, application_status, is_published, decision_reason, approved_at')
      .eq('election_id', election.id).limit(1000);
    if (error) throw new ApiError(500, error.message);
    const { data: learners } = await supabase.from('students')
      .select('id, full_name, admission_number, class_id').eq('school_id', schoolId).limit(10000);
    const { data: classes } = await supabase.from('classes').select('id, name').eq('school_id', schoolId);
    const learnerById = new Map((learners || []).map((s) => [s.id, s]));
    const classById = new Map((classes || []).map((c) => [c.id, c.name]));
    const positionById = new Map(positions.map((p) => [p.id, p.position_name]));
    sendCsv(res, `election-${String(election.id).slice(0, 8)}-candidates.csv`,
      ['position', 'candidate', 'admission_number', 'class', 'campaign_title', 'status', 'published', 'decision_reason', 'approved_at'],
      (candidates || []).map((c) => {
        const learner = learnerById.get(c.student_id) || {};
        return {
          position: positionById.get(c.position_id) || '',
          candidate: learner.full_name || '',
          admission_number: learner.admission_number || '',
          class: classById.get(learner.class_id) || '',
          campaign_title: c.campaign_title || '',
          status: c.application_status,
          published: c.is_published ? 'yes' : 'no',
          decision_reason: c.decision_reason || '',
          approved_at: c.approved_at || '',
        };
      }));
  } catch (e) { next(e); }
});

electionsRouter.get('/:id/reports/audit.csv', requirePermission('elections.export'), async (req, res, next) => {
  try {
    const { id } = z.object({ id: REPORT_UUID }).parse(req.params);
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { election } = await loadScoped(supabase, schoolId, id);
    const { data, error } = await supabase.from('audit_logs')
      .select('created_at, action, summary, status, user_scope, metadata').eq('school_id', schoolId)
      .eq('module', 'elections').eq('record_id', election.id)
      .order('created_at', { ascending: false }).limit(2000);
    if (error) throw new ApiError(500, error.message);
    sendCsv(res, `election-${String(election.id).slice(0, 8)}-audit.csv`, ['created_at', 'action', 'summary', 'status', 'actor_scope'],
      (data || []).map((row) => ({
        created_at: row.created_at, action: row.action, summary: row.summary, status: row.status, actor_scope: row.user_scope,
      })));
  } catch (e) { next(e); }
});

electionsRouter.get('/:id/reports/workbook.xlsx', requirePermission('elections.export'), async (req, res, next) => {
  try {
    const { id } = z.object({ id: REPORT_UUID }).parse(req.params);
    const supabase = requireDb();
    const context = await reportContext(supabase, req.auth.schoolId, id);
    const workbook = await buildElectionWorkbook(context);
    await audit(req, { module: 'elections', action: 'report_exported', recordId: context.election.id, summary: `Spreadsheet export for ${context.election.title}` });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="election-${String(context.election.id).slice(0, 8)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
});
