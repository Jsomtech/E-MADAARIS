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
