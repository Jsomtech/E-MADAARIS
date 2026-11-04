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
