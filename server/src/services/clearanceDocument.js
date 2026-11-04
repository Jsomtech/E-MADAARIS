import PDFDocument from 'pdfkit';

/**
 * The student clearance document: one A4 PDF that carries everything a receiving school,
 * a parent or an examination body asks for — identity, enrolment (class, section, year),
 * parents and guardians, every examination result with its grade, attendance and the list of
 * documents held on file. The school's own logo heads the paper.
 *
 * It is rendered from a student pack, so the transfer dossier and this paper can never
 * drift apart: same numbers, same rules, one source.
 */

const PAGE = { width: 595.28, height: 841.89 };  // A4 portrait, points
const MARGIN = 48;
const CONTENT = PAGE.width - MARGIN * 2;
const BOTTOM = PAGE.height - MARGIN - 54;        // leaves room for the footer rule
const ACCENT = '#5c26ff';
const MUTED = '#5b5b66';
const LINE = '#d8d8e2';

/**
 * The built-in Helvetica carries WinAnsi only, so typographic punctuation coming from user-entered
 * names, schools or routes is folded to what the font actually has a glyph for.
 */
function safe(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2192\u2194\u21D2]/g, ' to ')
    .replace(/[\u2022\u25AA\u25AB\u25CF\u25CB\u25A0]/g, '-')
    .replace(/[\u00A0\u2007\u202F\u2009]/g, ' ')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[^\u0009\u000A\u000D\u0020-\u00FF]/g, '');
}
const dash = (v) => {
  const t = safe(v).trim();
  return t || '-';
};
const dateText = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};

/** A one-page-at-a-time cursor: pdfkit's own y is unreliable across the blocks we draw. */
function pen(doc) {
  const state = { y: MARGIN, page: 1 };
  const newPage = () => { doc.addPage(); state.page += 1; state.y = MARGIN; };
  const room = (needed) => { if (state.y + needed > BOTTOM) newPage(); };
  return {
    state,
    space: (n) => { state.y += n; },
    room,
    newPage,
    text(str, opts = {}) {
      const { size = 9.5, bold = false, color = '#15122d', x = MARGIN, width = CONTENT, gap = 3, align = 'left', lineGap = 1.4 } = opts;
      const body = safe(str);
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
      const height = doc.heightOfString(body, { width, lineGap });
      room(height + gap);
      doc.text(body, x, state.y, { width, lineGap, align });
      state.y += height + gap;
      doc.fillColor('#15122d');
    },
    /** Label on the left, value on the right — the shape every record block uses. */
    pair(label, value, opts = {}) {
      const { size = 9.5, labelWidth = 150, x = MARGIN, width = CONTENT } = opts;
      doc.font('Helvetica-Bold').fontSize(size).fillColor(MUTED);
      const lines = Math.max(1, doc.heightOfString(label, { width: labelWidth, lineGap: 1.3 }) / (size * 1.3));
      doc.font('Helvetica').fontSize(size).fillColor('#15122d');
      const valueLines = Math.max(1, doc.heightOfString(dash(value), { width: width - labelWidth - 8, lineGap: 1.3 }) / (size * 1.3));
      const height = Math.max(lines, valueLines) * size * 1.3;
      room(height + 4);
      doc.font('Helvetica-Bold').fontSize(size).fillColor(MUTED).text(label, x, state.y, { width: labelWidth, lineGap: 1.3 });
      doc.font('Helvetica').fontSize(size).fillColor('#15122d').text(dash(value), x + labelWidth + 8, state.y, { width: width - labelWidth - 8, lineGap: 1.3 });
      state.y += height + 4;
    },
    heading(str) {
      room(30);
      state.y += 6;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text(safe(str).toUpperCase(), MARGIN, state.y, { width: CONTENT, characterSpacing: 0.6 });
      state.y += 14;
      doc.moveTo(MARGIN, state.y).lineTo(MARGIN + CONTENT, state.y).lineWidth(0.7).strokeColor(LINE).stroke();
      state.y += 7;
      doc.fillColor('#15122d');
    },
    /** Fixed-width columns; long cells wrap rather than overflow the page. */
    table(columns, rows) {
      const total = columns.reduce((x, c) => x + c.width, 0);
      const scale = total > CONTENT ? CONTENT / total : 1;
      const widths = columns.map((c) => c.width * scale);
      const rowHeight = (cells) => {
        let max = 1;
        cells.forEach((cell, i) => {
          doc.font('Helvetica').fontSize(8.8);
          const h = doc.heightOfString(dash(cell), { width: widths[i] - 6, lineGap: 1.25 }) / (8.8 * 1.25);
          max = Math.max(max, h);
        });
        return max * 8.8 * 1.25;
      };
      const draw = (cells, { bold = false, rule = true } = {}) => {
        const height = rowHeight(cells) + 5;
        room(height);
        let x = MARGIN;
        cells.forEach((cell, i) => {
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.8)
            .fillColor(bold ? MUTED : '#15122d')
            .text(dash(cell), x + 3, state.y + 2, { width: widths[i] - 6, lineGap: 1.25 });
          x += widths[i];
        });
        state.y += height - 3;
        if (rule) {
          doc.moveTo(MARGIN, state.y).lineTo(MARGIN + CONTENT, state.y).lineWidth(0.5).strokeColor(LINE).stroke();
        }
        state.y += 4;
        doc.fillColor('#15122d');
      };
      draw(columns.map((c) => c.label), { bold: true });
      for (const row of rows) draw(columns.map((c) => row[c.key]));
    },
  };
}

/**
 * Page furniture: the accent bar and the footer rule. Drawn when each page opens, so a pack with
 * many examinations stays readable across breaks. Content never reaches past BOTTOM.
 */
function pageFurniture(doc, pageNumber, schoolName, reference) {
  doc.rect(0, 0, PAGE.width, 6).fill(ACCENT);
  const y = PAGE.height - MARGIN - 20;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT, y).lineWidth(0.7).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  doc.text(`${safe(schoolName || 'School')} · ${reference}`, MARGIN, y + 6, { width: CONTENT - 64 });
  doc.text(`Page ${pageNumber}`, MARGIN + CONTENT - 64, y + 6, { width: 64, align: 'right' });
  doc.text('This document is machine generated from the school\'s live records.', MARGIN, y + 17, { width: CONTENT, align: 'center' });
  doc.fillColor('#15122d');
}

/**
 * Streams the clearance PDF. `pack` comes from buildStudentPack; `purpose` tweaks the wording for
 * a transfer, `meta` adds the request reference when the paper belongs to a transfer request, and
 * `logo` is the school's own mark ({ buffer, format }) already fetched as PNG/JPEG bytes.
 */
export function streamClearancePdf(res, { pack, purpose = 'clearance', meta = {}, logo = null }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'Student clearance document', Author: pack.school?.name || 'E-MADAARIS' } });
  const student = pack.student || {};
  const enrolment = pack.enrolment || {};
  const school = pack.school || {};
  const name = dash(student.full_name || [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' '));
  const reference = `${(enrolment.admission_number || 'STUDENT').replace(/[^A-Za-z0-9-]/g, '')}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const title = purpose === 'transfer' ? 'Student transfer clearance' : 'Student clearance';

  const filename = `${reference}-${(name.split(' ')[0] || 'student').toLowerCase()}-clearance.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  doc.pipe(res);

  let pageNo = 1;
  pageFurniture(doc, pageNo, school.name, reference);
  doc.on('pageAdded', () => { pageNo += 1; pageFurniture(doc, pageNo, school.name, reference); });

  const p = pen(doc);

  // ── Letterhead ────────────────────────────────────────────────
  const LOGO_BOX = { width: 104, height: 58 };
  const hasLogo = Boolean(logo?.buffer);
  const headWidth = hasLogo ? CONTENT - LOGO_BOX.width - 14 : CONTENT;
  p.space(10);
  p.text(school.name || 'School', { size: 17, bold: true, width: headWidth });
  const contact = [school.city, school.country, school.registration_number ? `Reg. ${school.registration_number}` : null].filter(Boolean).join(' · ');
  if (contact) p.text(contact, { size: 8.5, color: MUTED, width: headWidth });
  if (hasLogo) {
    // A logo is decoration, never a blocker: if the bytes cannot be embedded the paper still issues.
    try {
      doc.image(logo.buffer, MARGIN + CONTENT - LOGO_BOX.width, MARGIN + 4, {
        fit: [LOGO_BOX.width, LOGO_BOX.height], align: 'right', valign: 'top',
      });
    } catch {
      p.state.y = Math.max(p.state.y, MARGIN + 10);
    }
  }
  p.space(4);
  p.text(title.toUpperCase(), { size: 13, bold: true, color: ACCENT });
  p.text('Official record of enrolment, academic results and attendance', { size: 8.5, color: MUTED });
  p.space(6);
  p.pair('Document reference', reference, { labelWidth: 130 });
  p.pair('Issued on', new Date().toISOString().slice(0, 19).replace('T', ' '), { labelWidth: 130 });
  p.pair('Issued by', dash(pack.issued_by || meta.issued_by), { labelWidth: 130 });
  if (meta.reason) p.pair('Reason', meta.reason, { labelWidth: 130 });
  if (meta.route) p.pair('Transfer route', meta.route, { labelWidth: 130 });

  // ── Personal details ──────────────────────────────────────────
  p.heading('Student details');
  p.pair('Full name', name);
  p.pair('Admission number', enrolment.admission_number);
  p.pair('Hemis / national ID', enrolment.hemis_id);
  p.pair('Date of birth', student.date_of_birth ? dateText(student.date_of_birth) : null);
  p.pair('Gender', student.gender);
  p.pair('Nationality / address', student.address);
  p.pair('Phone', student.phone);
  p.pair('Emergency contact', student.emergency_contact);
  p.pair('Enrolment status', enrolment.status);

  // ── Enrolment ─────────────────────────────────────────────────
  p.heading('Class and enrolment');
  const className = [enrolment.class_name, enrolment.section_name ? `Section ${enrolment.section_name}` : null].filter(Boolean).join(' · ');
  p.pair('Class', className);
  p.pair('Academic year', enrolment.academic_year);
  p.pair('Admission date', enrolment.admission_date ? dateText(enrolment.admission_date) : null);
  p.pair('Previous school', enrolment.previous_school);

  // ── Guardians ─────────────────────────────────────────────────
  p.heading('Parents and guardians');
  if (pack.guardians?.length) {
    p.table(
      [{ key: 'name', label: 'Name', width: 180 }, { key: 'relationship', label: 'Relationship', width: 110 },
        { key: 'phone', label: 'Phone', width: 110 }, { key: 'email', label: 'Email', width: 120 }, { key: 'occupation', label: 'Occupation', width: 110 }],
      pack.guardians.map((g) => ({
        name: `${dash(g.full_name)}${g.is_primary ? ' (primary)' : ''}`,
        relationship: g.link_relationship || g.relationship, phone: g.phone, email: g.email, occupation: g.occupation,
      })),
    );
  } else p.text('No guardian is recorded for this student.', { size: 9, color: MUTED });

  // ── Results ───────────────────────────────────────────────────
  p.heading('Academic results');
  if (pack.results?.length) {
    for (const set of pack.results) {
      const heading = [set.examination, set.term, set.academic_year].filter(Boolean).join(' · ');
      p.space(2);
      p.text(heading, { size: 9.5, bold: true });
      p.table(
        [{ key: 'subject', label: 'Subject', width: 220 }, { key: 'obtained', label: 'Marks', width: 80 },
          { key: 'maximum', label: 'Out of', width: 80 }, { key: 'percent', label: '%', width: 70 }],
        (set.subjects || []).map((s) => ({
          subject: s.name, obtained: s.obtained, maximum: s.maximum, percent: s.percent,
        })),
      );
      const summary = [
        `Total: ${dash(set.total_obtained)} / ${dash(set.total_maximum)}`,
        `Average: ${dash(set.percent)}%`,
        set.grade ? `Grade: ${set.grade}${set.remark ? ` (${set.remark})` : ''}` : null,
        set.class_rank ? `Class position: ${set.class_rank} of ${dash(set.class_size)}` : null,
      ].filter(Boolean).join('   ·   ');
      p.text(summary, { size: 8.8, color: MUTED });
    }
  } else p.text('No examination marks have been entered for this student.', { size: 9, color: MUTED });

  // ── Attendance ────────────────────────────────────────────────
  p.heading('Attendance');
  const summary = pack.attendance?.summary || {};
  const keys = Object.keys(summary);
  if (keys.length) {
    p.text(keys.map((k) => `${k[0].toUpperCase()}${k.slice(1).replace(/_/g, ' ')}: ${summary[k]}`).join('   ·   '), { size: 9 });
    p.text(`Days recorded: ${dash(pack.attendance.days_recorded)}${pack.attendance.percent_present != null ? ` · Present: ${pack.attendance.percent_present}%` : ''}`, { size: 8.8, color: MUTED });
  } else p.text('No attendance has been recorded.', { size: 9, color: MUTED });

  // ── Documents held on file ────────────────────────────────────
  if (pack.documents?.length) {
    p.heading('Documents held on file');
    p.table(
      [{ key: 'type', label: 'Document', width: 200 }, { key: 'file', label: 'File', width: 220 }, { key: 'date', label: 'Recorded', width: 110 }],
      pack.documents.slice(0, 20).map((d) => ({ type: d.document_type, file: d.file_name || d.file_path, date: dateText(d.created_at) })),
    );
  }

  // ── Declaration ───────────────────────────────────────────────
  p.heading('Declaration');
  p.text('The information above is a true record of this student as held by the school on the issue date. '
    + 'Results are shown exactly as entered and approved by the school; any later amendment requires a freshly issued document.',
  { size: 9, lineGap: 1.6 });
  p.space(26);
  const signY = p.state.y;
  doc.moveTo(MARGIN, signY).lineTo(MARGIN + 200, signY).lineWidth(0.7).strokeColor(MUTED).stroke();
  doc.moveTo(MARGIN + CONTENT - 200, signY).lineTo(MARGIN + CONTENT, signY).lineWidth(0.7).strokeColor(MUTED).stroke();
  p.space(4);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  doc.text('School administrator', MARGIN, p.state.y, { width: 200, align: 'center' });
  doc.text('Received by (receiving school)', MARGIN + CONTENT - 200, p.state.y, { width: 200, align: 'center' });
  p.space(12);
  doc.fillColor('#15122d');
  doc.end();
}
