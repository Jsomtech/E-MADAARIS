-- 0015: Audit logs and file metadata. Audit history is append-only by policy.
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools (id) on delete set null,
  user_id uuid,                            -- school_users.id or platform_users.id
  user_scope text not null default 'school',
  action text not null,                    -- created | updated | deleted | login | approved | published | verified ...
  module text not null,
  record_id text,
  summary text,
  ip_address text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'success',  -- success | failure
  created_at timestamptz not null default now()
);

create table file_metadata (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools (id) on delete cascade,
  bucket text not null,
  file_path text not null,
  original_name text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create index idx_audit_school on audit_logs (school_id, created_at);
create index idx_audit_module on audit_logs (module, created_at);

-- Append-only protection: no updates/deletes through authenticated roles.
revoke update, delete on audit_logs from authenticated, anon;
