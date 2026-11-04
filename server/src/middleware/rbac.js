/**
 * Authorization middleware. Deny by default. Frontend menu hiding is NOT a control.
 */
export function requirePlatform(...roles) {
  return (req, res, next) => {
    if (!req.auth || req.auth.type !== 'platform') {
      return res.status(403).json({ error: 'Platform access required' });
    }
    if (roles.length && !req.auth.roles.some((r) => roles.includes(r))) {
      return res.status(403).json({ error: 'Insufficient platform role' });
    }
    next();
  };
}

export function requireSuperAdmin(req, res, next) {
  if (!req.auth?.isSuperAdmin) return res.status(403).json({ error: 'Super Admin access required' });
  next();
}

/** School membership + permission check. */
export function requirePermission(...keys) {
  return (req, res, next) => {
    const a = req.auth;
    if (!a || a.type !== 'school' || !a.schoolId) {
      return res.status(403).json({ error: 'School membership required' });
    }
    if (a.school.status === 'suspended' || a.school.status === 'archived') {
      return res.status(403).json({ error: 'School account is suspended' });
    }
    const ok = keys.some((k) => a.permissions.has(k) || a.isSuperAdmin);
    if (!ok) return res.status(403).json({ error: `Missing permission: ${keys.join(' or ')}` });
    next();
  };
}

/** Any of the given permissions, OR platform-level view (super admin oversight). */
export function requireAnyPermission(keys) {
  return requirePermission(...keys);
}

/** Tenant status must permit normal operations (past_due = grace, allowed; suspended blocked in requirePermission). */
export function requireActiveTenant(req, res, next) {
  const s = req.auth?.school?.status;
  if (!['pending_approval'].includes(s)) return next();
  res.status(403).json({ error: 'School is pending approval and cannot operate yet' });
}
