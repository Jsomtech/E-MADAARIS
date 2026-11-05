import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { db, requireDb } from '../config/supabase.js';
import { ApiError } from '../middleware/error.js';
import { requirePermission } from '../middleware/rbac.js';
import { audit } from '../services/audit.js';
import { derivePrimaryRole, assignRole } from '../services/provisioning.js';
import { visibleStudentIds } from '../services/scopes.js';
import { sendMail } from '../services/mailer.js';
import { sanitizeSearch } from '../core/crud.js';
import { IMAGE_MIME, sniffImage } from '../core/images.js';
import { credentialFlags, getIssuedCredential, setIssuedCredential } from '../services/credentialVault.js';
import { createBackup, listBackups, getBackupPayload } from '../services/backups.js';
import { clearSchoolData } from '../services/schoolData.js';
import { reclaimIdentity, temporaryPassword } from '../services/authIdentity.js';
import { listTeacherStaff } from '../services/staffRoles.js';
import { sendAccountConfirmation } from '../services/accountEmails.js';
import { alertUsers } from '../services/notify.js';
import { env } from '../config/env.js';

export const schoolRouter = Router();

// ── Profile ─────────────────────────────────────────────────────
schoolRouter.get('/profile', requirePermission('school.view'), async (req, res, next) => {
  try {
    const { data } = await requireDb().from('schools').select('*').eq('id', req.auth.schoolId).maybeSingle();
    res.json({ data });
  } catch (e) { next(e); }
});

schoolRouter.patch('/profile', requirePermission('school.edit'), async (req, res, next) => {
  try {
    const payload = z.object({
      school_name: z.string().trim().min(2).optional(),
      email: z.string().email().optional(), phone: z.string().trim().optional(),
      country: z.string().trim().optional(), region: z.string().trim().optional(),
      city: z.string().trim().optional(), address: z.string().trim().optional(),
      school_type: z.enum(['primary', 'secondary', 'primary_secondary', 'integrated']).optional(),
      logo_url: z.string().url().optional(),
    }).parse(req.body);
    if (!Object.keys(payload).length) throw new ApiError(400, 'No fields');
    const { data, error } = await requireDb().from('schools').update(payload)
      .eq('id', req.auth.schoolId).select().maybeSingle();
    if (error) throw new ApiError(500, error.message);
    await audit(req, { module: 'school', action: 'updated', recordId: req.auth.schoolId, summary: 'School profile updated' });
    res.json({ data });
  } catch (e) { next(e); }
});

// ── School logo ─────────────────────────────────────────────────
// The logo owns the dashboard identity (sidebar, topbar, student portal). Uploads replace the
// URL field: admins pick a file, the server validates the bytes and stores the public link.
const LOGO_BUCKET = 'school-logos';
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = LOGO_MIMES.includes(file.mimetype);
    cb(ok ? null : new ApiError(400, 'Logo must be a JPG, PNG or WebP image.'), ok);
  },
});

let logoBucketPromise = null;
async function ensureLogoBucket(supabase) {
  if (!logoBucketPromise) {
    logoBucketPromise = (async () => {
      const { data: buckets, error } = await supabase.storage.listBuckets();
      if (error) throw new ApiError(502, `Storage is not reachable: ${error.message}`);
      if (!(buckets || []).some((b) => b.name === LOGO_BUCKET)) {
        const { error: createError } = await supabase.storage.createBucket(LOGO_BUCKET, {
          public: true, fileSizeLimit: LOGO_MAX_BYTES,
        });
        if (createError && !/already exists/i.test(createError.message)) throw new ApiError(502, createError.message);
      }
    })().catch((error) => { logoBucketPromise = null; throw error; });
  }
  return logoBucketPromise;
}

/** Storage path of a public URL that belongs to this project's logo bucket, else null. */
function logoPathFromUrl(url) {
  const marker = `/object/public/${LOGO_BUCKET}/`;
  const index = String(url || '').indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(String(url).slice(index + marker.length).split('?')[0]);
}

schoolRouter.post('/logo', requirePermission('school.edit'), logoUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, 'Attach a logo image.');
    const ext = sniffImage(req.file.buffer);
    if (!ext) throw new ApiError(400, 'That file is not a real JPG, PNG or WebP image.');
    const supabase = requireDb();
    await ensureLogoBucket(supabase);

    const path = `${req.auth.schoolId}/logo-${randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(LOGO_BUCKET).upload(path, req.file.buffer, {
      contentType: IMAGE_MIME[ext], cacheControl: '31536000', upsert: false,
    });
    if (uploadError) throw new ApiError(502, `Logo upload failed: ${uploadError.message}`);
    const { data: pub } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);

    const { data: previous } = await supabase.from('schools').select('logo_url')
      .eq('id', req.auth.schoolId).maybeSingle();
    const { data, error } = await supabase.from('schools').update({ logo_url: pub.publicUrl })
      .eq('id', req.auth.schoolId).select('id, school_name, logo_url').single();
    if (error) throw new ApiError(500, error.message);

    const oldPath = logoPathFromUrl(previous?.logo_url);
    if (oldPath && oldPath !== path) {
      try { await supabase.storage.from(LOGO_BUCKET).remove([oldPath]); } catch { /* best effort */ }
    }
    await audit(req, { module: 'school', action: 'logo_updated', recordId: req.auth.schoolId, summary: 'School logo uploaded' });
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

schoolRouter.delete('/logo', requirePermission('school.edit'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: current } = await supabase.from('schools').select('logo_url')
      .eq('id', req.auth.schoolId).maybeSingle();
    const { error } = await supabase.from('schools').update({ logo_url: null })
      .eq('id', req.auth.schoolId);
    if (error) throw new ApiError(500, error.message);
    const oldPath = logoPathFromUrl(current?.logo_url);
    if (oldPath) {
      try { await supabase.storage.from(LOGO_BUCKET).remove([oldPath]); } catch { /* best effort */ }
    }
    await audit(req, { module: 'school', action: 'logo_removed', recordId: req.auth.schoolId, summary: 'School logo removed' });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// ── Staff profile photo ─────────────────────────────────────────
// School administrators upload a teacher/staff photo; the validated bytes land in a public
// bucket and only the URL is stored on school_users.avatar_url.
const STAFF_AVATAR_BUCKET = 'staff-avatars';
const STAFF_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const STAFF_AVATAR_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const staffAvatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: STAFF_AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = STAFF_AVATAR_MIMES.includes(file.mimetype);
    cb(ok ? null : new ApiError(400, 'Profile photo must be a JPG, PNG or WebP image.'), ok);
  },
});

let staffAvatarBucketPromise = null;
async function ensureStaffAvatarBucket(supabase) {
  if (!staffAvatarBucketPromise) {
    staffAvatarBucketPromise = (async () => {
      const { data: buckets, error } = await supabase.storage.listBuckets();
      if (error) throw new ApiError(502, `Storage is not reachable: ${error.message}`);
      if (!(buckets || []).some((b) => b.name === STAFF_AVATAR_BUCKET)) {
        const { error: createError } = await supabase.storage.createBucket(STAFF_AVATAR_BUCKET, {
          public: true, fileSizeLimit: STAFF_AVATAR_MAX_BYTES,
        });
        if (createError && !/already exists/i.test(createError.message)) throw new ApiError(502, createError.message);
      }
    })().catch((error) => { staffAvatarBucketPromise = null; throw error; });
  }
  return staffAvatarBucketPromise;
}

/** Storage path of a public URL that belongs to this project's bucket, else null. */
function publicPathFromUrl(url, bucket) {
  const marker = `/object/public/${bucket}/`;
  const index = String(url || '').indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(String(url).slice(index + marker.length).split('?')[0]);
}

schoolRouter.post('/users/:id/avatar', requirePermission('users.edit'), staffAvatarUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, 'Attach a profile photo.');
    const ext = sniffImage(req.file.buffer);
    if (!ext) throw new ApiError(400, 'That file is not a real JPG, PNG or WebP image.');
    const supabase = requireDb();
    const { data: su } = await supabase.from('school_users')
      .select('id, avatar_url').eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!su) throw new ApiError(404, 'User not found in this school');

    await ensureStaffAvatarBucket(supabase);
    const path = `${req.auth.schoolId}/${req.params.id}-${randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(STAFF_AVATAR_BUCKET).upload(path, req.file.buffer, {
      contentType: IMAGE_MIME[ext], cacheControl: '31536000', upsert: false,
    });
    if (uploadError) throw new ApiError(502, `Photo upload failed: ${uploadError.message}`);
    const { data: pub } = supabase.storage.from(STAFF_AVATAR_BUCKET).getPublicUrl(path);

    const { error } = await supabase.from('school_users').update({ avatar_url: pub.publicUrl })
      .eq('id', su.id).eq('school_id', req.auth.schoolId);
    if (error) throw new ApiError(500, error.message);
    const oldPath = publicPathFromUrl(su.avatar_url, STAFF_AVATAR_BUCKET);
    if (oldPath && oldPath !== path) {
      try { await supabase.storage.from(STAFF_AVATAR_BUCKET).remove([oldPath]); } catch { /* best effort */ }
    }
    await audit(req, { module: 'users', action: 'avatar_updated', recordId: su.id });
    res.status(201).json({ data: { url: pub.publicUrl } });
  } catch (e) { next(e); }
});

// ── Settings ────────────────────────────────────────────────────
schoolRouter.get('/settings', requirePermission('school.view'), async (req, res, next) => {
  try {
    const { data } = await requireDb().from('school_settings')
      .select('*').eq('school_id', req.auth.schoolId).maybeSingle();
    res.json({ data });
  } catch (e) { next(e); }
});

schoolRouter.patch('/settings', requirePermission('school.edit'), async (req, res, next) => {
  try {
    const payload = z.object({
      academic_year_id: z.string().uuid().nullable().optional(),
      default_language: z.enum(['so', 'en']).optional(),
      currency: z.string().trim().max(8).optional(),
      timezone: z.string().trim().max(64).optional(),
      school_working_days: z.array(z.string()).optional(),
      grading_configuration: z.object({}).passthrough().optional(),
      attendance_configuration: z.object({}).passthrough().optional(),
      branding: z.object({}).passthrough().optional(),
    }).parse(req.body);
    const supabase = requireDb();
    const { data: cur } = await supabase.from('school_settings').select('id').eq('school_id', req.auth.schoolId).maybeSingle();
    let data;
    if (cur) {
      ({ data } = await supabase.from('school_settings').update(payload).eq('id', cur.id).select().maybeSingle());
    } else {
      ({ data } = await supabase.from('school_settings').insert({ school_id: req.auth.schoolId, ...payload }).select().single());
    }
    await audit(req, { module: 'school', action: 'settings_updated', recordId: req.auth.schoolId });
    res.json({ data });
  } catch (e) { next(e); }
});

// ── Academic years (admissions desk) ────────────────────────────
// The generic /academic-years CRUD needs timetable.create, which a school admin does not have;
// opening admissions is an administrative action, so it lives here with school.edit.
const academicYearSchema = z.object({
  name: z.string().trim().min(2).max(64),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  is_current: z.boolean().optional(),
});

async function activateAcademicYear(supabase, schoolId, yearId) {
  await supabase.from('academic_years').update({ is_current: false })
    .eq('school_id', schoolId).eq('is_current', true);
  const { data, error } = await supabase.from('academic_years')
    .update({ is_current: true }).eq('id', yearId).eq('school_id', schoolId).select().single();
  if (error) throw new ApiError(500, error.message);
  const { error: settingsError } = await supabase.from('school_settings')
    .upsert({ school_id: schoolId, academic_year_id: yearId }, { onConflict: 'school_id' });
  if (settingsError) throw new ApiError(500, settingsError.message);
  return data;
}

schoolRouter.post('/academic-years', requirePermission('school.edit', 'timetable.manage'), async (req, res, next) => {
  try {
    const body = academicYearSchema.parse(req.body);
    const supabase = requireDb();
    const { data, error } = await supabase.from('academic_years').insert({
      school_id: req.auth.schoolId, name: body.name,
      start_date: body.start_date || null, end_date: body.end_date || null,
      is_current: false,
    }).select().single();
    if (error) {
      throw new ApiError(error.code === '23505' ? 409 : 500,
        error.code === '23505' ? `Academic year ${body.name} already exists in this school.` : error.message);
    }
    const year = body.is_current ? await activateAcademicYear(supabase, req.auth.schoolId, data.id) : data;
    await audit(req, {
      module: 'school', action: 'academic_year_opened', recordId: year.id,
      summary: `${year.name}${body.is_current ? ' (set as current)' : ''}`,
    });
    res.status(201).json({ data: year });
  } catch (e) { next(e); }
});

schoolRouter.post('/academic-years/:id/activate', requirePermission('school.edit', 'timetable.manage'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: existing } = await supabase.from('academic_years').select('id, name')
      .eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!existing) throw new ApiError(404, 'Academic year not found in this school');
    const year = await activateAcademicYear(supabase, req.auth.schoolId, existing.id);
    await audit(req, {
      module: 'school', action: 'academic_year_activated', recordId: year.id,
      summary: `${year.name} is now the active academic year`,
    });
    res.json({ data: year });
  } catch (e) { next(e); }
});

// ── Subscription (own school, read-only) ────────────────────────
schoolRouter.get('/subscription', requirePermission('subscription.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: sub } = await supabase.from('school_subscriptions')
      .select('*, subscription_plans(*)').eq('school_id', req.auth.schoolId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const { data: invoices } = await supabase.from('saas_invoices')
      .select('*').eq('school_id', req.auth.schoolId).order('created_at', { ascending: false }).limit(24);
    const { data: payments } = await supabase.from('subscription_payments')
      .select('*').eq('school_id', req.auth.schoolId).order('created_at', { ascending: false }).limit(24);
    res.json({ data: { subscription: sub, invoices: invoices || [], payments: payments || [] } });
  } catch (e) { next(e); }
});

// Payment evidence submission for schools (verified by Super Admin)
schoolRouter.post('/subscription/evidence', requirePermission('subscription.view'), async (req, res, next) => {
  try {
    const body = z.object({
      invoice_id: z.string().uuid().optional(), amount: z.coerce.number().min(0),
      currency: z.string().trim().max(8).default('USD'),
      payment_method: z.enum(['bank_transfer', 'mobile_money']),
      provider_reference: z.string().trim().min(3), evidence_url: z.string().url().optional(),
    }).parse(req.body);
    const { data, error } = await requireDb().from('subscription_payments').insert({
      school_id: req.auth.schoolId, ...body,
      transaction_reference: `EVD-${Date.now().toString(36).toUpperCase()}`,
      status: 'pending', verification_status: 'unverified',
    }).select().single();
    if (error) throw new ApiError(500, error.message);
    await audit(req, { module: 'subscription', action: 'evidence_submitted', recordId: data.id });
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

// ── Usage ───────────────────────────────────────────────────────
schoolRouter.get('/usage', requirePermission('subscription.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const [{ count: students }, { count: users }, staffSeats] = await Promise.all([
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', req.auth.schoolId).eq('status', 'active'),
      supabase.from('school_users').select('*', { count: 'exact', head: true }).eq('school_id', req.auth.schoolId),
      staffSeatUsage(req),
    ]);
    const plan = req.auth.subscription?.plan;
    const maxStaff = plan?.max_staff ?? null;
    res.json({
      data: {
        students: students || 0, staffUsers: users || 0, staffSeats,
        limits: { max_students: plan?.max_students, max_staff: maxStaff, max_storage_mb: plan?.max_storage_mb },
        staffSeatsLeft: maxStaff ? Math.max(0, Number(maxStaff) - staffSeats) : null,
        subscription_status: req.auth.subscription?.status,
      },
    });
  } catch (e) { next(e); }
});

// ── Audit trail (this school only) ──────────────────────────────
schoolRouter.get('/audit', requirePermission('audit.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    let q = requireDb().from('audit_logs')
      .select('id, user_id, action, module, record_id, summary, ip_address, status, created_at', { count: 'exact' })
      .eq('school_id', req.auth.schoolId).eq('user_scope', 'school');
    if (req.query.module) q = q.eq('module', req.query.module);
    if (req.query.action) q = q.eq('action', req.query.action);
    if (req.query.q) {
      const term = `%${sanitizeSearch(req.query.q)}%`;
      q = q.or(`summary.ilike.${term},module.ilike.${term},action.ilike.${term}`);
    }
    const { data, count, error } = await q.order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new ApiError(500, error.message);
    const { data: modules } = await requireDb().from('audit_logs').select('module')
      .eq('school_id', req.auth.schoolId).order('created_at', { ascending: false }).limit(2000);
    res.json({ data: data || [], total: count || 0, page, pageSize,
      modules: [...new Set((modules || []).map((m) => m.module))].sort() });
  } catch (e) { next(e); }
});

// ── Personal portal: the students behind this account ───────────
schoolRouter.get('/me/students', async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const visible = await visibleStudentIds(req.auth);
    if (!visible) throw new ApiError(403, 'Not a student or parent account');
    if (!visible.length) return res.json({ data: [] });
    const { data, error } = await supabase.from('students')
      .select('*, classes(name), sections(name), academic_years(name)')
      .eq('school_id', schoolId).in('id', visible).order('full_name');
    if (error) throw new ApiError(500, error.message);
    res.json({ data: data || [] });
  } catch (e) { next(e); }
});

// ── Teacher's own classes and subjects ──────────────────────────
// Attendance and timetable pickers show only what this teacher actually teaches, so taking
// attendance always starts from a real class/subject pair.
schoolRouter.get('/me/teaching', requirePermission('attendance.view', 'timetable.view'), async (req, res, next) => {
  try {
    const schoolId = req.auth.schoolId;
    const supabase = requireDb();
    const [{ data: assigned, error: ae }, { data: lessons, error: le }] = await Promise.all([
      supabase.from('teacher_assignments')
        .select('class_id, subject_id, classes(name), subjects(name)')
        .eq('school_id', schoolId).eq('school_user_id', req.auth.userId).limit(500),
      supabase.from('timetable_entries')
        .select('class_id, subject_id, classes(name), subjects(name)')
        .eq('school_id', schoolId).eq('teacher_id', req.auth.userId).limit(2000),
    ]);
    if (ae) throw new ApiError(500, ae.message);
    if (le) throw new ApiError(500, le.message);
    const classMap = new Map();
    const pairs = new Map();
    for (const row of [...(assigned || []), ...(lessons || [])]) {
      if (!row.class_id) continue;
      if (!classMap.has(row.class_id)) classMap.set(row.class_id, row.classes?.name || 'Class');
      if (row.subject_id && !pairs.has(`${row.class_id}:${row.subject_id}`)) {
        pairs.set(`${row.class_id}:${row.subject_id}`, {
          class_id: row.class_id, class_name: row.classes?.name || '',
          subject_id: row.subject_id, subject_name: row.subjects?.name || 'Subject',
        });
      }
    }
    const classes = [...classMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const assignments = [...pairs.values()].sort((a, b) => a.class_name.localeCompare(b.class_name)
      || a.subject_name.localeCompare(b.subject_name));
    res.json({ data: { classes, assignments } });
  } catch (e) { next(e); }
});

// ── School users ────────────────────────────────────────────────
const PERSONAL_ROLE_NAMES = ['parent', 'student'];

/**
 * Ids of every account holding at least one non-portal role — the staff directory's universe.
 * `roleNames` narrows it to the roles a picker actually wants, so a duty roster can ask for
 * invigilators without offering the whole office.
 */
async function staffUserIds(schoolId, roleNames = []) {
  const supabase = requireDb();
  const { data: roles, error } = await supabase.from('school_roles')
    .select('id, name').eq('school_id', schoolId);
  if (error) throw new ApiError(500, error.message);
  let picked = (roles || []).filter((r) => !PERSONAL_ROLE_NAMES.includes(r.name));
  if (roleNames.length) picked = picked.filter((r) => roleNames.includes(r.name));
  const staffRoleIds = picked.map((r) => r.id);
  if (!staffRoleIds.length) return [];
  const { data: links, error: linkError } = await supabase.from('school_user_roles').select('user_id')
    .eq('school_id', schoolId).in('role_id', staffRoleIds);
  if (linkError) throw new ApiError(500, linkError.message);
  return [...new Set((links || []).map((l) => l.user_id))];
}

// Staff only: students and parents have personal portals and are listed with their class records.
schoolRouter.get('/users', requirePermission('users.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
    const roleNames = String(req.query.role || '').split(',').map((s) => s.trim()).filter(Boolean);
    const staffIds = await staffUserIds(req.auth.schoolId, roleNames);
    if (!staffIds.length) return res.json({ data: [], total: 0, page, pageSize });
    let q = requireDb().from('school_users').select('*', { count: 'exact' })
      .eq('school_id', req.auth.schoolId).in('id', staffIds);
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.q) {
      const term = sanitizeSearch(req.query.q);
      q = q.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
    }
    const { data, count, error } = await q.order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new ApiError(500, error.message);
    const ids = (data || []).map((u) => u.id);
    let rolesBy = {};
    if (ids.length) {
      const { data: links } = await requireDb().from('school_user_roles')
        .select('user_id, school_roles(name)').in('user_id', ids);
      for (const l of links || []) {
        const name = l.school_roles?.name;
        if (name) (rolesBy[l.user_id] ||= []).push(name);
      }
    }
    res.json({ data: (data || []).map((u) => ({ ...u, roles: rolesBy[u.id] || [] })), total: count, page, pageSize });
  } catch (e) { next(e); }
});

/**
 * Teacher-only directory for timetables and teaching assignments. Any staff role that can
 * schedule lessons may read it, so a timetable manager without users.view still gets a list;
 * students, registrars and admins who do not teach stay out of the select.
 */
schoolRouter.get('/teachers', requirePermission(
  'timetable.view', 'timetable.manage', 'teachers.view', 'teachers.manage', 'school.edit', 'users.view',
), async (req, res, next) => {
  try {
    res.json({ data: await listTeacherStaff(req.auth.schoolId) });
  } catch (e) { next(e); }
});

schoolRouter.get('/roles', requirePermission('users.view'), async (req, res, next) => {  try {
    const { data, error } = await requireDb().from('school_roles')
      .select('id, name, description, is_system_role').eq('school_id', req.auth.schoolId).order('name');
    if (error) throw new ApiError(500, error.message);
    res.json({ data: data || [] });
  } catch (e) { next(e); }
});

schoolRouter.post('/users/invite', requirePermission('users.create', 'users.invite'), async (req, res, next) => {
  try {
    const body = z.object({
      full_name: z.string().trim().min(2), email: z.string().email(),
      phone: z.string().trim().max(32).optional(), role: z.string().trim().min(2),
    }).parse(req.body);
    const supabase = requireDb();
    const { data: role } = await supabase.from('school_roles').select('name').eq('school_id', req.auth.schoolId).eq('name', body.role).maybeSingle();
    if (!role) throw new ApiError(400, `Role not available in your school: ${body.role}`);

    const { data: link, error } = await supabase.auth.admin.generateLink({
      type: 'invite', email: body.email,
      options: {
        data: { full_name: body.full_name, school_id: req.auth.schoolId, role: body.role },
        redirectTo: `${env.frontendUrl}/auth/accept-invite`,
      },
    });
    let authUserId = link?.user?.id || null;
    let invitationLink = link?.properties?.action_link || null;
    let temporary = null;
    if (error) {
      if (!error.message.includes('already')) throw new ApiError(500, error.message);
      // The address may belong to the shell of an account a wipe removed: the membership is gone but
      // Supabase Auth still holds it, and it will not issue a second invitation to the same address.
      // Reclaim the identity and hand it a password, the way a staff reset does.
      temporary = temporaryPassword();
      const reclaim = await reclaimIdentity({
        email: body.email,
        password: temporary,
        metadata: { full_name: body.full_name, school_id: req.auth.schoolId, role: body.role },
        mustChangePassword: true,
      });
      if (reclaim.status === 'failed') throw new ApiError(500, reclaim.error);
      if (reclaim.status !== 'reclaimed') throw new ApiError(409, 'An account with this email already exists');
      authUserId = reclaim.user.id;
    }
    const { data: su, error: e2 } = await supabase.from('school_users').insert({
      school_id: req.auth.schoolId, auth_user_id: authUserId,
      full_name: body.full_name, email: body.email, phone: body.phone,
      status: temporary ? 'active' : 'pending_verification',
      email_verified: Boolean(temporary),
    }).select().single();
    if (e2) throw new ApiError(500, e2.message);
    await assignRole(req.auth.schoolId, su.id, body.role);
    await supabase.from('school_invitations').insert({
      school_id: req.auth.schoolId, email: body.email, full_name: body.full_name,
      role_name: body.role, invited_by: req.auth.userId, last_sent_at: new Date().toISOString(), send_count: 1,
    });
    if (temporary) {
      try {
        await setIssuedCredential(authUserId, { schoolId: req.auth.schoolId, membershipId: su.id, password: temporary });
      } catch (credentialError) { req.log?.warn({ err: credentialError }, 'issued credential could not be sealed'); }
    }
    await sendMail({
      to: body.email, template: 'staff_invitation',
      variables: {
        user_name: body.full_name, school_name: req.auth.school.school_name, role: body.role,
        invitation_link: invitationLink || `${env.frontendUrl}/login`,
        expires_at: new Date(Date.now() + 7 * 86400000).toDateString(),
      },
    });
    await audit(req, {
      module: 'users', action: 'invited', recordId: su.id,
      summary: temporary ? `${body.email} as ${body.role} (leftover sign-in identity reclaimed)` : `${body.email} as ${body.role}`,
    });
    res.status(201).json({
      data: {
        user: su,
        ...(temporary ? { temporaryPassword: temporary } : {}),
        activationLink: env.nodeEnv === 'development' ? invitationLink : undefined,
      },
    });
  } catch (e) { next(e); }
});

/** Distinct staff members (any non-portal role) — mirrors what max_staff limits. */
async function staffSeatUsage(req) {
  const supabase = requireDb();
  const { data: roles } = await supabase.from('school_roles').select('id, name').eq('school_id', req.auth.schoolId);
  const staffRoleIds = (roles || []).filter((r) => !PERSONAL_ROLE_NAMES.includes(r.name)).map((r) => r.id);
  const { data: links } = await supabase.from('school_user_roles').select('user_id')
    .eq('school_id', req.auth.schoolId)
    .in('role_id', staffRoleIds.length ? staffRoleIds : ['00000000-0000-0000-0000-000000000000']);
  return new Set((links || []).map((l) => l.user_id)).size;
}

async function assertStaffSeat(req) {
  const max = Number(req.auth.subscription?.plan?.max_staff || 0);
  if (!max) return;
  const used = await staffSeatUsage(req);
  if (used >= max) {
    throw new ApiError(402, `Your plan includes ${max} staff accounts and ${used} are in use. Upgrade the subscription to add more staff.`);
  }
}

// Direct account creation: the administrator sets the first password, so the new staff member can
// sign in immediately even when SMTP delivery is unavailable. The password only reaches Supabase Auth.
schoolRouter.post('/users', requirePermission('users.create'), async (req, res, next) => {
  try {
    const body = z.object({
      full_name: z.string().trim().min(2),
      email: z.string().email(),
      password: z.string().min(8).max(72),
      phone: z.string().trim().max(32).optional(),
      role: z.string().trim().min(2),
      job_title: z.string().trim().max(120).optional(),
      department_id: z.string().uuid().optional(),
    }).parse(req.body);
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;

    const { data: role } = await supabase.from('school_roles').select('name')
      .eq('school_id', schoolId).eq('name', body.role).maybeSingle();
    if (!role) throw new ApiError(400, `Role not available in your school: ${body.role}`);
    if (body.department_id) {
      const { data: dept } = await supabase.from('staff_departments').select('id')
        .eq('id', body.department_id).eq('school_id', schoolId).maybeSingle();
      if (!dept) throw new ApiError(400, 'That department does not belong to this school');
    }
    if (!PERSONAL_ROLE_NAMES.includes(body.role)) await assertStaffSeat(req);

    const { data: existing } = await supabase.from('school_users').select('id')
      .eq('school_id', schoolId).eq('email', body.email).maybeSingle();
    if (existing) throw new ApiError(409, 'A staff account with this email already exists in this school.');

    const { data: created, error: authError } = await supabase.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: body.full_name, school_id: schoolId, role: body.role },
    });
    let authUserId = created?.user?.id || null;
    let reclaimed = false;
    if (authError) {
      const duplicate = authError.code === 'email_exists' || /already|duplicate/i.test(authError.message);
      if (!duplicate) throw new ApiError(500, authError.message);
      // A wipe deletes memberships but never the GoTrue identities behind them, so this address may be
      // held by an account no school row points at. Reclaim it rather than refuse the email forever.
      const reclaim = await reclaimIdentity({
        email: body.email,
        password: body.password,
        metadata: { full_name: body.full_name, school_id: schoolId, role: body.role },
      });
      if (reclaim.status === 'failed') throw new ApiError(500, reclaim.error);
      if (reclaim.status !== 'reclaimed') {
        throw new ApiError(409, 'An account with this email already exists. Use "Send invitation" for that person, or choose another email.');
      }
      authUserId = reclaim.user.id;
      reclaimed = true;
    }

    const { data: su, error: insertError } = await supabase.from('school_users').insert({
      school_id: schoolId, auth_user_id: authUserId,
      full_name: body.full_name, email: body.email, phone: body.phone,
      status: 'active', email_verified: true,
    }).select().single();
    if (insertError) {
      // Roll back the auth identity so a failed insert cannot leave an orphan login behind — but never a
      // reclaimed one: it was already stranded here, and deleting it would burn the address a second time.
      if (!reclaimed) await supabase.auth.admin.deleteUser(authUserId);
      throw new ApiError(500, insertError.message);
    }

    await assignRole(schoolId, su.id, body.role);
    if (body.job_title || body.department_id) {
      await supabase.from('staff_profiles').insert({
        school_id: schoolId, school_user_id: su.id,
        job_title: body.job_title || null, department_id: body.department_id || null,
      });
    }
    // Keep the admin-set first password retrievable by an administrator; the owner's own change clears it.
    try {
      await setIssuedCredential(authUserId, { schoolId, membershipId: su.id, password: body.password });
    } catch (error) { req.log?.warn({ err: error }, 'issued credential could not be sealed'); }
    // The staff member never chose this password and has no other way to learn it, so the first sign-in
    // details go to their email. A failure here must not undo the account the school just created.
    const confirmationEmail = await sendAccountConfirmation({
      template: 'staff_account_confirmation',
      to: body.email,
      name: body.full_name,
      schoolName: req.auth.school.school_name,
      role: body.role,
      loginEmail: body.email,
      password: body.password,
      membershipId: su.id,
      schoolId,
    });
    await audit(req, {
      module: 'users', action: 'created', recordId: su.id,
      summary: `${body.email} as ${body.role} (password set by admin, confirmation email ${confirmationEmail.status})`,
    });
    // The inbox entry is what the new colleague finds on their very first sign-in.
    alertUsers(req, [su.id], {
      category: 'account',
      title: `Welcome to ${req.auth.school.school_name}`,
      body: `Your ${body.role} account is ready. Sign in and change your password when prompted.`,
      link: '/account',
    });
    res.status(201).json({ data: { user: su, confirmationEmail } });
  } catch (e) { next(e); }
});

// Passwords are one-way hashes in Supabase Auth; nobody — including the school administrator — can
// read an existing one. This endpoint replaces it (admin-supplied or generated) and returns a
// generated password exactly once so the admin can hand it to the staff member.
schoolRouter.post('/users/:id/reset-password', requirePermission('users.edit'), async (req, res, next) => {
  try {
    const body = z.object({
      password: z.string().min(8).max(72).optional(),
      generate: z.boolean().optional(),
    }).refine((v) => Boolean(v.password) !== Boolean(v.generate), {
      message: 'Provide a new password or ask the server to generate one, not both',
    }).parse(req.body);
    const password = body.generate ? temporaryPassword() : body.password;
    const supabase = requireDb();
    const { data: su } = await supabase.from('school_users')
      .select('id, auth_user_id, email, status').eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!su) throw new ApiError(404, 'User not found in this school');
    if (!su.auth_user_id) throw new ApiError(409, 'This account has no sign-in identity yet — send an invitation instead.');
    const { error } = await supabase.auth.admin.updateUserById(su.auth_user_id, {
      password, email_confirm: true, app_metadata: { must_change_password: true },
    });
    if (error) throw new ApiError(500, error.message);
    if (su.status === 'pending_verification') {
      await supabase.from('school_users').update({ status: 'active', email_verified: true }).eq('id', su.id);
    }
    try {
      await setIssuedCredential(su.auth_user_id, { schoolId: req.auth.schoolId, membershipId: su.id, password });
    } catch (error) { req.log?.warn({ err: error }, 'reset password could not be sealed'); }
    await audit(req, {
      module: 'users', action: 'password_reset', recordId: su.id,
      summary: body.generate ? `${su.email} (temporary password generated)` : su.email,
    });
    alertUsers(req, [su.id], {
      category: 'account',
      title: 'Your password was reset',
      body: `${req.auth.fullName || 'A school administrator'} reset your sign-in password. `
        + 'The new password was given to you directly; change it at your next sign-in.',
      link: '/account',
    });
    res.json({ data: { ok: true, ...(body.generate ? { temporaryPassword: password } : {}) } });
  } catch (e) { next(e); }
});

// Administrators can retrieve passwords the system issued (student IDs, admin-set and temporary
// resets). A password the owner set themselves is intentionally unrecoverable.
schoolRouter.get('/users/:id/credential', requirePermission('users.edit'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: su } = await supabase.from('school_users')
      .select('id, auth_user_id, full_name, email, status')
      .eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!su) throw new ApiError(404, 'User not found in this school');
    if (!su.auth_user_id) throw new ApiError(409, 'This account has not accepted its invitation yet, so it has no password here.');

    const issued = await getIssuedCredential(su.auth_user_id, {
      schoolId: req.auth.schoolId, membershipId: su.id,
    });
    if (issued?.password) {
      await audit(req, { module: 'users', action: 'credential_viewed', recordId: su.id, summary: `${su.email} (issued password revealed)` });
      res.set('Cache-Control', 'no-store');
      return res.json({ data: { password: issued.password, issued_at: issued.issuedAt, source: 'issued' } });
    }

    // Student logins use the admission number as their first password; that is only current while
    // the account still has must_change_password set.
    const { data: student } = await supabase.from('students').select('admission_number')
      .eq('school_id', req.auth.schoolId).eq('user_id', su.id).maybeSingle();
    if (student?.admission_number) {
      const flags = await credentialFlags(su.auth_user_id);
      if (flags.mustChangePassword) {
        await audit(req, { module: 'users', action: 'credential_viewed', recordId: su.id, summary: `${su.email} (student ID password revealed)` });
        res.set('Cache-Control', 'no-store');
        return res.json({ data: { password: student.admission_number, source: 'student-id' } });
      }
    }

    throw new ApiError(404, 'This person set their own password, so it cannot be recovered. Reset it to issue a new one.');
  } catch (e) { next(e); }
});

schoolRouter.patch('/users/:id', requirePermission('users.edit'), async (req, res, next) => {
  try {
    const payload = z.object({
      full_name: z.string().trim().min(2).optional(), phone: z.string().trim().optional(),
      avatar_url: z.string().url().optional(), role: z.string().trim().optional(),
    }).parse(req.body);
    const supabase = requireDb();
    const { role, ...rest } = payload;
    if (Object.keys(rest).length) {
      const { data, error } = await supabase.from('school_users').update(rest)
        .eq('id', req.params.id).eq('school_id', req.auth.schoolId).select().maybeSingle();
      if (error) throw new ApiError(500, error.message);
      if (!data) throw new ApiError(404, 'User not found in this school');
    }
    if (role) await assignRole(req.auth.schoolId, req.params.id, role);
    await audit(req, { module: 'users', action: 'updated', recordId: req.params.id, metadata: payload.role ? { role } : {} });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

schoolRouter.patch('/users/:id/status', requirePermission('users.edit', 'users.delete'), async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(['active', 'inactive', 'pending_verification']) }).parse(req.body);
    const { data, error } = await requireDb().from('school_users').update({ status })
      .eq('id', req.params.id).eq('school_id', req.auth.schoolId).select().maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, 'User not found in this school');
    // Deactivation keeps historical records; sessions are re-checked on every request.
    await audit(req, { module: 'users', action: 'status_changed', recordId: data.id, summary: status });
    res.json({ data });
  } catch (e) { next(e); }
});

schoolRouter.post('/users/:id/resend-invitation', requirePermission('users.invite'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: su } = await supabase.from('school_users').select('*')
      .eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!su) throw new ApiError(404, 'User not found');
    // Rate-limit: at most 3 sends per hour
    const { data: recent } = await supabase.from('school_invitations')
      .select('last_sent_at, send_count').eq('school_id', req.auth.schoolId).eq('email', su.email)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (recent?.last_sent_at && Date.now() - new Date(recent.last_sent_at).getTime() < 60 * 60 * 1000 && (recent.send_count || 0) >= 3) {
      throw new ApiError(429, 'Invitation resend limit reached for this hour');
    }
    const { data: link, error } = await supabase.auth.admin.generateLink({ type: 'invite', email: su.email });
    if (error) throw new ApiError(500, error.message);
    if (recent) {
      await supabase.from('school_invitations').update({
        last_sent_at: new Date().toISOString(), send_count: (recent.send_count || 0) + 1,
      }).eq('id', recent.id);
    } else {
      await supabase.from('school_invitations').insert({
        school_id: req.auth.schoolId, email: su.email, full_name: su.full_name, role_name: 'staff',
        invited_by: req.auth.userId, last_sent_at: new Date().toISOString(), send_count: 1,
      });
    }
    await sendMail({
      to: su.email, template: 'staff_invitation',
      variables: { user_name: su.full_name, school_name: req.auth.school.school_name, role: 'staff member',
        invitation_link: link.properties?.action_link, expires_at: new Date(Date.now() + 7 * 86400000).toDateString() },
    });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// ── Backups & danger zone ───────────────────────────────────────
schoolRouter.get('/backups', requirePermission('school.edit'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    res.json(await listBackups(req.auth.schoolId, { page, pageSize, kind: req.query.kind || undefined }));
  } catch (e) { next(e); }
});

schoolRouter.post('/backups', requirePermission('school.edit'), async (req, res, next) => {
  try {
    const result = await createBackup(req.auth.schoolId, {
      kind: 'manual', actor: { userId: req.auth.userId, scope: 'school' },
    });
    await audit(req, {
      module: 'backup', action: 'created', recordId: result.backup?.id,
      summary: `Manual backup created · ${result.totalRows} rows`,
    });
    res.status(201).json({ data: { ...result, school_name: req.auth.school?.school_name } });
  } catch (e) { next(e); }
});

schoolRouter.get('/backups/:id/download', requirePermission('school.edit'), async (req, res, next) => {
  try {
    const found = await getBackupPayload(req.auth.schoolId, req.params.id);
    if (!found?.payload) throw new ApiError(404, 'Backup not found or its payload was pruned');
    const stamp = String(found.meta.created_at || '').slice(0, 10) || 'backup';
    const safeName = String(req.auth.school?.school_name || 'school').replace(/[^A-Za-z0-9._-]+/g, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-${stamp}.json"`);
    res.send(JSON.stringify(found.payload, null, 2));
  } catch (e) { next(e); }
});

schoolRouter.post('/data/clear', requirePermission('school.edit'), async (req, res, next) => {
  try {
    const { confirm } = z.object({ confirm: z.string().trim().min(1) }).parse(req.body);
    const expected = req.auth.school?.school_name;
    if (confirm !== expected) {
      throw new ApiError(400, `Type the school name exactly ("${expected}") to confirm.`);
    }
    const result = await clearSchoolData(req.auth.schoolId, {
      actor: { userId: req.auth.userId, scope: 'school' },
    });
    await audit(req, {
      module: 'school', action: 'purged', recordId: req.auth.schoolId,
      summary: `All school data cleared (${result.tables} tables, ${result.rows} rows snapshotted)`,
      metadata: { snapshotId: result.snapshotId, rows: result.rows },
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ── Role-aware dashboard ────────────────────────────────────────
schoolRouter.get('/dashboard', requirePermission('school.view', 'students.view', 'attendance.view',
  'finance.view', 'examinations.view', 'results.view', 'announcements.view', 'learning.view'), async (req, res, next) => {
  try {
    const role = derivePrimaryRole(req.auth);
    const data = await buildDashboard(req, role);
    res.json({ data: { role, ...data } });
  } catch (e) { next(e); }
});

// ── The signed-in student's own weekly timetable ────────────────
schoolRouter.get('/me/timetable', async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: student, error } = await supabase.from('students')
      .select('id, class_id, section_id, classes(name), sections(name)')
      .eq('school_id', req.auth.schoolId).eq('user_id', req.auth.userId).maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!student) { res.json({ data: { student: null, entries: [] } }); return; }
    const { data, error: entryError } = await supabase.from('timetable_entries')
      .select('id, day_of_week, subjects(name), timetable_periods(name, start_time, end_time, sort_order), school_users!timetable_entries_teacher_id_fkey(full_name), classrooms(name)')
      .eq('school_id', req.auth.schoolId)
      .eq('class_id', student.class_id || '00000000-0000-0000-0000-000000000000');
    if (entryError) throw new ApiError(500, entryError.message);
    const order = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const entries = (data || []).sort((a, b) => {
      const byDay = order.indexOf(a.day_of_week) - order.indexOf(b.day_of_week);
      if (byDay) return byDay;
      return String(a.timetable_periods?.start_time || '').localeCompare(String(b.timetable_periods?.start_time || ''));
    });
    res.json({ data: { student, entries } });
  } catch (e) { next(e); }
});

// Timetable rows store the full English day name; keep the dashboard in step with the picker.
const todayName = () => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];

async function buildDashboard(req, role) {  const supabase = requireDb();
  const schoolId = req.auth.schoolId;
  const count = async (t, fns = []) => {
    let q = supabase.from(t).select('*', { count: 'exact', head: true }).eq('school_id', schoolId);
    for (const fn of fns) q = fn(q);
    const { count } = await q;
    return count || 0;
  };

  const base = {
    school: req.auth.school,
    subscription: req.auth.subscription ? {
      plan: req.auth.subscription.plan?.name, status: req.auth.subscription.status, end_date: req.auth.subscription.end_date,
    } : null,
  };

  const studentCounts = async () => ({
    students: await count('students', [(q) => q.eq('status', 'active')]),
    teachers: await supabase.from('school_user_roles').select('user_id', { count: 'exact', head: true })
      .eq('school_id', schoolId).in('role_id', await roleIds(schoolId, ['teacher'])).then(({ count }) => count || 0),
    classes: await count('classes'),
    subjects: await count('subjects'),
  });

  async function roleIds(sid, names) {
    const { data } = await supabase.from('school_roles').select('id').eq('school_id', sid).in('name', names);
    return (data || []).map((r) => r.id);
  }

  const today = new Date().toISOString().slice(0, 10);
  const attendanceToday = async () => {
    const { data } = await supabase.from('attendance_records')
      .select('attendance_status').eq('school_id', schoolId).eq('attendance_date', today);
    const tally = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const r of data || []) tally[r.attendance_status] = (tally[r.attendance_status] || 0) + 1;
    const total = data?.length || 0;
    return { ...tally, total, rate: total ? Math.round(((tally.present + tally.late) / total) * 100) : null };
  };

  switch (role) {
    case 'school_admin': {
      const monthStart = `${today.slice(0, 7)}-01`;
      const [counts, staff, att, outstanding, recentPays, withoutClass, monthPays, upcomingExams, announcements] = await Promise.all([
        studentCounts(),
        count('school_users', [(q) => q.eq('status', 'active')]),
        attendanceToday(),
        supabase.from('student_fee_assignments').select('amount, discount, paid_amount').eq('school_id', schoolId).neq('status', 'paid'),
        supabase.from('fee_payments').select('id, amount, currency, paid_at, transaction_reference, students (full_name)').eq('school_id', schoolId).order('paid_at', { ascending: false }).limit(8),
        count('students', [(q) => q.eq('status', 'active').is('class_id', null)]),
        supabase.from('fee_payments').select('amount').eq('school_id', schoolId).eq('status', 'successful').gte('paid_at', monthStart).limit(20000),
        supabase.from('examinations').select('*').eq('school_id', schoolId).in('status', ['scheduled', 'in_progress']).order('created_at').limit(5),
        supabase.from('announcements').select('*').eq('school_id', schoolId).eq('status', 'published').order('created_at', { ascending: false }).limit(5),
      ]);
      const sum = (rows) => (rows || []).reduce((s, r) => s + Number(r.amount), 0);
      const outstandingTotal = (outstanding.data || []).reduce((s, r) => s + Number(r.amount) - Number(r.discount) - Number(r.paid_amount), 0);
      return {
        ...base, ...counts, staff, attendanceToday: att,
        outstandingFees: Math.max(0, outstandingTotal),
        monthCollections: sum(monthPays.data),
        studentsWithoutClass: withoutClass,
        recentPayments: recentPays.data || [],
        upcomingExaminations: upcomingExams.data || [],
        announcements: announcements.data || [],
        usage: { students: counts.students, staff, subscription: req.auth.subscription },
      };
    }
    case 'principal':
    case 'vice_principal': {
      const [counts, att, pendingApprovals, exams] = await Promise.all([
        studentCounts(), attendanceToday(),
        supabase.from('result_approvals').select('*').eq('school_id', schoolId).eq('status', 'pending').limit(10),
        supabase.from('examinations').select('*').eq('school_id', schoolId).in('status', ['scheduled', 'in_progress']).limit(5),
      ]);
      return { ...base, ...counts, attendanceToday: att, pendingResultApprovals: pendingApprovals.data || [], upcomingExaminations: exams.data || [] };
    }
    case 'registrar': {
      const [total, recent, byClass] = await Promise.all([
        count('students'),
        supabase.from('students').select('id, first_name, last_name, admission_number, status, created_at, class_id').eq('school_id', schoolId).order('created_at', { ascending: false }).limit(8),
        supabase.from('students').select('class_id, classes(name)').eq('school_id', schoolId).eq('status', 'active'),
      ]);
      const classDist = {};
      for (const s of byClass.data || []) {
        const n = s.classes?.name || 'Unassigned';
        classDist[n] = (classDist[n] || 0) + 1;
      }
      return { ...base, totalStudents: total, recentStudents: recent.data || [], studentsByClass: classDist,
        pendingAdmissions: await supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'active').is('class_id', null).then(({ count }) => count || 0) };
    }
    case 'accountant': {
      const { data: assigns } = await supabase.from('student_fee_assignments').select('amount, paid_amount, status').eq('school_id', schoolId);
      const expected = (assigns || []).reduce((s, r) => s + Number(r.amount), 0);
      const collected = (assigns || []).reduce((s, r) => s + Number(r.paid_amount), 0);
      const monthStart = new Date(); monthStart.setDate(1);
      const { data: monthPays } = await supabase.from('fee_payments').select('amount').eq('school_id', schoolId).gte('paid_at', monthStart.toISOString());
      const { data: todayPays } = await supabase.from('fee_payments').select('*, students(first_name, last_name, admission_number)').eq('school_id', schoolId).gte('paid_at', today).order('paid_at', { ascending: false }).limit(10);
      const { data: expenses } = await supabase.from('expenses').select('amount').eq('school_id', schoolId);
      const expenseTotal = (expenses || []).reduce((s, r) => s + Number(r.amount), 0);
      return { ...base,
        totals: { expected, collected, outstanding: expected - collected, expenses: expenseTotal,
          monthCollections: (monthPays || []).reduce((s, r) => s + Number(r.amount), 0) },
        todayCollections: todayPays.data || [],
        pendingExpenseApprovals: await supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'pending_approval').then(({ count }) => count || 0) };
    }
    case 'exam_officer': {
      const { data: exams } = await supabase.from('examinations').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }).limit(10);
      const { data: marksStatus } = await supabase.from('marks').select('approval_status').eq('school_id', schoolId);
      const tally = { draft: 0, submitted: 0, approved: 0, rejected: 0 };
      for (const m of marksStatus || []) tally[m.approval_status] = (tally[m.approval_status] || 0) + 1;
      return { ...base, examinations: exams || [], marksStatus: tally,
        pendingApprovals: await supabase.from('result_approvals').select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'pending').then(({ count }) => count || 0) };
    }
    case 'teacher': {
      const uid = req.auth.userId;
      const { data: assignments } = await supabase.from('teacher_assignments')
        .select('class_id, subject_id, classes(name), subjects(name)').eq('school_user_id', uid).eq('school_id', schoolId);
      const classIds = [...new Set((assignments || []).map((a) => a.class_id).filter(Boolean))];
      const day = todayName();
      const { data: timetable } = await supabase.from('timetable_entries')
        .select('*, classes(name), subjects(name), timetable_periods(name, start_time, end_time), classrooms(name)')
        .eq('school_id', schoolId).eq('teacher_id', uid).eq('day_of_week', day)
        .order('start_time', { foreignTable: 'timetable_periods' });
      const { data: sessionToday } = await supabase.from('attendance_sessions')
        .select('id, class_id, status, classes(name)').eq('school_id', schoolId).eq('session_date', today).in('class_id', classIds.length ? classIds : ['00000000-0000-0000-0000-000000000000']);
      const { data: openAssignments } = await supabase.from('assignments').select('id, title, due_date, class_id, classes(name)')
        .eq('school_id', schoolId).eq('teacher_id', uid).eq('status', 'open').order('due_date').limit(8);
      return { ...base, myClasses: assignments || [], todayTimetable: timetable || [],
        attendanceSessionsToday: sessionToday || [], myAssignments: openAssignments || [] };
    }
    case 'student': {
      const { data: student } = await supabase.from('students').select('*, classes(name), sections(name)')
        .eq('school_id', schoolId).eq('user_id', req.auth.userId).maybeSingle();
      if (!student) return { ...base, student: null };
      const { data: att } = await supabase.from('attendance_records').select('attendance_status').eq('student_id', student.id);
      const tally = { present: 0, absent: 0, late: 0, excused: 0 };
      for (const r of att || []) tally[r.attendance_status] = (tally[r.attendance_status] || 0) + 1;
      const total = att?.length || 0;
      const { data: assignments } = await supabase.from('assignment_submissions').select('*').eq('student_id', student.id);
      const { data: openWork } = await supabase.from('assignments').select('*, classes(name)')
        .eq('school_id', schoolId).eq('class_id', student.class_id || '00000000-0000-0000-0000-000000000000').eq('status', 'open');
      const submitted = new Set((assignments || []).map((a) => a.assignment_id));
      const pending = (openWork || []).filter((a) => !submitted.has(a.id)).slice(0, 5);
      const { data: fees } = await supabase.from('student_fee_assignments').select('amount, paid_amount, status').eq('student_id', student.id).neq('status', 'paid');
      const feeBalance = (fees || []).reduce((s, r) => s + Number(r.amount) - Number(r.paid_amount), 0);
      const day = todayName();
      const { data: timetable } = await supabase.from('timetable_entries')
        .select('*, subjects(name), timetable_periods(name, start_time, end_time), school_users!timetable_entries_teacher_id_fkey(full_name), classrooms(name)')
        .eq('school_id', schoolId).eq('class_id', student.class_id || '00000000-0000-0000-0000-000000000000').eq('day_of_week', day);
      return { ...base, student, attendance: { ...tally, total, rate: total ? Math.round(((tally.present + tally.late) / total) * 100) : null },
        pendingAssignments: pending, todayTimetable: timetable || [], feeBalance };
    }
    case 'parent': {
      const { data: guardians } = await supabase.from('guardians').select('id').eq('school_id', schoolId).eq('user_id', req.auth.userId);
      const gids = (guardians || []).map((g) => g.id);
      const { data: links } = await supabase.from('student_guardians').select('student_id').eq('school_id', schoolId).in('guardian_id', gids.length ? gids : ['00000000-0000-0000-0000-000000000000']);
      const sids = [...new Set(links.map((l) => l.student_id))];
      const { data: children } = sids.length
        ? await supabase.from('students').select('*, classes(name), sections(name)').in('id', sids)
        : { data: [] };
      return { ...base, children: children || [] };
    }
    default: {
      // staff-type roles: announcements + minimal context
      const { data: announcements } = await supabase.from('announcements').select('*').eq('school_id', schoolId).eq('status', 'published').order('created_at', { ascending: false }).limit(5);
      return { ...base, announcements: announcements || [] };
    }
  }
}
