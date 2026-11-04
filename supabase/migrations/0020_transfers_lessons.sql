-- 0020: Cross-school student transfers + lesson share links (Google Drive videos)

-- Transfer requests travel between two tenant schools; both school administrators act on
-- them and the super admin sees everything. student_id is nullable on purpose: once the
-- sending school clears the student, the request must survive as the audit record.
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
  payload jsonb not null default '{}'::jsonb,        -- dossier snapshot: guardians, documents, attendance, marks
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
