import { randomBytes, randomInt } from 'node:crypto';
import { db } from '../config/supabase.js';

/**
 * Sign-in identities live in Supabase Auth, outside the tenant tables a school wipe clears, so removing
 * a membership leaves its identity behind — still claiming the email address, belonging to nobody, and
 * invisible everywhere in the app. Every creation path then answers "this email already exists" and the
 * address can never be used again. The fix is to hand that leftover identity to the account now being
 * created: same address, new password. Only an identity no login row references may be taken, so a live
 * account can never be seized. The cost is narrow: once an identity has been reclaimed, the matching row
 * in an older recycle-bin snapshot cannot come back, because `school_users.auth_user_id` is unique for
 * the whole platform. Bulk restore stops there — first table in the order, before anything else is written.
 */

const PAGE_SIZE = 200;
// Runs only on the duplicate path, but must not walk a large user table forever.
const MAX_PAGES = 50;

/** supabase-js has no getUserByEmail: page through the directory until the address turns up or it ends. */
export async function findAuthUserByEmail(email) {
  const wanted = String(email || '').toLowerCase();
  if (!wanted) return null;
  const supabase = db();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) return null;
    const users = data?.users || [];
    const hit = users.find((user) => String(user.email || '').toLowerCase() === wanted);
    if (hit) return hit;
    if (users.length < PAGE_SIZE) return null;
  }
  return null;
}

/** True when a school membership or a platform account still signs in through this identity. */
export async function isIdentityClaimed(authUserId) {
  if (!authUserId) return true;
  const supabase = db();
  const [{ data: members }, { data: platform }] = await Promise.all([
    supabase.from('school_users').select('id').eq('auth_user_id', authUserId).limit(1),
    supabase.from('platform_users').select('id').eq('auth_user_id', authUserId).limit(1),
  ]);
  return Boolean(members?.length || platform?.length);
}

/**
 * Takes an address that GoTrue still recognises.
 * `none` — nothing holds it, so the caller's own "already exists" answer stands.
 * `taken` — a live account owns it and must not be disturbed.
 * `reclaimed` — the caller now owns an identity that used to be stranded; its password is the one given.
 * `failed` — the identity is stranded but GoTrue refused the change; report the reason, do not create twice.
 */
export async function reclaimIdentity({ email, password, metadata, mustChangePassword = false }) {
  const found = await findAuthUserByEmail(email);
  if (!found) return { status: 'none' };
  if (await isIdentityClaimed(found.id)) return { status: 'taken', user: found };
  const { error } = await db().auth.admin.updateUserById(found.id, {
    password,
    email_confirm: true,
    user_metadata: metadata,
    app_metadata: { must_change_password: mustChangePassword },
  });
  return error ? { status: 'failed', error: error.message } : { status: 'reclaimed', user: found };
}

/**
 * Invitation tokens are single-use and GoTrue refuses a second one for an address it already knows, so
 * a reclaimed account cannot be "re-invited". It gets a password the way a reset does: the school hands
 * it over once and the owner changes it at the first sign-in. The alphabet skips look-alike characters
 * so the password survives being read out or copied by hand.
 */
export function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return `Em${out}${randomInt(10, 100)}`;
}
