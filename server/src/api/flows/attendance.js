import { Router } from 'express';
import { z } from 'zod';
import { requireDb } from '../../config/supabase.js';
import { ApiError } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { audit } from '../../services/audit.js';
import { teacherClassIds, visibleStudentIds } from '../../services/scopes.js';
import {
  notify, notifyLater, alertUsers, householdsByStudent, teacherUserIdsForClasses, userIdsWithRoles,
} from '../../services/notify.js';

export const attendanceRouter = Router();

const STATUS = z.enum(['present', 'absent', 'late', 'excused']);

/**
 * Not the daily roll — the marks that keep a learner out of class, which is the message a family
 * actually wants. Each note goes to that child's own household, never to the class. A day where half
 * the register is missing stops being a flood: past this many learners the school gets one summary for
 * its administrators and the class teacher instead of hundreds of pushes.
 */
const PERSONAL_ALERTS = 40;
const ALERTED_STATUSES = { absent: 'absent', late: 'late' };

function alertAbsentees(req, supabase, { classId, date, flagged }) {
  if (!flagged.length) return;
  const schoolId = req.auth.schoolId;
  const statusOf = new Map(flagged.map((f) => [f.student_id, f.attendance_status]));
  notifyLater('attendance alert', async () => {
    if (flagged.length > PERSONAL_ALERTS) {
      const { data: cls } = await supabase.from('classes').select('name').eq('id', classId).maybeSingle();
      const [admins, teachers] = await Promise.all([
        userIdsWithRoles(supabase, schoolId, ['school_admin', 'principal']),
        teacherUserIdsForClasses(supabase, schoolId, [classId]),
      ]);
      return notify(supabase, [...new Set([...admins, ...teachers])], {
        schoolId, category: 'attendance',
        title: `${flagged.length} learners marked absent in ${cls?.name || 'a class'}`,
        body: `${date} · this many follow-ups are waiting on one register.`,
      });
    }
    const households = await householdsByStudent(supabase, schoolId, [...statusOf.keys()]);
    const { data: students } = await supabase.from('students').select('id, full_name')
      .eq('school_id', schoolId).in('id', [...households.keys()]);
    const names = new Map((students || []).map((s) => [s.id, s.full_name]));
    let last = null;
    for (const [studentId, logins] of households) {
      if (!logins.length) continue;
      const status = ALERTED_STATUSES[statusOf.get(studentId)] || 'not present';
      last = await notify(supabase, logins, {
        schoolId, category: 'attendance',
        title: `${names.get(studentId) || 'Your child'} was marked ${status}`,
        body: `${date} · logged by ${req.auth.fullName || 'the class teacher'}.`,
      });
    }
    return last;
  }, req.log);
}

const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A teacher without administrative rights takes one subject at a time. */
const isTeacherScoped = (auth) => auth.roles.includes('teacher') && !auth.roles.includes('school_admin');

/** One attendance sheet per class/subject/date; the next submission opens the next day. */
async function findSession(supabase, auth, classId, subjectId, date) {
  let q = supabase.from('attendance_sessions')
    .select('id, session_type, status, created_at, school_users!attendance_sessions_created_by_fkey(full_name)')
    .eq('school_id', auth.schoolId).eq('class_id', classId).eq('session_date', date);
  q = subjectId ? q.eq('subject_id', subjectId) : q.is('subject_id', null);
  const { data } = await q.maybeSingle();
  return data || null;
}

// Bulk save for a class session. Enforces: teacher may only mark assigned classes/subjects,
// a teacher must pick one of their subjects, and each class/subject/day can be taken once.
attendanceRouter.post('/sessions', requirePermission('attendance.create'), async (req, res, next) => {
  try {
    const body = z.object({
      class_id: z.string().uuid(),
      subject_id: z.string().uuid().nullable().optional(),
      session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      session_type: z.enum(['daily', 'subject']).default('daily'),
      records: z.array(z.object({
        student_id: z.string().uuid(), attendance_status: STATUS, remarks: z.string().max(255).optional(),
      })).min(1),
    }).parse(req.body);

    const supabase = requireDb();
    const cls = await teacherClassIds(req.auth);
    if (cls && !cls.includes(body.class_id)) {
      // A teacher can also be scheduled through the timetable without an explicit assignment.
      const { data: scheduled } = await supabase.from('timetable_entries').select('id')
        .eq('school_id', req.auth.schoolId).eq('teacher_id', req.auth.userId)
        .eq('class_id', body.class_id).limit(1);
      if (!(scheduled || []).length) {
        throw new ApiError(403, 'You may only take attendance for your assigned classes');
      }
    }

    if (isTeacherScoped(req.auth)) {
      if (!body.subject_id) {
        throw new ApiError(400, 'Select the subject you are taking attendance for.');
      }
      const [{ data: assigned }, { data: lessons }] = await Promise.all([
        supabase.from('teacher_assignments').select('id')
          .eq('school_id', req.auth.schoolId).eq('school_user_id', req.auth.userId)
          .eq('class_id', body.class_id).eq('subject_id', body.subject_id).limit(1),
        supabase.from('timetable_entries').select('id')
          .eq('school_id', req.auth.schoolId).eq('teacher_id', req.auth.userId)
          .eq('class_id', body.class_id).eq('subject_id', body.subject_id).limit(1),
      ]);
      if (!(assigned || []).length && !(lessons || []).length) {
        throw new ApiError(403, 'That subject is not assigned to you in this class.');
      }
    }

    const existing = await findSession(supabase, req.auth, body.class_id, body.subject_id || null, body.session_date);
    if (existing) {
      const when = existing.created_at
        ? ` (recorded ${new Date(existing.created_at).toLocaleString()})`
        : '';
      throw new ApiError(409,
        `Attendance for this ${body.subject_id ? 'subject' : 'class'} was already submitted on ${body.session_date}${when}. It can be taken again tomorrow.`);
    }
    // Every marked student must actually belong to the class on the session.
    const { data: roster } = await supabase.from('students').select('id')
      .eq('school_id', req.auth.schoolId).eq('class_id', body.class_id)
      .in('id', body.records.map((r) => r.student_id));
    const rosterIds = new Set((roster || []).map((s) => s.id));
    if (body.records.some((r) => !rosterIds.has(r.student_id))) {
      throw new ApiError(400, 'The attendance sheet contains a student who is not in this class');
    }
    const { data: session, error: se } = await supabase.from('attendance_sessions').upsert({
      school_id: req.auth.schoolId, class_id: body.class_id, subject_id: body.subject_id || null,
      session_date: body.session_date, session_type: body.session_type,
      status: 'submitted', created_by: req.auth.userId,
    }, { onConflict: 'school_id,class_id,subject_id,session_date' }).select().single();
    if (se) throw new ApiError(500, se.message);

    // Replace only this session's records; sibling classes/subjects on the same date stay intact.
    await supabase.from('attendance_records').delete()
      .eq('school_id', req.auth.schoolId).eq('session_id', session.id);
    const rows = body.records.map((r) => ({
      school_id: req.auth.schoolId, session_id: session.id, student_id: r.student_id,
      class_id: body.class_id, subject_id: body.subject_id || null,
      attendance_date: body.session_date, attendance_status: r.attendance_status,
      remarks: r.remarks, marked_by: req.auth.userId,
    }));
    const { error: ie } = await supabase.from('attendance_records').insert(rows);
    if (ie) throw new ApiError(500, ie.message);
    alertAbsentees(req, supabase, {
      classId: body.class_id,
      date: body.session_date,
      flagged: body.records.filter((r) => ALERTED_STATUSES[r.attendance_status]),
    });
    await audit(req, { module: 'attendance', action: 'submitted', recordId: session.id, summary: `${rows.length} students for ${body.session_date}` });
    res.json({ data: { session, saved: rows.length } });
  } catch (e) { next(e); }
});

// Lets the sheet show "already taken today" before the teacher marks anyone.
attendanceRouter.get('/session-state', requirePermission('attendance.view'), async (req, res, next) => {
  try {
    const { class_id: classId, subject_id: subjectId, date } = z.object({
      class_id: z.string().uuid(),
      subject_id: z.string().uuid().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(req.query);
    const session = await findSession(requireDb(), req.auth, classId, subjectId || null, date);
    if (!session) return res.json({ data: { taken: false } });
    const { count } = await requireDb().from('attendance_records')
      .select('*', { count: 'exact', head: true }).eq('session_id', session.id);
    res.json({
      data: {
        taken: true,
        session: {
          id: session.id, status: session.status, session_type: session.session_type,
          created_at: session.created_at, records: count || 0,
          taken_by: session.school_users?.full_name || null,
        },
      },
    });
  } catch (e) { next(e); }
});

// Summary per class or per student over a period. Personal portals are pinned to their own child.
attendanceRouter.get('/summary', requirePermission('attendance.view'), async (req, res, next) => {
  try {
    const { from, to, class_id } = req.query;
    const visible = await visibleStudentIds(req.auth);
    if (visible !== null) {
      if (!visible.length) return res.json({ data: {} });
      if (req.query.student_id && !visible.includes(req.query.student_id)) {
        throw new ApiError(403, 'You can only view attendance for your own student record');
      }
    }
    let q = requireDb().from('attendance_records').select('*').eq('school_id', req.auth.schoolId);
    if (from) q = q.gte('attendance_date', from);
    if (to) q = q.lte('attendance_date', to);
    if (visible === null) {
      if (class_id) q = q.eq('class_id', class_id);
      if (req.query.student_id) q = q.eq('student_id', req.query.student_id);
    } else {
      q = q.in('student_id', visible);
    }
    const { data, error } = await q.limit(20000);
    if (error) throw new ApiError(500, error.message);
    const byStudent = {};
    for (const r of data || []) {
      const s = (byStudent[r.student_id] ||= { present: 0, absent: 0, late: 0, excused: 0, total: 0 });
      s[r.attendance_status]++; s.total++;
    }
    const enriched = { ...byStudent };
    for (const k of Object.keys(enriched)) {
      const v = enriched[k];
      v.rate = v.total ? Math.round(((v.present + v.late) / v.total) * 100) : null;
    }
    res.json({ data: enriched });
  } catch (e) { next(e); }
});

// Student/parent view: each record carries its subject and the teacher who marked it, and the
// payload includes today's class count. Scoping comes from the signed-in account, never the URL.
attendanceRouter.get('/my-records', requirePermission('attendance.view'), async (req, res, next) => {
  try {
    const visible = await visibleStudentIds(req.auth);
    if (visible === null) throw new ApiError(403, 'This view is only for student and parent accounts');
    const studentId = req.query.student_id || visible[0];
    if (!studentId || !visible.includes(studentId)) {
      throw new ApiError(403, 'You can only view attendance for your own student record');
    }
    const from = req.query.from || todayIso();
    const to = req.query.to || todayIso();
    const { data, error } = await requireDb().from('attendance_records')
      .select('id, attendance_date, attendance_status, remarks, created_at, subjects(name), classes(name), school_users!attendance_records_marked_by_fkey(full_name, avatar_url)')
      .eq('school_id', req.auth.schoolId).eq('student_id', studentId)
      .gte('attendance_date', from).lte('attendance_date', to)
      .order('attendance_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(2000);
    if (error) throw new ApiError(500, error.message);

    const records = (data || []).map((r) => ({
      id: r.id,
      date: r.attendance_date,
      status: r.attendance_status,
      remarks: r.remarks || null,
      subject: r.subjects?.name || null,
      class_name: r.classes?.name || null,
      teacher: r.school_users?.full_name || null,
      teacher_avatar: r.school_users?.avatar_url || null,
    }));
    const tally = (rows) => {
      const out = { total: rows.length, present: 0, absent: 0, late: 0, excused: 0 };
      for (const r of rows) if (out[r.status] !== undefined) out[r.status] += 1;
      out.rate = out.total ? Math.round(((out.present + out.late) / out.total) * 100) : null;
      return out;
    };
    const today = todayIso();
    const todayRecords = records.filter((r) => r.date === today);
    res.json({
      data: {
        student_id: studentId,
        today: { date: today, classes: todayRecords.length, ...tally(todayRecords), records: todayRecords },
        range: { from, to, ...tally(records) },
        records,
      },
    });
  } catch (e) { next(e); }
});

// Correction requests (teacher/student/parent may request; reviewer approves)
attendanceRouter.post('/corrections', requirePermission('attendance.create', 'attendance.view'), async (req, res, next) => {
  try {
    const body = z.object({
      student_id: z.string().uuid(), attendance_date: z.string(),
      requested_status: STATUS, reason: z.string().trim().min(3).max(500),
    }).parse(req.body);
    const visible = await visibleStudentIds(req.auth);
    if (visible !== null && !visible.includes(body.student_id)) {
      throw new ApiError(403, 'You can only request a correction for your own attendance record');
    }
    const supabase = requireDb();
    const { data: record } = await supabase.from('attendance_records').select('id, attendance_status')
      .eq('school_id', req.auth.schoolId).eq('student_id', body.student_id).eq('attendance_date', body.attendance_date).maybeSingle();
    if (!record) throw new ApiError(404, 'No attendance record for that date');
    const { data, error } = await supabase.from('attendance_corrections').insert({
      school_id: req.auth.schoolId, attendance_record_id: record.id, student_id: body.student_id,
      requested_by: req.auth.userId, original_status: record.attendance_status,
      requested_status: body.requested_status, reason: body.reason,
    }).select().single();
    if (error) throw new ApiError(500, error.message);
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

attendanceRouter.post('/corrections/:id/review', requirePermission('attendance.approve'), async (req, res, next) => {
  try {
    const { action } = z.object({ action: z.enum(['approve', 'reject']) }).parse(req.body);
    const supabase = requireDb();
    const { data: cor } = await supabase.from('attendance_corrections').select('*')
      .eq('id', req.params.id).eq('school_id', req.auth.schoolId).maybeSingle();
    if (!cor) throw new ApiError(404, 'Correction request not found');
    await supabase.from('attendance_corrections').update({
      status: action === 'approve' ? 'approved' : 'rejected', reviewed_by: req.auth.userId,
    }).eq('id', cor.id);
    if (action === 'approve' && cor.attendance_record_id) {
      await supabase.from('attendance_records').update({ attendance_status: cor.requested_status })
        .eq('id', cor.attendance_record_id);
    }
    await audit(req, { module: 'attendance', action: `correction_${action}d`, recordId: cor.id });
    alertUsers(req, [cor.requested_by].filter(Boolean), {
      category: 'attendance',
      title: `Attendance correction ${action === 'approve' ? 'approved' : 'rejected'}`,
      body: `${cor.original_status} → ${cor.requested_status}.`,
    });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});
