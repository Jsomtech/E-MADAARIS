-- 0021: Monthly fee collection — the cashier's month-by-month register.
--
-- A Somali school usually charges one standing fee per class, collected every month. The existing
-- invoice/assignment ledger models one-off charges, so the monthly register gets its own two facts:
--   * class_monthly_fees — what one month of that class costs;
--   * fee_payments.period_month — which month a recorded payment settles.
-- A learner whose period_month row exists for January therefore drops out of the January register
-- and reappears when the cashier moves to February, with no extra "clearing" job anywhere.

create table if not exists class_monthly_fees (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  class_id uuid not null references classes (id) on delete cascade,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  currency text not null default 'SOS',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, class_id)
);

drop trigger if exists trg_class_monthly_fees_touch on class_monthly_fees;
create trigger trg_class_monthly_fees_touch before update on class_monthly_fees
  for each row execute function app_touch_updated_at();

alter table fee_payments add column if not exists period_month char(7)
  check (period_month is null or period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

create index if not exists idx_fee_payments_period on fee_payments (school_id, period_month);

-- 0090 enables RLS for every school_id table it can see, but this migration may also be applied to
-- a database that already ran it, so the tenant policy is stated here too.
alter table class_monthly_fees enable row level security;
drop policy if exists tenant_isolation on class_monthly_fees;
create policy tenant_isolation on class_monthly_fees
  for all
  using (school_id = app.current_school_id() or app.is_super_admin())
  with check (school_id = app.current_school_id() or app.is_super_admin());
