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
