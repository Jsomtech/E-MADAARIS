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
  status text not null default 'active',              -- active | inactive | transferred | withdrawn | graduated
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, admission_number)
);

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
