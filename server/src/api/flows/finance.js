import { Router } from 'express';
import { z } from 'zod';
import { requireDb } from '../../config/supabase.js';
import { ApiError } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { audit } from '../../services/audit.js';
import { visibleStudentIds, isPortalOnly } from '../../services/scopes.js';
import { assertSchoolRefs } from '../../services/tenantRefs.js';

export const financeRouter = Router();

const money = z.coerce.number().min(0);
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Sequential, human-readable document numbers (invoice / receipt / payment reference)
async function nextNumber(supabase, table, column, prefix, scopeFilter) {
  let q = supabase.from(table).select(column).like(column, `${prefix}%`).order(column, { ascending: false }).limit(1);
  if (scopeFilter) q = scopeFilter(q);
  const { data } = await q;
  const last = Number(String(data?.[0]?.[column] || '').slice(prefix.length));
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(5, '0')}`;
}

const year = () => new Date().getFullYear();

// --- Fee assignment: apply a fee structure to a class or an explicit student list ---
financeRouter.post('/assign-fees', requirePermission('finance.create'), async (req, res, next) => {
  try {
    const body = z.object({
      fee_structure_id: z.string().uuid(),
      class_id: z.string().uuid().optional(),
      student_ids: z.array(z.string().uuid()).optional(),
    }).parse(req.body);

    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { data: structure } = await supabase.from('fee_structures').select('*, fee_categories (*)')
      .eq('id', body.fee_structure_id).eq('school_id', schoolId).maybeSingle();
    if (!structure) throw new ApiError(404, 'Fee structure not found');

    let studentIds = body.student_ids || [];
    if (!studentIds.length && body.class_id) {
      const { data } = await supabase.from('students').select('id')
        .eq('school_id', schoolId).eq('class_id', body.class_id).eq('status', 'active');
      studentIds = (data || []).map((s) => s.id);
    }
    if (!studentIds.length) throw new ApiError(400, 'Provide student_ids or a class_id with enrolled students');
    studentIds = [...new Set(studentIds)];
    await assertSchoolRefs(schoolId, { student_ids: studentIds }, { student_ids: 'students' });

    const { error: ie } = await supabase.from('student_fee_assignments').upsert(
      studentIds.map((id) => ({
        school_id: schoolId, student_id: id, fee_structure_id: structure.id,
        amount: structure.amount, discount: 0,
      })), { onConflict: 'student_id,fee_structure_id' });
    if (ie) throw new ApiError(500, ie.message);

    // One invoice per student for the structure's term; reuse the open invoice when present
    const invPrefix = `INV-${year()}-`;
    const createdInvoices = [];
    for (const studentId of studentIds) {
      const { data: existing } = await supabase.from('fee_invoices').select('id')
        .eq('school_id', schoolId).eq('student_id', studentId).eq('status', 'open').maybeSingle();
      const invoiceId = existing?.id || null;
      const total = round(structure.amount);
      if (invoiceId) {
        const { data: inv } = await supabase.from('fee_invoices').select('subtotal,total,balance').eq('id', invoiceId).single();
        const subtotal = round(inv.subtotal) + total;
        await supabase.from('fee_invoices').update({
          subtotal, total, balance: round(subtotal - (inv.total - inv.balance)),
        }).eq('id', invoiceId);
      } else {
        const invoice_number = await nextNumber(supabase, 'fee_invoices', 'invoice_number', invPrefix,
          (q) => q.eq('school_id', schoolId));
        const { data: inv } = await supabase.from('fee_invoices').insert({
          school_id: schoolId, student_id: studentId, invoice_number,
          term_id: structure.term_id, subtotal: total, discount: 0, total, balance: total,
          currency: req.auth.school?.currency || 'SOS', due_date: structure.due_date,
        }).select('id').single();
        createdInvoices.push(inv?.id);
      }
    }

    await audit(req, {
      module: 'finance', action: 'fees_assigned', recordId: structure.id,
      summary: `${studentIds.length} students · ${structure.fee_categories?.name || ''}`,
      metadata: { students: studentIds.length, amount: structure.amount },
    });
    res.status(201).json({ data: { assigned: studentIds.length, new_invoices: createdInvoices.length } });
  } catch (e) { next(e); }
});

// --- Record a payment against a student's outstanding fees ---
financeRouter.post('/payments', requirePermission('finance.create'), async (req, res, next) => {
  try {
    const body = z.object({
      student_id: z.string().uuid(),
      amount: z.coerce.number().positive(),
      payment_method: z.enum(['cash', 'mobile_money', 'bank', 'other']).default('cash'),
      provider_reference: z.string().trim().max(120).optional(),
      invoice_id: z.string().uuid().nullable().optional(),
      note: z.string().trim().max(500).optional(),
      allocations: z.array(z.object({ fee_assignment_id: z.string().uuid(), amount: money.positive() })).optional(),
    }).parse(req.body);

    const supabase = requireDb();
    const schoolId = req.auth.schoolId;

    await assertSchoolRefs(schoolId, { student_id: body.student_id, invoice_id: body.invoice_id }, {
      student_id: 'students', invoice_id: 'fee_invoices',
    });
    if (body.invoice_id) {
      const { data: inv } = await supabase.from('fee_invoices').select('id, student_id')
        .eq('id', body.invoice_id).eq('school_id', schoolId).maybeSingle();
      if (!inv || inv.student_id !== body.student_id) throw new ApiError(422, 'Invoice does not belong to this student');
    }

    const { data: assignments } = await supabase.from('student_fee_assignments').select('*')
      .eq('school_id', schoolId).eq('student_id', body.student_id).neq('status', 'paid').neq('status', 'waived');
    if (!assignments?.length) throw new ApiError(400, 'This student has no outstanding fees');

    const outstanding = round(assignments.reduce((s, a) => s + (a.amount - a.discount - a.paid_amount), 0));
    if (round(body.amount) > outstanding) {
      throw new ApiError(422, `Payment exceeds outstanding balance (${outstanding})`);
    }

    // Distribute: explicit allocations, else oldest-first across open assignments
    const plan = [];
    if (body.allocations?.length) {
      const map = new Map(assignments.map((a) => [a.id, a]));
      let sum = 0;
      for (const al of body.allocations) {
        const a = map.get(al.fee_assignment_id);
        if (!a) throw new ApiError(422, 'Allocation references an assignment that is not outstanding');
        const due = round(a.amount - a.discount - a.paid_amount);
        if (round(al.amount) > due) throw new ApiError(422, `Allocation exceeds the balance of one fee item`);
        plan.push({ assignment: a, amount: round(al.amount) });
        sum += round(al.amount);
      }
      if (sum !== round(body.amount)) throw new ApiError(422, 'Allocations must add up to the payment amount');
    } else {
      let remaining = round(body.amount);
      for (const a of [...assignments].sort((x, y) => new Date(x.created_at) - new Date(y.created_at))) {
        if (remaining <= 0) break;
        const due = round(a.amount - a.discount - a.paid_amount);
        const take = Math.min(due, remaining);
        if (take > 0) { plan.push({ assignment: a, amount: take }); remaining = round(remaining - take); }
      }
    }

    const transaction_reference = await nextNumber(supabase, 'fee_payments', 'transaction_reference', `PAY-${year()}-`);
    const { data: payment, error: pe } = await supabase.from('fee_payments').insert({
      school_id: schoolId, student_id: body.student_id, invoice_id: body.invoice_id || null,
      transaction_reference, amount: round(body.amount), currency: req.auth.school?.currency || 'SOS',
      payment_method: body.payment_method, provider_reference: body.provider_reference,
      status: 'successful', note: body.note, received_by: req.auth.userId,
    }).select().single();
    if (pe) throw new ApiError(500, pe.message);

    await supabase.from('payment_allocations').insert(plan.map((p) => ({
      school_id: schoolId, payment_id: payment.id, fee_assignment_id: p.assignment.id, amount: p.amount,
    })));

    // Recompute assignments, then invoices, from the allocation totals
    for (const p of plan) {
      const paid = round(p.assignment.paid_amount + p.amount);
      const due = round(p.assignment.amount - p.assignment.discount);
      await supabase.from('student_fee_assignments')
        .update({ paid_amount: paid, status: paid >= due ? 'paid' : 'partial' }).eq('id', p.assignment.id);
    }

    const invoiceId = body.invoice_id || await openInvoiceId(supabase, schoolId, body.student_id);
    if (invoiceId) await recalcInvoice(supabase, invoiceId);

    const receipt_number = await nextNumber(supabase, 'receipts', 'receipt_number', `RCP-${year()}-`);
    const { data: receipt } = await supabase.from('receipts').insert({
      school_id: schoolId, payment_id: payment.id, receipt_number,
      student_id: body.student_id, amount: round(body.amount), currency: req.auth.school?.currency || 'SOS',
      issued_by: req.auth.userId,
    }).select().single();

    await refreshExaminationClearances(supabase, schoolId, body.student_id);

    await audit(req, {
      module: 'finance', action: 'payment_recorded', recordId: payment.id,
      summary: `${transaction_reference} · ${round(body.amount)}`,
      metadata: { student_id: body.student_id, amount: body.amount, method: body.payment_method },
    });
    res.status(201).json({ data: { payment, receipt } });
  } catch (e) { next(e); }
});

async function openInvoiceId(supabase, schoolId, studentId) {
  const { data } = await supabase.from('fee_invoices').select('id').eq('school_id', schoolId)
    .eq('student_id', studentId).in('status', ['open', 'partial']).order('created_at', { ascending: true }).limit(1).maybeSingle();
  return data?.id || null;
}

async function recalcInvoice(supabase, invoiceId) {
  const { data: inv } = await supabase.from('fee_invoices').select('*').eq('id', invoiceId).single();
  if (!inv) return;
  const { data: assigns } = await supabase.from('student_fee_assignments')
    .select('amount, discount, paid_amount').eq('school_id', inv.school_id).eq('student_id', inv.student_id);
  const expected = round((assigns || []).reduce((s, a) => s + (Number(a.amount) - Number(a.discount)), 0));
  const paid = round((assigns || []).reduce((s, a) => s + Number(a.paid_amount), 0));
  await supabase.from('fee_invoices').update({
    subtotal: expected, total: expected, balance: Math.max(0, round(expected - paid)),
    status: paid <= 0 ? 'open' : paid >= expected ? 'paid' : 'partial',
  }).eq('id', invoiceId);
}

// Examination fee categories gate the exam clearance
async function refreshExaminationClearances(supabase, schoolId, studentId) {
  const { data: examCats } = await supabase.from('fee_categories').select('id')
    .eq('school_id', schoolId).eq('is_examination_fee', true);
  if (!examCats?.length) return;

  const { data: st } = await supabase.from('fee_structures').select('id').eq('school_id', schoolId)
    .in('category_id', examCats.map((c) => c.id));
  if (!st?.length) return;
  const { data: rows } = await supabase.from('student_fee_assignments').select('amount, discount, paid_amount')
    .eq('school_id', schoolId).eq('student_id', studentId).in('fee_structure_id', st.map((x) => x.id));
  const required = round((rows || []).reduce((s, a) => s + (Number(a.amount) - Number(a.discount)), 0));
  const paid = round((rows || []).reduce((s, a) => s + Number(a.paid_amount), 0));
  const status = paid >= required && required > 0 ? 'pending_verification'
    : paid > 0 ? 'partially_paid' : 'unpaid';

  // examination_id is nullable, so a plain upsert cannot match an existing row; select then write
  const { data: existing } = await supabase.from('examination_clearances').select('id, status')
    .eq('school_id', schoolId).eq('student_id', studentId).is('examination_id', null).limit(1);
  const alreadyCleared = (existing || []).some((c) => c.status === 'cleared');
  const payload = { required_amount: required, paid_amount: paid, status: alreadyCleared ? 'cleared' : status };
  if (existing?.length) {
    await supabase.from('examination_clearances').update(payload).in('id', existing.map((c) => c.id));
  } else {
    await supabase.from('examination_clearances').insert({ school_id: schoolId, student_id: studentId, ...payload });
  }
}

// --- Student account view (also used by student/parent portals) ---
financeRouter.get('/student-balance/:student_id', requirePermission('finance.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const studentId = req.params.student_id;
    const visible = await visibleStudentIds(req.auth);
    if (visible && !visible.includes(studentId)) throw new ApiError(403, 'Not your child account');

    const [assigns, invoices, payments, clearances] = await Promise.all([
      supabase.from('student_fee_assignments').select('*, fee_structures(*, fee_categories(id, name, is_examination_fee))')
        .eq('school_id', schoolId).eq('student_id', studentId),
      supabase.from('fee_invoices').select('*').eq('school_id', schoolId).eq('student_id', studentId).order('created_at', { ascending: false }),
      supabase.from('fee_payments').select('*').eq('school_id', schoolId).eq('student_id', studentId).order('paid_at', { ascending: false }).limit(200),
      supabase.from('examination_clearances').select('*').eq('school_id', schoolId).eq('student_id', studentId),
    ]);
    const expected = round((assigns.data || []).reduce((s, a) => s + (a.amount - a.discount), 0));
    const paid = round((assigns.data || []).reduce((s, a) => s + a.paid_amount, 0));
    res.json({
      data: {
        assignments: assigns.data || [], invoices: invoices.data || [],
        payments: payments.data || [], clearances: clearances.data || [],
        summary: { expected, paid, outstanding: Math.max(0, round(expected - paid)) },
      },
    });
  } catch (e) { next(e); }
});

// --- Reverse a payment (recompute allocations, assignments, invoices) ---
financeRouter.post('/payments/:id/reverse', requirePermission('finance.approve'), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const supabase = requireDb();
    const { data: payment } = await supabase.from('fee_payments').select('*')
      .eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!payment) throw new ApiError(404, 'Payment not found');
    if (payment.reversed) throw new ApiError(409, 'Payment is already reversed');

    const { data: allocations } = await supabase.from('payment_allocations').select('*').eq('payment_id', payment.id);
    for (const al of allocations || []) {
      const { data: a } = await supabase.from('student_fee_assignments').select('*').eq('id', al.fee_assignment_id).single();
      const paid = Math.max(0, round(a.paid_amount - al.amount));
      const due = round(a.amount - a.discount);
      await supabase.from('student_fee_assignments').update({
        paid_amount: paid, status: paid <= 0 ? 'outstanding' : paid >= due ? 'paid' : 'partial',
      }).eq('id', a.id);
    }
    await supabase.from('fee_payments').update({
      reversed: true, reversed_by: req.auth.userId, reversal_reason: reason, status: 'refunded',
    }).eq('id', payment.id);
    if (payment.invoice_id) await recalcInvoice(supabase, payment.invoice_id);
    else await recalcInvoice(supabase, await openInvoiceId(supabase, payment.school_id, payment.student_id));
    await refreshExaminationClearances(supabase, payment.school_id, payment.student_id);

    await audit(req, { module: 'finance', action: 'payment_reversed', recordId: payment.id, summary: reason });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// --- Expense approval workflow ---
financeRouter.post('/expenses/:id/review', requirePermission('finance.approve'), async (req, res, next) => {
  try {
    const { action, reason } = z.object({ action: z.enum(['approve', 'reject']), reason: z.string().trim().max(500).optional() }).parse(req.body);
    if (action === 'reject' && !reason) throw new ApiError(422, 'A reason is required when rejecting an expense');
    const supabase = requireDb();
    const { data } = await supabase.from('expenses').update({
      status: action === 'approve' ? 'approved' : 'rejected', approved_by: req.auth.userId,
    }).eq('id', req.params.id).eq('school_id', req.auth.schoolId).eq('status', 'pending_approval')
      .select().maybeSingle();
    if (!data) throw new ApiError(404, 'No pending expense with that id');
    await supabase.from('financial_approvals').insert({
      school_id: req.auth.schoolId, entity_type: 'expense', entity_id: data.id,
      action: `expense_${action}`, status: action === 'approve' ? 'approved' : 'rejected',
      requested_by: data.requested_by, reviewed_by: req.auth.userId, reason,
    });
    await audit(req, { module: 'finance', action: `expense_${action}d`, recordId: data.id });
    res.json({ data });
  } catch (e) { next(e); }
});

// --- Finance overview for the cashier/admin dashboard ---
financeRouter.get('/summary', requirePermission('finance.view'), async (req, res, next) => {
  try {
    // School-wide collections/expenses are back-office figures, not part of the personal portal.
    if (isPortalOnly(req.auth)) throw new ApiError(403, 'Not available in the student/parent portal');
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const { from, to } = req.query;
    let pq = supabase.from('fee_payments').select('amount, payment_method, paid_at').eq('school_id', schoolId).eq('status', 'successful');
    if (from) pq = pq.gte('paid_at', from);
    if (to) pq = pq.lte('paid_at', to);
    const [payments, assigns, expenses] = await Promise.all([
      pq.limit(20000),
      supabase.from('student_fee_assignments').select('amount, discount, paid_amount').eq('school_id', schoolId),
      supabase.from('expenses').select('amount, status').eq('school_id', schoolId),
    ]);
    const collected = round((payments.data || []).reduce((s, p) => s + Number(p.amount), 0));
    const expected = round((assigns.data || []).reduce((s, a) => s + (a.amount - a.discount), 0));
    const paid = round((assigns.data || []).reduce((s, a) => s + Number(a.paid_amount), 0));
    const byMethod = {};
    for (const p of payments.data || []) byMethod[p.payment_method] = round((byMethod[p.payment_method] || 0) + Number(p.amount));
    res.json({
      data: {
        collected, expected, paid, outstanding: Math.max(0, round(expected - paid)),
        expenses_total: round((expenses.data || []).reduce((s, e) => s + Number(e.amount), 0)),
        expenses_pending: (expenses.data || []).filter((e) => e.status === 'pending_approval').length,
        by_method: byMethod, payment_count: (payments.data || []).length,
      },
    });
  } catch (e) { next(e); }
});

// --- Examination clearance list + manual verification ---
financeRouter.get('/clearances', requirePermission('finance.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    let q = supabase.from('examination_clearances')
      .select('*, students (id, full_name, admission_number)')
      .eq('school_id', req.auth.schoolId);
    if (req.query.status) q = q.eq('status', req.query.status);
    const visible = await visibleStudentIds(req.auth);
    if (visible !== null) {
      if (!visible.length) return res.json({ data: [], total: 0 });
      q = q.in('student_id', visible);
    }
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(1000);
    if (error) throw new ApiError(500, error.message);
    res.json({ data: data || [], total: (data || []).length });
  } catch (e) { next(e); }
});

financeRouter.post('/clearances/:id/verify', requirePermission('finance.approve'), async (req, res, next) => {
  try {
    const { action } = z.object({ action: z.enum(['clear', 'block']) }).parse(req.body);
    const supabase = requireDb();
    const { data } = await supabase.from('examination_clearances').update({
      status: action === 'clear' ? 'cleared' : 'blocked', verified_by: req.auth.userId,
    }).eq('id', req.params.id).eq('school_id', req.auth.schoolId).select().maybeSingle();
    if (!data) throw new ApiError(404, 'Clearance not found');
    await audit(req, { module: 'finance', action: `clearance_${action}ed`, recordId: data.id });
    res.json({ data });
  } catch (e) { next(e); }
});
