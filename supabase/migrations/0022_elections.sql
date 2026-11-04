-- 0022: Student Council Elections — president and vice-president voted for online, once each.
--
-- Two rules define this module, and both are put where they cannot be argued with:
--
--   1. One ballot per eligible student, per election. election_voter_participation carries a
--      unique (election_id, student_id) and the only way a ballot is written is the
--      election_cast_ballot() function below, which inserts that row first. A second attempt hits
--      the constraint inside the function and comes back as 'already_voted' — the button in the
--      browser is a convenience, not the rule.
--   2. The secret ballot. election_ballots deliberately has no student_id, no user_id and nothing
--      that joins it back to a voter. The participation row says only THAT a student voted; the
--      ballot says only WHICH candidates were chosen. They are separate tables, and RLS on both
--      ballot tables lets only a Super Admin read them directly — every other reader, including the
--      school administrator, goes through the aggregate endpoints that return counts.
--
-- The clock is Postgres' now(), never the student's device: election_tick() flips scheduled
-- elections to active and active elections to closed, and election_cast_ballot() re-checks the
-- window on every submission, so a ballot sent at 5:01 PM for a 5:00 PM deadline is rejected even
-- if nobody has the dashboard open.

-- --------------------------------------------------------------------------------------------
-- A) The election itself
-- --------------------------------------------------------------------------------------------
create table if not exists elections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  title text not null,
  description text,
  academic_year_id uuid references academic_years (id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  timezone text not null default 'Africa/Mogadishu',
  status text not null default 'scheduled'
    check (status in ('scheduled', 'active', 'paused', 'closed', 'cancelled')),
  -- Students may be shown only participation while voting is open, and rankings only after close.
  student_live_results_enabled boolean not null default true,
  results_published boolean not null default false,
  opened_at timestamptz,
  closed_at timestamptz,
  cancel_reason text,
  -- What the administrator recorded when two candidates tied on the highest vote.
  resolution_note text,
  created_by uuid references school_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_elections_school_status on elections (school_id, status);
create index if not exists idx_elections_due on elections (status, start_at, end_at);

drop trigger if exists trg_elections_touch on elections;
create trigger trg_elections_touch before update on elections
  for each row execute function app_touch_updated_at();

-- The two seats are rows, not hard-coded strings, so a school can rename them ("Chairperson")
-- while the API still recognises president / vice_president by position_key.
create table if not exists election_positions (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections (id) on delete cascade,
  position_key text not null check (position_key in ('president', 'vice_president')),
  position_name text not null,
  description text,
  display_order int not null default 1,
  created_at timestamptz not null default now(),
  unique (election_id, position_key)
);

create index if not exists idx_election_positions_election on election_positions (election_id);

-- --------------------------------------------------------------------------------------------
-- B) Candidates and their manifestos
-- --------------------------------------------------------------------------------------------
create table if not exists election_candidates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  election_id uuid not null references elections (id) on delete cascade,
  position_id uuid not null references election_positions (id) on delete cascade,
  -- Always a real enrolment; there is no free-text candidate name in this module.
  student_id uuid not null references students (id) on delete cascade,
  campaign_title text,
  introduction text,
  photograph_url text,
  application_status text not null default 'pending'
    check (application_status in ('pending', 'approved', 'rejected', 'suspended')),
  -- Approval alone does not show a candidate to voters; publishing is a separate decision.
  is_published boolean not null default false,
  decision_reason text,
  approved_by uuid references school_users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One position per student per election. Whether the position belongs to the same election is
  -- enforced by election_cast_ballot() and by the API, because a CHECK constraint may not read
  -- another table.
  unique (election_id, student_id)
);

create index if not exists idx_election_candidates_election on election_candidates (election_id, position_id);
create index if not exists idx_election_candidates_school on election_candidates (school_id, application_status);

drop trigger if exists trg_election_candidates_touch on election_candidates;
create trigger trg_election_candidates_touch before update on election_candidates
  for each row execute function app_touch_updated_at();

-- Campaign promises, entered one at a time and shown in the order the school set them.
create table if not exists candidate_manifestos (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references election_candidates (id) on delete cascade,
  promise_text text not null check (length(btrim(promise_text)) > 0),
  display_order int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_candidate_manifestos_candidate on candidate_manifestos (candidate_id, display_order);

drop trigger if exists trg_candidate_manifestos_touch on candidate_manifestos;
create trigger trg_candidate_manifestos_touch before update on candidate_manifestos
  for each row execute function app_touch_updated_at();

-- --------------------------------------------------------------------------------------------
-- C) The register of who voted, and the ballots they cast — kept in different tables on purpose
-- --------------------------------------------------------------------------------------------
create table if not exists election_voter_participation (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections (id) on delete cascade,
  school_id uuid not null references schools (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  submitted_at timestamptz not null default now(),
  ballot_status text not null default 'cast' check (ballot_status in ('cast', 'voided')),
  unique (election_id, student_id)
);

create index if not exists idx_election_participation_election on election_voter_participation (election_id);

create table if not exists election_ballots (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections (id) on delete cascade,
  school_id uuid not null references schools (id) on delete cascade,
  -- Nothing here identifies the voter; the reference is only a receipt handle for the tally.
  ballot_reference uuid not null unique default gen_random_uuid(),
  submitted_at timestamptz not null default now()
);

create index if not exists idx_election_ballots_election on election_ballots (election_id);

create table if not exists election_ballot_selections (
  id uuid primary key default gen_random_uuid(),
  ballot_id uuid not null references election_ballots (id) on delete cascade,
  -- Repeated from the ballot on purpose: a tally is then one indexed scan, with no join back to
  -- anything that could hint at who cast the vote.
  election_id uuid not null references elections (id) on delete cascade,
  position_id uuid not null references election_positions (id) on delete cascade,
  candidate_id uuid not null references election_candidates (id) on delete cascade,
  unique (ballot_id, position_id)
);

create index if not exists idx_election_selections_tally on election_ballot_selections (election_id, position_id, candidate_id);
create index if not exists idx_election_selections_candidate on election_ballot_selections (candidate_id);
create index if not exists idx_election_selections_position on election_ballot_selections (position_id);

-- --------------------------------------------------------------------------------------------
-- D) The tally. Rows are written from the ballots, never typed by a person.
-- --------------------------------------------------------------------------------------------
create table if not exists election_results (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections (id) on delete cascade,
  position_id uuid not null references election_positions (id) on delete cascade,
  candidate_id uuid not null references election_candidates (id) on delete cascade,
  total_votes int not null default 0 check (total_votes >= 0),
  vote_percentage numeric(5, 2) not null default 0,
  ranking int,
  result_status text not null default 'live'
    check (result_status in ('live', 'final', 'tied', 'winner')),
  total_valid_votes int not null default 0,
  calculated_at timestamptz not null default now(),
  unique (election_id, position_id, candidate_id)
);

create index if not exists idx_election_results_position on election_results (election_id, position_id, ranking);

-- --------------------------------------------------------------------------------------------
-- E) Casting a ballot — the only supported way a vote enters the database.
--    Returns a jsonb verdict instead of raising, so the API can turn each case into a plain
--    sentence for the student. Nothing is written unless every check below passes, and a failure
--    half-way rolls the whole call back, so a retry never leaves half a ballot.
-- --------------------------------------------------------------------------------------------
create or replace function election_cast_ballot(
  p_election_id uuid,
  p_school_id uuid,
  p_user_id uuid,
  p_selections jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_election record;
  v_student_id uuid;
  v_required int;
  v_answered int;
  v_distinct int;
  v_bad int;
  v_part_id uuid;
  v_ballot_id uuid;
begin
  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  select id, status, start_at, end_at into v_election from elections
    where id = p_election_id and school_id = p_school_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  -- Server-side clock and status. A ballot that arrives after end_at is refused whatever the
  -- student's device says, and whatever the browser was showing a minute earlier.
  if v_election.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', case v_election.status
      when 'scheduled' then 'not_open'
      when 'paused' then 'paused'
      when 'cancelled' then 'cancelled'
      else 'ended' end);
  end if;
  if now() < v_election.start_at then return jsonb_build_object('ok', false, 'error', 'not_open'); end if;
  if now() >= v_election.end_at then return jsonb_build_object('ok', false, 'error', 'ended'); end if;

  -- Eligibility: an active enrolment in this school, belonging to the signed-in account.
  select s.id into v_student_id
    from students s
    where s.user_id = p_user_id and s.school_id = p_school_id and s.status = 'active'
    order by s.admission_number
    limit 1;
  if v_student_id is null then return jsonb_build_object('ok', false, 'error', 'not_eligible'); end if;

  -- A complete ballot answers every seat exactly once — no skipping the vice-president and no
  -- second vote for president.
  select count(*) into v_required from election_positions where election_id = p_election_id;
  select count(*), count(distinct (e->>'position_id')) into v_answered, v_distinct
    from jsonb_array_elements(p_selections) e;
  if v_answered <> v_required or v_distinct <> v_answered then
    return jsonb_build_object('ok', false, 'error', 'incomplete_ballot',
      'positions_required', v_required, 'positions_answered', v_distinct);
  end if;

  -- Both ids must exist, so a made-up uuid is refused before it reaches any insert.
  select count(*) into v_bad from jsonb_array_elements(p_selections) e
    where coalesce(e->>'position_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(e->>'candidate_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  if v_bad > 0 then return jsonb_build_object('ok', false, 'error', 'bad_selection'); end if;

  -- Every position must belong to this election.
  select count(*) into v_bad from jsonb_array_elements(p_selections) e
    where not exists (select 1 from election_positions p
      where p.id = (e->>'position_id')::uuid and p.election_id = p_election_id);
  if v_bad > 0 then return jsonb_build_object('ok', false, 'error', 'unknown_position'); end if;

  -- Every candidate must stand for exactly the position being answered, and be approved and
  -- published — this is what stops a vote for a president landing in the vice-president column.
  select count(*) into v_bad from jsonb_array_elements(p_selections) e
    where not exists (select 1 from election_candidates c
      where c.id = (e->>'candidate_id')::uuid
        and c.position_id = (e->>'position_id')::uuid
        and c.election_id = p_election_id
        and c.application_status = 'approved'
        and c.is_published);
  if v_bad > 0 then return jsonb_build_object('ok', false, 'error', 'candidate_not_standing'); end if;

  -- The unique (election_id, student_id) IS the one-vote rule. Claim it first: a student who has
  -- already voted writes nothing else.
  begin
    insert into election_voter_participation (election_id, school_id, student_id)
      values (p_election_id, p_school_id, v_student_id)
      returning id into v_part_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_voted');
  end;

  insert into election_ballots (election_id, school_id)
    values (p_election_id, p_school_id)
    returning id into v_ballot_id;

  insert into election_ballot_selections (ballot_id, election_id, position_id, candidate_id)
    select v_ballot_id, p_election_id, (e->>'position_id')::uuid, (e->>'candidate_id')::uuid
      from jsonb_array_elements(p_selections) e;

  -- Participation and ballot are separate rows, and this function is the only place both exist.
  -- No API response ever carries them together.
  return jsonb_build_object('ok', true, 'ballot_id', v_ballot_id,
    'submitted_at', now(), 'positions_answered', v_answered);
end $$;

revoke all on function election_cast_ballot(uuid, uuid, uuid, jsonb) from public;
revoke all on function election_cast_ballot(uuid, uuid, uuid, jsonb) from anon, authenticated;
grant execute on function election_cast_ballot(uuid, uuid, uuid, jsonb) to service_role;

-- --------------------------------------------------------------------------------------------
-- F) The tick: opening and closing on the database clock.
--    Called every few seconds by the API's scheduler; nothing depends on an administrator being
--    logged in or on an open browser tab.
-- --------------------------------------------------------------------------------------------
create or replace function election_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_opened jsonb := '[]'::jsonb;
  v_closed jsonb := '[]'::jsonb;
  v_id uuid;
begin
  -- Each flip is its own UPDATE and the old status is re-checked inside it, so two API processes
  -- ticking at the same instant cannot both claim the same election: the loser gets found = false.
  -- Nothing here depends on a browser being open or an administrator being signed in.
  for v_id in
    select id from elections
     where status = 'scheduled' and start_at <= now()
     order by start_at
  loop
    update elections set status = 'active', opened_at = coalesce(opened_at, now())
      where id = v_id and status = 'scheduled';
    if found then v_opened := v_opened || jsonb_build_array(v_id); end if;
  end loop;

  for v_id in
    select id from elections
     where status in ('active', 'paused') and end_at <= now()
     order by end_at
  loop
    update elections set status = 'closed', closed_at = coalesce(closed_at, now())
      where id = v_id and status in ('active', 'paused');
    if found then v_closed := v_closed || jsonb_build_array(v_id); end if;
  end loop;

  return jsonb_build_object(
    'opened', jsonb_array_length(v_opened),
    'opened_ids', v_opened,
    'closed', jsonb_array_length(v_closed),
    'closed_ids', v_closed
  );
end $$;

revoke all on function election_tick() from public;
revoke all on function election_tick() from anon, authenticated;
grant execute on function election_tick() to service_role;

-- --------------------------------------------------------------------------------------------
-- G) Row level security. The backend uses service-role and bypasses all of this; these policies
--    are the floor if the anon key is ever used directly.
-- --------------------------------------------------------------------------------------------
alter table elections enable row level security;
drop policy if exists tenant_isolation on elections;
create policy tenant_isolation on elections
  for all
  using (school_id = app.current_school_id() or app.is_super_admin())
  with check (school_id = app.current_school_id() or app.is_super_admin());

alter table election_candidates enable row level security;
drop policy if exists tenant_isolation on election_candidates;
create policy tenant_isolation on election_candidates
  for all
  using (school_id = app.current_school_id() or app.is_super_admin())
  with check (school_id = app.current_school_id() or app.is_super_admin());

-- Who has voted is not a secret; which candidates they chose is.
alter table election_voter_participation enable row level security;
drop policy if exists tenant_isolation on election_voter_participation;
create policy tenant_isolation on election_voter_participation
  for all
  using (school_id = app.current_school_id() or app.is_super_admin())
  with check (school_id = app.current_school_id() or app.is_super_admin());

-- Reached through its own election: Postgres validates a policy expression when the policy is
-- created, and election_results has no school_id column of its own.
alter table election_results enable row level security;
drop policy if exists tenant_isolation on election_results;
drop policy if exists parent_tenant on election_results;
create policy parent_tenant on election_results
  for all
  using (exists (select 1 from elections e
    where e.id = election_id and (e.school_id = app.current_school_id() or app.is_super_admin())))
  with check (exists (select 1 from elections e
    where e.id = election_id and (e.school_id = app.current_school_id() or app.is_super_admin())));

-- Children of a tenant table: reachable only through their own election.
alter table election_positions enable row level security;
drop policy if exists parent_tenant on election_positions;
create policy parent_tenant on election_positions
  for all
  using (exists (select 1 from elections e
    where e.id = election_id and (e.school_id = app.current_school_id() or app.is_super_admin())))
  with check (exists (select 1 from elections e
    where e.id = election_id and (e.school_id = app.current_school_id() or app.is_super_admin())));

alter table candidate_manifestos enable row level security;
drop policy if exists parent_tenant on candidate_manifestos;
create policy parent_tenant on candidate_manifestos
  for all
  using (exists (select 1 from election_candidates c
    where c.id = candidate_id and (c.school_id = app.current_school_id() or app.is_super_admin())))
  with check (exists (select 1 from election_candidates c
    where c.id = candidate_id and (c.school_id = app.current_school_id() or app.is_super_admin())));

-- The two ballot tables are sealed. No school member reads them directly: not the administrator,
-- not a teacher, not a candidate. Ballot content leaves the database only as an aggregate count.
alter table election_ballots enable row level security;
drop policy if exists ballot_secrecy on election_ballots;
create policy ballot_secrecy on election_ballots
  for all using (app.is_super_admin()) with check (app.is_super_admin());

alter table election_ballot_selections enable row level security;
drop policy if exists ballot_secrecy on election_ballot_selections;
create policy ballot_secrecy on election_ballot_selections
  for all using (app.is_super_admin()) with check (app.is_super_admin());

-- --------------------------------------------------------------------------------------------
-- H) The switch the Super Admin controls per school.
-- --------------------------------------------------------------------------------------------
alter table school_settings add column if not exists election_configuration jsonb not null default '{}'::jsonb;

-- --------------------------------------------------------------------------------------------
-- I) Permission catalog. The server authorises on module.action keys, so the elections keys must
--    exist before the screens can be used. Repeated here (and in seed.sql) so that pasting this one
--    file onto a database that was seeded long ago is enough.
-- --------------------------------------------------------------------------------------------
do $$
declare
  a text;
  actions text[] := array['view','create','edit','delete','approve','reject','submit','publish','export','manage','assign'];
begin
  foreach a in array actions loop
    insert into school_permissions (permission_key, module, description)
      values ('elections.' || a, 'elections', 'Elections - ' || a)
      on conflict (permission_key) do nothing;
  end loop;
end $$;

-- Schools that already exist get the module on the roles that need it; new schools receive the
-- same grants from the server's role defaults when they are provisioned.
do $$
declare
  v_role record;
  v_keys text[];
begin
  for v_role in select id, school_id, name from school_roles loop
    v_keys := case v_role.name
      when 'school_admin' then array[
        'elections.view','elections.create','elections.edit','elections.delete',
        'elections.approve','elections.reject','elections.publish','elections.export',
        'elections.manage','elections.assign']
      when 'principal' then array['elections.view', 'elections.export']
      when 'student' then array['elections.view', 'elections.submit']
      else null
    end;
    if v_keys is null then continue; end if;
    insert into school_role_permissions (school_id, role_id, permission_id)
      select v_role.school_id, v_role.id, p.id
        from school_permissions p
        where p.permission_key = any (v_keys)
      on conflict (role_id, permission_id) do nothing;
  end loop;
end $$;

-- PostgREST answers from a cached view of the schema, so the API keeps saying "could not find the
-- table public.elections" until it is told to look again. This costs nothing if it already has.
notify pgrst, 'reload schema';
