import { env } from '../config/env.js';
import { db } from '../config/supabase.js';

/**
 * Email dispatch. Without a configured provider, emails are logged with their
 * secure links so onboarding still works in development. External integrations
 * (Resend, SES, SMTP, SMS, payment gateways) require credentials — see README.
 */
export async function renderTemplate(key, variables) {
  let subject = key;
  let body = '';
  const { data } = await db().from('email_templates').select('subject, body_html').eq('template_key', key).maybeSingle();
  if (data) {
    subject = fill(data.subject, variables);
    body = fill(data.body_html, variables);
  } else {
    body = Object.entries(variables).map(([k, v]) => `${k}: ${v}`).join('\n');
  }
  return { subject, body };
}

function fill(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

export async function sendMail({ to, subject, html, template, variables = {} }) {
  if (template) {
    const rendered = await renderTemplate(template, variables);
    subject = subject || rendered.subject;
    html = html || rendered.body;
  }
  if (!env.emailProvider) {
    console.log(`\n[email:disabled] to=${to} subject="${subject}"\n${html}\n`);
    return { sent: false, reason: 'no_email_provider_configured' };
  }
  // Provider integration point (kept explicit — requires credentials).
  if (env.emailProvider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.EMAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.emailFrom, to, subject, html }),
    });
    if (!res.ok) throw new Error(`Email provider error: ${await res.text()}`);
    return { sent: true };
  }
  throw new Error(`Unsupported EMAIL_PROVIDER: ${env.emailProvider}`);
}
