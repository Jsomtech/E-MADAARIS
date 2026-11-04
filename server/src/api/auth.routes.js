import { Router } from 'express';
import { z } from 'zod';
import { db, dbAnon, requireDb } from '../config/supabase.js';
import { env } from '../config/env.js';
import { authenticate, loadAuthContext } from '../middleware/auth.js';
import { ApiError } from '../middleware/error.js';
import { audit } from '../services/audit.js';
import { clearIssuedCredential } from '../services/credentialVault.js';
import { sendMail } from '../services/mailer.js';
import { derivePrimaryRole } from '../services/provisioning.js';
import { readSiteContent } from '../services/siteContent.js';

export const authRouter = Router();
export const publicRouter = Router();

// ── Public: published pricing plans (landing page) ──────────────
publicRouter.get('/plans', async (req, res, next) => {
  try {
    // A scaffolded install has no database yet; the public site still renders its pricing section.
    if (!env.configured) return res.json({ data: [], configured: false });
    const { data: plans, error } = await requireDb().from('subscription_plans')
      .select('*').eq('status', 'published').order('sort_order');
    if (error) throw new ApiError(500, error.message);
    const { data: features } = await db().from('plan_features').select('plan_id, feature_key, enabled, limit_value');
    const byPlan = {};
    for (const f of features || []) (byPlan[f.plan_id] ||= []).push(f);
    res.json({ data: (plans || []).map((p) => ({ ...p, features: byPlan[p.id] || [] })), configured: true });
  } catch (e) { next(e); }
});

// ── Public: editable marketing copy and policies ────────────────
// Only the published page objects are exposed; missing pages fall back to the client defaults.
publicRouter.get('/content', async (req, res, next) => {
  try {
    if (!env.configured) return res.json({ data: {}, configured: false });
    const stored = await readSiteContent(requireDb());
    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      data: Object.fromEntries(Object.entries(stored).map(([page, row]) => [page, row.content])),
      configured: true,
    });
  } catch (e) { next(e); }
});

// ── Public: school registration is disabled ─────────────────────
// Tenants are created only by a platform super admin from Platform → Schools.
publicRouter.post('/school-registrations', (req, res, next) => {
  next(new ApiError(403, 'Self-service school registration is disabled. A platform super admin creates every school.'));
});

// ── Auth ────────────────────────────────────────────────────────
authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const anon = dbAnon();
    if (!anon) throw new ApiError(503, 'Server not configured');
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error) {
      await audit({ auth: null, ip: req.ip }, { module: 'auth', action: 'login', status: 'failure', summary: `Failed login for ${email}` });
      throw new ApiError(401, error.message === 'Invalid login credentials' ? 'Invalid email or password' : error.message);
    }
    const user = data.user;
    const ctx = await loadAuthContext(user);
    if (!ctx) throw new ApiError(403, 'This account is not activated yet. Use the invitation link sent to your email, or contact your school administrator.');
    await audit({ auth: ctx, ip: req.ip }, { module: 'auth', action: 'login', summary: 'Signed in' });
    res.json({ data: { tokens: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token }, profile: publicProfile(ctx) } });
  } catch (e) { next(e); }
});

// Students have no email address: they sign in with their student ID, which is also the password
// assigned at admission. The derived GoTrue address never leaves the server.
authRouter.post('/student-login', async (req, res, next) => {
  try {
    const { student_id, password } = z.object({
      student_id: z.string().trim().min(2).max(64),
      password: z.string().min(1).max(128),
    }).parse(req.body);
    const anon = dbAnon();
    if (!anon) throw new ApiError(503, 'Server not configured');
    const supabase = requireDb();

    const wanted = [...new Set([student_id, student_id.toUpperCase()])];
    const { data: students } = await supabase.from('students')
      .select('id, school_id, admission_number, user_id')
      .in('admission_number', wanted).limit(5);
    const candidates = (students || []).filter((s) => s.user_id);
    let session = null;
    if (candidates.length) {
      const { data: members } = await supabase.from('school_users')
        .select('id, email, status')
        .in('id', candidates.map((s) => s.user_id))
        .eq('status', 'active');
      const matches = [];
      for (const member of members || []) {
        if (!member.email) continue;
        const attempt = await anon.auth.signInWithPassword({ email: member.email, password });
        if (!attempt.error && attempt.data?.session) matches.push(attempt.data);
      }
      // Admission numbers are only unique per school, so two schools can mint the same ID.
      // Never guess a tenant when the credentials fit more than one student.
      if (matches.length > 1) {
        throw new ApiError(409, 'This student ID exists at more than one school. Ask your school office for help signing in.');
      }
      session = matches[0] || null;
    }
    if (!session) {
      await audit({ auth: null, ip: req.ip }, {
        module: 'auth', action: 'login', status: 'failure', summary: `Failed student-ID login for ${student_id}`,
      });
      throw new ApiError(401, 'Invalid student ID or password.');
    }

    const ctx = await loadAuthContext(session.user);
    if (!ctx) throw new ApiError(403, 'This student account is not active. Contact your school administrator.');
    await audit({ auth: ctx, ip: req.ip }, { module: 'auth', action: 'login', summary: 'Signed in with student ID' });
    res.json({
      data: {
        tokens: { accessToken: session.session.access_token, refreshToken: session.session.refresh_token },
        profile: publicProfile(ctx),
      },
    });
  } catch (e) { next(e); }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
    const anon = dbAnon();
    if (!anon) throw new ApiError(503, 'Server not configured');
    const { data, error } = await anon.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session) throw new ApiError(401, 'Session expired. Please sign in again.');
    const ctx = await loadAuthContext(data.session.user);
    res.json({
      data: {
        tokens: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token },
        profile: publicProfile(ctx),
      },
    });
  } catch (e) { next(e); }
});

authRouter.post('/logout', authenticate, async (req, res, next) => {
  try {
    await audit(req, { module: 'auth', action: 'logout', summary: 'Signed out' });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json({ data: publicProfile(req.auth) });
});

// PKCE: exchange the code from the emailed redirect for a session.
authRouter.post('/exchange-code', async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().min(10) }).parse(req.body);
    const anon = dbAnon();
    if (!anon) throw new ApiError(503, 'Server not configured');
    const { data, error } = await anon.auth.exchangeCodeForSession(code);
    if (error) throw new ApiError(400, error.message);
    res.json({ data: { tokens: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token } } });
  } catch (e) { next(e); }
});

// Invitation verification: backend redeems GoTrue invite/magiclink token server-side.
authRouter.post('/verify-invitation', async (req, res, next) => {
  try {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    const supabase = requireDb();
    const res2 = await fetch(
      `${env.supabaseUrl}/auth/v1/verify?type=invite&token=${encodeURIComponent(token)}`,
      { headers: { apikey: env.supabaseAnonKey, Authorization: `Bearer ${env.supabaseServiceRoleKey}` } },
    );
    const payload = await res2.json().catch(() => null);
    if (!res2.ok || !payload?.access_token) {
      throw new ApiError(400, payload?.error_description || payload?.msg || 'Invitation link is invalid or has expired');
    }
    // Activate pending membership
    const { data: pu } = await supabase.auth.getUser(payload.access_token);
    const { data: membership } = await supabase.from('school_users')
      .update({ status: 'active', email_verified: true })
      .eq('auth_user_id', pu.user.id).select('id, full_name, school_id').maybeSingle();
    if (membership) {
      await sendMail({
        to: pu.user.email,
        template: 'staff_invitation',
        variables: {
          user_name: membership.full_name, school_name: 'your school', role: 'staff member',
          invitation_link: `${env.frontendUrl}/login`, expires_at: '—',
        },
      }).catch(() => {});
    }
    res.json({ data: { tokens: { accessToken: payload.access_token, refreshToken: payload.refresh_token } } });
  } catch (e) { next(e); }
});

// Set/rotate password with a valid bearer session (used after invite + after recovery).
authRouter.post('/update-password', authenticate, async (req, res, next) => {
  try {
    const { password } = z.object({ password: z.string().min(8).max(128) }).parse(req.body);
    const anon = dbAnon();
    if (!anon) throw new ApiError(503, 'Server not configured');
    const admin = requireDb().auth.admin;
    // authenticate() already verified this bearer token with GoTrue, so the user may rotate
    // their own password; adding the flag in the same call keeps app_metadata atomic.
    const { data: current } = await admin.getUserById(req.auth.authUserId);
    const email = current?.user?.email || null;
    const { error } = await admin.updateUserById(req.auth.authUserId, {
      password,
      app_metadata: { must_change_password: false },
    });
    if (error) throw new ApiError(400, error.message);
    // The password just became the owner's own secret; any issued copy must stop being readable.
    try { await clearIssuedCredential(req.auth.authUserId); } catch { /* best effort */ }
    await audit(req, { module: 'auth', action: 'updated', summary: 'Password changed' });
    // GoTrue revokes the old session when the password changes; mint a fresh one so the
    // user stays signed in instead of being bounced back to the login screen.
    let tokens = null;
    if (email) {
      const { data: signed } = await anon.auth.signInWithPassword({ email, password });
      if (signed?.session) {
        tokens = { accessToken: signed.session.access_token, refreshToken: signed.session.refresh_token };
      }
    }
    res.json({ data: { ok: true, tokens } });
  } catch (e) { next(e); }
});

function publicProfile(auth) {
  if (!auth) return null;
  const dashboardRoute = auth.type === 'platform'
    ? (auth.isSuperAdmin ? '/super-admin' : '/platform-support')
    : roleRoute(derivePrimaryRole(auth));
  return {
    type: auth.type,
    userId: auth.userId,
    fullName: auth.fullName,
    email: auth.email,
    mustChangePassword: Boolean(auth.mustChangePassword),
    roles: auth.roles,
    primaryRole: auth.type === 'school' ? derivePrimaryRole(auth) : (auth.isSuperAdmin ? 'super_admin' : 'platform_support'),
    permissions: [...auth.permissions],
    dashboardRoute,
    school: auth.school || null,
    subscription: auth.subscription ? {
      id: auth.subscription.id, status: auth.subscription.status,
      billing_cycle: auth.subscription.billing_cycle, end_date: auth.subscription.end_date,
      trial_end_date: auth.subscription.trial_end_date,
      plan: auth.subscription.plan ? {
        id: auth.subscription.plan.id, name: auth.subscription.plan.name,
        max_students: auth.subscription.plan.max_students, max_staff: auth.subscription.plan.max_staff,
        max_storage_mb: auth.subscription.plan.max_storage_mb,
      } : null,
      features: auth.subscription.features || {},
    } : null,
  };
}

const ROLE_ROUTES = {
  school_admin: '/school-admin', principal: '/principal', vice_principal: '/vice-principal',
  registrar: '/registrar', teacher: '/teacher', accountant: '/accountant',
  exam_officer: '/exam-officer', invigilator: '/invigilator', student: '/student',
  parent: '/parent', librarian: '/staff/librarian', hr_officer: '/staff/hr',
  receptionist: '/staff/reception', discipline_officer: '/staff/discipline',
  transport_officer: '/staff/transport', lab_assistant: '/staff/lab', staff: '/staff',
};
export function roleRoute(role) { return ROLE_ROUTES[role] || '/staff'; }
