-- 0023_account_confirmation_emails.sql
-- Account confirmation mail for the two ways an account is created:
--   * the platform administrator creates a school -> its administrator gets school_account_confirmation
--   * a school creates a staff account            -> that person gets staff_account_confirmation
-- Both carry the login address, the first password and a signed link that marks the address verified.
-- Run once in the Supabase SQL editor. Re-running replaces the text, never duplicates a key.

insert into email_templates (template_key, subject, body_html, variables) values
  ('school_account_confirmation',
   'Confirm your E-MADAARIS account for {{school_name}}',
   '<p>Dear {{admin_name}},</p>
    <p>Your school <strong>{{school_name}}</strong> is now live on E-MADAARIS and you are its administrator. Please confirm that this is the right email address for the school.</p>
    <p><a href="{{confirm_link}}" style="display:inline-block;background:#6027ff;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Confirm my email address</a></p>
    <p><strong>Your sign-in details</strong></p>
    <ul>
      <li>Email (login): {{login_email}}</li>
      <li>First password: {{password}}</li>
      <li>Role: {{role}}</li>
    </ul>
    <p>Sign in here: <a href="{{login_link}}">{{login_link}}</a></p>
    <p>The confirmation link expires on {{expires_at}}. This password was set for you, so change it the first time you sign in and keep it private.</p>
    <p>If you did not expect this school account, tell your platform administrator.</p>',
   '["admin_name","school_name","login_email","password","role","confirm_link","login_link","expires_at"]'),

  ('staff_account_confirmation',
   '{{school_name}} created your E-MADAARIS account',
   '<p>Dear {{user_name}},</p>
    <p><strong>{{school_name}}</strong> has set up your E-MADAARIS account as <em>{{role}}</em>. Please confirm that this is the right email address for you.</p>
    <p><a href="{{confirm_link}}" style="display:inline-block;background:#6027ff;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Confirm my email address</a></p>
    <p><strong>Your sign-in details</strong></p>
    <ul>
      <li>Email (login): {{login_email}}</li>
      <li>First password: {{password}}</li>
      <li>Role: {{role}}</li>
    </ul>
    <p>Sign in here: <a href="{{login_link}}">{{login_link}}</a></p>
    <p>The confirmation link expires on {{expires_at}}. Your school set this password, so change it the first time you sign in.</p>
    <p>If you did not expect this account, tell your school administrator.</p>',
   '["user_name","school_name","login_email","password","role","confirm_link","login_link","expires_at"]')

on conflict (template_key) do update
  set subject = excluded.subject,
      body_html = excluded.body_html,
      variables = excluded.variables,
      updated_at = now();
