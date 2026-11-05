import { Router } from 'express';
import { z } from 'zod';
import { requireDb } from '../../config/supabase.js';
import { ApiError } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { audit } from '../../services/audit.js';
import { teacherClassIds, visibleStudentIds } from '../../services/scopes.js';
import { assertSchoolRefs } from '../../services/tenantRefs.js';
import {
  alertUsers, notify, notifyLater, householdUserIdsForClasses, userIdsWithPermission, teacherUserIdsForClasses,
} from '../../services/notify.js';

export const examRouter = Router();
const uuidz = z.string().uuid();

// Create an examination together with its class/subject scope.
examRouter.post('/', requirePermission('examinations.create'), async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().trim().min(2).max(120),
      examination_type_id: uuidz.optional(),
      academic_year_id: uuidz.optional(),
      term_id: uuidz.optional(),
      scopes: z.array(z.object({
        class_id: uuidz, subject_id: uuidz, total_marks: z.coerce.number().min(1).default(100),
        components: z.array(z.object({ name: z.string().trim().min(1), weight_percent: z.coerce.number().default(100), maximum_marks: z.coerce.number().default(100) })).optional(),
      })).min(1),
      status: z.enum(['draft', 'scheduled']).default('draft'),
    }).parse(req.body);
    const supabase = requireDb();
    await assertSchoolRefs(req.auth.schoolId, {
      examination_type_id: body.examination_type_id,
      academic_year_id: body.academic_year_id,
      term_id: body.term_id,
      class_ids: body.scopes.map((s) => s.class_id),
      subject_ids: body.scopes.map((s) => s.subject_id),
    }, {
      examination_type_id: 'examination_types', academic_year_id: 'academic_years', term_id: 'terms',
      class_ids: 'classes', subject_ids: 'subjects',
    });
    const { data: exam, error } = await supabase.from('examinations').insert({
      school_id: req.auth.schoolId, examination_type_id: body.examination_type_id || null,
      academic_year_id: body.academic_year_id || null, term_id: body.term_id || null,
      name: body.name, status: body.status,
    }).select().single();
    if (error) throw new ApiError(500, error.message);
    for (const sc of body.scopes) {
      const { data: ecs } = await supabase.from('exam_class_subjects').insert({
        school_id: req.auth.schoolId, examination_id: exam.id,
        class_id: sc.class_id, subject_id: sc.subject_id, total_marks: sc.total_marks,
      }).select().single();
      for (const c of sc.components || []) {
        await supabase.from('examination_components').insert({
          school_id: req.auth.schoolId, exam_class_subject_id: ecs.id,
          name: c.name, weight_percent: c.weight_percent, maximum_marks: c.maximum_marks,
        });
      }
    }
    await audit(req, { module: 'examinations', action: 'created', recordId: exam.id, summary: exam.name });
    res.status(201).json({ data: exam });
  } catch (e) { next(e); }
});

// Bulk marks entry (draft). Teachers limited to assigned classes.
examRouter.post('/marks/bulk', requirePermission('marks.create', 'marks.edit'), async (req, res, next) => {
  try {
    const body = z.object({
      exam_class_subject_id: uuidz,
      component_id: uuidz.nullable().optional(),
      entries: z.array(z.object({
        student_id: uuidz,
        marks_obtained: z.coerce.number().min(0),
        maximum_marks: z.coerce.number().min(1).default(100),
      })).min(1),
    }).parse(req.body);
    const supabase = requireDb();
    await assertSchoolRefs(req.auth.schoolId, {
      exam_class_subject_id: body.exam_class_subject_id,
      component_id: body.component_id,
      student_ids: body.entries.map((e) => e.student_id),
    }, {
      exam_class_subject_id: 'exam_class_subjects', component_id: 'examination_components', student_ids: 'students',
    });
    const { data: ecs } = await supabase.from('exam_class_subjects').select('*, examinations(name, status)')
      .eq('id', body.exam_class_subject_id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!ecs) throw new ApiError(404, 'Examination subject not found');
    if (['published', 'archived'].includes(ecs.examinations?.status)) throw new ApiError(403, 'Marks locked: results published');
    const cls = await teacherClassIds(req.auth);
    if (cls && !cls.includes(ecs.class_id)) throw new ApiError(403, 'You may only enter marks for assigned classes');

    let saved = 0, rejected = 0;
    for (const e of body.entries) {
      if (e.marks_obtained > e.maximum_marks) { rejected++; continue; }
      const { error } = await supabase.from('marks').upsert({
        school_id: req.auth.schoolId, examination_id: ecs.examination_id,
        exam_class_subject_id: ecs.id, component_id: body.component_id || null,
        student_id: e.student_id, subject_id: ecs.subject_id, class_id: ecs.class_id,
        marks_obtained: e.marks_obtained, maximum_marks: e.maximum_marks,
        entered_by: req.auth.userId, approval_status: 'draft',
      }, { onConflict: 'component_id,student_id' });
      if (error) throw new ApiError(500, error.message);
      saved++;
    }
    await audit(req, { module: 'marks', action: 'created', recordId: ecs.id, summary: `${saved} entries draft` });
    res.json({ data: { saved, rejected } });
  } catch (e) { next(e); }
});

// Submit draft marks for review → creates a pending result approval
examRouter.post('/marks/submit', requirePermission('marks.submit'), async (req, res, next) => {
  try {
    const { exam_class_subject_id } = z.object({ exam_class_subject_id: uuidz }).parse(req.body);
    const supabase = requireDb();
    const { data: ecs } = await supabase.from('exam_class_subjects').select('*')
      .eq('id', exam_class_subject_id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!ecs) throw new ApiError(404, 'Not found');
    const { count } = await supabase.from('marks').select('*', { count: 'exact', head: true })
      .eq('exam_class_subject_id', ecs.id).eq('school_id', req.auth.schoolId);
    if (!count) throw new ApiError(400, 'No marks to submit');
    const { error: ue } = await supabase.from('marks').update({ approval_status: 'submitted' })
      .eq('exam_class_subject_id', ecs.id).eq('school_id', req.auth.schoolId).eq('approval_status', 'draft');
    if (ue) throw new ApiError(500, ue.message);
    await supabase.from('result_approvals').upsert({
      school_id: req.auth.schoolId, examination_id: ecs.examination_id,
      class_id: ecs.class_id, subject_id: ecs.subject_id, status: 'pending', submitted_by: req.auth.userId,
    }, { onConflict: 'examination_id,class_id,subject_id' });
    await audit(req, { module: 'results', action: 'submitted', recordId: ecs.id, summary: `${count} marks submitted for review` });
    // The reviewer is the only person who can move this forward, so the queue is announced, not polled.
    notifyLater('marks submitted alert', async () => {
      const [{ data: exam }, { data: cls }, { data: sub }] = await Promise.all([
        supabase.from('examinations').select('name').eq('id', ecs.examination_id).maybeSingle(),
        supabase.from('classes').select('name').eq('id', ecs.class_id).maybeSingle(),
        supabase.from('subjects').select('name').eq('id', ecs.subject_id).maybeSingle(),
      ]);
      const reviewers = await userIdsWithPermission(supabase, req.auth.schoolId, 'results.approve');
      return notify(supabase, reviewers, {
        schoolId: req.auth.schoolId, category: 'results',
        title: `Results waiting for review: ${exam?.name || 'an examination'}`,
        body: [cls?.name, sub?.name, `${count} marks`].filter(Boolean).join(' · '),
      });
    }, req.log);
    res.json({ data: { submitted: count } });
  } catch (e) { next(e); }
});

// Approval / rejection of submitted results (separation of duties enforced below)
examRouter.post('/results/:approvalId/review', requirePermission('results.approve', 'results.reject'), async (req, res, next) => {
  try {
    const { action, reason } = z.object({ action: z.enum(['approve', 'reject']), reason: z.string().max(500).optional() }).parse(req.body);
    const supabase = requireDb();
    const { data: ap } = await supabase.from('result_approvals').select('*')
      .eq('id', req.params.approvalId).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!ap) throw new ApiError(404, 'Approval not found');
    // Separation of duties: a submitter cannot approve their own submission unless school admin.
    if (action === 'approve' && ap.submitted_by === req.auth.userId && !req.auth.roles.includes('school_admin')) {
      throw new ApiError(403, 'You cannot approve results you submitted');
    }
    await supabase.from('result_approvals').update({
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewed_by: req.auth.userId, reason: reason || null,
    }).eq('id', ap.id);
    await supabase.from('marks').update({ approval_status: action === 'approve' ? 'approved' : 'rejected' })
      .eq('school_id', req.auth.schoolId).eq('examination_id', ap.examination_id)
      .eq('class_id', ap.class_id || ap.class_id).eq('subject_id', ap.subject_id || ap.subject_id);
    await audit(req, { module: 'results', action: `${action}d`, recordId: ap.id, summary: `Result approval ${action}` });
    alertUsers(req, [ap.submitted_by].filter((id) => id && id !== req.auth.userId), {
      category: 'results',
      title: `Your submitted results were ${action === 'approve' ? 'approved' : 'sent back'}`,
      body: reason || (action === 'approve' ? 'They are now part of the report card.' : 'A reason was expected with the rejection.'),
    });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// Publish approved results for an examination → students/parents can view
examRouter.post('/:id/publish', requirePermission('results.publish'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const { data: exam } = await supabase.from('examinations').select('*')
      .eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!exam) throw new ApiError(404, 'Examination not found');
    const { data: pending } = await supabase.from('result_approvals').select('id')
      .eq('examination_id', exam.id).eq('school_id', req.auth.schoolId).eq('status', 'pending');
    if (pending?.length) throw new ApiError(409, 'All results must be reviewed before publication');
    const { data, error } = await supabase.from('examinations').update({ status: 'published' })
      .eq('id', exam.id).select().single();
    if (error) throw new ApiError(500, error.message);
    await audit(req, { module: 'results', action: 'published', recordId: exam.id, summary: `Published ${exam.name}` });
    alertUsers(req, async (supabase, schoolId) => {
      const { data: scoped } = await supabase.from('exam_class_subjects').select('class_id')
        .eq('examination_id', exam.id).eq('school_id', schoolId).limit(500);
      const classIds = [...new Set((scoped || []).map((row) => row.class_id).filter(Boolean))];
      const households = await householdUserIdsForClasses(supabase, schoolId, classIds);
      const teachers = await teacherUserIdsForClasses(supabase, schoolId, classIds);
      return [...new Set([...households, ...teachers])].filter((id) => id && id !== req.auth.userId);
    }, {
      category: 'results',
      title: `Results published: ${exam.name}`,
      body: 'The report card for this examination is ready to view.',
    });
    res.json({ data });
  } catch (e) { next(e); }
});

// Report card (computed): per-subject totals, grade, class rank
examRouter.get('/report-card', requirePermission('results.view', 'marks.view'), async (req, res, next) => {
  try {
    const { examination_id, student_id } = z.object({
      examination_id: uuidz, student_id: uuidz,
    }).parse(req.query);
    const supabase = requireDb();
    const { data: exam } = await supabase.from('examinations').select('*')
      .eq('id', examination_id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!exam) throw new ApiError(404, 'Examination not found');
    // Students/parents may only see published results, and only for a student linked to them.
    const personal = ['student', 'parent'].some((r) => req.auth.roles.includes(r))
      && !['school_admin', 'principal', 'teacher'].some((r) => req.auth.roles.includes(r));
    if (personal) {
      if (exam.status !== 'published') throw new ApiError(403, 'Results are not published yet');
      const visible = await visibleStudentIds(req.auth);
      if (!visible || !visible.includes(student_id)) {
        throw new ApiError(403, 'You can only view results for your own student record');
      }
    }

    const { data: subjects } = await supabase.from('marks').select('subject_id, subjects(name), marks_obtained, maximum_marks, approval_status')
      .eq('examination_id', exam.id).eq('student_id', student_id).eq('school_id', req.auth.schoolId);
    const perSubject = {};
    for (const m of subjects || []) {
      if (personal && m.approval_status !== 'approved') continue;
      const key = m.subject_id;
      const s = (perSubject[key] ||= { name: m.subjects?.name, obtained: 0, maximum: 0 });
      s.obtained += Number(m.marks_obtained); s.maximum += Number(m.maximum_marks);
    }
    const list = Object.values(perSubject);
    const totalObt = list.reduce((x, s) => x + s.obtained, 0);
    const totalMax = list.reduce((x, s) => x + s.maximum, 0);
    const percent = totalMax ? (totalObt / totalMax) * 100 : 0;
    const { data: ranges } = await supabase.from('grade_ranges').select('*').eq('school_id', req.auth.schoolId);
    const grade = (ranges || []).find((g) => percent >= Number(g.min_percent) && percent <= Number(g.max_percent));
    // Class rank
    let rank = null, classSize = null, className = null;
    const { data: student } = await supabase.from('students').select('class_id')
      .eq('id', student_id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (student?.class_id) {
      const { data: cls } = await supabase.from('classes').select('name')
        .eq('id', student.class_id).eq('school_id', req.auth.schoolId).maybeSingle();
      className = cls?.name || null;
      let rankQuery = supabase.from('marks')
        .select('student_id, marks_obtained, maximum_marks')
        .eq('examination_id', exam.id).eq('class_id', student.class_id).eq('school_id', req.auth.schoolId);
      if (personal) rankQuery = rankQuery.eq('approval_status', 'approved');
      const { data: allMarks } = await rankQuery;
      const totals = {};
      for (const m of allMarks || []) {
        const t = (totals[m.student_id] ||= { o: 0, x: 0 });
        t.o += Number(m.marks_obtained); t.x += Number(m.maximum_marks);
      }
      const arr = Object.entries(totals).map(([sid, t]) => ({ sid, pct: t.x ? (t.o / t.x) * 100 : 0 }))
        .sort((a, b) => b.pct - a.pct);
      classSize = arr.length;
      rank = arr.findIndex((x) => x.sid === student_id) + 1 || null;
    }
    res.json({
      data: {
        examination: { id: exam.id, name: exam.name, status: exam.status },
        student_id: student_id, subjects: list,
        total_obtained: totalObt, total_maximum: totalMax,
        percent: Math.round(percent * 10) / 10,
        grade: grade?.grade_label || null, remark: grade?.remark || null,
        class_rank: rank, class_size: classSize, class_name: className,
      },
    });
  } catch (e) { next(e); }
});
