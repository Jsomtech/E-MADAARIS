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
