-- ============================================================================
-- E-MADAARIS — complete database bootstrap (fresh Supabase project)
-- Generated from supabase/migrations/0001…0015 + 0090_rls.sql + seed.sql.
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- It creates the full schema, RLS policies, permission catalog, platform roles,
-- subscription plans and email templates. It does NOT create the Super Admin login:
-- after this succeeds run  npm run db:seed -w server  with SUPERADMIN_EMAIL /
-- SUPERADMIN_PASSWORD set in .env.
-- ============================================================================

-- ============================================================================
-- supabase/migrations/0001_core_helpers.sql
-- ============================================================================

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

-- ============================================================================
-- supabase/migrations/0002_platform_rbac.sql
-- ============================================================================

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

-- ============================================================================
-- supabase/migrations/0003_schools.sql
-- ============================================================================

-- 0003: Schools (tenants), registrations/applications, settings, domains
create table schools (
  id uuid primary key default gen_random_uuid(),
  school_name text not null,
  registration_number text unique,
  logo_url text,
  school_type text not null default 'primary_secondary', -- primary | secondary | primary_secondary | integrated
  email text,
  phone text,
  country text not null default 'Somalia',
  region text,
  city text,
  address text,
  status text not null default 'pending_approval', -- pending_approval | trial | active | past_due | suspended | expired | cancelled | archived
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table school_registrations (
  id uuid primary key default gen_random_uuid(),
  school_name text not null,
  school_type text not null,
  registration_number text,
  country text, region text, city text, address text,
  school_email text not null,
  school_phone text,
  admin_full_name text not null,
  admin_email text not null,
  admin_phone text,
  plan_id uuid, -- FK added in 0004 (subscription_plans is created there)
  message text,
  status text not null default 'submitted', -- submitted | under_review | approved | rejected
  rejection_reason text,
  reviewed_by uuid references platform_users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table school_settings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null unique references schools (id) on delete cascade,
  academic_year_id uuid,
  default_language text not null default 'so',  -- so | en
  currency text not null default 'SOS',
  timezone text not null default 'Africa/Mogadishu',
  school_working_days text[] not null default '{Sat,Sun,Mon,Tue,Wed}',
  grading_configuration jsonb not null default '{}'::jsonb,
  attendance_configuration jsonb not null default '{}'::jsonb,
  branding jsonb not null default '{}'::jsonb,
  limits_override jsonb not null default '{}'::jsonb,   -- school-specific limits set by Super Admin
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table school_domains (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  domain text not null unique,
  verification_status text not null default 'unverified',
  created_at timestamptz not null default now()
);

create trigger trg_schools_touch before update on schools
for each row execute function app_touch_updated_at();
create trigger trg_school_registrations_touch before update on school_registrations
for each row execute function app_touch_updated_at();
create trigger trg_school_settings_touch before update on school_settings
for each row execute function app_touch_updated_at();

create index idx_schools_status on schools (status);
create index idx_school_registrations_status on school_registrations (status);

-- ============================================================================
-- supabase/migrations/0004_subscriptions_billing.sql
-- ============================================================================

-- 0004: Subscription plans, tenant subscriptions, SaaS billing (separate domain from school fees)
create table subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  monthly_price numeric(12,2) not null default 0,
  quarterly_price numeric(12,2),
  annual_price numeric(12,2),
  currency text not null default 'USD',
  trial_days int not null default 14,
  max_students int not null default 100,
  max_staff int not null default 20,
  max_storage_mb int not null default 1024,
  max_branches int not null default 1,
  grace_period_days int not null default 7,
  renewal_settings jsonb not null default '{}'::jsonb,
  feature_restrictions jsonb not null default '{}'::jsonb,
  status text not null default 'published', -- draft | published | disabled | archived
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table plan_features (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references subscription_plans (id) on delete cascade,
  feature_key text not null,        -- students.management, examinations, digital_learning ...
  enabled boolean not null default true,
  limit_value int,
  unique (plan_id, feature_key)
);

create table school_subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  plan_id uuid not null references subscription_plans (id),
  status text not null default 'trial', -- pending | trial | active | past_due | suspended | expired | cancelled
  billing_cycle text not null default 'monthly', -- monthly | quarterly | annual
  start_date timestamptz not null default now(),
  end_date timestamptz,
  trial_end_date timestamptz,
  grace_period_end timestamptz,
  auto_renew boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table saas_invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  subscription_id uuid references school_subscriptions (id),
  invoice_number text not null unique,
  billing_period_start timestamptz,
  billing_period_end timestamptz,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  currency text not null default 'USD',
  due_date timestamptz,
  status text not null default 'open', -- draft | open | paid | partial | overdue | void
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table subscription_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  subscription_id uuid references school_subscriptions (id),
  invoice_id uuid references saas_invoices (id),
  transaction_reference text not null unique,
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  payment_method text not null default 'manual', -- manual | bank_transfer | mobile_money | provider
  provider_reference text,
  evidence_url text,
  status text not null default 'pending', -- pending | processing | successful | failed | rejected | refunded | cancelled
  verification_status text not null default 'unverified', -- unverified | verified | rejected
  verified_by uuid references platform_users (id),
  paid_at timestamptz,
  recorded_by uuid references platform_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table promotional_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null default 'percent', -- percent | fixed
  discount_value numeric(12,2) not null,
  start_date timestamptz,
  end_date timestamptz,
  usage_limit int,
  used_count int not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table school_registrations
  add constraint school_registrations_plan_fk
  foreign key (plan_id) references subscription_plans (id);

create trigger trg_subscription_plans_touch before update on subscription_plans
for each row execute function app_touch_updated_at();
create trigger trg_school_subscriptions_touch before update on school_subscriptions
for each row execute function app_touch_updated_at();
create trigger trg_saas_invoices_touch before update on saas_invoices
for each row execute function app_touch_updated_at();
create trigger trg_subscription_payments_touch before update on subscription_payments
for each row execute function app_touch_updated_at();

create index idx_school_subscriptions_school on school_subscriptions (school_id);
create index idx_saas_invoices_school on saas_invoices (school_id);
create index idx_subscription_payments_school on subscription_payments (school_id);
create index idx_subscription_payments_status on subscription_payments (status);

-- ============================================================================
-- supabase/migrations/0005_school_users_rbac.sql
-- ============================================================================

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

-- ============================================================================
-- supabase/migrations/0006_academics.sql
-- ============================================================================

-- 0006: Academic structure — years, terms, classes, sections, subjects, assignments, timetables
create table academic_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,                 -- e.g. 2026/2027
  start_date date, end_date date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table terms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  academic_year_id uuid not null references academic_years (id) on delete cascade,
  name text not null,                 -- Term 1 / Semester 1
  start_date date, end_date date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (academic_year_id, name)
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,                 -- Grade 1, Form 2 ...
  level int,
  capacity int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);

create table sections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  class_id uuid not null references classes (id) on delete cascade,
  name text not null,                 -- A, B, C
  capacity int,
  unique (class_id, name)
);

create table subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,
  code text,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table class_subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  class_id uuid not null references classes (id) on delete cascade,
  subject_id uuid not null references subjects (id) on delete cascade,
  unique (class_id, subject_id)
);

create table classrooms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,
  capacity int,
  unique (school_id, name)
);

-- teacher = school_user with a teaching role
create table teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  school_user_id uuid not null references school_users (id) on delete cascade,
  class_id uuid references classes (id) on delete cascade,
  subject_id uuid references subjects (id) on delete cascade,
  is_homeroom boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_user_id, class_id, subject_id)
);

create table timetable_periods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,                 -- P1 .. P8
  start_time time, end_time time,
  sort_order int not null default 0,
  unique (school_id, name)
);

create table timetable_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  class_id uuid not null references classes (id) on delete cascade,
  subject_id uuid not null references subjects (id) on delete cascade,
  teacher_id uuid references school_users (id) on delete set null,
  classroom_id uuid references classrooms (id) on delete set null,
  day_of_week text not null,          -- Sat..Fri
  period_id uuid not null references timetable_periods (id) on delete cascade,
  academic_year_id uuid references academic_years (id),
  unique (class_id, period_id, day_of_week)
);

create trigger trg_classes_touch before update on classes
for each row execute function app_touch_updated_at();

create index idx_timetable_lookup on timetable_entries (school_id, day_of_week);
create index idx_teacher_assignments_user on teacher_assignments (school_user_id);

-- ============================================================================
-- supabase/migrations/0007_students.sql
-- ============================================================================

-- 0007: Students, guardians, documents
create table students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  user_id uuid references school_users (id) on delete set null,
  admission_number text not null,
  first_name text not null,
  middle_name text,
  last_name text,
  full_name text generated always as (
    -- concat_ws() is STABLE, so generated columns must build the string with || instead.
    btrim(regexp_replace(
      coalesce(first_name, '') || ' ' || coalesce(middle_name, '') || ' ' || coalesce(last_name, ''),
      ' +', ' ', 'g'
    ))
  ) stored,
  gender text,                                        -- male | female
  date_of_birth date,
  photo_url text,
  admission_date date not null default current_date,
  academic_year_id uuid references academic_years (id),
  class_id uuid references classes (id),
  section_id uuid references sections (id),
  previous_school text,
  address text,
  emergency_contact text,
  hemis_id text,                                      -- migration 0016: unique per school, typed by the school
  phone text,
  notes text,
  status text not null default 'active',              -- active | inactive | transferred | withdrawn | graduated
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, admission_number)
);

create unique index students_school_hemis_uidx
  on students (school_id, upper(hemis_id))
  where hemis_id is not null and btrim(hemis_id) <> '';

create table guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  user_id uuid references school_users (id) on delete set null,
  full_name text not null,
  phone text,
  email text,
  address text,
  relationship text not null default 'parent',
  occupation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table student_guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  guardian_id uuid not null references guardians (id) on delete cascade,
  relationship text not null default 'parent',
  is_primary boolean not null default false,
  unique (student_id, guardian_id)
);

create table student_documents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  document_type text not null,
  file_name text,
  file_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references school_users (id),
  created_at timestamptz not null default now()
);

create trigger trg_students_touch before update on students
for each row execute function app_touch_updated_at();
create trigger trg_guardians_touch before update on guardians
for each row execute function app_touch_updated_at();

create index idx_students_school_class on students (school_id, class_id);
create index idx_students_school_status on students (school_id, status);
create index idx_student_guardians_student on student_guardians (student_id);

-- ============================================================================
-- supabase/migrations/0008_staff.sql
-- ============================================================================

-- 0008: Staff profiles, departments, staff attendance & documents
create table staff_departments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,
  unique (school_id, name)
);

create table staff_profiles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  school_user_id uuid not null references school_users (id) on delete cascade,
  job_title text,
  department_id uuid references staff_departments (id) on delete set null,
  hire_date date,
  employee_number text,
  employment_status text not null default 'active',   -- active | on_leave | terminated
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, school_user_id)
);

create table staff_attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  school_user_id uuid not null references school_users (id) on delete cascade,
  attendance_date date not null,
  attendance_status text not null,                    -- present | absent | late | excused
  remarks text,
  marked_by uuid references school_users (id),
  created_at timestamptz not null default now(),
  unique (school_id, school_user_id, attendance_date)
);

create table staff_documents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  school_user_id uuid not null references school_users (id) on delete cascade,
  document_type text not null,
  file_path text not null,
  uploaded_by uuid references school_users (id),
  created_at timestamptz not null default now()
);

-- Leave requests (HR Officer module)
create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  school_user_id uuid not null references school_users (id) on delete cascade,
  leave_type text,
  start_date date, end_date date,
  reason text,
  status text not null default 'pending',             -- pending | approved | rejected
  reviewed_by uuid references school_users (id),
  created_at timestamptz not null default now()
);

create trigger trg_staff_profiles_touch before update on staff_profiles
for each row execute function app_touch_updated_at();
create index idx_staff_attendance_date on staff_attendance (school_id, attendance_date);

-- ============================================================================
-- supabase/migrations/0009_attendance.sql
-- ============================================================================

-- 0009: Student attendance (sessions + records + corrections)
create table attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  class_id uuid not null references classes (id) on delete cascade,
  subject_id uuid references subjects (id) on delete set null,
  session_date date not null,
  session_type text not null default 'daily',         -- daily | subject
  status text not null default 'open',                -- open | submitted | approved
  created_by uuid references school_users (id),
  created_at timestamptz not null default now()
);

create unique index attendance_sessions_unique
  on attendance_sessions (school_id, class_id, subject_id, session_date) nulls not distinct;

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  session_id uuid references attendance_sessions (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  class_id uuid references classes (id),
  subject_id uuid references subjects (id),
  attendance_date date not null,
  attendance_status text not null,                    -- present | absent | late | excused
  remarks text,
  marked_by uuid references school_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index attendance_records_unique
  on attendance_records (school_id, student_id, attendance_date, subject_id) nulls not distinct;

create table attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  attendance_record_id uuid references attendance_records (id) on delete cascade,
  student_id uuid references students (id),
  requested_by uuid references school_users (id),
  original_status text,
  requested_status text,
  reason text,
  status text not null default 'pending',             -- pending | approved | rejected
  reviewed_by uuid references school_users (id),
  created_at timestamptz not null default now()
);

create index idx_attendance_lookup on attendance_records (school_id, attendance_date);
create index idx_attendance_student on attendance_records (student_id, attendance_date);

-- ============================================================================
-- supabase/migrations/0010_examinations.sql
-- ============================================================================

-- 0010: Examinations, marks, grading, results workflow
create table examination_types (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,                                 -- midterm | final | quiz ...
  description text,
  unique (school_id, name)
);

create table examinations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  examination_type_id uuid references examination_types (id),
  academic_year_id uuid references academic_years (id),
  term_id uuid references terms (id),
  name text not null,
  status text not null default 'draft',               -- draft | scheduled | in_progress | completed | published | archived
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table exam_class_subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  examination_id uuid not null references examinations (id) on delete cascade,
  class_id uuid not null references classes (id) on delete cascade,
  subject_id uuid not null references subjects (id) on delete cascade,
  total_marks numeric(6,2) not null default 100,
  unique (examination_id, class_id, subject_id)
);

create table examination_components (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  exam_class_subject_id uuid not null references exam_class_subjects (id) on delete cascade,
  name text not null,                                 -- continuous assessment, exam paper
  weight_percent numeric(5,2) not null default 100,
  maximum_marks numeric(6,2) not null default 100,
  unique (exam_class_subject_id, name)
);

create table examination_schedules (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  exam_class_subject_id uuid not null references exam_class_subjects (id) on delete cascade,
  exam_date date not null,
  start_time time, end_time time,
  classroom_id uuid references classrooms (id) on delete set null,
  unique (exam_class_subject_id, exam_date, start_time)
);

create table examination_invigilators (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  schedule_id uuid not null references examination_schedules (id) on delete cascade,
  school_user_id uuid not null references school_users (id) on delete cascade,
  unique (schedule_id, school_user_id)
);

create table examination_attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  schedule_id uuid not null references examination_schedules (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  attendance_status text not null,                    -- present | absent | late
  cleared_for_exam boolean not null default true,     -- fee clearance gate
  recorded_by uuid references school_users (id),
  created_at timestamptz not null default now(),
  unique (schedule_id, student_id)
);

create table marks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  examination_id uuid not null references examinations (id) on delete cascade,
  exam_class_subject_id uuid not null references exam_class_subjects (id) on delete cascade,
  component_id uuid references examination_components (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  subject_id uuid references subjects (id),
  class_id uuid references classes (id),
  marks_obtained numeric(6,2) not null check (marks_obtained >= 0),
  maximum_marks numeric(6,2) not null default 100 check (maximum_marks > 0),
  entered_by uuid references school_users (id),
  approval_status text not null default 'draft',      -- draft | submitted | approved | rejected
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (component_id, student_id)
);

create table grade_scales (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  unique (school_id, name)
);

create table grade_ranges (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  grade_scale_id uuid not null references grade_scales (id) on delete cascade,
  grade_label text not null,                          -- A, B, C ...
  min_percent numeric(5,2) not null,
  max_percent numeric(5,2) not null,
  remark text,
  unique (grade_scale_id, grade_label)
);

create table result_approvals (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  examination_id uuid not null references examinations (id) on delete cascade,
  class_id uuid references classes (id),
  subject_id uuid references subjects (id),
  status text not null default 'pending',             -- pending | approved | rejected
  submitted_by uuid references school_users (id),
  reviewed_by uuid references school_users (id),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table report_cards (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  examination_id uuid not null references examinations (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  overall_average numeric(5,2),
  class_rank int,
  status text not null default 'generated',
  pdf_path text,
  created_at timestamptz not null default now(),
  unique (examination_id, student_id)
);

create trigger trg_examinations_touch before update on examinations
for each row execute function app_touch_updated_at();
create trigger trg_marks_touch before update on marks
for each row execute function app_touch_updated_at();
create trigger trg_result_approvals_touch before update on result_approvals
for each row execute function app_touch_updated_at();

create index idx_marks_exam_student on marks (examination_id, student_id);
create index idx_marks_school_status on marks (school_id, approval_status);

-- ============================================================================
-- supabase/migrations/0011_finance.sql
-- ============================================================================

-- 0011: School finance (student fees) — separate domain from SaaS subscription billing
create table fee_categories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,
  description text,
  is_examination_fee boolean not null default false,
  unique (school_id, name)
);

create table fee_structures (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  category_id uuid not null references fee_categories (id),
  academic_year_id uuid references academic_years (id),
  term_id uuid references terms (id),
  class_id uuid references classes (id),
  amount numeric(12,2) not null,
  due_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table student_fee_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  fee_structure_id uuid not null references fee_structures (id) on delete cascade,
  amount numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  status text not null default 'outstanding',         -- outstanding | partial | paid | waived
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, fee_structure_id)
);

create table fee_invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  invoice_number text not null,
  term_id uuid references terms (id),
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  balance numeric(12,2) not null default 0,
  currency text not null default 'SOS',
  due_date date,
  status text not null default 'open',                -- open | partial | paid | void
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, invoice_number)
);

create table fee_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  invoice_id uuid references fee_invoices (id),
  transaction_reference text not null unique,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'SOS',
  payment_method text not null default 'cash',        -- cash | mobile_money | bank | other
  provider_reference text,
  evidence_url text,
  status text not null default 'successful',          -- pending | processing | successful | failed | rejected | refunded | cancelled
  note text,
  received_by uuid references school_users (id),
  paid_at timestamptz not null default now(),
  reversed boolean not null default false,
  reversed_by uuid references school_users (id),
  reversal_reason text,
  created_at timestamptz not null default now()
);

create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  payment_id uuid not null references fee_payments (id) on delete cascade,
  fee_assignment_id uuid not null references student_fee_assignments (id) on delete cascade,
  amount numeric(12,2) not null,
  unique (payment_id, fee_assignment_id)
);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  payment_id uuid not null references fee_payments (id) on delete cascade,
  receipt_number text not null unique,
  student_id uuid references students (id),
  amount numeric(12,2) not null,
  currency text not null default 'SOS',
  issued_by uuid references school_users (id),
  pdf_path text,
  created_at timestamptz not null default now()
);

create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,
  unique (school_id, name)
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  category_id uuid references expense_categories (id),
  title text not null,
  description text,
  amount numeric(12,2) not null,
  currency text not null default 'SOS',
  expense_date date not null default current_date,
  evidence_url text,
  status text not null default 'pending_approval',    -- pending_approval | approved | rejected | paid
  requested_by uuid references school_users (id),
  approved_by uuid references school_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table financial_approvals (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  entity_type text not null,                          -- expense | payment_reversal | discount
  entity_id uuid not null,
  action text not null,
  status text not null default 'pending',             -- pending | approved | rejected
  requested_by uuid references school_users (id),
  reviewed_by uuid references school_users (id),
  reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table examination_clearances (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  examination_id uuid references examinations (id) on delete cascade,
  required_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  status text not null default 'unpaid',              -- not_required | unpaid | partially_paid | paid | pending_verification | cleared | blocked
  payment_id uuid references fee_payments (id),
  verified_by uuid references school_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, student_id, examination_id)
);

create trigger trg_fee_assignments_touch before update on student_fee_assignments
for each row execute function app_touch_updated_at();
create trigger trg_fee_invoices_touch before update on fee_invoices
for each row execute function app_touch_updated_at();
create trigger trg_expenses_touch before update on expenses
for each row execute function app_touch_updated_at();
create trigger trg_clearances_touch before update on examination_clearances
for each row execute function app_touch_updated_at();

create index idx_fee_payments_school_date on fee_payments (school_id, paid_at);
create index idx_fee_assignments_student on student_fee_assignments (student_id);

-- ============================================================================
-- supabase/migrations/0012_learning.sql
-- ============================================================================

-- 0012: Digital learning — materials, assignments, submissions, grading
create table learning_materials (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  class_id uuid references classes (id) on delete cascade,
  subject_id uuid references subjects (id) on delete cascade,
  teacher_id uuid references school_users (id) on delete set null,
  title text not null,
  description text,
  material_type text not null default 'document',     -- document | presentation | video | note
  file_path text,
  file_name text,
  size_bytes bigint,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  class_id uuid not null references classes (id) on delete cascade,
  subject_id uuid references subjects (id),
  teacher_id uuid references school_users (id),
  title text not null,
  instructions text,
  due_date timestamptz,
  maximum_marks numeric(6,2) not null default 100,
  status text not null default 'open',                -- open | closed | archived
  created_at timestamptz not null default now()
);

create table assignment_attachments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  assignment_id uuid not null references assignments (id) on delete cascade,
  file_path text not null,
  file_name text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create table assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  assignment_id uuid not null references assignments (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  note text,
  file_path text,
  file_name text,
  submitted_at timestamptz not null default now(),
  is_late boolean not null default false,
  unique (assignment_id, student_id)
);

create table assignment_grades (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  submission_id uuid not null unique references assignment_submissions (id) on delete cascade,
  assignment_id uuid references assignments (id),
  student_id uuid references students (id),
  marks numeric(6,2),
  feedback text,
  graded_by uuid references school_users (id),
  created_at timestamptz not null default now()
);

create index idx_assignments_class on assignments (school_id, class_id);
create index idx_submissions_assignment on assignment_submissions (assignment_id);

-- ============================================================================
-- supabase/migrations/0013_communication.sql
-- ============================================================================

-- 0013: Communication — announcements, notifications, templates, support tickets
create table announcements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools (id) on delete cascade,   -- null = platform-wide
  audience text not null default 'all',               -- all | students | parents | teachers | staff | class
  class_id uuid references classes (id) on delete set null,
  title text not null,
  body text,
  created_by uuid references school_users (id) on delete set null,
  published_at timestamptz,
  status text not null default 'published',           -- draft | published | archived
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools (id) on delete cascade,
  recipient_user_id uuid not null,                    -- school_users.id or platform_users.id
  recipient_scope text not null default 'school',     -- school | platform
  category text not null default 'general',
  title text not null,
  body text,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  school_user_id uuid not null references school_users (id) on delete cascade,
  category text not null,
  in_app boolean not null default true,
  email boolean not null default false,
  unique (school_user_id, category)
);

create table email_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,  -- school_registration_confirmation, staff_invitation ...
  subject text not null,
  body_html text not null,
  variables jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools (id) on delete set null,
  created_by_platform_user uuid references platform_users (id),
  created_by_school_user uuid references school_users (id),
  category text not null default 'technical',
  subject text not null,
  body text,
  priority text not null default 'medium',            -- low | medium | high | urgent
  status text not null default 'open',                -- open | in_progress | waiting_for_school | resolved | closed
  assigned_to uuid references platform_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table support_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets (id) on delete cascade,
  reply_body text not null,
  is_internal_note boolean not null default false,
  author_platform_user uuid references platform_users (id),
  author_school_user uuid references school_users (id),
  attachment_url text,
  created_at timestamptz not null default now()
);

create trigger trg_announcements_touch before update on announcements
for each row execute function app_touch_updated_at();
create trigger trg_tickets_touch before update on support_tickets
for each row execute function app_touch_updated_at();

create index idx_notifications_recipient on notifications (recipient_user_id, is_read);
create index idx_tickets_status on support_tickets (status);

-- ============================================================================
-- supabase/migrations/0014_extra_modules.sql
-- ============================================================================

-- 0014: Certificates, library, discipline, transport, laboratory, reception, ID cards
create table certificate_templates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,
  template_type text not null default 'certificate',  -- certificate | transcript | admission_letter | id_card
  body_html text,
  unique (school_id, name)
);

create table certificates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  template_id uuid references certificate_templates (id),
  certificate_type text not null,                     -- graduation | completion | enrollment | transfer
  reference_number text not null unique,
  issued_date date not null default current_date,
  signature_name text,
  status text not null default 'issued',
  issued_by uuid references school_users (id),
  pdf_path text,
  created_at timestamptz not null default now()
);

create table student_id_cards (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  verification_code text not null unique,
  academic_year text,
  created_at timestamptz not null default now(),
  unique (school_id, student_id)
);

create table library_books (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  title text not null,
  author text,
  isbn text,
  category text,
  total_copies int not null default 1,
  available_copies int not null default 1,
  created_at timestamptz not null default now()
);

create table library_transactions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  book_id uuid not null references library_books (id) on delete cascade,
  borrower_type text not null default 'student',      -- student | staff
  student_id uuid references students (id) on delete cascade,
  school_user_id uuid references school_users (id) on delete cascade,
  borrowed_at timestamptz not null default now(),
  due_date date,
  returned_at timestamptz,
  status text not null default 'borrowed',            -- borrowed | returned | overdue | lost | damaged
  remarks text
);

create table discipline_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  incident_date date not null default current_date,
  incident_type text,
  description text,
  action_taken text,
  follow_up text,
  status text not null default 'open',                -- open | under_review | resolved
  reported_by uuid references school_users (id),
  reviewed_by uuid references school_users (id),
  created_at timestamptz not null default now()
);

create table transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  plate_number text not null,
  vehicle_type text,
  capacity int,
  status text not null default 'active',
  unique (school_id, plate_number)
);

create table transport_drivers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  full_name text not null,
  phone text,
  license_number text,
  status text not null default 'active'
);

create table transport_routes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,
  description text,
  vehicle_id uuid references transport_vehicles (id) on delete set null,
  driver_id uuid references transport_drivers (id) on delete set null,
  monthly_fee numeric(12,2),
  schedule text,
  status text not null default 'active'
);

create table student_transport_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  route_id uuid not null references transport_routes (id) on delete cascade,
  pickup_point text,
  fee_status text not null default 'unpaid',
  unique (student_id, route_id)
);

create table lab_equipment (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,
  category text,
  quantity int not null default 1,
  condition text not null default 'available',        -- available | in_use | damaged | maintenance
  location text,
  notes text,
  created_at timestamptz not null default now()
);

create table equipment_allocations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  equipment_id uuid not null references lab_equipment (id) on delete cascade,
  allocated_to text,
  allocated_at timestamptz not null default now(),
  returned_at timestamptz,
  status text not null default 'allocated'
);

create table visitors (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  full_name text not null,
  phone text,
  purpose text,
  visiting_whom text,
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  recorded_by uuid references school_users (id)
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  visitor_name text not null,
  department text,
  appointment_date date not null,
  notes text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);

create index idx_library_tx_status on library_transactions (school_id, status);
create index idx_discipline_student on discipline_records (student_id);

-- ============================================================================
-- supabase/migrations/0015_audit_files.sql
-- ============================================================================

-- 0015: Audit logs and file metadata. Audit history is append-only by policy.
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools (id) on delete set null,
  user_id uuid,                            -- school_users.id or platform_users.id
  user_scope text not null default 'school',
  action text not null,                    -- created | updated | deleted | login | approved | published | verified ...
  module text not null,
  record_id text,
  summary text,
  ip_address text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'success',  -- success | failure
  created_at timestamptz not null default now()
);

create table file_metadata (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools (id) on delete cascade,
  bucket text not null,
  file_path text not null,
  original_name text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create index idx_audit_school on audit_logs (school_id, created_at);
create index idx_audit_module on audit_logs (module, created_at);

-- Append-only protection: no updates/deletes through authenticated roles.
revoke update, delete on audit_logs from authenticated, anon;

-- ============================================================================
-- supabase/migrations/0020_transfers_lessons.sql
-- ============================================================================

-- Cross-school student transfers: a request travels between two tenant schools, both
-- administrators act on it, and the super admin sees everything. student_id is nullable so
-- the record survives as an audit trail after the sending school clears the student.
create table if not exists student_transfers (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students (id) on delete set null,
  from_school_id uuid not null references schools (id) on delete cascade,
  to_school_id uuid not null references schools (id) on delete cascade,
  student_name text not null,
  admission_number text,
  reason text not null,
  status text not null default 'requested',          -- requested | completed | rejected | cancelled
  requested_by uuid,
  requested_by_name text,
  decided_by uuid,
  decided_by_name text,
  decision_note text,
  new_student_id uuid,
  payload jsonb not null default '{}'::jsonb,        -- dossier snapshot: guardians, documents, attendance, marks, fees
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_transfers_from_idx on student_transfers (from_school_id, status);
create index if not exists student_transfers_to_idx on student_transfers (to_school_id, status);
create index if not exists student_transfers_student_idx on student_transfers (student_id);

create trigger student_transfers_touch
  before update on student_transfers
  for each row execute function app_touch_updated_at();

-- Only the service role touches this table; direct anon access stays locked down.
alter table student_transfers enable row level security;

-- The receiving school keeps the shared dossier on the student record itself.
alter table students add column if not exists transfer_history jsonb;

-- Video lessons are never uploaded: teachers paste a Google Drive share link.
alter table learning_materials add column if not exists link_url text;

-- ============================================================================
-- supabase/migrations/0090_rls.sql
-- ============================================================================

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

-- ============================================================================
-- supabase/seed.sql
-- ============================================================================

-- E-MADAARIS seed: permission catalogs, platform RBAC defaults, subscription plans.
-- Idempotent: safe to re-run.
-- The Super Admin account itself is created with: npm run db:seed -w server (bootstrap script).

-- 1) School-level permission catalog --------------------------------------------
do $$
declare
  m text;
  a text;
  perms text[] := array[
    'school','users','roles','students','admissions','teachers','staff','guardians',
    'attendance','timetable','examinations','marks','results','finance','learning',
    'announcements','reports','certificates','library','discipline','transport',
    'hr','reception','lab','subscription','support','audit','notifications'
  ];
  actions text[] := array['view','create','edit','delete','approve','reject','submit','publish','export','manage','assign'];
begin
  foreach m in array perms loop
    foreach a in array actions loop
      insert into school_permissions (permission_key, module, description)
      values (m || '.' || a, m, initcap(m) || ' - ' || a)
      on conflict (permission_key) do nothing;
    end loop;
  end loop;
end $$;

-- 2) Platform roles & permissions -------------------------------------------------
insert into platform_roles (name, description) values
  ('super_admin', 'Full platform ownership'),
  ('platform_support', 'Support-only platform access')
on conflict (name) do nothing;

do $$
declare k text; begin
  foreach k in array array[
    'platform.dashboard.view','platform.schools.view','platform.schools.create','platform.schools.approve',
    'platform.schools.edit','platform.schools.suspend','platform.plans.manage','platform.subscriptions.manage',
    'platform.billing.view','platform.billing.manage','platform.payments.verify','platform.users.manage',
    'platform.roles.manage','platform.analytics.view','platform.reports.export','platform.tickets.manage',
    'platform.audit.view','platform.settings.manage'
  ] loop
    insert into platform_permissions (permission_key, module, description)
    values (k, split_part(k,'.','2'), k) on conflict (permission_key) do nothing;
  end loop;
end $$;

insert into platform_role_permissions (role_id, permission_id)
select r.id, p.id from platform_roles r cross join platform_permissions p
where r.name = 'super_admin'
on conflict (role_id, permission_id) do nothing;

insert into platform_role_permissions (role_id, permission_id)
select r.id, p.id from platform_roles r join platform_permissions p
  on p.permission_key in ('platform.dashboard.view','platform.schools.view','platform.tickets.manage',
                          'platform.analytics.view','platform.billing.view')
where r.name = 'platform_support'
on conflict (role_id, permission_id) do nothing;

-- 3) Subscription plans -------------------------------------------------------------
insert into subscription_plans (name, description, monthly_price, quarterly_price, annual_price,
  currency, trial_days, max_students, max_staff, max_storage_mb, grace_period_days, status, sort_order)
values
  ('Basic','Student, teacher, class management, attendance, basic reports.', 29, 79, 279, 'USD', 14, 150, 15, 1024, 7, 'published', 1),
  ('Standard','All Basic plus examinations, results, fees and parent portal.', 59, 159, 549, 'USD', 14, 500, 40, 5120, 7, 'published', 2),
  ('Premium','All Standard plus digital learning, advanced analytics and certificates.', 99, 269, 949, 'USD', 21, 1500, 120, 20480, 14, 'published', 3),
  ('Enterprise','Configurable package with custom limits and dedicated support.', 0, 0, 0, 'USD', 30, 100000, 10000, 102400, 30, 'published', 4)
on conflict do nothing;

-- 4) Feature entitlements per plan ---------------------------------------------------
do $$
declare pid uuid; fname text;
declare features text[] := array[
  'students.management','teachers.management','classes.subjects','attendance',
  'examinations','results','fees','parent.portal','digital.learning',
  'advanced.analytics','certificates','library','discipline','transport','hr'
];
begin
  select id into pid from subscription_plans where name = 'Basic';
  if found then
    insert into plan_features (plan_id, feature_key, enabled) values
      (pid,'students.management',true),(pid,'teachers.management',true),(pid,'classes.subjects',true),
      (pid,'attendance',true),(pid,'examinations',false),(pid,'results',false),(pid,'fees',false),
      (pid,'parent.portal',false),(pid,'digital.learning',false),(pid,'advanced.analytics',false),
      (pid,'certificates',false),(pid,'library',false),(pid,'discipline',false),(pid,'transport',false),(pid,'hr',false)
    on conflict (plan_id, feature_key) do update set enabled = excluded.enabled;
  end if;

  select id into pid from subscription_plans where name = 'Standard';
  if found then
    insert into plan_features (plan_id, feature_key, enabled) values
      (pid,'students.management',true),(pid,'teachers.management',true),(pid,'classes.subjects',true),
      (pid,'attendance',true),(pid,'examinations',true),(pid,'results',true),(pid,'fees',true),
      (pid,'parent.portal',true),(pid,'digital.learning',false),(pid,'advanced.analytics',false),
      (pid,'certificates',true),(pid,'library',false),(pid,'discipline',true),(pid,'transport',false),(pid,'hr',true)
    on conflict (plan_id, feature_key) do update set enabled = excluded.enabled;
  end if;

  select id into pid from subscription_plans where name = 'Premium';
  if found then
    insert into plan_features (plan_id, feature_key, enabled)
    select pid, f, true from unnest(features) f
    on conflict (plan_id, feature_key) do update set enabled = true;
  end if;

  select id into pid from subscription_plans where name = 'Enterprise';
  if found then
    insert into plan_features (plan_id, feature_key, enabled)
    select pid, f, true from unnest(features) f
    on conflict (plan_id, feature_key) do update set enabled = true;
  end if;
end $$;

-- 5) Core email templates -------------------------------------------------------------
insert into email_templates (template_key, subject, body_html, variables) values
  ('school_registration_confirmation','Welcome to E-MADAARIS, {{school_name}}',
   '<p>Dear {{admin_name}},</p><p>Your school registration for <strong>{{school_name}}</strong> was received. Status: {{status}}.</p>',
   '["school_name","admin_name","status"]'),
  ('school_application_approved','Your school application is approved',
   '<p>Dear {{admin_name}},</p><p>{{school_name}} has been approved. Activate your account: <a href="{{activation_link}}">Activate now</a></p>',
   '["admin_name","school_name","activation_link"]'),
  ('school_application_rejected','School application update',
   '<p>Dear {{admin_name}},</p><p>Your application for {{school_name}} was not approved. Reason: {{reason}}</p>',
   '["admin_name","school_name","reason"]'),
  ('staff_invitation','You are invited to join {{school_name}} on E-MADAARIS',
   '<p>Dear {{user_name}},</p><p>{{school_name}} invited you as {{role}}. Accept: <a href="{{invitation_link}}">Join now</a> (expires {{expires_at}})</p>',
   '["user_name","school_name","role","invitation_link","expires_at"]'),
  ('password_reset','Reset your E-MADAARIS password',
   '<p>Use this secure link to reset your password: <a href="{{reset_link}}">Reset password</a></p>',
   '["reset_link"]'),
  ('subscription_activated','Subscription active — {{school_name}}',
   '<p>Plan {{plan}} is active until {{end_date}}.</p>',
   '["plan","end_date"]'),
  ('subscription_renewal_reminder','Renew your E-MADAARIS subscription',
   '<p>Invoice {{invoice_number}} for {{amount}} is due {{due_date}}.</p>',
   '["invoice_number","amount","due_date"]'),
  ('payment_confirmed','Payment received — {{transaction_reference}}',
   '<p>We confirmed your payment of {{amount}} on {{paid_at}}.</p>',
   '["transaction_reference","amount","paid_at"]')
on conflict (template_key) do nothing;

-- ============================================================================
-- Sanity check (optional): run these to confirm the bootstrap succeeded.
-- ============================================================================
-- select count(*) as public_tables from information_schema.tables
--   where table_schema = 'public' and table_type = 'BASE TABLE';          -- expect 93
-- select count(*) as school_permissions from school_permissions;         -- expect 308
-- select count(*) as platform_permissions from platform_permissions;     -- expect 18
-- select name, monthly_price, status from subscription_plans order by sort_order;
