-- E-MADAARIS seed: permission catalogs, platform RBAC defaults, subscription plans.
-- Idempotent: safe to re-run.
-- The Super Admin account itself is created with: npm run db:seed -w server (bootstrap script).

-- 1) School-level permission catalog --------------------------------------------
do $$
declare
  m text;
  a text;
  perms text[] := array[
    'school','users','roles','students','admissions','teachers','staff','guardians',
    'attendance','timetable','examinations','marks','results','finance','learning',
    'announcements','reports','certificates','library','discipline','transport',
    'hr','reception','lab','subscription','support','audit','notifications'
  ];
  actions text[] := array['view','create','edit','delete','approve','reject','submit','publish','export','manage','assign'];
begin
  foreach m in array perms loop
    foreach a in array actions loop
      insert into school_permissions (permission_key, module, description)
      values (m || '.' || a, m, initcap(m) || ' - ' || a)
      on conflict (permission_key) do nothing;
    end loop;
  end loop;
end $$;

-- 2) Platform roles & permissions -------------------------------------------------
insert into platform_roles (name, description) values
  ('super_admin', 'Full platform ownership'),
  ('platform_support', 'Support-only platform access')
on conflict (name) do nothing;

do $$
declare k text; begin
  foreach k in array array[
    'platform.dashboard.view','platform.schools.view','platform.schools.create','platform.schools.approve',
    'platform.schools.edit','platform.schools.suspend','platform.plans.manage','platform.subscriptions.manage',
    'platform.billing.view','platform.billing.manage','platform.payments.verify','platform.users.manage',
    'platform.roles.manage','platform.analytics.view','platform.reports.export','platform.tickets.manage',
    'platform.audit.view','platform.settings.manage'
  ] loop
    insert into platform_permissions (permission_key, module, description)
    values (k, split_part(k,'.','2'), k) on conflict (permission_key) do nothing;
  end loop;
end $$;

insert into platform_role_permissions (role_id, permission_id)
select r.id, p.id from platform_roles r cross join platform_permissions p
where r.name = 'super_admin'
on conflict (role_id, permission_id) do nothing;

insert into platform_role_permissions (role_id, permission_id)
select r.id, p.id from platform_roles r join platform_permissions p
  on p.permission_key in ('platform.dashboard.view','platform.schools.view','platform.tickets.manage',
                          'platform.analytics.view','platform.billing.view')
where r.name = 'platform_support'
on conflict (role_id, permission_id) do nothing;

-- 3) Subscription plans -------------------------------------------------------------
insert into subscription_plans (name, description, monthly_price, quarterly_price, annual_price,
  currency, trial_days, max_students, max_staff, max_storage_mb, grace_period_days, status, sort_order)
values
  ('Basic','Student, teacher, class management, attendance, basic reports.', 29, 79, 279, 'USD', 14, 150, 15, 1024, 7, 'published', 1),
  ('Standard','All Basic plus examinations, results, fees and parent portal.', 59, 159, 549, 'USD', 14, 500, 40, 5120, 7, 'published', 2),
  ('Premium','All Standard plus digital learning, advanced analytics and certificates.', 99, 269, 949, 'USD', 21, 1500, 120, 20480, 14, 'published', 3),
  ('Enterprise','Configurable package with custom limits and dedicated support.', 0, 0, 0, 'USD', 30, 100000, 10000, 102400, 30, 'published', 4)
on conflict do nothing;

-- 4) Feature entitlements per plan ---------------------------------------------------
do $$
declare pid uuid; fname text;
declare features text[] := array[
  'students.management','teachers.management','classes.subjects','attendance',
  'examinations','results','fees','parent.portal','digital.learning',
  'advanced.analytics','certificates','library','discipline','transport','hr'
];
begin
  select id into pid from subscription_plans where name = 'Basic';
  if found then
    insert into plan_features (plan_id, feature_key, enabled) values
      (pid,'students.management',true),(pid,'teachers.management',true),(pid,'classes.subjects',true),
      (pid,'attendance',true),(pid,'examinations',false),(pid,'results',false),(pid,'fees',false),
      (pid,'parent.portal',false),(pid,'digital.learning',false),(pid,'advanced.analytics',false),
      (pid,'certificates',false),(pid,'library',false),(pid,'discipline',false),(pid,'transport',false),(pid,'hr',false)
    on conflict (plan_id, feature_key) do update set enabled = excluded.enabled;
  end if;

  select id into pid from subscription_plans where name = 'Standard';
  if found then
    insert into plan_features (plan_id, feature_key, enabled) values
      (pid,'students.management',true),(pid,'teachers.management',true),(pid,'classes.subjects',true),
      (pid,'attendance',true),(pid,'examinations',true),(pid,'results',true),(pid,'fees',true),
      (pid,'parent.portal',true),(pid,'digital.learning',false),(pid,'advanced.analytics',false),
      (pid,'certificates',true),(pid,'library',false),(pid,'discipline',true),(pid,'transport',false),(pid,'hr',true)
    on conflict (plan_id, feature_key) do update set enabled = excluded.enabled;
  end if;

  select id into pid from subscription_plans where name = 'Premium';
  if found then
    insert into plan_features (plan_id, feature_key, enabled)
    select pid, f, true from unnest(features) f
    on conflict (plan_id, feature_key) do update set enabled = true;
  end if;

  select id into pid from subscription_plans where name = 'Enterprise';
  if found then
    insert into plan_features (plan_id, feature_key, enabled)
    select pid, f, true from unnest(features) f
    on conflict (plan_id, feature_key) do update set enabled = true;
  end if;
end $$;

-- 5) Core email templates -------------------------------------------------------------
insert into email_templates (template_key, subject, body_html, variables) values
  ('school_registration_confirmation','Welcome to E-MADAARIS, {{school_name}}',
   '<p>Dear {{admin_name}},</p><p>Your school registration for <strong>{{school_name}}</strong> was received. Status: {{status}}.</p>',
   '["school_name","admin_name","status"]'),
  ('school_application_approved','Your school application is approved',
   '<p>Dear {{admin_name}},</p><p>{{school_name}} has been approved. Activate your account: <a href="{{activation_link}}">Activate now</a></p>',
   '["admin_name","school_name","activation_link"]'),
  ('school_application_rejected','School application update',
   '<p>Dear {{admin_name}},</p><p>Your application for {{school_name}} was not approved. Reason: {{reason}}</p>',
   '["admin_name","school_name","reason"]'),
  ('staff_invitation','You are invited to join {{school_name}} on E-MADAARIS',
   '<p>Dear {{user_name}},</p><p>{{school_name}} invited you as {{role}}. Accept: <a href="{{invitation_link}}">Join now</a> (expires {{expires_at}})</p>',
   '["user_name","school_name","role","invitation_link","expires_at"]'),
  ('password_reset','Reset your E-MADAARIS password',
   '<p>Use this secure link to reset your password: <a href="{{reset_link}}">Reset password</a></p>',
   '["reset_link"]'),
  ('subscription_activated','Subscription active — {{school_name}}',
   '<p>Plan {{plan}} is active until {{end_date}}.</p>',
   '["plan","end_date"]'),
  ('subscription_renewal_reminder','Renew your E-MADAARIS subscription',
   '<p>Invoice {{invoice_number}} for {{amount}} is due {{due_date}}.</p>',
   '["invoice_number","amount","due_date"]'),
  ('payment_confirmed','Payment received — {{transaction_reference}}',
   '<p>We confirmed your payment of {{amount}} on {{paid_at}}.</p>',
   '["transaction_reference","amount","paid_at"]')
on conflict (template_key) do nothing;
