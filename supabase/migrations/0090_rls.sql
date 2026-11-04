-- 0090: Row Level Security. Backend uses service-role (bypasses RLS) but RLS is the
-- defense-in-depth floor for tenant isolation if the anon key is ever used directly.

-- A) Generic tenant isolation for every table with a NOT NULL school_id, except the
--    tables that get bespoke policies below.
do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_name = c.table_name and t.table_schema = 'public' and t.table_type = 'BASE TABLE'
    where c.column_name = 'school_id' and c.table_schema = 'public'
      and c.table_name not in ('announcements','notifications','support_tickets','audit_logs','schools')
  loop
    execute format('alter table public.%I enable row level security', r.table_name);
    execute format('drop policy if exists tenant_isolation on public.%I', r.table_name);
    execute format($f$
      create policy tenant_isolation on public.%I
        for all
        using (school_id = app.current_school_id() or app.is_super_admin())
        with check (school_id = app.current_school_id() or app.is_super_admin())
    $f$, r.table_name);
  end loop;
end $$;

-- B) Schools: a school member sees only their own school; Super Admin sees all.
alter table schools enable row level security;
drop policy if exists school_member_read on schools;
create policy school_member_read on schools
  for select using (id = app.current_school_id() or app.is_super_admin());

-- C) Subscription plans & features: public read of published plans (landing page pricing).
alter table subscription_plans enable row level security;
drop policy if exists published_plans_read on subscription_plans;
create policy published_plans_read on subscription_plans
  for select to anon, authenticated using (status = 'published');

alter table plan_features enable row level security;
drop policy if exists plan_features_read on plan_features;
create policy plan_features_read on plan_features
  for select to anon, authenticated
  using (exists (select 1 from subscription_plans p
                 where p.id = plan_id and p.status = 'published'));

-- D) School registration: public submit only (no public enumeration).
alter table school_registrations enable row level security;
drop policy if exists public_submit on school_registrations;
create policy public_submit on school_registrations
  for insert to anon, authenticated with check (true);
drop policy if exists super_admin_read on school_registrations;
create policy super_admin_read on school_registrations
  for select to authenticated using (app.is_super_admin());

-- E) Announcements: platform-wide (school_id null) visible to all authenticated;
--    school announcements visible within tenant; writers are service-role only.
alter table announcements enable row level security;
drop policy if exists announcements_read on announcements;
create policy announcements_read on announcements
  for select to authenticated using (school_id is null or school_id = app.current_school_id() or app.is_super_admin());

-- F) Notifications: recipient may read/update their own.
alter table notifications enable row level security;
drop policy if exists notifications_own on notifications;
create policy notifications_own on notifications
  for all to authenticated
  using (
    exists (select 1 from school_users su
            where su.id = notifications.recipient_user_id and su.auth_user_id = auth.uid())
    or exists (select 1 from platform_users pu
            where pu.id = notifications.recipient_user_id and pu.auth_user_id = auth.uid())
  )
  with check (true);

-- G) Support tickets: school members see own school's tickets; platform users see all.
alter table support_tickets enable row level security;
drop policy if exists tickets_read on support_tickets;
create policy tickets_read on support_tickets
  for select to authenticated
  using (app.is_platform_user() or school_id = app.current_school_id());

alter table support_replies enable row level security;
drop policy if exists replies_read on support_replies;
create policy replies_read on support_replies
  for select to authenticated
  using (exists (select 1 from support_tickets t
                 where t.id = ticket_id
                   and (app.is_platform_user() or t.school_id = app.current_school_id())));

-- H) Audit logs: super admin reads all; school users read their school scope. Append-only.
alter table audit_logs enable row level security;
drop policy if exists audit_read on audit_logs;
create policy audit_read on audit_logs
  for select to authenticated
  using (school_id is not distinct from app.current_school_id() or app.is_super_admin());

-- I) Permission catalogs and platform RBAC: readable by members, managed by Super Admin.
alter table school_permissions enable row level security;
drop policy if exists school_perms_read on school_permissions;
create policy school_perms_read on school_permissions for select to authenticated using (true);

alter table platform_users enable row level security;
alter table platform_roles enable row level security;
alter table platform_permissions enable row level security;
alter table platform_user_roles enable row level security;
alter table platform_role_permissions enable row level security;
drop policy if exists platform_read on platform_users;
create policy platform_read on platform_users for select to authenticated using (app.is_platform_user());
drop policy if exists platform_roles_read on platform_roles;
create policy platform_roles_read on platform_roles for select to authenticated using (app.is_platform_user());
drop policy if exists platform_perms_read on platform_permissions;
create policy platform_perms_read on platform_permissions for select to authenticated using (app.is_platform_user());

-- J) Email templates: platform-admin readable only.
alter table email_templates enable row level security;
drop policy if exists email_tpl_read on email_templates;
create policy email_tpl_read on email_templates for select to authenticated using (app.is_super_admin());

-- K) Storage buckets and policies
insert into storage.buckets (id, name, public) values
  ('avatars', 'avatars', true),
  ('school-branding', 'school-branding', true),
  ('school-documents', 'school-documents', false),
  ('learning-materials', 'learning-materials', false),
  ('payment-evidence', 'payment-evidence', false)
on conflict (id) do nothing;

drop policy if exists "public asset read" on storage.objects;
create policy "public asset read" on storage.objects
  for select to anon, authenticated using (bucket_id in ('avatars','school-branding'));

drop policy if exists "tenant folder write" on storage.objects;
create policy "tenant folder write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('school-documents','learning-materials','payment-evidence','avatars','school-branding')
    and (split_part(name, '/', 1) = app.current_school_id()::text or app.is_super_admin())
  );

drop policy if exists "tenant folder access" on storage.objects;
create policy "tenant folder access" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('avatars','school-branding')
    or split_part(name, '/', 1) = app.current_school_id()::text
    or app.is_super_admin()
  );
