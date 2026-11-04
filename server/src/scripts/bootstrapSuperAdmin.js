import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

/**
 * Creates (or repairs) the first Super Admin account.
 *   SUPERADMIN_EMAIL=… SUPERADMIN_PASSWORD=… npm run db:seed -w server
 * Idempotent: re-running only updates the existing account.
 */
const email = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.SUPERADMIN_PASSWORD || '';
const fullName = process.env.SUPERADMIN_NAME || 'Platform Super Admin';

if (!env.configured) {
  console.error('Supabase credentials are missing. Copy .env.example to .env first.');
  process.exit(1);
}
if (!email || password.length < 8) {
  console.error('Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD (at least 8 characters).');
  process.exit(1);
}

const admin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false } });

// supabase-js has no auth.admin.getUserByEmail(); page through listUsers instead.
async function findAuthUserByEmail(target) {
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Failed to list auth users: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < perPage) return null;
  }
  return null;
}

const existing = await findAuthUserByEmail(email);
let authUserId = existing?.id;
if (authUserId) {
  await admin.auth.admin.updateUserById(authUserId, { email_confirm: true, password });
  console.log(`Auth user already exists (${email}) — email confirmed and password updated.`);
} else {
  const { data: created, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, password, user_metadata: { full_name: fullName, access_level: 'platform' },
  });
  if (error) {
    if (error.code === 'email_exists' || /already/i.test(error.message)) {
      const raced = await findAuthUserByEmail(email);
      if (!raced) { console.error('Failed to create auth user:', error.message); process.exit(1); }
      authUserId = raced.id;
      await admin.auth.admin.updateUserById(authUserId, { email_confirm: true });
      console.log(`Auth user already exists (${email}) — email confirmed.`);
    } else {
      console.error('Failed to create auth user:', error.message);
      process.exit(1);
    }
  } else {
    authUserId = created.user.id;
    console.log(`Created auth user ${email}`);
  }
}

const { data: role } = await admin.from('platform_roles').select('id, name').eq('name', 'super_admin').single();
if (!role) { console.error('platform_roles is empty — run supabase/seed.sql first.'); process.exit(1); }

const { data: pu, error: puError } = await admin.from('platform_users').upsert({
  auth_user_id: authUserId, email, full_name: fullName, status: 'active', phone: null,
}, { onConflict: 'auth_user_id' }).select('id, email').single();
if (puError) { console.error('Failed to write platform_users:', puError.message); process.exit(1); }

const { error: linkError } = await admin.from('platform_user_roles')
  .upsert({ user_id: pu.id, role_id: role.id }, { onConflict: 'user_id,role_id' });
if (linkError) {
  console.error('Failed to assign the super_admin role:', linkError.message);
  process.exit(1);
}

console.log(`Super Admin ready: ${email}`);
console.log('Sign in through the platform login page — the API derives platform access from platform_users, not the browser.');
