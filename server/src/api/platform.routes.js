import { Router } from 'express';
import { z } from 'zod';
import { db, requireDb } from '../config/supabase.js';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/error.js';
import { requirePlatform, requireSuperAdmin } from '../middleware/rbac.js';
import { audit } from '../services/audit.js';
import { resourceRouter, uuid, trimStr, money, sanitizeSearch } from '../core/crud.js';
import { provisionSchool, ensureSchoolRoles, assignRole } from '../services/provisioning.js';
import { createBackup, listPlatformBackups, getBackupPayload, setAutoBackup, autoBackupState, runAutoBackupRound } from '../services/backups.js';
import { clearSchoolData } from '../services/schoolData.js';
import { listTrash, restoreTrashItem, purgeTrashItem, emptyTrashForSchool, emptyPlatformTrash, closeTrashForSchool } from '../services/trash.js';
import { sendMail } from '../services/mailer.js';
import {
  SITE_CONTENT_PAGES, isSiteContentKey,
  readSiteContent, writeSiteContent, clearSiteContent, assertSiteContent,
} from '../services/siteContent.js';
import { listAll as listAllTransfers, getTransfer } from '../services/transfers.js';
import { alertUsers, notify, userIdsWithRoles } from '../services/notify.js';

export const platformRouter = Router();
platformRouter.use(requirePlatform());

const SUP = (path, def) => platformRouter.use(`/${path}`, resourceRouter({ ...def, scope: 'super' }));

// ── Subscription plans (Super Admin) ────────────────────────────
SUP('plans', {
  table: 'subscription_plans', perm: 'plans', search: ['name'], filter: ['status'],
  fields: ['name', 'description', 'monthly_price', 'quarterly_price', 'annual_price', 'currency',
    'trial_days', 'max_students', 'max_staff', 'max_storage_mb', 'max_branches',
    'grace_period_days', 'renewal_settings', 'feature_restrictions', 'status', 'sort_order'],
  schema: z.object({
    name: z.string().trim().min(2).max(64), description: trimStr(500).optional(),
    monthly_price: money.default(0), quarterly_price: money.optional(), annual_price: money.optional(),
    currency: trimStr(8).default('USD'), trial_days: z.coerce.number().int().min(0).default(14),
    max_students: z.coerce.number().int().min(1).default(100),
    max_staff: z.coerce.number().int().min(1).default(20),
    max_storage_mb: z.coerce.number().int().min(1).default(1024),
    max_branches: z.coerce.number().int().min(1).default(1),
    grace_period_days: z.coerce.number().int().min(0).default(7),
    renewal_settings: z.object({}).passthrough().optional(),
    feature_restrictions: z.object({}).passthrough().optional(),
    status: z.enum(['draft', 'published', 'disabled', 'archived']).default('draft'),
    sort_order: z.coerce.number().int().default(0),
  }),
});

platformRouter.patch('/plans/:id/features', requireSuperAdmin, async (req, res, next) => {
  try {
    const body = z.object({ features: z.array(z.object({
      feature_key: z.string().min(2), enabled: z.boolean(), limit_value: z.number().int().nullable().optional(),
    })) }).parse(req.body);
    const supabase = requireDb();
    for (const f of body.features) {
      await supabase.from('plan_features').upsert(
        { plan_id: req.params.id, feature_key: f.feature_key, enabled: f.enabled, limit_value: f.limit_value ?? null },
        { onConflict: 'plan_id, feature_key' });
    }
    await audit(req, { module: 'plans', action: 'updated', recordId: req.params.id, summary: 'Plan features updated' });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

platformRouter.get('/plans/:id/features', requireSuperAdmin, async (req, res, next) => {
  try {
    const { data, error } = await requireDb().from('plan_features').select('*').eq('plan_id', req.params.id);
    if (error) throw new ApiError(500, error.message);
    res.json({ data });
  } catch (e) { next(e); }
});

// ── School applications ─────────────────────────────────────────
platformRouter.get('/applications', async (req, res, next) => {
  try {
    let q = requireDb().from('school_registrations').select('*, subscription_plans(name)');
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw new ApiError(500, error.message);
    res.json({ data });
  } catch (e) { next(e); }
});

platformRouter.post('/applications/:id/approve', requireSuperAdmin, async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: reg } = await supabase.from('school_registrations')
      .select('*').eq('id', req.params.id).maybeSingle();
    if (!reg) throw new ApiError(404, 'Application not found');
    if (reg.status === 'approved') throw new ApiError(409, 'Already approved');

    const { school, activationLink } = await provisionSchool({ registration: reg });
    await supabase.from('school_registrations').update({
      status: 'approved', reviewed_by: req.auth.userId, reviewed_at: new Date().toISOString(),
    }).eq('id', reg.id);

    await audit(req, { module: 'schools', action: 'approved', recordId: school.id, summary: `Approved application: ${school.school_name}` });
    alertUsers(req, async (supabase, schoolId) => userIdsWithRoles(supabase, schoolId, ['school_admin']), {
      scope: 'school', schoolId: school.id, category: 'account',
      title: `${school.school_name} is approved`,
      body: 'The platform team approved your application. Sign in to finish setting up the school.',
      link: '/school-admin',
    });
    res.json({ data: { school, activationLink }, message: 'School tenant provisioned; activation invitation sent.' });
  } catch (e) { next(e); }
});

platformRouter.post('/applications/:id/reject', requireSuperAdmin, async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const supabase = requireDb();
    const { data: reg } = await supabase.from('school_registrations').select('*').eq('id', req.params.id).maybeSingle();
    if (!reg) throw new ApiError(404, 'Application not found');
    await supabase.from('school_registrations').update({
      status: 'rejected', rejection_reason: reason, reviewed_by: req.auth.userId, reviewed_at: new Date().toISOString(),
    }).eq('id', reg.id);
    await sendMail({
      to: reg.admin_email, template: 'school_application_rejected',
      variables: { admin_name: reg.admin_full_name, school_name: reg.school_name, reason },
    });
    await audit(req, { module: 'schools', action: 'rejected', recordId: reg.id, summary: `Rejected application: ${reg.school_name}` });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// ── Schools / tenants ───────────────────────────────────────────
/** Aggregate embed so the tenant list shows plan + usage without one request per school. */
const SCHOOL_LIST_SELECT = [
  '*',
  'active_students:students(count)',
  'school_users(count)',
  'school_subscriptions(status, billing_cycle, start_date, end_date, trial_end_date, grace_period_end, created_at, subscription_plans(id, name, monthly_price, annual_price, currency))',
].join(', ');

function summarizeSchool(row) {
  const { active_students, school_users, school_subscriptions, ...school } = row;
  const subscriptions = [...(school_subscriptions || [])]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const subscription = subscriptions[0] || null;
  return {
    ...school,
    subscription,
    subscription_count: subscriptions.length,
    plan_name: subscription?.subscription_plans?.name || null,
    plan_end_date: subscription?.end_date || subscription?.trial_end_date || null,
    total_students: active_students?.[0]?.count ?? 0,
    total_users: school_users?.[0]?.count ?? 0,
  };
}

platformRouter.get('/schools', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Number(req.query.pageSize) || 25);
    let q = requireDb().from('schools').select(SCHOOL_LIST_SELECT, { count: 'exact' });
    for (const f of ['status', 'country', 'school_type']) if (req.query[f]) q = q.eq(f, req.query[f]);
    if (req.query.q) {
      const term = `%${sanitizeSearch(req.query.q)}%`;
      q = q.or(`school_name.ilike.${term},registration_number.ilike.${term},email.ilike.${term},city.ilike.${term}`);
    }
    // Embedded filter keeps the count to active students only; it does not drop schools with none.
    q = q.eq('students.status', 'active');
    const { data, count, error } = await q.order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new ApiError(500, error.message);
    res.json({ data: (data || []).map(summarizeSchool), total: count, page, pageSize });
  } catch (e) { next(e); }
});

platformRouter.get('/schools/:id', async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: school } = await supabase.from('schools').select('*').eq('id', req.params.id).maybeSingle();
    if (!school) throw new ApiError(404, 'School not found');
    const [{ data: subs }, { data: settings }, { data: admins }, usage] = await Promise.all([
      supabase.from('school_subscriptions').select('*, subscription_plans(*)').eq('school_id', school.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('school_settings').select('*').eq('school_id', school.id).maybeSingle(),
      supabase.from('school_user_roles')
        .select('school_users!inner(full_name, email, status, id)').eq('school_id', school.id)
        .in('role_id', await systemRoleId(school.id, 'school_admin')),
      schoolUsage(school.id),
    ]);
    const administrators = (admins || []).map((a) => a.school_users).filter(Boolean);
    res.json({ data: { ...school, subscriptions: subs || [], settings, administrators, usage } });
  } catch (e) { next(e); }
});

// ── Cross-school student transfers (Super Admin oversight) ───────
platformRouter.get('/transfers', requireSuperAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
    const status = req.query.status ? String(req.query.status) : null;
    res.json(await listAllTransfers(req, { status, page, pageSize }));
  } catch (e) { next(e); }
});

platformRouter.get('/transfers/:id', requireSuperAdmin, async (req, res, next) => {
  try { res.json({ data: await getTransfer(req, req.params.id) }); } catch (e) { next(e); }
});

async function systemRoleId(schoolId, name) {
  const { data } = await db().from('school_roles').select('id').eq('school_id', schoolId).eq('name', name);
  return (data || []).map((r) => r.id);
}

async function schoolUsage(schoolId) {
  const supabase = db();
  const [students, users, roleRows] = await Promise.all([
    supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'active'),
    supabase.from('school_users').select('*', { count: 'exact', head: true }).eq('school_id', schoolId),
    supabase.from('school_user_roles').select('user_id, school_roles!inner(name)').eq('school_id', schoolId).limit(20000),
  ]);
  const memberships = roleRows.data || [];
  const staffIds = new Set(memberships
    .filter((m) => !['student', 'parent'].includes(m.school_roles?.name))
    .map((m) => m.user_id));
  const teacherIds = new Set(memberships.filter((m) => m.school_roles?.name === 'teacher').map((m) => m.user_id));
  return {
    students: students.count || 0,
    users: users.count || 0,
    staff: staffIds.size,
    teachers: teacherIds.size,
  };
}

platformRouter.post('/schools', requireSuperAdmin, async (req, res, next) => {
  try {
    const body = z.object({
      school_name: z.string().trim().min(2), school_type: z.enum(['primary', 'secondary', 'primary_secondary', 'integrated']),
      registration_number: z.string().trim().optional(), school_email: z.string().email(),
      school_phone: z.string().trim().optional(), country: z.string().trim().default('Somalia'),
      region: z.string().trim().optional(), city: z.string().trim().optional(), address: z.string().trim().optional(),
      admin_full_name: z.string().trim().min(2), admin_email: z.string().email(), admin_phone: z.string().trim().optional(),
      admin_password: z.string().min(8).max(72).optional(),
      plan_id: z.string().uuid(),
    }).parse(req.body);
    const {
      school, activationLink, temporaryAdminPassword, confirmationEmail,
    } = await provisionSchool({ registration: { ...body, plan_id: body.plan_id } });
    await audit(req, {
      module: 'schools', action: 'created', recordId: school.id,
      summary: `Manual tenant: ${school.school_name} (administrator confirmation email ${confirmationEmail?.status || 'unknown'})`,
    });
    alertUsers(req, async (supabase, schoolId) => userIdsWithRoles(supabase, schoolId, ['school_admin']), {
      scope: 'school', schoolId: school.id, category: 'account',
      title: `Welcome to E-MADAARIS, ${school.school_name}`,
      body: 'Your school is live and its roles are ready. Add your classes, staff and learners to begin.',
      link: '/school-admin',
    });
    res.status(201).json({ data: { school, activationLink, temporaryAdminPassword, confirmationEmail } });
  } catch (e) { next(e); }
});

platformRouter.patch('/schools/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const payload = z.object({
      school_name: z.string().trim().min(2).optional(), registration_number: z.string().trim().optional(),
      email: z.string().email().optional(), phone: z.string().trim().optional(),
      country: z.string().trim().optional(), region: z.string().trim().optional(),
      city: z.string().trim().optional(), address: z.string().trim().optional(),
      school_type: z.enum(['primary', 'secondary', 'primary_secondary', 'integrated']).optional(),
      logo_url: z.string().url().optional(),
    }).parse(req.body);
    if (!Object.keys(payload).length) throw new ApiError(400, 'No fields to update');
    const { data, error } = await requireDb().from('schools').update(payload).eq('id', req.params.id).select().maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, 'School not found');
    await audit(req, { module: 'schools', action: 'updated', recordId: data.id, summary: 'School info updated' });
    res.json({ data });
  } catch (e) { next(e); }
});

const SCHOOL_STATUSES = ['pending_approval', 'trial', 'active', 'past_due', 'suspended', 'expired', 'cancelled', 'archived'];
platformRouter.patch('/schools/:id/status', requireSuperAdmin, async (req, res, next) => {
  try {
    const { status, reason } = z.object({
      status: z.enum(SCHOOL_STATUSES), reason: z.string().trim().max(500).optional(),
    }).parse(req.body);
    const supabase = requireDb();
    const { data, error } = await supabase.from('schools').update({ status }).eq('id', req.params.id).select().maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, 'School not found');
    if (data.email) {
      await sendMail({
        to: data.email, template: 'subscription_activated',
        variables: { plan: data.school_name, end_date: status },
      }).catch(() => {});
    }
    await audit(req, { module: 'schools', action: 'status_changed', recordId: data.id, summary: `${data.school_name} → ${status}`, metadata: { reason } });
    alertUsers(req, async (supabase, schoolId) => userIdsWithRoles(supabase, schoolId, ['school_admin']), {
      scope: 'school', schoolId: data.id, category: 'account',
      title: `Subscription status: ${status.replace(/_/g, ' ')}`,
      body: reason ? `${data.school_name} → ${status.replace(/_/g, ' ')}. ${reason}`
        : `${data.school_name} is now ${status.replace(/_/g, ' ')}.`,
      link: '/school/subscription',
    });
    res.json({ data });
  } catch (e) { next(e); }
});

platformRouter.patch('/schools/:id/limits', requireSuperAdmin, async (req, res, next) => {
  try {
    const payload = z.object({
      max_students: z.number().int().optional(), max_staff: z.number().int().optional(),
      max_storage_mb: z.number().int().optional(),
    }).parse(req.body);
    const supabase = requireDb();
    const { data } = await supabase.from('school_settings').select('id, limits_override').eq('school_id', req.params.id).maybeSingle();
    if (!data) throw new ApiError(404, 'School settings missing');
    await supabase.from('school_settings').update({
      limits_override: { ...(data.limits_override || {}), ...payload },
    }).eq('id', data.id);
    await audit(req, { module: 'schools', action: 'limits_changed', recordId: req.params.id, metadata: payload });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// ── Subscriptions ───────────────────────────────────────────────
platformRouter.get('/subscriptions', async (req, res, next) => {
  try {
    let q = requireDb().from('school_subscriptions')
      .select('*, schools(school_name), subscription_plans(name, monthly_price, annual_price, currency)');
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.school_id) q = q.eq('school_id', req.query.school_id);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
    if (error) throw new ApiError(500, error.message);
    res.json({ data });
  } catch (e) { next(e); }
});

platformRouter.post('/subscriptions', requireSuperAdmin, async (req, res, next) => {
  try {
    const body = z.object({
      school_id: uuid, plan_id: uuid, status: z.enum(['pending', 'trial', 'active', 'past_due', 'suspended', 'expired', 'cancelled']).default('active'),
      billing_cycle: z.enum(['monthly', 'quarterly', 'annual']).default('monthly'),
      months: z.number().int().min(1).max(36).default(1),
    }).parse(req.body);
    const supabase = requireDb();
    const { data: plan } = await supabase.from('subscription_plans').select('*').eq('id', body.plan_id).maybeSingle();
    if (!plan) throw new ApiError(404, 'Plan not found');
    const price = body.billing_cycle === 'annual' ? (plan.annual_price ?? plan.monthly_price * 12)
      : body.billing_cycle === 'quarterly' ? (plan.quarterly_price ?? plan.monthly_price * 3) : plan.monthly_price;
    const start = new Date();
    const end = new Date(start.getTime() + body.months * 30 * 86400000);
    await ensureSchoolRoles(body.school_id);
    const { data, error } = await supabase.from('school_subscriptions').insert({
      school_id: body.school_id, plan_id: plan.id, status: body.status, billing_cycle: body.billing_cycle,
      start_date: start.toISOString(), end_date: end.toISOString(),
      trial_end_date: body.status === 'trial' ? end.toISOString() : null,
      grace_period_end: new Date(end.getTime() + plan.grace_period_days * 86400000).toISOString(),
    }).select().single();
    if (error) throw new ApiError(500, error.message);
    // Auto-issue invoice
    const { data: invoice } = await supabase.from('saas_invoices').insert({
      school_id: body.school_id, subscription_id: data.id,
      invoice_number: await nextInvoiceNumber(),
      billing_period_start: start.toISOString(), billing_period_end: end.toISOString(),
      subtotal: price, total: price, currency: plan.currency,
      due_date: new Date(Date.now() + 14 * 86400000).toISOString(), status: 'open',
    }).select().single();
    await audit(req, { module: 'subscriptions', action: 'created', recordId: data.id, summary: `${plan.name} for school ${body.school_id}` });
    res.status(201).json({ data: { subscription: data, invoice } });
  } catch (e) { next(e); }
});

async function nextInvoiceNumber() {
  const { count } = await db().from('saas_invoices').select('*', { count: 'exact', head: true });
  return `INV-${new Date().getFullYear()}-${String((count || 0) + 1).padStart(5, '0')}`;
}

platformRouter.patch('/subscriptions/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const payload = z.object({
      status: z.enum(['pending', 'trial', 'active', 'past_due', 'suspended', 'expired', 'cancelled']).optional(),
      billing_cycle: z.enum(['monthly', 'quarterly', 'annual']).optional(),
      plan_id: uuid.optional(), auto_renew: z.boolean().optional(),
      end_date: z.string().optional(), extend_days: z.number().int().optional(),
    }).parse(req.body);
    const supabase = requireDb();
    const patch = { ...payload };
    if (patch.extend_days) {
      const { data: cur } = await supabase.from('school_subscriptions').select('end_date').eq('id', req.params.id).maybeSingle();
      const base = cur?.end_date ? new Date(cur.end_date) : new Date();
      patch.end_date = new Date(base.getTime() + patch.extend_days * 86400000).toISOString();
      delete patch.extend_days;
    }
      if (!Object.keys(patch).length) throw new ApiError(400, 'No fields');
    const { data, error } = await supabase.from('school_subscriptions').update(patch).eq('id', req.params.id).select().maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, 'Subscription not found');
    await audit(req, { module: 'subscriptions', action: 'updated', recordId: data.id, metadata: patch });
    res.json({ data });
  } catch (e) { next(e); }
});

// ── Invoices & payments (SaaS billing) ──────────────────────────
platformRouter.get('/invoices', async (req, res, next) => {
  try {
    let q = requireDb().from('saas_invoices').select('*, schools(school_name)');
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.school_id) q = q.eq('school_id', req.query.school_id);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
    if (error) throw new ApiError(500, error.message);
    res.json({ data });
  } catch (e) { next(e); }
});

platformRouter.post('/invoices', requireSuperAdmin, async (req, res, next) => {
  try {
    const body = z.object({
      school_id: uuid, subscription_id: uuid.optional(), amount: money,
      currency: trimStr(8).default('USD'), due_date: z.string().optional(),
      discount: money.default(0), note: trimStr(500).optional(),
    }).parse(req.body);
    const { data, error } = await requireDb().from('saas_invoices').insert({
      ...body, invoice_number: await nextInvoiceNumber(),
      subtotal: body.amount, total: body.amount - (body.discount || 0), status: 'open',
    }).select().single();
    if (error) throw new ApiError(500, error.message);
    await audit(req, { module: 'billing', action: 'created', recordId: data.id, summary: data.invoice_number });
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

platformRouter.post('/payments', requireSuperAdmin, async (req, res, next) => {
  try {
    const body = z.object({
      school_id: uuid, subscription_id: uuid.optional(), invoice_id: uuid.optional(),
      amount: money, currency: trimStr(8).default('USD'),
      payment_method: z.enum(['manual', 'bank_transfer', 'mobile_money', 'provider']).default('manual'),
      provider_reference: trimStr(128).optional(), evidence_url: z.string().url().optional(),
      status: z.enum(['pending', 'successful']).default('successful'),
    }).parse(req.body);
    const supabase = requireDb();
    const reference = `PAY-${Date.now().toString(36).toUpperCase()}`;
    const { data, error } = await supabase.from('subscription_payments').insert({
      ...body, transaction_reference: reference, recorded_by: req.auth.userId,
      verification_status: body.status === 'successful' ? 'verified' : 'unverified',
      verified_by: body.status === 'successful' ? req.auth.userId : null,
      paid_at: body.status === 'successful' ? new Date().toISOString() : null,
    }).select().single();
    if (error) throw new ApiError(500, error.message);
    if (body.invoice_id && body.status === 'successful') await settleInvoice(body.invoice_id);
    await audit(req, { module: 'billing', action: 'payment_recorded', recordId: data.id, summary: reference });
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

async function settleInvoice(invoiceId) {
  const supabase = db();
  const { data: inv } = await supabase.from('saas_invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (!inv) return;
  const { data: pays } = await supabase.from('subscription_payments')
    .select('amount').eq('invoice_id', invoiceId).eq('verification_status', 'verified');
  const paid = (pays || []).reduce((s, p) => s + Number(p.amount), 0);
  await supabase.from('saas_invoices').update({
    status: paid >= Number(inv.total) ? 'paid' : 'partial',
  }).eq('id', invoiceId);
}

platformRouter.post('/payments/:id/verify', requireSuperAdmin, async (req, res, next) => {
  try {
    const { action, reason } = z.object({ action: z.enum(['approve', 'reject']), reason: trimStr(500).optional() }).parse(req.body);
    const supabase = requireDb();
    const { data, error } = await supabase.from('subscription_payments').update({
      verification_status: action === 'approve' ? 'verified' : 'rejected',
      status: action === 'approve' ? 'successful' : 'rejected',
      verified_by: req.auth.userId,
      paid_at: action === 'approve' ? new Date().toISOString() : undefined,
    }).eq('id', req.params.id).select().maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, 'Payment not found');
    if (action === 'approve' && data.invoice_id) {
      await settleInvoice(data.invoice_id);
      if (data.subscription_id) {
        await supabase.from('school_subscriptions').update({ status: 'active' }).eq('id', data.subscription_id);
        await supabase.from('schools').update({ status: 'active' }).eq('id', data.school_id);
      }
    }
    await audit(req, { module: 'billing', action: `payment_${action}d`, recordId: data.id, summary: data.transaction_reference, metadata: { reason } });
    res.json({ data });
  } catch (e) { next(e); }
});

platformRouter.get('/payments', async (req, res, next) => {
  try {
    let q = requireDb().from('subscription_payments').select('*, schools(school_name)');
    for (const f of ['status', 'verification_status', 'school_id']) if (req.query[f]) q = q.eq(f, req.query[f]);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
    if (error) throw new ApiError(500, error.message);
    res.json({ data });
  } catch (e) { next(e); }
});

// ── Platform users ──────────────────────────────────────────────
platformRouter.get('/users', async (req, res, next) => {
  try {
    const { data: users } = await requireDb().from('platform_users')
      .select('*, platform_user_roles(platform_roles(name))').order('created_at');
    res.json({ data: (users || []).map((u) => ({ ...u, roles: (u.platform_user_roles || []).map((l) => l.platform_roles?.name) })) });
  } catch (e) { next(e); }
});

platformRouter.post('/users', requireSuperAdmin, async (req, res, next) => {
  try {
    const body = z.object({
      full_name: z.string().trim().min(2), email: z.string().email(),
      role: z.enum(['super_admin', 'platform_support']), phone: trimStr(32).optional(),
    }).parse(req.body);
    const supabase = requireDb();
    const { data: link, error } = await supabase.auth.admin.generateLink({
      type: 'invite', email: body.email,
      options: { data: { full_name: body.full_name, platform_role: body.role }, redirectTo: `${env.frontendUrl}/login` },
    });
    if (error) throw new ApiError(500, error.message);
    const { data: pu, error: e2 } = await supabase.from('platform_users').insert({
      auth_user_id: link.user.id, full_name: body.full_name, email: body.email, phone: body.phone, status: 'active',
    }).select().single();
    if (e2) throw new ApiError(500, e2.message);
    const { data: role } = await supabase.from('platform_roles').select('id').eq('name', body.role).maybeSingle();
    if (role) await supabase.from('platform_user_roles').insert({ user_id: pu.id, role_id: role.id });
    await sendMail({
      to: body.email, template: 'staff_invitation',
      variables: { user_name: body.full_name, school_name: 'E-MADAARIS Platform', role: body.role,
        invitation_link: link.properties?.action_link || `${env.frontendUrl}/login`, expires_at: new Date(Date.now() + 7 * 86400000).toDateString() },
    });
    await audit(req, { module: 'platform_users', action: 'created', recordId: pu.id, summary: `${body.email} as ${body.role}` });
    res.status(201).json({ data: { user: pu, activationLink: link.properties?.action_link } });
  } catch (e) { next(e); }
});

platformRouter.patch('/users/:id/status', requireSuperAdmin, async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(['active', 'inactive']) }).parse(req.body);
    const { data, error } = await requireDb().from('platform_users').update({ status }).eq('id', req.params.id).select().maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, 'Not found');
    await audit(req, { module: 'platform_users', action: 'status_changed', recordId: data.id, summary: status });
    res.json({ data });
  } catch (e) { next(e); }
});

// ── Platform dashboard & analytics ──────────────────────────────
platformRouter.get('/dashboard', async (req, res, next) => {
  try {
    const supabase = requireDb();
    // One parallel wave: each extra awaited round trip costs a full Supabase latency.
    const [
      { data: schoolRows },
      { count: applications },
      { data: subscriptionRows },
      { data: verified },
      { count: students },
      { count: totalUsers },
      { count: outstandingInvoices },
      { data: recentSchools },
      { data: recentPayments },
    ] = await Promise.all([
      supabase.from('schools').select('status, created_at'),
      supabase.from('school_registrations').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
      supabase.from('school_subscriptions').select('status, plan_id, subscription_plans(name)'),
      supabase.from('subscription_payments').select('amount, created_at').eq('verification_status', 'verified'),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('school_users').select('id', { count: 'exact', head: true }),
      supabase.from('saas_invoices').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('schools').select('id, school_name, status, created_at').order('created_at', { ascending: false }).limit(8),
      supabase.from('subscription_payments')
        .select('id, transaction_reference, amount, currency, status, created_at, schools(school_name)')
        .order('created_at', { ascending: false }).limit(8),
    ]);

    const schools = schoolRows || [];
    const statusCount = (s) => schools.filter((r) => r.status === s).length;
    const payments = verified || [];
    const totalRevenue = payments.reduce((s, p) => s + Number(p.amount), 0);
    const mrr = payments.filter((p) => Date.now() - new Date(p.created_at).getTime() < 30 * 86400000)
      .reduce((s, p) => s + Number(p.amount), 0);

    const subscriptions = subscriptionRows || [];
    const planDist = {};
    const subscriptionStatuses = {};
    for (const row of subscriptions) {
      subscriptionStatuses[row.status] = (subscriptionStatuses[row.status] || 0) + 1;
      if (row.plan_id) {
        const n = row.subscription_plans?.name || 'Unknown';
        planDist[n] = (planDist[n] || 0) + 1;
      }
    }

    const growth = {};
    for (const r of schools) {
      if (!r.created_at) continue;
      const k = new Date(r.created_at).toISOString().slice(0, 7);
      growth[k] = (growth[k] || 0) + 1;
    }

    res.json({
      data: {
        stats: {
          schools: schools.length,
          activeSchools: statusCount('active'),
          trialSchools: statusCount('trial'),
          suspendedSchools: statusCount('suspended'),
          pendingApplications: applications || 0,
          totalUsers: totalUsers || 0,
          totalStudents: students || 0,
          subscriptions: subscriptions.length,
          totalRevenue, mrr,
          outstandingInvoices: outstandingInvoices || 0,
        },
        subscriptionStatuses,
        planDistribution: planDist,
        registrationGrowth: growth,
        recentSchools: recentSchools || [],
        recentPayments: recentPayments || [],
      },
    });
  } catch (e) { next(e); }
});

// ── Audit logs ──────────────────────────────────────────────────
platformRouter.get('/audit-logs', requireSuperAdmin, async (req, res, next) => {
  try {
    let q = requireDb().from('audit_logs').select('*, schools(school_name)');
    for (const f of ['module', 'action', 'school_id', 'status']) if (req.query[f]) q = q.eq(f, req.query[f]);
    if (req.query.from) q = q.gte('created_at', req.query.from);
    if (req.query.to) q = q.lte('created_at', req.query.to);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
    if (error) throw new ApiError(500, error.message);
    res.json({ data });
  } catch (e) { next(e); }
});

// ── Backups (every tenant) ──────────────────────────────────────
platformRouter.get('/backups', requireSuperAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    res.json(await listPlatformBackups({
      page, pageSize, schoolId: req.query.school_id || undefined,
    }));
  } catch (e) { next(e); }
});

platformRouter.post('/backups/auto', requireSuperAdmin, async (req, res, next) => {
  try {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const auto = setAutoBackup(enabled);
    await audit(req, {
      module: 'backup', action: enabled ? 'scheduler_enabled' : 'scheduler_disabled',
      summary: `Automatic school backups ${enabled ? 'enabled' : 'disabled'} (every ${Math.round(auto.intervalMs / 1000)}s)`,
    });
    res.json({ data: auto });
  } catch (e) { next(e); }
});

platformRouter.post('/backups/run', requireSuperAdmin, async (req, res, next) => {
  try {
    const schoolId = req.body?.school_id;
    if (schoolId) {
      const result = await createBackup(schoolId, { kind: 'manual', actor: { userId: req.auth.userId, scope: 'platform' } });
      await audit(req, { module: 'backup', action: 'created', recordId: schoolId, summary: `Platform backup for school ${schoolId}` });
      return res.status(201).json({ data: result });
    }
    const auto = await runAutoBackupRound({ force: true });
    await audit(req, { module: 'backup', action: 'created', summary: 'Platform backup round triggered manually' });
    res.json({ data: auto });
  } catch (e) { next(e); }
});

platformRouter.get('/backups/:id/download', requireSuperAdmin, async (req, res, next) => {
  try {
    const { data: meta } = await requireDb().from('audit_logs').select('school_id, created_at')
      .eq('id', req.params.id).eq('module', 'backup').eq('action', 'backup').maybeSingle();
    if (!meta) throw new ApiError(404, 'Backup not found');
    const found = await getBackupPayload(meta.school_id, req.params.id);
    if (!found?.payload) throw new ApiError(404, 'Backup payload was pruned');
    const stamp = String(meta.created_at || '').slice(0, 10) || 'backup';
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="platform-backup-${stamp}.json"`);
    res.send(JSON.stringify(found.payload, null, 2));
  } catch (e) { next(e); }
});

platformRouter.get('/backups/auto/status', requireSuperAdmin, async (req, res, next) => {
  try { res.json({ data: autoBackupState() }); } catch (e) { next(e); }
});

// ── Recycle bin (every tenant) ──────────────────────────────────
platformRouter.get('/trash', requireSuperAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 25));
    res.json(await listTrash({
      schoolId: req.query.school_id || null, q: req.query.q, page, pageSize,
    }));
  } catch (e) { next(e); }
});

platformRouter.post('/trash/empty', requireSuperAdmin, async (req, res, next) => {
  try {
    const schoolId = req.body?.school_id || null;
    const actor = { userId: req.auth.userId, scope: 'platform' };
    const result = schoolId
      ? await emptyTrashForSchool(schoolId, actor)
      : await emptyPlatformTrash(actor);
    await audit(req, {
      module: 'trash', action: 'purged',
      summary: schoolId
        ? `Platform emptied the recycle bin for school ${schoolId} (${result.purged} items)`
        : `Platform emptied every school's recycle bin (${result.purged} items)`,
      metadata: { school_id: schoolId },
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

platformRouter.post('/trash/:id/restore', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await restoreTrashItem(req, req.params.id, { platform: true });
    await audit(req, {
      module: 'trash', action: 'restored', recordId: req.params.id,
      summary: `Platform restored ${result.label || result.record_id}`,
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

platformRouter.delete('/trash/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await purgeTrashItem(req, req.params.id, { platform: true });
    await audit(req, {
      module: 'trash', action: 'purged', recordId: req.params.id,
      summary: `Platform permanently removed ${result.label || req.params.id} from the recycle bin`,
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ── Per-school danger zone ──────────────────────────────────────
platformRouter.delete('/schools/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const { confirm } = z.object({ confirm: z.string().trim().min(1) }).parse({ confirm: req.query.confirm });
    const supabase = requireDb();
    const { data: school, error: readError } = await supabase.from('schools')
      .select('id, school_name, registration_number').eq('id', req.params.id).maybeSingle();
    if (readError) throw new ApiError(500, readError.message);
    if (!school) throw new ApiError(404, 'School not found');
    if (confirm !== school.school_name) {
      throw new ApiError(400, `Type the school name exactly ("${school.school_name}") to confirm.`);
    }

    const { data: accounts } = await supabase.from('school_users')
      .select('auth_user_id').eq('school_id', school.id);
    const authIds = [...new Set((accounts || []).map((r) => r.auth_user_id).filter(Boolean))];

    // Bin snapshots cannot outlive their tenant; close them before the cascade removes the school.
    const closed = await closeTrashForSchool(school.id, { userId: req.auth.userId, scope: 'platform' });

    const { error } = await supabase.from('schools').delete().eq('id', school.id);
    if (error) throw new ApiError(500, error.message);

    for (let i = 0; i < authIds.length; i += 20) {
      await Promise.allSettled(authIds.slice(i, i + 20).map((id) => supabase.auth.admin.deleteUser(id)));
    }

    await audit(req, {
      module: 'schools', action: 'deleted', recordId: school.id,
      summary: `Permanently deleted school ${school.school_name}`,
      metadata: {
        school_name: school.school_name, registration_number: school.registration_number,
        auth_users: authIds.length, closed_trash: closed,
      },
    });
    res.json({ data: { id: school.id, school_name: school.school_name, users: authIds.length, trash: closed } });
  } catch (e) { next(e); }
});

platformRouter.post('/schools/:id/clear-data', requireSuperAdmin, async (req, res, next) => {
  try {
    const { confirm } = z.object({ confirm: z.string().trim().min(1) }).parse(req.body);
    const { data: school } = await requireDb().from('schools')
      .select('id, school_name').eq('id', req.params.id).maybeSingle();
    if (!school) throw new ApiError(404, 'School not found');
    if (confirm !== school.school_name) {
      throw new ApiError(400, `Type the school name exactly ("${school.school_name}") to confirm.`);
    }
    const result = await clearSchoolData(school.id, {
      actor: { userId: req.auth.userId, scope: 'platform' },
    });
    await audit(req, {
      module: 'school', action: 'purged', recordId: school.id,
      summary: `Platform cleared all data for ${school.school_name} (${result.tables} tables, ${result.rows} rows snapshotted)`,
      metadata: { snapshotId: result.snapshotId, rows: result.rows },
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ── Website & policy content (Super Admin) ──────────────────────
platformRouter.get('/content', requireSuperAdmin, async (req, res, next) => {
  try {
    res.json({ data: await readSiteContent(requireDb()) });
  } catch (e) { next(e); }
});

platformRouter.put('/content/:page', requireSuperAdmin, async (req, res, next) => {
  try {
    const { content } = z.object({ content: z.any() }).parse(req.body);
    if (!SITE_CONTENT_PAGES.includes(req.params.page)) throw new ApiError(404, 'Unknown content page');
    const invalid = assertSiteContent(content);
    if (invalid) throw new ApiError(400, invalid);
    await writeSiteContent(requireDb(), req.params.page, content);
    await audit(req, {
      module: 'site_content', action: 'updated', recordId: req.params.page,
      summary: `Website content updated: ${req.params.page}`,
    });
    res.json({ data: { page: req.params.page, content } });
  } catch (e) { next(e); }
});

platformRouter.delete('/content/:page', requireSuperAdmin, async (req, res, next) => {
  try {
    if (!SITE_CONTENT_PAGES.includes(req.params.page)) throw new ApiError(404, 'Unknown content page');
    await clearSiteContent(requireDb(), req.params.page);
    await audit(req, {
      module: 'site_content', action: 'reset', recordId: req.params.page,
      summary: `Website content reset to defaults: ${req.params.page}`,
    });
    res.json({ data: { page: req.params.page, reset: true } });
  } catch (e) { next(e); }
});

// ── Global settings (platform config row, kept in email-free KV) ─
platformRouter.get('/settings', async (req, res, next) => {
  try {
    const { data } = await requireDb().from('email_templates')
      .select('template_key, subject, body_html').order('template_key');
    res.json({ data: { templates: (data || []).filter((row) => !isSiteContentKey(row.template_key)) } });
  } catch (e) { next(e); }
});

// ── Platform broadcast (Super Admin) ────────────────────────────
/**
 * One message to a single school, to a named role, or to every school on the platform. It is resolved
 * one tenant at a time so every inbox row carries the school it belongs to and the tenant's own
 * preference switches still apply — a platform broadcast is not a licence to ignore an opt-out.
 */
async function activeMemberIds(supabase, schoolId) {
  const { data, error } = await supabase.from('school_users').select('id')
    .eq('school_id', schoolId).eq('status', 'active').limit(3000);
  if (error) return [];
  return (data || []).map((row) => row.id);
}

platformRouter.get('/broadcast/roles', requireSuperAdmin, async (req, res, next) => {
  try {
    const schoolId = z.string().uuid().optional().parse(req.query.school_id);
    let query = requireDb().from('school_roles')
      .select('name, schools!inner(status)')
      .in('schools.status', ['active', 'trial']);
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data, error } = await query.limit(5000);
    if (error) throw new ApiError(500, error.message);
    res.json({ data: [...new Set((data || []).map((row) => row.name))].sort() });
  } catch (e) { next(e); }
});

platformRouter.post('/broadcast', requireSuperAdmin, async (req, res, next) => {
  try {
    const body = z.object({
      title: z.string().trim().min(3).max(200),
      body: z.string().trim().max(2000).optional(),
      link: z.string().trim().max(200).optional(),
      target: z.enum(['all_schools', 'one_school', 'platform_team']).default('all_schools'),
      school_id: z.string().uuid().optional(),
      roles: z.array(z.string().trim().min(2).max(40)).max(10).default([]),
      email_copy: z.coerce.boolean().default(false),
    }).parse(req.body);
    const supabase = requireDb();
    const deliveries = [];

    if (body.target === 'platform_team') {
      const { data, error } = await supabase.from('platform_users').select('id').eq('status', 'active').limit(500);
      if (error) throw new ApiError(500, error.message);
      const summary = await notify(supabase, (data || []).map((row) => row.id), {
        scope: 'platform', category: 'announcements', title: body.title,
        body: body.body || null, link: body.link || '/notifications', email: false,
      });
      deliveries.push({ scope: 'platform', recipients: summary.inserted, error: summary.error || null, push: summary.push });
    } else {
      let schools;
      if (body.target === 'one_school') {
        const { data } = await supabase.from('schools').select('id, school_name').eq('id', body.school_id).maybeSingle();
        if (!data) throw new ApiError(404, 'School not found');
        schools = [data];
      } else {
        const { data, error } = await supabase.from('schools').select('id, school_name')
          .in('status', ['active', 'trial']).limit(200);
        if (error) throw new ApiError(500, error.message);
        schools = data || [];
      }
      if (!schools.length) throw new ApiError(404, 'No school matches this broadcast');
      // Five tenants at a time: a platform-wide post is a background job measured in remote round trips,
      // and an unbounded fan-out would hold the request open for minutes.
      for (let i = 0; i < schools.length; i += 5) {
        const batch = await Promise.all(schools.slice(i, i + 5).map(async (school) => {
          const ids = body.roles.length
            ? await userIdsWithRoles(supabase, school.id, body.roles)
            : await activeMemberIds(supabase, school.id);
          const summary = await notify(supabase, ids, {
            schoolId: school.id, scope: 'school', category: 'announcements',
            title: body.title, body: body.body || null, link: body.link || '/notifications',
            email: body.email_copy,
          });
          return {
            school_id: school.id, school_name: school.school_name,
            recipients: summary.inserted, error: summary.error || null, push: summary.push,
          };
        }));
        deliveries.push(...batch);
      }
    }

    const push = { attempted: 0, sent: 0, failed: 0, skipped: null };
    for (const item of deliveries) {
      const outcome = await item.push;
      if (!outcome) continue;
      push.attempted += outcome.attempted || 0;
      push.sent += outcome.sent || 0;
      push.failed += outcome.failed || 0;
      if (outcome.skipped) push.skipped = outcome.skipped;
    }
    const delivered = deliveries.reduce((sum, item) => sum + (item.recipients || 0), 0);
    const failures = deliveries.filter((item) => item.error);
    await audit(req, {
      module: 'notifications', action: 'broadcast',
      summary: `Broadcast to ${body.target}${body.roles.length ? ` (${body.roles.join(', ')})` : ''}: `
        + `${deliveries.length} audience(s), ${delivered} inbox rows`,
      metadata: { title: body.title, target: body.target, school_id: body.school_id || null, roles: body.roles },
    });
    res.status(201).json({
      data: {
        target: body.target, audiences: deliveries.length, delivered, push,
        sender_errors: failures.map((item) => ({ school: item.school_name || 'platform', error: item.error })),
        detail: deliveries.map(({ push: _push, ...rest }) => rest),
      },
    });
  } catch (e) { next(e); }
});
