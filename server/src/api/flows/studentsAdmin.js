import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { requireDb } from '../../config/supabase.js';
import { requirePermission } from '../../middleware/rbac.js';
import { ApiError } from '../../middleware/error.js';
import { audit } from '../../services/audit.js';
import { checkEntitlement } from '../../services/entitlement.js';
import { admissionNumberSequence, formatAdmissionNumber } from '../../services/scopes.js';
import { provisionStudentAccounts } from '../../services/studentAccounts.js';
import { studentsProfileColumns } from '../../services/schemaSupport.js';
import { IMAGE_MIME, sniffImage } from '../../core/images.js';

export const studentAdminRouter = Router();

const BRAND = 'FF6027FF';
const DARK = 'FF130C2D';
const SOFT = 'FFEEF0F4';
const MUTED = 'FF6B7280';
const BORDER = 'FFD9DCE3';

const COLUMNS = [
  { key: 'first_name', header: 'First name *', width: 20 },
  { key: 'middle_name', header: 'Middle name', width: 18 },
  { key: 'last_name', header: 'Last name', width: 18 },
  { key: 'gender', header: 'Gender', width: 12 },
  { key: 'date_of_birth', header: 'Date of birth', width: 16 },
  { key: 'admission_date', header: 'Admission date', width: 16 },
  { key: 'class_name', header: 'Class', width: 16 },
  { key: 'section_name', header: 'Section', width: 14 },
  { key: 'previous_school', header: 'Previous school', width: 22 },
  { key: 'address', header: 'Address', width: 24 },
  { key: 'emergency_contact', header: 'Emergency contact', width: 20 },
  { key: 'admission_number', header: 'Admission number', width: 20 },
];

const HEADER_ALIASES = {
  first_name: ['firstname', 'first'],
  middle_name: ['middlename', 'middle'],
  last_name: ['lastname', 'surname', 'last'],
  gender: ['gender', 'sex'],
  date_of_birth: ['dateofbirth', 'birthdate', 'dob'],
  admission_date: ['admissiondate', 'enrolmentdate', 'enrollmentdate'],
  class_name: ['class', 'classname', 'grade'],
  section_name: ['section', 'sectionname'],
  previous_school: ['previousschool', 'lastschool'],
  address: ['address', 'homeaddress'],
  emergency_contact: ['emergencycontact', 'guardianphone', 'contact'],
  admission_number: ['admissionnumber', 'admissionno', 'studentid', 'id'],
};

const normalizeHeader = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function pickColumnMap(headerRow) {
  const map = {};
  headerRow.eachCell((cell, colNumber) => {
    const key = normalizeHeader(cellText(cell.value));
    if (!key) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field]) continue;
      if (aliases.includes(key)) map[field] = colNumber;
    }
  });
  return map;
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (value.hyperlink) return String(value.text || value.hyperlink);
    if (value.error) return '';
  }
  return String(value);
}

function toDateString(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'invalid' : value.toISOString().slice(0, 10);
  const text = String(value).trim();
  if (!text) return null;
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // Schools write day/month/year; the template shows YYYY-MM-DD so this is a tolerance, not the default.
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? 'invalid' : parsed.toISOString().slice(0, 10);
}

function normalizeGender(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (['male', 'm', 'boy', 'wiil'].includes(text)) return 'male';
  if (['female', 'f', 'girl', 'gabar'].includes(text)) return 'female';
  return 'invalid';
}

function rtfEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/[{}]/g, (m) => `\\${m}`)
    .replace(/\r?\n/g, '\\line ')
    .replace(/[^\x00-\x7F]/g, (c) => `\\u${c.charCodeAt(0)}?`);
}

function buildRegistrationForm({ schoolName, yearName, sampleId, prefix }) {
  const esc = rtfEscape;
  const blank = '\\ul\\u160?\\u160?\\u160?\\u160?\\u160?\\u160?\\u160?\\u160?\\u160?\\u160?\\u160?\\u160?\\ul0';
  const row = (label, hint = '') => (
    '\\trowd\\trgaph60\\trleft0\\trpaddl110\\trpaddr110\\trpaddb90\\trpaddt90\\clcbpat4\\cellx4700\\clcbpat0\\cellx10450'
    + `\\intbl\\b\\cf2 ${esc(label)}\\b0\\cell\\intbl\\i\\cf3 ${hint || blank}\\i0\\cf2\\cell\\row\n`
  );
  const section = (title) => (
    `\\pard\\sb240\\sa120\\b\\fs26\\cf1 ${esc(title)}\\b0\\fs22\\cf2\\par\n`
  );

  return `{\\rtf1\\ansi\\ansicpg1252\\deff0
{\\fonttbl{\\f0 Calibri;}{\\f1 Cambria;}}
{\\colortbl ;\\red96\\green39\\blue255;\\red19\\green12\\blue45;\\red110\\green115\\blue127;\\red238\\green240\\blue244;}
\\paperw11907\\paperh16840\\margl1134\\margr1134\\margt1020\\margb1020
\\viewkind4\\uc1
\\pard\\qc\\f1\\fs46\\b\\cf2 ${esc(schoolName)}\\b0\\par
\\pard\\qc\\fs28\\b\\cf1 STUDENT REGISTRATION FORM\\b0\\par
\\pard\\qc\\fs20\\cf3 Academic year: ${esc(yearName || '—')}   |   Student ID prefix: ${esc(prefix)}   |   Example ID: ${esc(sampleId)}\\par
\\pard\\sa60\\par
${section('1. Student details')}
${row('Admission number', 'auto-generated by the system')}
${row('First name')}
${row('Middle name')}
${row('Last name')}
${row('Gender', 'Male / Female')}
${row('Date of birth', 'YYYY-MM-DD')}
${row('Class')}
${row('Section')}
${row('Admission date', 'YYYY-MM-DD')}
${row('Previous school')}
${row('Address')}
${row('Emergency contact', 'name and phone number')}
${section('2. Guardian details')}
${row('Full name')}
${row('Relationship', 'parent / guardian')}
${row('Phone')}
${row('Email')}
${row('Occupation')}
\\pard\\sb240\\fs18\\cf3
Student IDs are generated automatically as prefix + academic year + sequence: ${esc(sampleId)} (${esc(prefix)} + ${esc(String(sampleId).slice(prefix.length))}). Fill this form or use the Excel template to import a whole class at once.\\par
\\pard\\qc\\fs18\\cf3 E-MADAARIS \\'b7 JSOM TECH\\par
}`;
}

function buildExcelTemplate({ schoolName, yearName, sampleId, prefix }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'E-MADAARIS';
  wb.created = new Date();

  const ws = wb.addWorksheet('Students', {
    views: [{ state: 'frozen', ySplit: 4 }],
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

  ws.mergeCells(1, 1, 1, COLUMNS.length);
  const title = ws.getCell(1, 1);
  title.value = `${schoolName} — Student import template`;
  title.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 34;

  ws.mergeCells(2, 1, 2, COLUMNS.length);
  const subtitle = ws.getCell(2, 1);
  subtitle.value = `One student per row. Leave Admission number blank to generate it automatically (example: ${sampleId}). Academic year: ${yearName || 'not set'}.`;
  subtitle.font = { size: 10, color: { argb: DARK } };
  subtitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
  subtitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 24;
  ws.getRow(3).height = 6;

  const headerRow = ws.getRow(4);
  COLUMNS.forEach((c, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: { style: 'thin', color: { argb: BORDER } }, left: { style: 'thin', color: { argb: BORDER } }, bottom: { style: 'thin', color: { argb: BORDER } }, right: { style: 'thin', color: { argb: BORDER } } };
    ws.getColumn(index + 1).numFmt = c.key.startsWith('date_') ? 'yyyy-mm-dd' : 'General';
  });
  headerRow.height = 26;

  // Borders on the blank entry rows keep the sheet looking like a form once filled.
  for (let r = 5; r <= 304; r += 1) {
    for (let c = 1; c <= COLUMNS.length; c += 1) {
      ws.getCell(r, c).border = { bottom: { style: 'hair', color: { argb: BORDER } } };
    }
  }

  ws.dataValidations.add('D5:D1004', {
    type: 'list', allowBlank: true, formulae: ['"male,female"'],
    showErrorMessage: true, errorTitle: 'Gender', error: 'Enter male or female.',
  });
  ws.getCell('L5').note = `Leave blank to use the school sequence: ${sampleId}, and the next number after it.`;
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: COLUMNS.length } };

  const example = wb.addWorksheet('Example');
  example.columns = COLUMNS.map((c) => ({ width: c.width }));
  example.mergeCells(1, 1, 1, COLUMNS.length);
  const exTitle = example.getCell(1, 1);
  exTitle.value = 'Example rows — do not import this sheet';
  exTitle.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  exTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  exTitle.alignment = { vertical: 'middle', indent: 1 };
  example.getRow(1).height = 28;
  const exHeader = example.getRow(3);
  COLUMNS.forEach((c, index) => {
    const cell = exHeader.getCell(index + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
  });
  const samples = [
    ['Amina', 'Hassan', 'Ali', 'female', '2015-04-12', '2026-02-01', 'Grade 1', 'A', '', 'Mogadishu', '+252 61 000 0000', ''],
    ['Yusuf', 'Abdi', 'Nur', 'male', '2014-11-03', '2026-02-01', 'Grade 2', 'B', '', 'Mogadishu', '+252 61 111 1111', ''],
  ];
  samples.forEach((values, rowIndex) => {
    const row = example.getRow(4 + rowIndex);
    values.forEach((value, colIndex) => {
      row.getCell(colIndex + 1).value = value;
    });
    row.font = { italic: true, color: { argb: MUTED } };
  });

  const guide = wb.addWorksheet('Instructions');
  guide.columns = [{ width: 4 }, { width: 110 }];
  const guideTitle = guide.getCell('B1');
  guideTitle.value = 'How to import your students';
  guideTitle.font = { size: 16, bold: true, color: { argb: BRAND } };
  guide.getRow(1).height = 28;

  const lines = [
    '',
    '1. Open the "Students" sheet and keep the header row in place.',
    '2. Enter one student per row. First name is the only required field.',
    '3. Dates must be YYYY-MM-DD (the date columns are formatted for you).',
    '4. Gender accepts male or female.',
    '5. Class and Section must match names that already exist in the school (see Classes / Sections modules).',
    '6. Leave Admission number blank to let the system generate the next ID.',
    `   Format: school prefix "${prefix}" + two-digit academic year + four-digit sequence, e.g. ${sampleId}.`,
    `   Every academic year starts a fresh sequence (${prefix}YY0001), so IDs from different years never clash.`,
    '7. Save the file, then upload it from Admissions → Import students.',
    '8. Rows that fail validation are listed with their row number and nothing is inserted for them; valid rows are imported.',
    '',
    'Class names in this school: use the exact names from the Classes module. Unknown names are rejected.',
  ];
  lines.forEach((line, index) => {
    const cell = guide.getCell(index + 2, 2);
    cell.value = line;
    cell.font = index === 0 ? { size: 11, italic: true, color: { argb: MUTED } } : { size: 11, color: { argb: DARK } };
    cell.alignment = { wrapText: true, vertical: 'top' };
  });

  return wb.xlsx.writeBuffer();
}

async function loadSchoolAndYear(req) {
  const supabase = requireDb();
  const { data: school } = await supabase.from('schools').select('school_name')
    .eq('id', req.auth.schoolId).maybeSingle();
  const seq = await admissionNumberSequence(req.auth.schoolId, req.query.academic_year_id || null, {
    schoolName: req.auth.school?.school_name || school?.school_name,
  });
  return { schoolName: school?.school_name || req.auth.school?.school_name || 'School', seq };
}

/* ── Academic years for the admissions desk ───────────────────── */
// Registrars can enrol students without timetable.view, so the generic /academic-years
// list is not readable for them; this projection is scoped to admissions work.
studentAdminRouter.get('/academic-years', requirePermission('students.create', 'students.edit'), async (req, res, next) => {
  try {
    const { data, error } = await requireDb().from('academic_years')
      .select('id, name, start_date, end_date, is_current')
      .eq('school_id', req.auth.schoolId)
      .order('name', { ascending: false });
    if (error) throw new ApiError(500, error.message);
    res.json({ data: data || [], total: (data || []).length });
  } catch (e) { next(e); }
});

/* ── Next student ID preview ──────────────────────────────────── */
studentAdminRouter.get('/next-admission-number', requirePermission('students.create'), async (req, res, next) => {
  try {
    const { seq } = await loadSchoolAndYear(req);
    res.json({
      data: {
        admission_number: formatAdmissionNumber(seq.head, seq.nextSequence),
        prefix: seq.prefix,
        year_code: seq.yearCode,
        academic_year_id: seq.academicYear?.id || null,
        academic_year: seq.academicYear?.name || null,
      },
    });
  } catch (e) { next(e); }
});

/* ── Schema capabilities (HEMIS/phone/notes need migration 0016) ── */
studentAdminRouter.get('/schema', requirePermission('students.view', 'students.create', 'students.edit'), async (req, res, next) => {
  try {
    res.json({ data: { profile_fields: await studentsProfileColumns() } });
  } catch (e) { next(e); }
});

/* ── Downloadable templates ───────────────────────────────────── */
studentAdminRouter.get('/import-template', requirePermission('students.create'), async (req, res, next) => {
  try {
    const { schoolName, seq } = await loadSchoolAndYear(req);
    const sampleId = formatAdmissionNumber(seq.head, 1);
    const yearName = seq.academicYear?.name || '';
    const format = String(req.query.format || 'xlsx').toLowerCase();

    if (format === 'doc' || format === 'word') {
      const rtf = buildRegistrationForm({ schoolName, yearName, sampleId, prefix: seq.prefix });
      res.setHeader('Content-Type', 'application/msword');
      res.setHeader('Content-Disposition', `attachment; filename="${seq.prefix}-student-registration-form.doc"`);
      return res.send(rtf);
    }

    const buffer = await buildExcelTemplate({ schoolName, yearName, sampleId, prefix: seq.prefix });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${seq.prefix}-student-import-template.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (e) { next(e); }
});

/* ── Bulk import ──────────────────────────────────────────────── */
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xlsm|csv)$/i.test(file.originalname)
      || ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'].includes(file.mimetype);
    cb(ok ? null : new ApiError(400, 'Attach the .xlsx template (or a .csv exported from it).'), ok);
  },
});

studentAdminRouter.post('/import', requirePermission('students.create'), importUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, 'Attach the completed Excel template.');

    const ent = await checkEntitlement(req.auth, 'students.management');
    if (!ent.ok) throw new ApiError(ent.status, ent.error);

    const supabase = requireDb();
    const schoolId = req.auth.schoolId;
    const requestedYearId = req.body?.academic_year_id || null;
    const seq = await admissionNumberSequence(schoolId, requestedYearId, {
      schoolName: req.auth.school?.school_name,
    });
    if (requestedYearId && !seq.academicYear) throw new ApiError(400, 'That academic year is not part of this school.');

    const wb = new ExcelJS.Workbook();
    try {
      if (/\.csv$/i.test(req.file.originalname)) await wb.csv.read(Readable.from([req.file.buffer]));
      else await wb.xlsx.load(req.file.buffer);
    } catch {
      throw new ApiError(400, 'That file could not be read as a spreadsheet. Download the template and fill it in.');
    }

    const sheet = wb.getWorksheet('Students') || wb.worksheets[0];
    if (!sheet) throw new ApiError(400, 'The workbook has no sheet to read.');

    let headerRowNumber = 0;
    let columnMap = {};
    for (let r = 1; r <= Math.min(10, sheet.rowCount); r += 1) {
      const candidate = pickColumnMap(sheet.getRow(r));
      if (candidate.first_name) { headerRowNumber = r; columnMap = candidate; break; }
    }
    if (!headerRowNumber) throw new ApiError(400, 'Could not find a "First name" column. Use the provided template.');

    const [{ data: classes }, { data: sections }] = await Promise.all([
      supabase.from('classes').select('id, name').eq('school_id', schoolId),
      supabase.from('sections').select('id, class_id, name').eq('school_id', schoolId),
    ]);
    const classByName = new Map((classes || []).map((c) => [String(c.name).trim().toLowerCase(), c]));
    const sectionByName = new Map();
    for (const s of sections || []) {
      sectionByName.set(`${s.class_id}:${String(s.name).trim().toLowerCase()}`, s);
    }

    const errors = [];
    const valid = [];
    const seenNumbers = new Set();
    const maxRow = Math.min(sheet.rowCount, headerRowNumber + 1000);
    for (let r = headerRowNumber + 1; r <= maxRow; r += 1) {
      const row = sheet.getRow(r);
      const value = (field) => (columnMap[field] ? cellText(row.getCell(columnMap[field]).value).trim() : '');
      const firstName = value('first_name');
      if (!firstName && !value('last_name') && !value('admission_number')) continue; // blank row

      const fail = (message) => { if (errors.length < 100) errors.push({ row: r, message }); };
      if (firstName.length < 2) { fail('First name is required (at least 2 letters).'); continue; }
      if (firstName.length > 96) { fail('First name is longer than 96 characters.'); continue; }

      const gender = normalizeGender(value('gender'));
      if (gender === 'invalid') { fail('Gender must be male or female.'); continue; }

      const dateOfBirth = toDateString(value('date_of_birth'));
      if (dateOfBirth === 'invalid') { fail('Date of birth is not a valid date.'); continue; }
      const admissionDate = toDateString(value('admission_date'));
      if (admissionDate === 'invalid') { fail('Admission date is not a valid date.'); continue; }

      let classId = null;
      const className = value('class_name');
      if (className) {
        const found = classByName.get(className.toLowerCase());
        if (!found) { fail(`Class "${className}" does not exist in this school.`); continue; }
        classId = found.id;
      }
      let sectionId = null;
      const sectionName = value('section_name');
      if (sectionName) {
        if (!classId) { fail('A section needs a class on the same row.'); continue; }
        const found = sectionByName.get(`${classId}:${sectionName.toLowerCase()}`);
        if (!found) { fail(`Section "${sectionName}" does not exist in class "${className}".`); continue; }
        sectionId = found.id;
      }

      const providedNumber = value('admission_number').toUpperCase();
      if (providedNumber && !/^[A-Z0-9]{3,32}$/.test(providedNumber)) {
        fail('Admission number may only contain letters and digits (3–32 characters).');
        continue;
      }
      if (providedNumber && seenNumbers.has(providedNumber)) {
        fail(`Admission number ${providedNumber} appears more than once in the file.`);
        continue;
      }
      if (providedNumber) seenNumbers.add(providedNumber);

      valid.push({
        row: r,
        school_id: schoolId,
        admission_number: providedNumber || null,
        first_name: firstName,
        middle_name: value('middle_name') || null,
        last_name: value('last_name') || null,
        gender,
        date_of_birth: dateOfBirth,
        admission_date: admissionDate,
        academic_year_id: seq.academicYear?.id || null,
        class_id: classId,
        section_id: sectionId,
        previous_school: value('previous_school') || null,
        address: value('address') || null,
        emergency_contact: value('emergency_contact') || null,
        status: 'active',
      });
    }

    if (!valid.length) {
      return res.status(422).json({ data: { created: 0, failed: errors.length, total: errors.length, errors } });
    }

    const plan = req.auth.subscription?.plan;
    if (plan?.max_students) {
      const { count } = await supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', schoolId);
      if ((count || 0) + valid.length > plan.max_students) {
        throw new ApiError(402, `Your plan allows ${plan.max_students} students and ${count || 0} already exist. This file would add ${valid.length}. Upgrade the plan or split the file.`);
      }
    }

    // Existing explicit numbers must not collide with what the school already has.
    const explicit = valid.map((v) => v.admission_number).filter(Boolean);
    if (explicit.length) {
      const { data: taken } = await supabase.from('students').select('admission_number')
        .eq('school_id', schoolId).in('admission_number', explicit);
      const takenSet = new Set((taken || []).map((t) => t.admission_number));
      for (let i = valid.length - 1; i >= 0; i -= 1) {
        if (valid[i].admission_number && takenSet.has(valid[i].admission_number)) {
          if (errors.length < 100) errors.push({ row: valid[i].row, message: `Admission number ${valid[i].admission_number} already belongs to another student.` });
          valid.splice(i, 1);
        }
      }
    }

    let counter = seq.nextSequence;
    const used = new Set([...seenNumbers]);
    const allocate = () => {
      let candidate;
      do { candidate = formatAdmissionNumber(seq.head, counter); counter += 1; } while (used.has(candidate));
      used.add(candidate);
      return candidate;
    };
    for (const row of valid) {
      row.admission_number = row.admission_number || allocate();
    }

    const created = [];
    for (let i = 0; i < valid.length; i += 20) {
      const chunk = valid.slice(i, i + 20).map(({ row, ...payload }) => payload);
      const { data, error } = await supabase.from('students').insert(chunk).select('id, admission_number, first_name, middle_name, last_name, user_id');
      if (!error) { created.push(...(data || [])); continue; }
      // Fall back to row-by-row so one bad row cannot block the whole batch.
      for (let j = 0; j < chunk.length; j += 1) {
        const { data: one, error: rowError } = await supabase.from('students').insert(chunk[j])
          .select('id, admission_number, first_name, middle_name, last_name, user_id').single();
        if (rowError) {
          const message = rowError.code === '23505' ? `Admission number ${chunk[j].admission_number} already exists.` : rowError.message;
          if (errors.length < 100) errors.push({ row: valid[i + j]?.row || 0, message });
        } else {
          created.push(one);
        }
      }
    }

    await audit(req, {
      module: 'students', action: 'imported',
      summary: `${created.length} students imported for ${seq.academicYear?.name || 'the current academic year'} (${created.map((c) => c.admission_number).slice(0, 5).join(', ')}${created.length > 5 ? '…' : ''})`,
      metadata: { created: created.length, rejected: errors.length },
    });

    // Logins are provisioned after the response so a large workbook cannot hit the request timeout.
    // The admissions page exposes a retry for anything the background pass misses.
    void provisionStudentAccounts(schoolId, created, { concurrency: 3 }).then((result) => {
      if (result.failed.length) {
        req.log?.warn({ failures: result.failed.slice(0, 10), total: result.failed.length }, 'some student logins were not provisioned');
      }
    }).catch((error) => req.log?.warn({ err: error }, 'student login provisioning crashed'));

    res.status(created.length ? 201 : 422).json({
      data: {
        created: created.length,
        failed: errors.length,
        total: created.length + errors.length,
        admission_numbers: created.map((c) => c.admission_number),
        errors,
        academic_year: seq.academicYear?.name || null,
      },
    });
  } catch (e) { next(e); }
});

/* ── Student logins for existing admissions ───────────────────── */
// Student ID is both the login and the first password. This batch endpoint links any student
// that never got an account (legacy rows, imports interrupted by a restart).
studentAdminRouter.post('/provision-accounts', requirePermission('students.create', 'students.edit'), async (req, res, next) => {
  try {
    const body = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      student_ids: z.array(z.string().uuid()).max(100).optional(),
    }).parse(req.body || {});
    const supabase = requireDb();
    const schoolId = req.auth.schoolId;

    let q = supabase.from('students')
      .select('id, admission_number, first_name, middle_name, last_name, user_id')
      .eq('school_id', schoolId).is('user_id', null)
      .order('created_at').limit(body.limit);
    if (body.student_ids?.length) q = q.in('id', body.student_ids);
    const { data, error } = await q;
    if (error) throw new ApiError(500, error.message);

    const result = data?.length
      ? await provisionStudentAccounts(schoolId, data, { concurrency: 4 })
      : { created: [], skipped: [], failed: [] };

    const { count } = await supabase.from('students')
      .select('*', { count: 'exact', head: true }).eq('school_id', schoolId).is('user_id', null);

    await audit(req, {
      module: 'students', action: 'logins_provisioned',
      summary: `${result.created.length} student logins created${result.failed.length ? `, ${result.failed.length} failed` : ''}`,
      metadata: { created: result.created.length, failed: result.failed.length },
    });

    res.json({
      data: {
        created: result.created.length,
        failed: result.failed,
        remaining: count || 0,
        logins: result.created.map((c) => ({ student_id: c.studentId, student_id_number: c.loginId })),
      },
    });
  } catch (e) { next(e); }
});

/* ── Student photo upload ─────────────────────────────────────── */
const PHOTO_BUCKET = 'student-photos';
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = Boolean(PHOTO_TYPES[file.mimetype]);
    cb(ok ? null : new ApiError(400, 'Photo must be a JPG, PNG or WebP image.'), ok);
  },
});

let bucketPromise = null;
async function ensurePhotoBucket(supabase) {
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const { data: buckets, error } = await supabase.storage.listBuckets();
      if (error) throw new ApiError(502, `Storage is not reachable: ${error.message}`);
      if (!(buckets || []).some((b) => b.name === PHOTO_BUCKET)) {
        const { error: createError } = await supabase.storage.createBucket(PHOTO_BUCKET, {
          public: true, fileSizeLimit: 3 * 1024 * 1024,
        });
        if (createError && !/already exists/i.test(createError.message)) throw new ApiError(502, createError.message);
      }
    })().catch((error) => { bucketPromise = null; throw error; });
  }
  return bucketPromise;
}

studentAdminRouter.post('/photo', requirePermission('students.create', 'students.edit'), photoUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, 'Attach a photo file.');
    const ext = sniffImage(req.file.buffer);
    if (!ext) throw new ApiError(400, 'Photo must be a real JPG, PNG or WebP image.');
    const supabase = requireDb();
    await ensurePhotoBucket(supabase);
    const path = `${req.auth.schoolId}/${randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, req.file.buffer, {
      contentType: IMAGE_MIME[ext], cacheControl: '31536000', upsert: false,
    });
    if (error) throw new ApiError(502, `Photo upload failed: ${error.message}`);
    const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    res.status(201).json({ data: { url: data.publicUrl, path } });
  } catch (e) { next(e); }
});
