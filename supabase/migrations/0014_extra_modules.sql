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
