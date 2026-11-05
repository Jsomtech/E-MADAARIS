import { db } from '../config/supabase.js';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_NAMES } from '../config/roleDefaults.js';
import { sendMail } from './mailer.js';
import { setIssuedCredential } from './credentialVault.js';
import { reclaimIdentity, temporaryPassword } from './authIdentity.js';
import { ensureStandardGrades } from './standardGrades.js';
import { env } from '../config/env.js';

// Unambiguous alphabet (no 0/O, 1/I) so the printed reference stays easy to read.
const REGISTRATION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRegistrationNumber() {
  const year = new Date().getFullYear();
  let suffix = '';
  for (let i = 0; i < 5; i += 1) {
    suffix += REGISTRATION_ALPHABET[Math.floor(Math.random() * REGISTRATION_ALPHABET.length)];
  }
  return `EMD-${year}-${suffix}`;
}

/**
 * Creates a fully provisioned school tenant:
 * school row, settings, system roles + permissions, subscription, admin auth user, admin membership.
 * Returns activation link (single-use token is managed by Supabase Auth, never stored here).
 */
export async function provisionSchool({ registration, adminUser }, { actor } = {}) {
  const supabase = db();
  const planId = registration.plan_id || null;
  let plan = null;
  if (planId) {
    const { data } = await supabase.from('subscription_plans').select('*').eq('id', planId).maybeSingle();
    plan = data;
  }

  let school = null;
  let e1 = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const registrationNumber = registration.registration_number || generateRegistrationNumber();
    const result = await supabase.from('schools').insert({
      school_name: registration.school_name,
      registration_number: registrationNumber,
      school_type: registration.school_type,
      email: registration.school_email,
      phone: registration.school_phone,
      country: registration.country,
      region: registration.region,
      city: registration.city,
      address: registration.address,
      status: 'trial',
    }).select().single();
    school = result.data;
    e1 = result.error;
    if (!e1) break;
    // A caller-supplied number that collides must surface; only generated numbers retry.
    if (e1.code !== '23505' || registration.registration_number) break;
  }
  if (e1) throw Object.assign(new Error(`School creation failed: ${e1.message}`), { status: 500 });

  // Grade classes are convenience data; a failure here must not block the tenant.
  try {
    await ensureStandardGrades(supabase, school.id, school.school_type);
  } catch { /* the school can create classes later */ }

  // Settings row
  await supabase.from('school_settings').insert({
    school_id: school.id,
    default_language: 'so',
    currency: 'SOS',
  });

  // System roles + permissions from defaults
  await ensureSchoolRoles(school.id);

  // Subscription
  let subError = null;
  if (plan) {
    const trialEnd = new Date(Date.now() + (plan.trial_days || 14) * 86400000);
    const { error } = await supabase.from('school_subscriptions').insert({
      school_id: school.id,
      plan_id: plan.id,
      status: 'trial',
      billing_cycle: 'monthly',
      start_date: new Date().toISOString(),
      trial_end_date: trialEnd.toISOString(),
      end_date: trialEnd.toISOString(),
      grace_period_end: new Date(trialEnd.getTime() + plan.grace_period_days * 86400000).toISOString(),
    });
    subError = error;
  }

  // Admin account: created with a password when supplied, otherwise invited through Supabase Auth.
  // Invitation tokens are single-use and managed by GoTrue — never stored here.
  const hasPassword = Boolean(registration.admin_password);
  let activationLink = null;
  let adminAuthUser = null;
  let handedPassword = null;
  const adminMetadata = { full_name: registration.admin_full_name, school_id: school.id, role: ROLE_NAMES.school_admin };
  const inviteRedirect = `${env.frontendUrl}/auth/accept-invite`;
  if (hasPassword) {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: registration.admin_email,
      password: registration.admin_password,
      email_confirm: true,
      user_metadata: adminMetadata,
    });
    if (error) {
      const duplicate = error.code === 'email_exists' || /already/i.test(error.message);
      if (!duplicate) throw Object.assign(new Error(`Admin account creation failed: ${error.message}`), { status: 500 });
      // A school wipe leaves its sign-in identities in Auth even after the membership is gone, so this
      // address may belong to an account nobody can reach. Take it over rather than refuse it forever.
      const reclaim = await reclaimIdentity({
        email: registration.admin_email,
        password: registration.admin_password,
        metadata: adminMetadata,
      });
      if (reclaim.status === 'failed') {
        throw Object.assign(new Error(`Admin account creation failed: ${reclaim.error}`), { status: 500 });
      }
      if (reclaim.status !== 'reclaimed') {
        throw Object.assign(new Error('An account with this administrator email already exists. Use a different email.'), { status: 409 });
      }
      adminAuthUser = reclaim.user;
    } else {
      adminAuthUser = created.user;
    }
  } else {
    const { data: inviteData, error: inviteError } = await supabase.auth.admin.generateLink({
      type: 'invite',
      email: registration.admin_email,
      options: {
        data: adminMetadata,
        redirectTo: inviteRedirect,
      },
    });
    if (inviteError) {
      const duplicate = inviteError.code === 'email_exists' || /already/i.test(inviteError.message);
      if (!duplicate) throw Object.assign(new Error(`Admin account creation failed: ${inviteError.message}`), { status: 500 });
      // GoTrue refuses a second invitation to an address it already knows, so a stranded identity can
      // never be activated by mail. Give it a password instead, exactly as a staff reset does.
      const generated = temporaryPassword();
      const reclaim = await reclaimIdentity({
        email: registration.admin_email,
        password: generated,
        metadata: adminMetadata,
        mustChangePassword: true,
      });
      if (reclaim.status === 'failed') {
        throw Object.assign(new Error(`Admin account creation failed: ${reclaim.error}`), { status: 500 });
      }
      if (reclaim.status !== 'reclaimed') {
        throw Object.assign(new Error('An account with this administrator email already exists. Use a different email.'), { status: 409 });
      }
      adminAuthUser = reclaim.user;
      handedPassword = generated;
    } else {
      adminAuthUser = inviteData.user;
      activationLink = inviteData?.properties?.action_link || inviteData?.confirmation_url || null;
    }
  }

  const usableNow = hasPassword || Boolean(handedPassword);
  const { data: adminMembership, error: e2 } = await supabase.from('school_users').insert({
    school_id: school.id,
    auth_user_id: adminAuthUser.id,
    full_name: registration.admin_full_name,
    email: registration.admin_email,
    phone: registration.admin_phone,
    status: usableNow ? 'active' : 'pending_verification',
    email_verified: usableNow,
  }).select().single();
  if (e2) throw Object.assign(new Error(`Admin membership failed: ${e2.message}`), { status: 500 });

  await assignRole(school.id, adminMembership.id, ROLE_NAMES.school_admin);

  if (usableNow) {
    try {
      await setIssuedCredential(adminAuthUser.id, {
        schoolId: school.id, membershipId: adminMembership.id,
        password: registration.admin_password || handedPassword,
      });
    } catch { /* a missing vault key must not undo the school creation */ }
  }

  if (!usableNow) {
    await sendMail({
      to: registration.admin_email,
      template: 'staff_invitation',
      variables: {
        user_name: registration.admin_full_name,
        school_name: school.school_name,
        role: 'School Administrator',
        invitation_link: activationLink || `${env.frontendUrl}/login`,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      },
    });
  }

  return { school, subscriptionError: subError, activationLink, temporaryAdminPassword: handedPassword };
}

/** Creates the 17 system roles + their default permission grants for a school. Idempotent. */
export async function ensureSchoolRoles(schoolId) {
  const supabase = db();
  const { data: existing } = await supabase.from('school_roles').select('id, name').eq('school_id', schoolId);
  const existingByName = Object.fromEntries((existing || []).map((r) => [r.name, r.id]));

  const { data: perms } = await supabase.from('school_permissions').select('id, permission_key');
  const permByKey = Object.fromEntries((perms || []).map((p) => [p.permission_key, p.id]));

  for (const roleName of Object.values(ROLE_NAMES)) {
    let roleId = existingByName[roleName];
    if (!roleId) {
      const { data: created, error } = await supabase.from('school_roles').insert({
        school_id: schoolId, name: roleName, is_system_role: true,
        description: `System role: ${roleName.replace(/_/g, ' ')}`,
      }).select('id').single();
      if (error) throw new Error(`role seed failed: ${error.message}`);
      roleId = created.id;
    }
    const keys = DEFAULT_ROLE_PERMISSIONS[roleName] || new Set();
    const rows = [...keys].map((k) => permByKey[k]).filter(Boolean).map((pid) => ({
      school_id: schoolId, role_id: roleId, permission_id: pid,
    }));
    if (rows.length) {
      await supabase.from('school_role_permissions').upsert(rows, { onConflict: 'role_id,permission_id', ignoreDuplicates: true });
    }
  }
}

export async function assignRole(schoolId, schoolUserId, roleName) {
  const supabase = db();
  const { data: role } = await supabase.from('school_roles').select('id').eq('school_id', schoolId).eq('name', roleName).maybeSingle();
  if (!role) throw new Error(`Role not found: ${roleName}`);
  const { data: user } = await supabase.from('school_users').select('id').eq('id', schoolUserId).eq('school_id', schoolId).maybeSingle();
  if (!user) throw new Error('User not found in this school');
  await supabase.from('school_user_roles').upsert(
    { school_id: schoolId, user_id: schoolUserId, role_id: role.id },
    { onConflict: 'user_id,role_id' },
  );
}

export function derivePrimaryRole(auth) {
  // Order matters: most privileged first.
  const priority = ['school_admin', 'principal', 'vice_principal', 'registrar', 'exam_officer',
    'accountant', 'invigilator', 'teacher', 'librarian', 'hr_officer', 'receptionist',
    'discipline_officer', 'transport_officer', 'lab_assistant', 'parent', 'student', 'staff'];
  return auth.roles.find((r) => priority.includes(r)) || auth.roles[0] || 'staff';
}
