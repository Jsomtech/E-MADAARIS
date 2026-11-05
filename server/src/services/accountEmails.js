import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { sendMail } from './mailer.js';

/**
 * Account confirmation mail. A school administrator created by the platform and a staff member
 * created by their school both get the same thing: the address they log in with, the first
 * password, and a link that marks the address as verified.
 *
 * The link carries a stateless token — membership id, school id and expiry, signed with a key
 * derived from CREDENTIALS_KEY for this purpose only — so confirming needs no new table and no
 * migration, and a token cannot name a membership from another school. Without CREDENTIALS_KEY the
 * mail still goes out, just without the button.
 */
const TOKEN_DAYS = 7;

function signingKey() {
  if (!env.credentialsKey) return null;
  return createHmac('sha256', env.credentialsKey).update('email-confirmation').digest();
}

export function buildConfirmToken(membershipId, schoolId) {
  const key = signingKey();
  if (!key) return null;
  const expiresAt = new Date(Date.now() + TOKEN_DAYS * 86400000).toISOString();
  const payload = Buffer.from(`${membershipId}:${schoolId}:${expiresAt}`).toString('base64url');
  const signature = createHmac('sha256', key).update(payload).digest('hex');
  return { token: `${payload}.${signature}`, expiresAt };
}

/** Returns the ids a valid, unexpired token names, or null. */
export function readConfirmToken(token) {
  const key = signingKey();
  if (!key || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', key).update(payload).digest('hex');
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let decoded;
  try {
    decoded = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  // The expiry is an ISO timestamp and therefore full of colons, so only the first two fields are
  // split off; the remainder is the timestamp verbatim.
  const parts = decoded.split(':');
  const [membershipId, schoolId] = parts;
  const expiresAt = parts.slice(2).join(':');
  if (!membershipId || !schoolId || !expiresAt) return null;
  if (new Date(expiresAt).getTime() < Date.now()) return null;
  return { membershipId, schoolId, expiresAt };
}

/**
 * Sends one account confirmation and reports what happened, so the screen that asked for it can
 * tell the truth: 'sent' reached a provider, 'logged' means delivery is not configured and the
 * message only went to the server console, 'failed' carries the provider error.
 */
export async function sendAccountConfirmation({
  template, to, name, schoolName, role, loginEmail, password, membershipId, schoolId,
}) {
  const link = buildConfirmToken(membershipId, schoolId);
  try {
    const result = await sendMail({
      to,
      template,
      variables: {
        user_name: name,
        admin_name: name,
        school_name: schoolName,
        role: role || 'staff member',
        login_email: loginEmail,
        password: password || '',
        confirm_link: link ? `${env.frontendUrl}/auth/confirm-email?token=${link.token}` : '',
        login_link: `${env.frontendUrl}/login`,
        expires_at: link ? link.expiresAt.slice(0, 10) : '—',
      },
    });
    return {
      status: result?.sent ? 'sent' : 'logged',
      reason: result?.reason || null,
      to,
      expiresAt: link?.expiresAt || null,
    };
  } catch (error) {
    return { status: 'failed', reason: error.message, to, expiresAt: link?.expiresAt || null };
  }
}
