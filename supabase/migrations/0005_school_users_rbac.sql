-- 0005: School-level users, roles, permissions (RBAC), invitations
create table school_users (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  avatar_url text,
  status text not null default 'pending_verification', -- pending_verification | active | inactive
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, email)
);

create table school_roles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,
  description text,
  is_system_role boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table school_permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null unique,
  description text,
  module text not null
);

create table school_user_roles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  user_id uuid not null references school_users (id) on delete cascade,
  role_id uuid not null references school_roles (id) on delete cascade,
  unique (user_id, role_id)
);

create table school_role_permissions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  role_id uuid not null references school_roles (id) on delete cascade,
  permission_id uuid not null references school_permissions (id) on delete cascade,
  unique (role_id, permission_id)
);

-- Invitation metadata (actual token is managed by Supabase Auth; never stored here)
create table school_invitations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  email text not null,
  full_name text not null,
  role_name text not null,
  invited_by uuid references school_users (id),
  status text not null default 'pending', -- pending | accepted | expired
  last_sent_at timestamptz,
  send_count int not null default 0,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

create trigger trg_school_users_touch before update on school_users
for each row execute function app_touch_updated_at();

create index idx_school_users_school on school_users (school_id);
create index idx_school_users_auth on school_users (auth_user_id);
create index idx_school_user_roles_user on school_user_roles (user_id);
create index idx_school_roles_school on school_roles (school_id);
