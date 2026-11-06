-- 0027_notification_acks.sql
-- An announcement that the school needs to be able to prove was seen.
--
-- `is_read` records that a message was opened — the bell clears, the row goes grey. That is not the same
-- promise as "this person acknowledged it", which is what a headteacher needs for a fee deadline, a
-- safety notice or an exam rule. So the two are separate columns: reading is automatic, acknowledging is
-- an explicit act by the recipient, and a phone notification being displayed counts as neither.
--
-- A message that requires an acknowledgment is presented again on sign-in until the recipient confirms
-- it, per recipient — one person's acknowledgment never settles their neighbour's copy, because every
-- recipient has their own row.
--
-- Scheduled notices carry the flag inside `scheduled_notifications.targeting` (already jsonb), so no
-- column is needed there.
--
-- Run once in the Supabase SQL editor. Every statement is repeatable.

alter table notifications add column if not exists ack_required boolean not null default false;
alter table notifications add column if not exists acknowledged_at timestamptz;

-- An acknowledgment without a requirement to make one is a stray timestamp; the writer keeps them
-- together, and this keeps the data honest if anything else writes the column.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_ack_pairs_check') then
    alter table notifications add constraint notifications_ack_pairs_check check (
      acknowledged_at is null or ack_required
    );
  end if;
end $$;

-- What the sign-in screen asks, over and over: this recipient's unacknowledged messages. Partial, so the
-- index stays small no matter how many years of read notices the tenant accumulates.
create index if not exists notifications_pending_ack_idx
  on notifications (recipient_user_id, created_at desc)
  where ack_required and acknowledged_at is null;

-- Sends report who has not confirmed yet, per batch.
create index if not exists notifications_batch_ack_idx
  on notifications (batch_id) where ack_required;

comment on column notifications.ack_required is 'The sender requires this recipient to explicitly confirm they read it.';
comment on column notifications.acknowledged_at is 'When the recipient confirmed it. Reading the message, or its push notification, does not set this.';
