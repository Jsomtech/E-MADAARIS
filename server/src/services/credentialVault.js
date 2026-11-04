import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { requireDb } from '../config/supabase.js';

/**
 * Passwords issued by the system (student IDs, admin-set staff passwords, temporary resets) are
 * recoverable; passwords a user sets themselves are not. GoTrue stores only hashes, so issued
 * secrets are sealed with AES-256-GCM and kept in `app_metadata.issued_credential`. That record
 * is deleted the moment the owner changes their own password.
 *
 * The cipher text is bound to "<schoolId>:<membershipId>" so a copied value cannot be replayed
 * against another account.
 */
const PREFIX = 'v1';

function vaultKey() {
  const secret = process.env.CREDENTIALS_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return secret ? createHash('sha256').update(secret).digest() : null;
}

function contextOf({ schoolId, membershipId }) {
  return `${schoolId || ''}:${membershipId || ''}`;
}

export function sealCredential(password, context) {
  const key = vaultKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(context), 'utf8'));
  const data = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function openCredential(blob, context) {
  if (typeof blob !== 'string' || !blob.startsWith(`${PREFIX}.`)) return null;
  const key = vaultKey();
  if (!key) return null;
  const [, ivPart, tagPart, dataPart] = blob.split('.');
  if (!ivPart || !tagPart || !dataPart) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64'));
    decipher.setAAD(Buffer.from(String(context), 'utf8'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

async function readMetadata(authUserId) {
  const { data, error } = await requireDb().auth.admin.getUserById(authUserId);
  if (error || !data?.user) return null;
  return data.user.app_metadata || {};
}

/** Records the secret the administrator just issued so it can be shown again on demand. */
export async function setIssuedCredential(authUserId, { schoolId, membershipId, password }) {
  if (!authUserId || !password) return false;
  const context = contextOf({ schoolId, membershipId });
  const sealed = sealCredential(password, context);
  if (!sealed) return false;
  const current = await readMetadata(authUserId);
  if (current === null) return false;
  const { error } = await requireDb().auth.admin.updateUserById(authUserId, {
    app_metadata: {
      ...current,
      issued_credential: sealed,
      issued_credential_at: new Date().toISOString(),
      issued_credential_context: context,
    },
  });
  return !error;
}

/** Returns { password, issuedAt } for a system-issued secret, or null when none is stored. */
export async function getIssuedCredential(authUserId, { schoolId, membershipId }) {
  if (!authUserId) return null;
  const meta = await readMetadata(authUserId);
  if (!meta?.issued_credential) return null;
  const context = meta.issued_credential_context || contextOf({ schoolId, membershipId });
  const password = openCredential(meta.issued_credential, context);
  if (!password) return null;
  return { password, issuedAt: meta.issued_credential_at || null };
}

/** Small projection used by the reveal endpoint to decide whether a student-ID fallback is valid. */
export async function credentialFlags(authUserId) {
  const meta = await readMetadata(authUserId);
  return {
    mustChangePassword: Boolean(meta?.must_change_password),
    hasIssued: Boolean(meta?.issued_credential),
  };
}

/** Called when the owner rotates their own password: the issued secret is no longer valid. */
export async function clearIssuedCredential(authUserId) {
  if (!authUserId) return;
  // GoTrue merges app_metadata updates, so keys are nulled instead of deleted.
  await requireDb().auth.admin.updateUserById(authUserId, {
    app_metadata: { issued_credential: null, issued_credential_at: null, issued_credential_context: null },
  });
}
