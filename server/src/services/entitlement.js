import { db } from '../config/supabase.js';

const OPERATIONAL_STATUSES = ['trial', 'active', 'past_due'];

/**
 * Subscription enforcement — checked server-side per request.
 * Returns { ok, error } for feature usage; call as middleware via requireEntitlement().
 */
export async function checkEntitlement(auth, featureKey) {
  if (auth.type !== 'school') return { ok: true };
  const sub = auth.subscription;
  if (!sub) return { ok: false, error: 'No subscription found for this school', status: 403 };
  if (!OPERATIONAL_STATUSES.includes(sub.status)) {
    return { ok: false, status: 403, error: `Subscription is ${sub.status}; this module is unavailable` };
  }
  const f = sub.features?.[featureKey];
  if (f && f.enabled === false) {
    return { ok: false, status: 402, error: `Your plan (${sub.plan?.name}) does not include this feature` };
  }
  return { ok: true };
}

/** Count current usage of a resource for limit enforcement at creation time. */
export async function checkUsageLimit(auth, table, limitKey) {
  const plan = auth.subscription?.plan;
  const max = plan?.[limitKey];
  if (!max || max <= 0) return { ok: true };
  const { count } = await db()
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('school_id', auth.schoolId);
  if ((count || 0) >= max) {
    return { ok: false, status: 402, error: `Plan limit reached (${limitKey.replace('max_', '')} ≤ ${max}). Request an upgrade.` };
  }
  return { ok: true };
}
