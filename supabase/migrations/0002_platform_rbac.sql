-- 0002: Platform-level identity and RBAC
create table platform_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  full_name text not null,
  email text not null unique,
  phone text,
  status text not null default 'active', -- active | inactive
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,            -- super_admin | platform_support
  description text,
  created_at timestamptz not null default now()
);

create table platform_permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null unique,  -- platform.schools.manage ...
  description text,
  module text not null
);

create table platform_user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references platform_users (id) on delete cascade,
  role_id uuid not null references platform_roles (id) on delete cascade,
  unique (user_id, role_id)
);

create table platform_role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references platform_roles (id) on delete cascade,
  permission_id uuid not null references platform_permissions (id) on delete cascade,
  unique (role_id, permission_id)
);

create trigger trg_platform_users_touch before update on platform_users
for each row execute function app_touch_updated_at();

create index idx_platform_user_roles_user on platform_user_roles (user_id);
create index idx_platform_role_permissions_role on platform_role_permissions (role_id);
