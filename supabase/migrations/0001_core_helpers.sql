-- 0001: extensions, shared helpers, RLS support functions
create extension if not exists pgcrypto;

-- updated_at trigger
create or replace function app_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- app schema for helpers (kept out of RLS surface)
create schema if not exists app;

-- The active school of the authenticated user (tenant context).
create or replace function app.current_school_id() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare sid uuid;
begin
  select su.school_id into sid
  from school_users su
  where su.auth_user_id = auth.uid() and su.status = 'active'
  limit 1;
  return sid;
end $$;

-- Super Admin bypass (platform-level ownership only).
create or replace function app.is_super_admin() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare ok boolean;
begin
  select exists (
    select 1
    from platform_users pu
    join platform_user_roles pur on pur.user_id = pu.id
    join platform_roles pr on pr.id = pur.role_id
    where pu.auth_user_id = auth.uid() and pu.status = 'active'
      and pr.name = 'super_admin'
  ) into ok;
  return coalesce(ok, false);
end $$;

-- Any platform-level staff member (super admin or support).
create or replace function app.is_platform_user() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare ok boolean;
begin
  select exists (
    select 1 from platform_users pu
    where pu.auth_user_id = auth.uid() and pu.status = 'active'
  ) into ok;
  return coalesce(ok, false);
end $$;

grant execute on function app.current_school_id() to authenticated, service_role;
grant execute on function app.is_super_admin() to authenticated, service_role;
grant execute on function app.is_platform_user() to authenticated, service_role;
