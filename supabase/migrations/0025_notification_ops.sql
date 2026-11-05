-- 0025_notification_ops.sql
-- The operational half of the notification system: what a message is worth (priority), when it is
-- allowed to leave (scheduling), and proof of what actually happened to it (delivery logs).
--
-- Inbox rows stay exactly as they are — one row per recipient, written at delivery time — so this file
-- only adds columns and new tables. Nothing here rewrites history: existing notifications come back as
-- priority 'normal' with no batch, which is the truth about them.
--
-- Run once in the Supabase SQL editor. Every statement is repeatable: re-running adds nothing, duplicates
-- no template and cannot lose a row.

-- --------------------------------------------------------------------------------------------
-- A) Every fan-out gets a batch id, so "one message, many people" stays one analysable event.
--    An announcement uses its own id; the composer and the platform broadcast mint one.
--    No foreign key: a batch may outlive the row that minted it, and platform messages have no
--    school row at all.
-- --------------------------------------------------------------------------------------------
alter table notifications add column if not exists batch_id uuid;
alter table notifications add column if not exists priority text not null default 'normal';
-- When the push and mail attempts for this row completed. Reading is separate (is_read): an accepted
-- message is not a delivered one, and a delivered one is not a read one.
alter table notifications add column if not exists sent_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_priority_check'
  ) then
    alter table notifications add constraint notifications_priority_check
      check (priority in ('low', 'normal', 'high', 'urgent'));
  end if;
end $$;

create index if not exists idx_notifications_batch on notifications (batch_id);
create index if not exists idx_notifications_school_created on notifications (school_id, created_at desc);

-- --------------------------------------------------------------------------------------------
-- B) Announcements gain the same two ideas: how loud, and when. An announcement with a future
--    scheduled_at and status 'draft' is a queue entry; the scheduler publishes and fans it out.
-- --------------------------------------------------------------------------------------------
alter table announcements add column if not exists priority text not null default 'normal';
alter table announcements add column if not exists scheduled_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'announcements_priority_check') then
    alter table announcements add constraint announcements_priority_check
      check (priority in ('low', 'normal', 'high', 'urgent'));
  end if;
end $$;

create index if not exists idx_announcements_due
  on announcements (scheduled_at)
  where status = 'draft' and scheduled_at is not null;

-- --------------------------------------------------------------------------------------------
-- C) A message that is queued, not yet addressed to anybody. Recipients are resolved when it fires,
--    because a class roster or a staff list that changed overnight must not be delivered against.
--    payload holds the send exactly as the composer submitted it, with no recipient ids in it.
-- --------------------------------------------------------------------------------------------
create table if not exists scheduled_notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools (id) on delete cascade,      -- null = platform broadcast
  recipient_scope text not null default 'school' check (recipient_scope in ('school', 'platform')),
  batch_id uuid not null default gen_random_uuid(),
  created_by uuid references school_users (id) on delete set null,
  created_by_scope text not null default 'school' check (created_by_scope in ('school', 'platform')),
  category text not null default 'general',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  title text not null,
  body text,
  link text,
  targeting jsonb not null default '{}'::jsonb,                  -- audience, class ids, roles, user ids
  channels jsonb not null default '["in_app","push"]'::jsonb,
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  last_error text,
  delivered_to integer,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The scheduler claims a row by moving it out of 'pending' in one statement, so a due row is only ever
-- picked up once even if two API processes overlap; the index is what makes that sweep cheap.
create index if not exists idx_scheduled_due
  on scheduled_notifications (scheduled_at) where status = 'pending';

-- --------------------------------------------------------------------------------------------
-- D) Delivery logs: one row per recipient per channel per attempt. This is where "Firebase accepted
--    it" and "the phone showed it" stop being the same sentence.
--
--    device_id points at the registration row and nothing else. The token itself is never copied in
--    here, and no user-facing endpoint returns this table's rows to anybody but their own school's
--    managers, because a token is a bearer credential.
-- --------------------------------------------------------------------------------------------
create table if not exists notification_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools (id) on delete cascade,      -- null = platform-wide message
  batch_id uuid,
  notification_id uuid references notifications (id) on delete cascade,
  recipient_user_id uuid not null,
  recipient_scope text not null default 'school' check (recipient_scope in ('school', 'platform')),
  channel text not null check (channel in ('push', 'email', 'in_app')),
  device_id uuid references push_tokens (id) on delete set null,
  delivery_status text not null check (delivery_status in ('sent', 'failed', 'skipped')),
  provider_code text,                                            -- UNREGISTERED, SENDER_ID_MISMATCH, HTTP 429…
  error_message text,
  attempt integer not null default 1,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_delivery_batch on notification_delivery_logs (batch_id);
create index if not exists idx_delivery_school_time on notification_delivery_logs (school_id, created_at desc);
create index if not exists idx_delivery_status on notification_delivery_logs (delivery_status, created_at desc);
-- The read that analytics does most: how did this recipient's pushes end?
create index if not exists idx_delivery_recipient on notification_delivery_logs (recipient_user_id, channel, created_at desc);

-- The clock-driven reminders ask one question before they send: has this already been said? The answer
-- is an audit row keyed by what it covered (see the scheduler), and this index keeps that lookup cheap
-- however long the tenant's audit trail has grown.
create index if not exists idx_audit_notice_ledger on audit_logs (module, action, record_id);

-- --------------------------------------------------------------------------------------------
-- E) Push is now a switch a user owns, separate from the in-app copy. Someone who wants the inbox but
--    not the OS notification gets exactly that, and the in-app centre keeps working either way.
-- --------------------------------------------------------------------------------------------
alter table notification_preferences add column if not exists push boolean not null default true;

-- --------------------------------------------------------------------------------------------
-- E2) The tenant switches for the clock-driven notices. A school turns the automatic reminders off, or
--     moves their lead time, from its own settings page — no deploy. An empty object means "defaults",
--     so this column never has to be written for the feature to work:
--       assignment_reminder_hours  24   -- lead time on an unfinished assignment; 0 switches it off
--       lesson_reminders           false -- a notice to a class a few minutes before its period
--       lesson_lead_minutes        10
--       subscription_alerts        true  -- licence and invoice warnings to the school's leaders
-- --------------------------------------------------------------------------------------------
alter table school_settings
  add column if not exists notification_configuration jsonb not null default '{}'::jsonb;

-- --------------------------------------------------------------------------------------------
-- F) Row level security. The API writes these with the service role, which skips policies by design.
--    Enabling RLS with no policy is the deliberate choice for the two bookkeeping tables: a browser
--    has no reason to read a school's delivery history or its queue, so it must not be able to.
--
--    notifications is different, and that is the point of the next block: a recipient may read their
--    own rows and nothing else. 0090 already grants that to authenticated users, so the same JWT the
--    app already holds can subscribe to it.
-- --------------------------------------------------------------------------------------------
alter table scheduled_notifications enable row level security;
alter table notification_delivery_logs enable row level security;

-- Repeat the recipient-own policy so this file alone is enough on a database that predates 0090.
drop policy if exists notifications_own on notifications;
create policy notifications_own on notifications
  for all to authenticated
  using (
    exists (select 1 from school_users su
            where su.id = notifications.recipient_user_id and su.auth_user_id = auth.uid())
    or exists (select 1 from platform_users pu
            where pu.id = notifications.recipient_user_id and pu.auth_user_id = auth.uid())
  )
  with check (false);

-- --------------------------------------------------------------------------------------------
-- G) Realtime: the bell follows the recipient without a refresh. Supabase only streams tables that
--    belong to the publication, and RLS still decides whose rows arrive — a subscription can filter
--    all it likes, it cannot read past the policy above.
-- --------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
      execute 'alter publication supabase_realtime add table public.notifications';
    end if;
  end if;
end $$;

-- Replicating the whole table is the cheap and correct answer: every recipient's own rows, filtered by
-- RLS at the moment of delivery, which is precisely the set a subscription is allowed to see.
alter table notifications replica identity full;

-- --------------------------------------------------------------------------------------------
-- H) Permissions. The composer and the analytics screens authorise on these keys, so they must exist
--    before the server will let anybody near them.
--
--    A grant here says only that a role may compose. WHO that role may address is decided by the
--    server every time — a teacher reaches their own classes, an accountant reaches money messages —
--    so a stolen permission row cannot turn into a whole-school broadcast.
-- --------------------------------------------------------------------------------------------
insert into school_permissions (permission_key, module, description) values
  ('notifications.send', 'notifications', 'Notifications - compose and send'),
  ('notifications.export', 'notifications', 'Notifications - analytics and delivery logs')
on conflict (permission_key) do nothing;

do $$
declare
  v_role record;
begin
  for v_role in
    select r.id, r.school_id, r.name
    from school_roles r
    where r.name in ('school_admin', 'principal', 'teacher', 'accountant', 'exam_officer')
  loop
    -- Composing: the school's leaders, and the three roles the specification gives audiences to.
    insert into school_role_permissions (school_id, role_id, permission_id)
      select v_role.school_id, v_role.id, p.id
      from school_permissions p
      where p.permission_key = 'notifications.send'
      on conflict (role_id, permission_id) do nothing;

    -- Reading reach: only the roles that own the school's communication.
    if v_role.name in ('school_admin', 'principal') then
      insert into school_role_permissions (school_id, role_id, permission_id)
        select v_role.school_id, v_role.id, p.id
        from school_permissions p
        where p.permission_key = 'notifications.export'
        on conflict (role_id, permission_id) do nothing;
    end if;

    -- Whoever composes also sees their own inbox.
    insert into school_role_permissions (school_id, role_id, permission_id)
      select v_role.school_id, v_role.id, p.id
      from school_permissions p
      where p.permission_key = 'notifications.view'
      on conflict (role_id, permission_id) do nothing;
  end loop;
end $$;
