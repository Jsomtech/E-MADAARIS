-- 0013: Communication — announcements, notifications, templates, support tickets
create table announcements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools (id) on delete cascade,   -- null = platform-wide
  audience text not null default 'all',               -- all | students | parents | teachers | staff | class
  class_id uuid references classes (id) on delete set null,
  title text not null,
  body text,
  created_by uuid references school_users (id) on delete set null,
  published_at timestamptz,
  status text not null default 'published',           -- draft | published | archived
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools (id) on delete cascade,
  recipient_user_id uuid not null,                    -- school_users.id or platform_users.id
  recipient_scope text not null default 'school',     -- school | platform
  category text not null default 'general',
  title text not null,
  body text,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  school_user_id uuid not null references school_users (id) on delete cascade,
  category text not null,
  in_app boolean not null default true,
  email boolean not null default false,
  unique (school_user_id, category)
);

create table email_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,  -- school_registration_confirmation, staff_invitation ...
  subject text not null,
  body_html text not null,
  variables jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools (id) on delete set null,
  created_by_platform_user uuid references platform_users (id),
  created_by_school_user uuid references school_users (id),
  category text not null default 'technical',
  subject text not null,
  body text,
  priority text not null default 'medium',            -- low | medium | high | urgent
  status text not null default 'open',                -- open | in_progress | waiting_for_school | resolved | closed
  assigned_to uuid references platform_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table support_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets (id) on delete cascade,
  reply_body text not null,
  is_internal_note boolean not null default false,
  author_platform_user uuid references platform_users (id),
  author_school_user uuid references school_users (id),
  attachment_url text,
  created_at timestamptz not null default now()
);

create trigger trg_announcements_touch before update on announcements
for each row execute function app_touch_updated_at();
create trigger trg_tickets_touch before update on support_tickets
for each row execute function app_touch_updated_at();

create index idx_notifications_recipient on notifications (recipient_user_id, is_read);
create index idx_tickets_status on support_tickets (status);
