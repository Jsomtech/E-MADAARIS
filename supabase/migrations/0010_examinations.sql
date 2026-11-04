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
