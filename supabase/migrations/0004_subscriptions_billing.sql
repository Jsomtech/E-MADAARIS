-- 0004: Subscription plans, tenant subscriptions, SaaS billing (separate domain from school fees)
create table subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  monthly_price numeric(12,2) not null default 0,
  quarterly_price numeric(12,2),
  annual_price numeric(12,2),
  currency text not null default 'USD',
  trial_days int not null default 14,
  max_students int not null default 100,
  max_staff int not null default 20,
  max_storage_mb int not null default 1024,
  max_branches int not null default 1,
  grace_period_days int not null default 7,
  renewal_settings jsonb not null default '{}'::jsonb,
  feature_restrictions jsonb not null default '{}'::jsonb,
  status text not null default 'published', -- draft | published | disabled | archived
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table plan_features (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references subscription_plans (id) on delete cascade,
  feature_key text not null,        -- students.management, examinations, digital_learning ...
  enabled boolean not null default true,
  limit_value int,
  unique (plan_id, feature_key)
);

create table school_subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  plan_id uuid not null references subscription_plans (id),
  status text not null default 'trial', -- pending | trial | active | past_due | suspended | expired | cancelled
  billing_cycle text not null default 'monthly', -- monthly | quarterly | annual
  start_date timestamptz not null default now(),
  end_date timestamptz,
  trial_end_date timestamptz,
  grace_period_end timestamptz,
  auto_renew boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table saas_invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  subscription_id uuid references school_subscriptions (id),
  invoice_number text not null unique,
  billing_period_start timestamptz,
  billing_period_end timestamptz,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  currency text not null default 'USD',
  due_date timestamptz,
  status text not null default 'open', -- draft | open | paid | partial | overdue | void
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table subscription_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  subscription_id uuid references school_subscriptions (id),
  invoice_id uuid references saas_invoices (id),
  transaction_reference text not null unique,
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  payment_method text not null default 'manual', -- manual | bank_transfer | mobile_money | provider
  provider_reference text,
  evidence_url text,
  status text not null default 'pending', -- pending | processing | successful | failed | rejected | refunded | cancelled
  verification_status text not null default 'unverified', -- unverified | verified | rejected
  verified_by uuid references platform_users (id),
  paid_at timestamptz,
  recorded_by uuid references platform_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table promotional_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null default 'percent', -- percent | fixed
  discount_value numeric(12,2) not null,
  start_date timestamptz,
  end_date timestamptz,
  usage_limit int,
  used_count int not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table school_registrations
  add constraint school_registrations_plan_fk
  foreign key (plan_id) references subscription_plans (id);

create trigger trg_subscription_plans_touch before update on subscription_plans
for each row execute function app_touch_updated_at();
create trigger trg_school_subscriptions_touch before update on school_subscriptions
for each row execute function app_touch_updated_at();
create trigger trg_saas_invoices_touch before update on saas_invoices
for each row execute function app_touch_updated_at();
create trigger trg_subscription_payments_touch before update on subscription_payments
for each row execute function app_touch_updated_at();

create index idx_school_subscriptions_school on school_subscriptions (school_id);
create index idx_saas_invoices_school on saas_invoices (school_id);
create index idx_subscription_payments_school on subscription_payments (school_id);
create index idx_subscription_payments_status on subscription_payments (status);
