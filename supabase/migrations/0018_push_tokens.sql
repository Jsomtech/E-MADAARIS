-- Firebase Cloud Messaging device tokens.
-- One row per browser/device. Tokens belong to exactly one signed-in identity and
-- (for school accounts) one school; deleting the school or the account removes them.
create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  user_type text not null check (user_type in ('school', 'platform')),
  user_id uuid not null,
  auth_user_id uuid,
  token text not null unique,
  platform text not null default 'web',
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_tokens_school_idx on public.push_tokens (school_id);
create index if not exists push_tokens_user_idx on public.push_tokens (user_type, user_id);
create index if not exists push_tokens_auth_idx on public.push_tokens (auth_user_id);

-- Service-role only: the API registers tokens after verifying the session.
-- RLS enabled with no policies denies every anon/authenticated direct read.
alter table public.push_tokens enable row level security;
