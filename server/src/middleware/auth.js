import { db, requireDb } from '../config/supabase.js';

/**
 * Verifies the Supabase JWT and loads the trusted authorization context.
 * Never trusts role/school data from the request body or browser.
 * Attaches req.auth = { userId, authUserId, email, fullName, type, schoolId, school, roles, permissions:Set, platformPermissions:Set, subscription }
 */
export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const client = db();
    if (!client) return res.status(503).json({ error: 'Server is not configured (missing Supabase credentials)' });

    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid or expired session' });

    const ctx = await loadAuthContext(user);
    if (!ctx) return res.status(403).json({ error: 'No active account found for this identity' });
    req.auth = ctx;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

export async function loadAuthContext(user) {
  const supabase = requireDb();

  // 1) Platform-level identity
  const { data: pu } = await supabase
    .from('platform_users')
    .select('id, full_name, email, phone, status')
    .eq('auth_user_id', user.id).maybeSingle();

  if (pu && pu.status === 'active') {
    const { data: links } = await supabase
      .from('platform_user_roles').select('role_id').eq('user_id', pu.id);
    const roleIds = (links || []).map((l) => l.role_id);
    let roleNames = [];
    let perms = [];
    if (roleIds.length) {
      const { data: roles } = await supabase.from('platform_roles').select('id, name').in('id', roleIds);
      roleNames = (roles || []).map((r) => r.name);
      const { data: rp } = await supabase
        .from('platform_role_permissions').select('platform_permissions!inner(permission_key)')
        .in('role_id', roleIds);
      perms = (rp || []).map((x) => x.platform_permissions.permission_key);
    }
    return {
      type: 'platform',
      userId: pu.id,
      authUserId: user.id,
      email: pu.email,
      fullName: pu.full_name,
      roles: roleNames,
      isSuperAdmin: roleNames.includes('super_admin'),
      permissions: new Set(perms),
      schoolId: null,
      school: null,
      subscription: null,
    };
  }

  // 2) School-level identity
  const { data: su } = await supabase
    .from('school_users')
    .select('id, full_name, email, phone, status, avatar_url, school_id')
    .eq('auth_user_id', user.id).maybeSingle();

  if (!su || su.status !== 'active') {
    // pending/deactivated account: authenticate but no permissions
    if (su) return null;
    return null;
  }

  const { data: school } = await supabase
    .from('schools')
    .select('id, school_name, logo_url, status, school_type, email, phone, country, region, city, address')
    .eq('id', su.school_id).maybeSingle();
  if (!school) return null;

  const { data: roleLinks } = await supabase
    .from('school_user_roles').select('role_id').eq('user_id', su.id);
  const roleIds = (roleLinks || []).map((l) => l.role_id);
  let roleNames = [];
  let perms = [];
  if (roleIds.length) {
    const { data: roles } = await supabase.from('school_roles').select('id, name').in('id', roleIds);
    roleNames = (roles || []).map((r) => r.name);
    const { data: rp } = await supabase
      .from('school_role_permissions').select('school_permissions!inner(permission_key)')
      .in('role_id', roleIds);
    perms = (rp || []).map((x) => x.school_permissions.permission_key);
  }

  let subscription = null;
  const { data: subs } = await supabase
    .from('school_subscriptions')
    .select('id, status, billing_cycle, start_date, end_date, trial_end_date, grace_period_end, plan_id')
    .eq('school_id', su.school_id)
    .order('created_at', { ascending: false }).limit(1);
  if (subs?.length) {
    subscription = subs[0];
    if (subscription.plan_id) {
      const { data: plan } = await supabase
        .from('subscription_plans')
        .select('id, name, max_students, max_staff, max_storage_mb, trial_days')
        .eq('id', subscription.plan_id).maybeSingle();
      subscription.plan = plan || null;
      const { data: features } = await supabase
        .from('plan_features').select('feature_key, enabled, limit_value').eq('plan_id', subscription.plan_id);
      subscription.features = Object.fromEntries(
        (features || []).map((f) => [f.feature_key, { enabled: f.enabled, limit: f.limit_value }]));
    }
  }

  return {
    type: 'school',
    userId: su.id,
    authUserId: user.id,
    email: su.email,
    fullName: su.full_name,
    avatarUrl: su.avatar_url,
    mustChangePassword: user.app_metadata?.must_change_password === true,
    roles: roleNames,
    permissions: new Set(perms),
    schoolId: su.school_id,
    school,
    subscription,
  };
}
