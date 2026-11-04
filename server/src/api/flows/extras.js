import { Router } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { requireDb } from '../../config/supabase.js';
import { ApiError } from '../../middleware/error.js';
import { requirePermission, requirePlatform } from '../../middleware/rbac.js';
import { audit } from '../../services/audit.js';
import { visibleStudentIds } from '../../services/scopes.js';

/**
 * Remaining school-facing flows: notifications, support tickets, certificates,
 * ID cards, CSV reports and PDF documents.
 */

// ---------- Notifications ----------
export const notificationsRouter = Router();

async function unreadCount(supabase, req) {
  const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true })
    .eq('recipient_user_id', req.auth.userId).eq('recipient_scope', req.auth.type === 'platform' ? 'platform' : 'school')
    .eq('is_read', false);
  return count || 0;
}

notificationsRouter.get('/', async (req, res, next) => {
  try {
    const supabase = requireDb();
    let q = supabase.from('notifications').select('*')
      .eq('recipient_user_id', req.auth.userId)
      .eq('recipient_scope', req.auth.type === 'platform' ? 'platform' : 'school');
    if (req.query.unread === 'true') q = q.eq('is_read', false);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(100);
    if (error) throw new ApiError(500, error.message);
    res.json({ data: data || [], unread: await unreadCount(supabase, req) });
  } catch (e) { next(e); }
});

notificationsRouter.post('/read-all', async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { error } = await supabase.from('notifications').update({ is_read: true })
      .eq('recipient_user_id', req.auth.userId).eq('is_read', false);
    if (error) throw new ApiError(500, error.message);
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

notificationsRouter.post('/:id/read', async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data, error } = await supabase.from('notifications').update({ is_read: true })
      .eq('id', req.params.id).eq('recipient_user_id', req.auth.userId).select().maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, 'Notification not found');
    res.json({ data });
  } catch (e) { next(e); }
});

// ---------- Support tickets ----------
export const supportRouter = Router();

supportRouter.get('/tickets', requirePermission('support.view'), async (req, res, next) => {
  try {
    const { data, error } = await requireDb().from('support_tickets')
      .select('*, support_replies (id, created_at)')
      .eq('school_id', req.auth.schoolId).order('updated_at', { ascending: false }).limit(200);
    if (error) throw new ApiError(500, error.message);
    res.json({ data: data || [], total: (data || []).length });
  } catch (e) { next(e); }
});

supportRouter.post('/tickets', requirePermission('support.create'), async (req, res, next) => {
  try {
    const body = z.object({
      category: z.enum(['technical', 'account', 'subscription', 'billing', 'other']).default('technical'),
      subject: z.string().trim().min(3).max(200),
      body: z.string().trim().max(4000).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
    }).parse(req.body);
    const { data, error } = await requireDb().from('support_tickets').insert({
      school_id: req.auth.schoolId, created_by_school_user: req.auth.userId, ...body,
    }).select().single();
    if (error) throw new ApiError(500, error.message);
    await audit(req, { module: 'support', action: 'created', recordId: data.id, summary: body.subject });
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

supportRouter.get('/tickets/:id', requirePermission('support.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: ticket } = await supabase.from('support_tickets').select('*')
      .eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!ticket) throw new ApiError(404, 'Ticket not found');
    // Internal notes are visible to administrators only
    let q = supabase.from('support_replies').select('*').eq('ticket_id', ticket.id);
    if (!req.auth.permissions.has('support.manage')) q = q.eq('is_internal_note', false);
    const { data: replies } = await q.order('created_at', { ascending: true });
    res.json({ data: { ...ticket, replies: replies || [] } });
  } catch (e) { next(e); }
});

supportRouter.post('/tickets/:id/replies', requirePermission('support.create'), async (req, res, next) => {
  try {
    const { reply_body } = z.object({ reply_body: z.string().trim().min(1).max(4000) }).parse(req.body);
    const supabase = requireDb();
    const { data: ticket } = await supabase.from('support_tickets').select('id, status')
      .eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!ticket) throw new ApiError(404, 'Ticket not found');
    const { data, error } = await supabase.from('support_replies').insert({
      ticket_id: ticket.id, reply_body, author_school_user: req.auth.userId,
    }).select().single();
    if (error) throw new ApiError(500, error.message);
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      await supabase.from('support_tickets').update({ status: 'open' }).eq('id', ticket.id);
    }
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

// Platform-side ticket handling (also used by the Super Admin dashboard)
export const platformSupportRouter = Router();

platformSupportRouter.get('/tickets', requirePlatform(), async (req, res, next) => {
  try {
    const supabase = requireDb();
    let q = supabase.from('support_tickets').select('*, schools (id, school_name)');
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.priority) q = q.eq('priority', req.query.priority);
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(300);
    if (error) throw new ApiError(500, error.message);
    res.json({ data: data || [], total: (data || []).length });
  } catch (e) { next(e); }
});

platformSupportRouter.post('/tickets/:id/replies', requirePlatform(), async (req, res, next) => {
  try {
    const body = z.object({
      reply_body: z.string().trim().min(1).max(4000),
      is_internal_note: z.coerce.boolean().default(false),
      status: z.enum(['open', 'in_progress', 'waiting_for_school', 'resolved', 'closed']).optional(),
    }).parse(req.body);
    const supabase = requireDb();
    const { data: reply, error } = await supabase.from('support_replies').insert({
      ticket_id: req.params.id, reply_body: body.reply_body,
      is_internal_note: body.is_internal_note, author_platform_user: req.auth.userId,
    }).select().single();
    if (error) throw new ApiError(500, error.message);
    if (body.status) {
      await supabase.from('support_tickets').update({ status: body.status, assigned_to: req.auth.userId })
        .eq('id', req.params.id);
    }
    await audit(req, { module: 'support', action: 'replied', recordId: req.params.id });
    res.status(201).json({ data: reply });
  } catch (e) { next(e); }
});

platformSupportRouter.patch('/tickets/:id', requirePlatform(), async (req, res, next) => {
  try {
    const body = z.object({
      status: z.enum(['open', 'in_progress', 'waiting_for_school', 'resolved', 'closed']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      assigned_to: z.string().uuid().nullable().optional(),
    }).parse(req.body);
    const { data, error } = await requireDb().from('support_tickets').update(body).eq('id', req.params.id).select().maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, 'Ticket not found');
    res.json({ data });
  } catch (e) { next(e); }
});

// ---------- Certificates & ID cards ----------
export const certificateRouter = Router();

const certPrefix = () => `CERT-${new Date().getFullYear()}-`;

certificateRouter.post('/issue', requirePermission('certificates.create'), async (req, res, next) => {
  try {
    const body = z.object({
      student_id: z.string().uuid(),
      certificate_type: z.enum(['graduation', 'completion', 'enrollment', 'transfer']),
      template_id: z.string().uuid().nullable().optional(),
      signature_name: z.string().trim().max(120).optional(),
      issued_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.body);

    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { data: student } = await supabase.from('students').select('id, full_name, admission_number, class_id')
      .eq('id', body.student_id).eq('school_id', schoolId).maybeSingle();
    if (!student) throw new ApiError(404, 'Student not found in your school');

    const prefix = certPrefix();
    const { data: last } = await supabase.from('certificates').select('reference_number')
      .like('reference_number', `${prefix}%`).order('reference_number', { ascending: false }).limit(1).maybeSingle();
    const reference_number = `${prefix}${String((Number(String(last?.reference_number || '').slice(prefix.length)) || 0) + 1).padStart(4, '0')}`;

    const { data, error } = await supabase.from('certificates').insert({
      school_id: schoolId, student_id: student.id, certificate_type: body.certificate_type,
      template_id: body.template_id || null, reference_number,
      signature_name: body.signature_name, issued_date: body.issued_date || new Date().toISOString().slice(0, 10),
      issued_by: req.auth.userId,
    }).select().single();
    if (error) throw new ApiError(500, error.message);
    await audit(req, { module: 'certificates', action: 'issued', recordId: data.id, summary: `${student.full_name} · ${reference_number}` });
    res.status(201).json({ data: { ...data, student } });
  } catch (e) { next(e); }
});

certificateRouter.get('/', requirePermission('certificates.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    let q = supabase.from('certificates').select('*, students (id, full_name, admission_number)')
      .eq('school_id', req.auth.schoolId);
    if (req.query.student_id) q = q.eq('student_id', req.query.student_id);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
    if (error) throw new ApiError(500, error.message);
    res.json({ data: data || [], total: (data || []).length });
  } catch (e) { next(e); }
});

export const idCardRouter = Router();

idCardRouter.post('/generate', requirePermission('students.manage'), async (req, res, next) => {
  try {
    const { student_id } = z.object({ student_id: z.string().uuid() }).parse(req.body);
    const supabase = requireDb();
    const { data: student } = await supabase.from('students')
      .select('id, full_name, admission_number, academic_year_id, academic_years (name)')
      .eq('id', student_id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!student) throw new ApiError(404, 'Student not found');
    // The student ID is the admission number (school prefix + academic year + sequence).
    // Codes are globally unique, so a cross-school collision (same initials) gets a school suffix.
    let code = student.admission_number;
    const { data: clash } = await supabase.from('student_id_cards')
      .select('student_id').eq('verification_code', code).maybeSingle();
    if (clash && clash.student_id !== student.id) {
      code = `${student.admission_number}-${String(req.auth.schoolId).slice(0, 4).toUpperCase()}`;
      const { data: clash2 } = await supabase.from('student_id_cards')
        .select('student_id').eq('verification_code', code).maybeSingle();
      if (clash2 && clash2.student_id !== student.id) code = `${code}-${Date.now().toString(36).toUpperCase()}`;
    }
    const { data, error } = await supabase.from('student_id_cards').upsert({
      school_id: req.auth.schoolId, student_id, verification_code: code,
      academic_year: student.academic_years?.name || String(new Date().getFullYear()),
    }, { onConflict: 'school_id,student_id' }).select().single();
    if (error) throw new ApiError(500, error.message);
    res.status(201).json({ data: { ...data, student } });
  } catch (e) { next(e); }
});

// ---------- Public verification (no auth) ----------
export const publicVerifyRouter = Router();

publicVerifyRouter.get('/certificate/:reference', async (req, res, next) => {
  try {
    const { data } = await requireDb().from('certificates').select('reference_number, certificate_type, issued_date, status, schools (school_name), students (full_name)')
      .eq('reference_number', req.params.reference).maybeSingle();
    res.json({ data: { valid: Boolean(data), record: data || null } });
  } catch (e) { next(e); }
});

publicVerifyRouter.get('/student-id/:code', async (req, res, next) => {
  try {
    const { data } = await requireDb().from('student_id_cards').select('verification_code, academic_year, schools (school_name), students (full_name, admission_number)')
      .eq('verification_code', req.params.code).maybeSingle();
    res.json({ data: { valid: Boolean(data), record: data || null } });
  } catch (e) { next(e); }
});

// ---------- CSV reports ----------
export const reportRouter = Router();

const REPORTS = {
  students: { table: 'students', perm: 'students.export', columns: ['full_name', 'admission_number', 'gender', 'status', 'created_at'] },
  staff: { table: 'school_users', perm: 'reports.export', columns: ['full_name', 'email', 'phone', 'status', 'created_at'] },
  payments: { table: 'fee_payments', perm: 'finance.export', columns: ['transaction_reference', 'student_id', 'amount', 'payment_method', 'status', 'paid_at'] },
  expenses: { table: 'expenses', perm: 'finance.export', columns: ['title', 'amount', 'expense_date', 'status'] },
  'attendance-summary': { table: 'attendance_records', perm: 'attendance.export', columns: ['student_id', 'class_id', 'attendance_date', 'attendance_status'] },
  discipline: { table: 'discipline_records', perm: 'discipline.export', columns: ['student_id', 'incident_date', 'incident_type', 'action_taken', 'status'] },
};

reportRouter.get('/:type', async (req, res, next) => {
  try {
    const def = REPORTS[req.params.type];
    if (!def) throw new ApiError(404, `Unknown report: ${req.params.type}`);
    if (!req.auth.permissions.has(def.perm)) throw new ApiError(403, 'You do not have export permission for this report');
    const supabase = requireDb();
    let q = supabase.from(def.table).select(def.columns.join(',')).eq('school_id', req.auth.schoolId);
    if (req.query.from) q = q.gte('created_at', req.query.from);
    if (req.query.to) q = q.lte('created_at', req.query.to);
    const { data, error } = await q.limit(50000);
    if (error) throw new ApiError(500, error.message);
    const rows = data || [];

    // Prefix formulas so spreadsheet apps treat exported values as text, not executable cells.
    const esc = (v) => {
      let text = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [def.columns.join(','), ...rows.map((r) => def.columns.map((c) => esc(r[c])).join(','))].join('\r\n');
    await audit(req, { module: 'reports', action: 'exported', summary: `${req.params.type} (${rows.length} rows)` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

// ---------- PDF documents ----------
export const documentRouter = Router();

function streamPdf(res, title, lines) {
  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${title}.pdf"`);
  doc.pipe(res);
  doc.fontSize(20).text(title, { align: 'center' });
  doc.moveDown();
  doc.fontSize(11);
  for (const [label, value] of lines) {
    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true })
      .font('Helvetica').text(String(value ?? '-'));
    doc.moveDown(0.4);
  }
  doc.end();
}

documentRouter.get('/receipts/:id/pdf', requirePermission('finance.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: receipt } = await supabase.from('receipts')
      .select('*, students (full_name, admission_number), fee_payments (transaction_reference, payment_method, paid_at)')
      .eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!receipt) throw new ApiError(404, 'Receipt not found');
    const visible = await visibleStudentIds(req.auth);
    if (visible !== null && !visible.includes(receipt.student_id)) throw new ApiError(404, 'Receipt not found');
    streamPdf(res, `Receipt ${receipt.receipt_number}`, [
      ['Receipt number', receipt.receipt_number],
      ['Student', receipt.students?.full_name],
      ['Admission number', receipt.students?.admission_number],
      ['Amount', `${receipt.amount} ${receipt.currency}`],
      ['Payment method', receipt.fee_payments?.payment_method],
      ['Transaction reference', receipt.fee_payments?.transaction_reference],
      ['Date', receipt.fee_payments?.paid_at],
    ]);
  } catch (e) { next(e); }
});

documentRouter.get('/certificates/:id/pdf', requirePermission('certificates.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: certificate } = await supabase.from('certificates')
      .select('*, students (full_name, admission_number), schools (school_name)')
      .eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!certificate) throw new ApiError(404, 'Certificate not found');
    streamPdf(res, certificate.schools?.school_name || 'Certificate', [
      ['Certificate type', certificate.certificate_type],
      ['Student', certificate.students?.full_name],
      ['Admission number', certificate.students?.admission_number],
      ['Reference number', certificate.reference_number],
      ['Issued date', certificate.issued_date],
      ['Signed by', certificate.signature_name],
    ]);
  } catch (e) { next(e); }
});
