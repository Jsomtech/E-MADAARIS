/**
 * Election arithmetic, in one place, so the screens and the scheduler cannot disagree about who
 * won. Nothing here trusts a client-supplied number: every vote count is read out of
 * election_ballot_selections, which only election_cast_ballot() ever writes.
 *
 * Ballot secrecy is a rule about data flow, not just about the schema: no function in this file
 * returns a ballot together with a voter. Rankings are built from counts, and counts are all the
 * administrator ever receives.
 */
import { ApiError } from '../middleware/error.js';

export const ELECTION_MIGRATION = 'supabase/migrations/0022_elections.sql';

/** The two seats every school election runs, in the order they are presented. */
export const DEFAULT_POSITIONS = [
  { key: 'president', name: 'Student Council President', order: 1 },
  { key: 'vice_president', name: 'Student Council Vice President', order: 2 },
];

export const POSITION_KEYS = DEFAULT_POSITIONS.map((p) => p.key);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** (candidate votes / total valid votes for that position) x 100 — the formula the spec fixes. */
export function votePercentage(votes, totalValid) {
  if (!totalValid || totalValid <= 0) return 0;
  return round2((Number(votes) / totalValid) * 100);
}

/**
 * Rank one position's candidates. Equal votes for the lead are reported as a tie, never broken by
 * picking one: the administrator then records a runoff or a resolution, and that note is audited.
 */
export function rankPosition(candidates, totalValid) {
  const withVotes = candidates.map((c) => ({ ...c, votes: Number(c.votes) || 0 }));
  const ordered = [...withVotes].sort((a, b) => b.votes - a.votes || String(a.full_name || '').localeCompare(String(b.full_name || '')));
  const top = ordered[0]?.votes ?? 0;
  const leaderTied = top > 0 && ordered.filter((c) => c.votes === top).length > 1;
  let rank = 0;
  let seen = -1;
  return ordered.map((c, index) => {
    if (c.votes !== seen) { rank = index + 1; seen = c.votes; }
    const isLeader = c.votes === top && top > 0;
    return {
      ...c,
      ranking: c.votes > 0 ? rank : null,
      percentage: votePercentage(c.votes, totalValid),
      status: isLeader ? (leaderTied ? 'tied' : 'winner') : (totalValid > 0 ? 'final' : 'live'),
    };
  });
}

/** The election row, this school's only. Everything downstream is trusted to be inside it. */
export async function loadElection(supabase, schoolId, electionId) {
  const { data, error } = await supabase.from('elections')
    .select('id, school_id, title, description, academic_year_id, start_at, end_at, timezone, status, student_live_results_enabled, results_published, opened_at, closed_at, cancel_reason, resolution_note, created_at, updated_at')
    .eq('id', electionId).eq('school_id', schoolId).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Election not found in this school');
  return data;
}

export async function electionPositions(supabase, electionId) {
  const { data, error } = await supabase.from('election_positions')
    .select('id, position_key, position_name, description, display_order')
    .eq('election_id', electionId).order('display_order', { ascending: true });
  if (error) throw new ApiError(500, error.message);
  return data || [];
}

/**
 * Raw counts for every position, straight from the ballots. A candidate with no votes still needs
 * to appear on the scoreboard, so the caller passes the standing candidates in.
 */
export async function voteCounts(supabase, electionId) {
  const { data, error } = await supabase.from('election_ballot_selections')
    .select('position_id, candidate_id')
    .eq('election_id', electionId)
    .limit(200000);
  if (error) throw new ApiError(500, error.message);
  const byCandidate = new Map();
  const byPosition = new Map();
  for (const row of data || []) {
    byCandidate.set(row.candidate_id, (byCandidate.get(row.candidate_id) || 0) + 1);
    byPosition.set(row.position_id, (byPosition.get(row.position_id) || 0) + 1);
  }
  return { byCandidate, byPosition, ballotsScored: (data || []).length };
}

/** Active enrolments — the voters' roll. Only aggregate attributes are read. */
export async function eligibleStudents(supabase, schoolId) {
  const { data, error } = await supabase.from('students')
    .select('id, class_id, gender, status, user_id')
    .eq('school_id', schoolId).eq('status', 'active').limit(10000);
  if (error) throw new ApiError(500, error.message);
  return data || [];
}

/**
 * Only a learner with a sign-in account can ever be handed a ballot: election_cast_ballot() matches
 * students.user_id against the account making the request. Counting an enrolment with no account in
 * the turnout denominator would blame the school for a vote that was never reachable, so every
 * turnout figure is computed from this filtered roll and the missing accounts are reported apart.
 */
export function votableStudents(roll) {
  return (roll || []).filter((s) => s.user_id);
}

export async function votedStudentIds(supabase, schoolId, electionId) {
  const { data, error } = await supabase.from('election_voter_participation')
    .select('student_id, submitted_at')
    .eq('election_id', electionId).eq('school_id', schoolId).limit(10000);
  if (error) throw new ApiError(500, error.message);
  return data || [];
}

/**
 * Everything the dashboard shows about turnout. Deliberately counts-only: which candidate a named
 * student chose is nowhere in here, and neither is a per-student ballot.
 */
export function participationStats(eligible, voted) {
  const votedIds = new Set(voted.map((v) => v.student_id));
  const byGroup = (key) => {
    const groups = new Map();
    for (const s of eligible) {
      const label = s[key] || (key === 'gender' ? 'unspecified' : 'unassigned');
      const row = groups.get(label) || { group: label, eligible: 0, voted: 0 };
      row.eligible += 1;
      if (votedIds.has(s.id)) row.voted += 1;
      groups.set(label, row);
    }
    return [...groups.values()]
      .map((g) => ({ ...g, percentage: votePercentage(g.voted, g.eligible) }))
      .sort((a, b) => b.eligible - a.eligible || a.group.localeCompare(b.group));
  };
  return {
    eligible: eligible.length,
    voted: votedIds.size,
    not_voted: eligible.length - votedIds.size,
    percentage: round2(votePercentage(votedIds.size, eligible.length)),
    by_class: byGroup('class_id'),
    by_gender: byGroup('gender'),
    last_vote_at: voted.reduce((latest, v) => (v.submitted_at && (!latest || v.submitted_at > latest) ? v.submitted_at : latest), null),
  };
}

/**
 * Full scoreboard for an election: one ranked list per position, plus turnout. This is the only
 * shape results ever leave the server in.
 */
export async function buildResults(supabase, { schoolId, election, positions }) {
  const [{ data: candidates }, counts, { data: studentRows }, { data: classRows }] = await Promise.all([
    supabase.from('election_candidates')
      .select('id, position_id, student_id, campaign_title, introduction, photograph_url, application_status, is_published')
      .eq('election_id', election.id).limit(5000),
    voteCounts(supabase, election.id),
    supabase.from('students')
      .select('id, full_name, admission_number, class_id, gender, photo_url')
      .eq('school_id', schoolId).limit(10000),
    supabase.from('classes').select('id, name').eq('school_id', schoolId),
  ]);
  const studentById = new Map((studentRows || []).map((s) => [s.id, s]));
  const classById = new Map((classRows || []).map((c) => [c.id, c.name]));

  const byPosition = [];
  for (const position of positions) {
    const standing = (candidates || []).filter((c) => c.position_id === position.id);
    const totalValid = counts.byPosition.get(position.id) || 0;
    const ranked = rankPosition(standing.map((c) => {
      const student = studentById.get(c.student_id) || {};
      return {
        candidate_id: c.id,
        student_id: c.student_id,
        full_name: student.full_name || '—',
        admission_number: student.admission_number || null,
        class_id: student.class_id || null,
        class_name: classById.get(student.class_id) || null,
        photograph_url: c.photograph_url || student.photo_url || null,
        campaign_title: c.campaign_title,
        introduction: c.introduction,
        application_status: c.application_status,
        is_published: c.is_published,
        votes: counts.byCandidate.get(c.id) || 0,
      };
    }), totalValid);
    byPosition.push({
      position_id: position.id,
      position_key: position.position_key,
      position_name: position.position_name,
      total_valid_votes: totalValid,
      candidates: ranked,
      winner: ranked.find((c) => c.status === 'winner') || null,
      tied: ranked.some((c) => c.status === 'tied'),
    });
  }
  return byPosition;
}

/** Persist the tally so history keeps the numbers even if ballots are later anonymised further. */
export async function saveResults(supabase, { schoolId, election, positions, status }) {
  const scoreboard = await buildResults(supabase, { schoolId, election, positions });
  const rows = scoreboard.flatMap((position) => position.candidates.map((c) => ({
    election_id: election.id,
    position_id: position.position_id,
    candidate_id: c.candidate_id,
    total_votes: c.votes,
    vote_percentage: c.percentage,
    ranking: c.ranking,
    result_status: status === 'final' ? (c.status === 'tied' ? 'tied' : c.status === 'winner' ? 'winner' : 'final') : 'live',
    total_valid_votes: position.total_valid_votes,
    calculated_at: new Date().toISOString(),
  })));
  if (rows.length) {
    const { error } = await supabase.from('election_results').upsert(rows, {
      onConflict: 'election_id,position_id,candidate_id',
      ignoreDuplicates: false,
    });
    if (error) throw new ApiError(500, error.message);
  }
  return scoreboard;
}

/**
 * Notifications. Students are addressed through their own school_users rows; the batch insert keeps
 * a whole-school announcement to a handful of round trips.
 */
const NOTIFY_BATCH = 200;

export async function notifyRecipients(supabase, userIds, { schoolId, category, title, body, link }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += NOTIFY_BATCH) {
    const rows = ids.slice(i, i + NOTIFY_BATCH).map((recipient_user_id) => ({
      school_id: schoolId,
      recipient_user_id,
      recipient_scope: 'school',
      category,
      title,
      body,
      link,
      is_read: false,
    }));
    const { error } = await supabase.from('notifications').insert(rows);
    if (error) return { sent: 0, error: error.message };
  }
  return { sent: ids.length, error: null };
}

export async function studentUserIds(supabase, schoolId, { candidatesOnly = false, electionId = null } = {}) {
  const { data: students } = await supabase.from('students')
    .select('id, user_id').eq('school_id', schoolId).eq('status', 'active').not('user_id', 'is.null').limit(10000);
  if (!candidatesOnly || !electionId) return (students || []).map((s) => s.user_id);
  const { data: candidates } = await supabase.from('election_candidates')
    .select('student_id').eq('election_id', electionId).limit(1000);
  const ids = new Set((candidates || []).map((c) => c.student_id));
  return (students || []).filter((s) => ids.has(s.id)).map((s) => s.user_id);
}

export async function adminUserIds(supabase, schoolId) {
  const { data, error } = await supabase.from('school_user_roles')
    .select('user_id, school_roles!inner(name)')
    .eq('school_id', schoolId)
    .in('school_roles.name', ['school_admin', 'principal'])
    .limit(200);
  if (error) return [];
  return (data || []).map((r) => r.user_id);
}

/** Is the module switched on for this school? On by default; the Super Admin can switch it off. */
export async function electionsEnabled(supabase, schoolId) {
  const { data, error } = await supabase.from('school_settings')
    .select('election_configuration').eq('school_id', schoolId).maybeSingle();
  if (error || !data) return true;
  const config = data.election_configuration || {};
  return config.enabled !== false;
}

/** Plain sentences for the verdicts election_cast_ballot() can return. */
export const BALLOT_MESSAGES = {
  not_found: ['Election not found', 404],
  not_open: ['Voting has not started yet. It opens at the time the school set.', 425],
  paused: ['Voting is paused right now. Try again once the school reopens it.', 409],
  cancelled: ['This election was cancelled, so no ballot can be accepted.', 409],
  ended: ['Voting has officially ended. The election submission period is now closed. You can view the election results.', 410],
  not_eligible: ['Your account is not linked to an active learner in this school, so you cannot vote.', 403],
  incomplete_ballot: ['Answer every seat on the ballot before confirming.', 422],
  bad_selection: ['The ballot names candidates this election does not run.', 422],
  unknown_position: ['The ballot names a position this election does not run.', 422],
  candidate_not_standing: ['One of the candidates you picked does not stand for that position, or is not published.', 422],
  already_voted: ['Your ballot for this election is already recorded. Each learner votes once.', 409],
  bad_request: ['The ballot could not be read. Open the election again and try once more.', 400],
};
