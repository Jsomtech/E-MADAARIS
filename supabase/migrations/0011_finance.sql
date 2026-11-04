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
