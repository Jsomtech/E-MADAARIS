-- 0026_push_subscriptions.sql
-- A second push provider beside Firebase Cloud Messaging: standards-based Web Push (RFC 8291 with
-- VAPID, RFC 8292).
--
-- Why a second one at all: FCM's browser channel is not available everywhere. On iPhone and iPad a web
-- app can only be pushed to through the OS's own Web Push service, and only once it has been added to
-- the Home Screen — `firebase/messaging` reports unsupported there, and no Firebase configuration
-- changes that. Desktop Safari and Firefox want the same standards-based route. So one delivery system
-- now speaks two transports, and a device row records which one it answered on.
--
-- The row stops being "an FCM token" and becomes "a registered device": `provider` says which transport,
-- and the credential that transport needs travels with it. Nothing is deleted, so every browser that is
-- registered today keeps receiving messages exactly as before, on the 'fcm' default.
--
-- Run once in the Supabase SQL editor. Every statement is repeatable.

-- --------------------------------------------------------------------------------------------
-- A) Transport and its credential.
--
--    An FCM registration token is a bare string; a Web Push subscription is a URL plus two key
--    halves, and the URL is longer than the token column's habit. Both live in the same row because
--    one person's phone is one device whichever transport it answered on.
-- --------------------------------------------------------------------------------------------
alter table push_tokens add column if not exists provider text not null default 'fcm';
-- The push service URL that a POST must be addressed to. Also the natural identity of the device.
alter table push_tokens add column if not exists endpoint text;
-- The subscriber's P-256 public key and its 16-byte auth secret. These encrypt the payload for this
-- device alone; they are not bearer credentials but they are never returned to any other account.
alter table push_tokens add column if not exists p256dh text;
alter table push_tokens add column if not exists auth text;
-- "Aqalam's Chrome phone" — what the owner sees when they manage their own devices.
alter table push_tokens add column if not exists label text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'push_tokens_provider_check') then
    alter table push_tokens add constraint push_tokens_provider_check
      check (provider in ('fcm', 'webpush'));
  end if;
  -- A row that claims a transport must actually carry that transport's credential, or a send would
  -- silently aim at nothing.
  if not exists (select 1 from pg_constraint where conname = 'push_tokens_credential_check') then
    alter table push_tokens add constraint push_tokens_credential_check check (
      (provider = 'fcm' and token is not null)
      or (provider = 'webpush' and endpoint is not null and p256dh is not null and auth is not null)
    );
  end if;
end $$;

-- `token` was the whole table. Now only the FCM transport needs it.
alter table push_tokens alter column token drop not null;

-- A unique constraint, not a partial index: PostgREST can only merge on a constraint it can name, and
-- NULLs are distinct under Postgres uniqueness, so the FCM rows (endpoint null) stay unconstrained here
-- while each Web Push subscription keeps exactly one row.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'push_tokens_endpoint_key') then
    alter table push_tokens add constraint push_tokens_endpoint_key unique (endpoint);
  end if;
end $$;

-- --------------------------------------------------------------------------------------------
-- B) Lifecycle. A device that has been uninstalled should stop being aimed at rather than being
--    retried forever, and the operator needs to see why one went quiet.
-- --------------------------------------------------------------------------------------------
alter table push_tokens add column if not exists active boolean not null default true;
alter table push_tokens add column if not exists failure_count integer not null default 0;
alter table push_tokens add column if not exists last_error text;
alter table push_tokens add column if not exists revoked_at timestamptz;

-- Sends only ever look for live devices belonging to an account. This is that read.
create index if not exists push_tokens_live_idx
  on push_tokens (user_type, user_id) where active;

comment on column push_tokens.provider is 'Which transport answers this device: fcm token or web push subscription.';
comment on column push_tokens.active is 'false once the push service has rejected it (404/410) or its owner removed it.';
