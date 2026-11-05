import { Router } from 'express';
import { z } from 'zod';
import { requireDb } from '../../config/supabase.js';
import { requirePermission } from '../../middleware/rbac.js';
import { ApiError } from '../../middleware/error.js';
import { audit } from '../../services/audit.js';
import { recordDeletion } from '../../services/trash.js';
import { checkEntitlement } from '../../services/entitlement.js';
import { classesExtraColumns } from '../../services/schemaSupport.js';
import { sanitizeSearch } from '../../core/crud.js';

/**
 * Class management flow: card overview, class detail with enrolled + unassigned students,
 * and the section/roster operations behind it. Tenant-scoped by school_id on every query.
 */
export const classAdminRouter = Router();

const name = (max) => z.string().trim().min(1).max(max);
const optionalCount = z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().min(0).max(100000).nullable().optional());

const sectionSchema = z.object({
  id: z.string().uuid().optional(),
  name: name(32),
  capacity: optionalCount,
});

const classSchema = z.object({
  name: name(64),
  level: optionalCount,
  capacity: optionalCount,
  room: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(64).nullable().optional()),
  teacher_id: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  sections: z.array(sectionSchema).max(30).optional(),
});

async function loadClass(schoolId, id) {
  const { data, error } = await requireDb().from('classes').select('*')
    .eq('id', id).eq('school_id', schoolId).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Class not found');
  return data;
}

async function assertTeacher(schoolId, teacherId) {
  if (!teacherId) return null;
  const { data } = await requireDb().from('school_users').select('id, full_name')
    .eq('id', teacherId).eq('school_id', schoolId).maybeSingle();
  if (!data) throw new ApiError(400, 'That teacher is not part of this school.');
  return data;
}

function dropUnsupported(payload, hasExtras) {
  if (!hasExtras) {
    delete payload.room;
    delete payload.teacher_id;
  }
  return payload;
}

function sectionNames(value) {
  return (value || []).map((s) => String(s.name || '').trim()).filter(Boolean);
}

async function sectionsForClasses(schoolId, classIds) {
  if (!classIds.length) return [];
  const { data, error } = await requireDb().from('sections')
    .select('id, class_id, name, capacity').eq('school_id', schoolId).in('class_id', classIds)
    .order('name');
  if (error) throw new ApiError(500, error.message);
  return data || [];
}

/**
 * Homeroom teacher fallback for databases that have not run migration 0019:
 * teacher_assignments already records who leads a class, so the feature works without
 * the new classes.teacher_id column.
 */
async function homeroomTeachers(schoolId, classIds) {
  if (!classIds.length) return new Map();
  const { data, error } = await requireDb().from('teacher_assignments')
    .select('class_id, school_user_id, school_users(full_name)')
    .eq('school_id', schoolId).eq('is_homeroom', true).in('class_id', classIds);
  if (error) return new Map();
  const map = new Map();
  for (const row of data || []) {
    if (row.class_id && row.school_users?.full_name) {
      map.set(row.class_id, { id: row.school_user_id, name: row.school_users.full_name });
    }
  }
  return map;
}

/** Keep the teacher list usable even for registrars who cannot open /school/users. */
async function teacherDirectory(schoolId) {
  const { data, error } = await requireDb().from('school_users')
    .select('id, full_name, email, school_user_roles(school_roles(name))')
    .eq('school_id', schoolId).eq('status', 'active').order('full_name').limit(500);
  if (error) return [];
  return (data || [])
    .map((u) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      roles: (u.school_user_roles || []).map((r) => r.school_roles?.name).filter(Boolean),
    }))
    .filter((u) => !u.roles.length || u.roles.some((r) => /teacher|principal|head/i.test(r)));
}

/** Attendance taken in the last 180 days, as a percentage per student. Late still counts as present. */
async function attendanceByStudent(schoolId, studentIds) {
  if (!studentIds.length) return {};
  const since = new Date();
  since.setDate(since.getDate() - 180);
  const { data, error } = await requireDb().from('attendance_records')
    .select('student_id, attendance_status')
    .eq('school_id', schoolId)
    .in('student_id', studentIds)
    .gte('attendance_date', since.toISOString().slice(0, 10))
    .limit(30000);
  if (error) return {};
  const totals = {};
  for (const row of data || []) {
    const bucket = (totals[row.student_id] ||= { total: 0, attended: 0 });
    bucket.total += 1;
    if (row.attendance_status === 'present' || row.attendance_status === 'late') bucket.attended += 1;
  }
  const result = {};
  for (const [id, bucket] of Object.entries(totals)) {
    result[id] = bucket.total ? Math.round((bucket.attended / bucket.total) * 100) : null;
  }
  return result;
}

/* ── Overview: cards for every class ──────────────────────────── */
classAdminRouter.get('/overview', requirePermission('students.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const extras = await classesExtraColumns();

    let classesQuery = supabase.from('classes').select('*').eq('school_id', schoolId).order('name');
    if (req.query.q) classesQuery = classesQuery.ilike('name', `%${sanitizeSearch(req.query.q)}%`);
    const { data: classes, error } = await classesQuery;
    if (error) throw new ApiError(500, error.message);

    const classIds = (classes || []).map((c) => c.id);
    const [sections, students, teachers, homerooms] = await Promise.all([
      sectionsForClasses(schoolId, classIds),
      supabase.from('students').select('id, class_id, section_id').eq('school_id', schoolId).eq('status', 'active'),
      teacherDirectory(schoolId),
      homeroomTeachers(schoolId, classIds),
    ]);
    if (students.error) throw new ApiError(500, students.error.message);

    const teacherById = new Map(teachers.map((t) => [t.id, t]));
    const sectionsByClass = new Map();
    for (const s of sections) {
      if (!sectionsByClass.has(s.class_id)) sectionsByClass.set(s.class_id, []);
      sectionsByClass.get(s.class_id).push(s);
    }
    const countByClass = new Map();
    let unassigned = 0;
    for (const student of students.data || []) {
      if (!student.class_id) { unassigned += 1; continue; }
      countByClass.set(student.class_id, (countByClass.get(student.class_id) || 0) + 1);
    }

    const rows = (classes || []).map((cls) => {
      const teacher = extras && cls.teacher_id ? teacherById.get(cls.teacher_id) : null;
      const homeroom = homerooms.get(cls.id);
      return {
        ...cls,
        room: extras ? cls.room || null : null,
        teacher_id: teacher?.id || homeroom?.id || null,
        teacher_name: teacher?.full_name || homeroom?.name || null,
        student_count: countByClass.get(cls.id) || 0,
        sections: sectionsByClass.get(cls.id) || [],
      };
    });

    res.json({
      data: {
        classes: rows,
        teachers,
        capabilities: { room: Boolean(extras), teacher: true },
        stats: {
          classes: rows.length,
          sections: sections.length,
          students: students.data?.length || 0,
          unassigned,
          seats: rows.reduce((sum, c) => sum + (Number(c.capacity) || 0), 0),
        },
      },
    });
  } catch (e) { next(e); }
});

/* ── Create a class (with sections in one pass) ───────────────── */
classAdminRouter.post('/', requirePermission('students.create'), async (req, res, next) => {
  try {
    const ent = await checkEntitlement(req.auth, 'classes.subjects');
    if (!ent.ok) throw new ApiError(ent.status, ent.error);

    const body = classSchema.parse(req.body || {});
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const extras = await classesExtraColumns();
    const teacher = await assertTeacher(schoolId, body.teacher_id);

    const payload = dropUnsupported({
      school_id: schoolId,
      name: body.name,
      level: body.level ?? null,
      capacity: body.capacity ?? null,
      room: body.room ?? null,
      teacher_id: teacher?.id || null,
    }, extras);

    const { data: cls, error } = await supabase.from('classes').insert(payload).select().single();
    if (error) {
      throw new ApiError(error.code === '23505' ? 409 : 500,
        error.code === '23505' ? `A class named "${body.name}" already exists.` : error.message);
    }

    if (!extras && teacher) {
      const { error: homeroomError } = await supabase.from('teacher_assignments').insert({
        school_id: schoolId, school_user_id: teacher.id, class_id: cls.id, is_homeroom: true,
      });
      if (homeroomError) req.log?.warn({ err: homeroomError }, 'homeroom teacher was not saved');
    }

    const names = [...new Set(sectionNames(body.sections))];
    if (names.length) {
      const { error: sectionError } = await supabase.from('sections').insert(
        names.map((sectionName) => ({ school_id: schoolId, class_id: cls.id, name: sectionName })),
      );
      if (sectionError && sectionError.code !== '23505') throw new ApiError(500, sectionError.message);
    }

    const createdSections = await sectionsForClasses(schoolId, [cls.id]);
    await audit(req, {
      module: 'classes', action: 'created', recordId: cls.id,
      summary: `${cls.name} created${names.length ? ` with sections ${names.join(', ')}` : ''}`,
    });

    res.status(201).json({
      data: {
        ...cls,
        room: extras ? cls.room || null : null,
        teacher_id: teacher?.id || null,
        teacher_name: teacher?.full_name || null,
        sections: createdSections,
        student_count: 0,
      },
    });
  } catch (e) { next(e); }
});

/* ── Update a class and reconcile its sections ────────────────── */
classAdminRouter.patch('/:id', requirePermission('students.edit'), async (req, res, next) => {
  try {
    const body = classSchema.partial().parse(req.body || {});
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const cls = await loadClass(schoolId, req.params.id);
    const extras = await classesExtraColumns();

    const payload = {};
    if (body.name !== undefined) payload.name = body.name;
    if (body.level !== undefined) payload.level = body.level;
    if (body.capacity !== undefined) payload.capacity = body.capacity;
    if (extras && body.room !== undefined) payload.room = body.room;
    let nextHomeroom;
    if (body.teacher_id !== undefined) {
      const teacher = await assertTeacher(schoolId, body.teacher_id);
      if (extras) payload.teacher_id = teacher?.id || null;
      else nextHomeroom = teacher;
    }

    if (!extras && body.teacher_id !== undefined) {
      const { error: clearError } = await supabase.from('teacher_assignments')
        .delete().eq('school_id', schoolId).eq('class_id', cls.id).eq('is_homeroom', true);
      if (clearError) throw new ApiError(500, clearError.message);
      if (nextHomeroom) {
        const { error: homeroomError } = await supabase.from('teacher_assignments').insert({
          school_id: schoolId, school_user_id: nextHomeroom.id, class_id: cls.id, is_homeroom: true,
        });
        if (homeroomError) throw new ApiError(500, homeroomError.message);
      }
    }

    if (Object.keys(payload).length) {
      const { error } = await supabase.from('classes').update(payload)
        .eq('id', cls.id).eq('school_id', schoolId);
      if (error) {
        throw new ApiError(error.code === '23505' ? 409 : 500,
          error.code === '23505' ? `A class named "${body.name}" already exists.` : error.message);
      }
    }

    let removed = 0;
    if (Array.isArray(body.sections)) {
      const existing = await sectionsForClasses(schoolId, [cls.id]);
      const keepIds = new Set(body.sections.filter((s) => s.id).map((s) => s.id));
      const drop = existing.filter((s) => !keepIds.has(s.id));
      const afterDrop = existing.filter((s) => keepIds.has(s.id));

      for (const section of body.sections) {
        if (section.id) {
          const current = afterDrop.find((s) => s.id === section.id);
          if (!current) continue;
          if (current.name !== section.name || (section.capacity ?? null) !== (current.capacity ?? null)) {
            const { error } = await supabase.from('sections')
              .update({ name: section.name, capacity: section.capacity ?? null })
              .eq('id', section.id).eq('school_id', schoolId);
            if (error) throw new ApiError(error.code === '23505' ? 409 : 500,
              error.code === '23505' ? `Section "${section.name}" already exists in this class.` : error.message);
          }
        } else if (!afterDrop.some((s) => s.name.toLowerCase() === section.name.toLowerCase())) {
          const { error } = await supabase.from('sections').insert({
            school_id: schoolId, class_id: cls.id, name: section.name, capacity: section.capacity ?? null,
          });
          if (error) throw new ApiError(error.code === '23505' ? 409 : 500,
            error.code === '23505' ? `Section "${section.name}" already exists in this class.` : error.message);
          afterDrop.push({ name: section.name, capacity: section.capacity ?? null });
        }
      }

      for (const section of drop) {
        const { count } = await supabase.from('students')
          .select('*', { count: 'exact', head: true })
          .eq('school_id', schoolId).eq('section_id', section.id);
        if (count) {
          throw new ApiError(409, `Section "${section.name}" still has ${count} student${count === 1 ? '' : 's'}. Move them to another section first.`);
        }
        const { error } = await supabase.from('sections').delete()
          .eq('id', section.id).eq('school_id', schoolId);
        if (error) throw new ApiError(500, error.message);
        await recordDeletion(req, { table: 'sections', row: section, module: 'classes', label: `${cls.name} · ${section.name}` });
        removed += 1;
      }
    }

    const updated = await loadClass(schoolId, cls.id);
    await audit(req, {
      module: 'classes', action: 'updated', recordId: cls.id,
      summary: `${updated.name} updated${removed ? ` (${removed} section${removed === 1 ? '' : 's'} removed)` : ''}`,
    });
    res.json({ data: { ...updated, sections: await sectionsForClasses(schoolId, [cls.id]) } });
  } catch (e) { next(e); }
});

/* ── Delete a class only when it is empty ─────────────────────── */
classAdminRouter.delete('/:id', requirePermission('students.delete'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const cls = await loadClass(schoolId, req.params.id);

    const { count } = await supabase.from('students')
      .select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('class_id', cls.id);
    if (count) {
      throw new ApiError(409, `${cls.name} still has ${count} student${count === 1 ? '' : 's'}. Move them to another class before deleting.`);
    }

    const { data: sections } = await supabase.from('sections').select('*')
      .eq('school_id', schoolId).eq('class_id', cls.id);
    const { error } = await supabase.from('classes').delete().eq('id', cls.id).eq('school_id', schoolId);
    if (error) {
      throw new ApiError(error.code === '23503' ? 409 : 500,
        error.code === '23503'
          ? `${cls.name} is referenced by attendance, timetable or exam records. Rename it instead of deleting.`
          : error.message);
    }
    await recordDeletion(req, {
      table: 'classes', row: cls, module: 'classes', label: cls.name,
      related: sections?.length ? [{ table: 'sections', rows: sections }] : [],
    });
    res.json({ data: { deleted: true } });
  } catch (e) { next(e); }
});

/* ── Detail: class, sections, enrolled students, unassigned pool ─ */
classAdminRouter.get('/:id', requirePermission('students.view'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const cls = await loadClass(schoolId, req.params.id);
    const extras = await classesExtraColumns();

    const [sections, enrolled, unassigned] = await Promise.all([
      sectionsForClasses(schoolId, [cls.id]),
      supabase.from('students')
        .select('id, admission_number, full_name, first_name, middle_name, last_name, gender, photo_url, status, section_id, phone, date_of_birth')
        .eq('school_id', schoolId).eq('class_id', cls.id).order('full_name'),
      supabase.from('students')
        .select('id, admission_number, full_name, first_name, middle_name, last_name, gender, photo_url, status')
        .eq('school_id', schoolId).eq('status', 'active').is('class_id', null).order('full_name').limit(500),
    ]);
    if (enrolled.error) throw new ApiError(500, enrolled.error.message);
    if (unassigned.error) throw new ApiError(500, unassigned.error.message);

    const attendance = await attendanceByStudent(schoolId, (enrolled.data || []).map((s) => s.id));
    const homerooms = await homeroomTeachers(schoolId, [cls.id]);
    const columnTeacher = extras && cls.teacher_id ? await assertTeacher(schoolId, cls.teacher_id) : null;
    const homeroom = homerooms.get(cls.id);

    res.json({
      data: {
        class: {
          ...cls,
          room: extras ? cls.room || null : null,
          teacher_id: columnTeacher?.id || homeroom?.id || null,
          teacher_name: columnTeacher?.full_name || homeroom?.name || null,
        },
        capabilities: { room: Boolean(extras), teacher: true },
        sections,
        students: (enrolled.data || []).map((student) => ({
          ...student, attendance_percent: attendance[student.id] ?? null,
        })),
        unassigned: unassigned.data || [],
      },
    });
  } catch (e) { next(e); }
});

/* ── Assign unassigned students into this class ───────────────── */
classAdminRouter.post('/:id/students', requirePermission('students.assign', 'students.edit'), async (req, res, next) => {
  try {
    const body = z.object({
      student_ids: z.array(z.string().uuid()).min(1).max(200),
      section_id: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
    }).parse(req.body || {});

    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const cls = await loadClass(schoolId, req.params.id);

    let section = null;
    if (body.section_id) {
      const { data } = await supabase.from('sections').select('id, class_id, name')
        .eq('id', body.section_id).eq('school_id', schoolId).maybeSingle();
      if (!data || data.class_id !== cls.id) throw new ApiError(400, 'That section does not belong to this class.');
      section = data;
    }

    const ids = [...new Set(body.student_ids)];
    const { data: found, error } = await supabase.from('students')
      .select('id, class_id').eq('school_id', schoolId).in('id', ids);
    if (error) throw new ApiError(500, error.message);
    if ((found || []).length !== ids.length) throw new ApiError(400, 'Some students are not part of this school.');

    const { error: updateError } = await supabase.from('students')
      .update({ class_id: cls.id, section_id: section?.id || null })
      .eq('school_id', schoolId).in('id', ids);
    if (updateError) throw new ApiError(500, updateError.message);

    await audit(req, {
      module: 'classes', action: 'students_assigned', recordId: cls.id,
      summary: `${ids.length} student${ids.length === 1 ? '' : 's'} assigned to ${cls.name}${section ? ` / Section ${section.name}` : ''}`,
      metadata: { students: ids.length, section_id: section?.id || null },
    });

    res.json({ data: { assigned: ids.length, class_id: cls.id, section_id: section?.id || null } });
  } catch (e) { next(e); }
});

/* ── Remove one student from this class ───────────────────────── */
classAdminRouter.delete('/:id/students/:studentId', requirePermission('students.assign', 'students.edit'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const cls = await loadClass(schoolId, req.params.id);

    const { data, error } = await supabase.from('students')
      .update({ class_id: null, section_id: null })
      .eq('id', req.params.studentId).eq('class_id', cls.id).eq('school_id', schoolId)
      .select('id, full_name, admission_number').maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, 'That student is not in this class.');

    await audit(req, {
      module: 'classes', action: 'student_removed', recordId: cls.id,
      summary: `${data.full_name} (${data.admission_number}) removed from ${cls.name}`,
    });
    res.json({ data: { removed: true, student: data } });
  } catch (e) { next(e); }
});

/* ── Sections ─────────────────────────────────────────────────── */
classAdminRouter.post('/:id/sections', requirePermission('students.edit'), async (req, res, next) => {
  try {
    const body = z.object({ name: name(32), capacity: optionalCount }).parse(req.body || {});
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const cls = await loadClass(schoolId, req.params.id);

    const { data, error } = await supabase.from('sections').insert({
      school_id: schoolId, class_id: cls.id, name: body.name, capacity: body.capacity ?? null,
    }).select().single();
    if (error) {
      throw new ApiError(error.code === '23505' ? 409 : 500,
        error.code === '23505' ? `Section "${body.name}" already exists in ${cls.name}.` : error.message);
    }
    await audit(req, { module: 'classes', action: 'section_created', recordId: cls.id, summary: `Section ${body.name} added to ${cls.name}` });
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

classAdminRouter.delete('/:id/sections/:sectionId', requirePermission('students.edit'), async (req, res, next) => {
  try {
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const cls = await loadClass(schoolId, req.params.id);

    const { data: section } = await supabase.from('sections').select('id, name')
      .eq('id', req.params.sectionId).eq('class_id', cls.id).eq('school_id', schoolId).maybeSingle();
    if (!section) throw new ApiError(404, 'Section not found');

    const { count } = await supabase.from('students')
      .select('*', { count: 'exact', head: true })
      .eq('school_id', schoolId).eq('section_id', section.id);
    if (count) throw new ApiError(409, `Section ${section.name} still has ${count} student${count === 1 ? '' : 's'}. Move them first.`);

    const { error } = await supabase.from('sections').delete()
      .eq('id', section.id).eq('school_id', schoolId);
    if (error) throw new ApiError(500, error.message);

    await recordDeletion(req, { table: 'sections', row: section, module: 'classes', label: `${cls.name} · ${section.name}` });
    await audit(req, { module: 'classes', action: 'section_deleted', recordId: cls.id, summary: `Section ${section.name} removed from ${cls.name}` });
    res.json({ data: { deleted: true } });
  } catch (e) { next(e); }
});
