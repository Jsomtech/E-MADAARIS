-- 0024_notification_email.sql
-- The email copy a user can opt into per category (notification_preferences.email). notify() renders
-- this template for the few recipients who switched mail on, so the mail looks like the inbox entry.
-- Run once in the Supabase SQL editor. Re-running replaces the text, never duplicates a key.

insert into email_templates (template_key, subject, body_html, variables) values
  ('notification',
   '{{title}}',
   '<p>Dear {{user_name}},</p>
    <p><strong>{{title}}</strong></p>
    <p>{{body}}</p>
    <p><a href="{{link}}" style="display:inline-block;background:#6027ff;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Open in E-MADAARIS</a></p>
    <p>You receive this email because you turned on the email copy for this kind of message. Turn it off any time under Notifications → Preferences.</p>',
   '["user_name","title","body","link"]')
on conflict (template_key) do update
  set subject = excluded.subject,
      body_html = excluded.body_html,
      variables = excluded.variables,
      updated_at = now();
