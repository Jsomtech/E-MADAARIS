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
