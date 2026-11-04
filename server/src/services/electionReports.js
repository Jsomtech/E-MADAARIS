/**
 * Election documents: the PDFs, CSVs and spreadsheets an election officer hands out.
 *
 * Every one of these is built from aggregate counts. A report carries the school's name and mark,
 * the election title and window, each position, each candidate, their votes, their percentage and
 * the totals — and never a learner's name next to another learner's choice, a voter id, a ballot id
 * or anything the participation table knows. Turnout reports group by class and gender only, which
 * is how a school proves the election was fair without proving how anyone voted.
 */
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

/** Prefix formulas so spreadsheet apps treat exported text as text, not as an executable cell. */
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(columns, rows) {
  return [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))].join('\r\n');
}

export function sendCsv(res, filename, columns, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, '_')}"`);
  res.send(toCsv(columns, rows));
}

/** pdfkit reads PNG and JPEG only, so any other mark is left out rather than failing the paper. */
async function readLogo(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const isPng = buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpeg = buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    return isPng || isJpeg ? buffer : null;
  } catch {
    return null;
  }
}

const fmtTime = (value) => (value ? new Date(value).toISOString().replace('T', ' ').slice(0, 16) : '-');

const LEFT = 60;
const RIGHT = 535;

/**
 * pdfkit moves the writing cursor after every text call, so a row drawn one cell at a time drifts
 * sideways and the block after it starts in the middle of the page. Every cell is therefore pinned to
 * an absolute x, and the row hands the cursor back to the left margin at the tallest cell's foot.
 */
function placeRow(doc, cells, { font = 'Helvetica', size = 9, gap = 4 } = {}) {
  doc.font(font).fontSize(size);
  const y = doc.y;
  let foot = y;
  for (const { text, x, width } of cells) {
    const value = String(text ?? '');
    doc.text(value, x, y, { width });
    foot = Math.max(foot, y + doc.heightOfString(value, { width }));
  }
  doc.x = LEFT;
  doc.y = foot + gap;
  return foot;
}

/** The bottom a table row may reach before the next one has to start on a fresh page (A4 is 842 tall). */
const FOOT_LIMIT = 700;

function letterhead(doc, { school, election, subtitle }) {
  const top = doc.y;
  if (school?.logo_url) {
    try {
      doc.image(school.__logo, LEFT, top, { fit: [58, 58] });
    } catch { /* a logo pdfkit cannot decode is simply omitted */ }
  }
  doc.fontSize(15).font('Helvetica-Bold').text(school?.school_name || 'School', { align: 'right', width: 480 });
  doc.fontSize(13).font('Helvetica-Bold').text('Student Council Election', { align: 'right', width: 480 });
  doc.fontSize(10.5).font('Helvetica').text(election.title, { align: 'right', width: 480 });
  if (subtitle) doc.fontSize(9.5).text(subtitle, { align: 'right', width: 480 });
  doc.moveDown(0.2);
  doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor('#999999').lineWidth(0.7).stroke();
  doc.moveDown(0.6);
  doc.strokeColor('#000000');
  doc.x = LEFT;
}

function metaLines(doc, { school, election, issuedBy }) {
  const rows = [
    ['Academic year', election.academic_year_label || '-'],
    ['Voting window', `${fmtTime(election.start_at)} to ${fmtTime(election.end_at)} (${election.timezone || 'Africa/Mogadishu'})`],
    ['Status', `${election.status}${election.results_published ? ' | results published' : ''}${election.closed_at ? ` | closed ${fmtTime(election.closed_at)}` : ''}`],
    ['Eligible learners', String(election.__turnout?.eligible ?? '-')],
    ['Ballots recorded', String(election.__turnout?.voted ?? '-')],
    ['Turnout', `${election.__turnout?.percentage ?? 0}%`],
    ['Issued by', issuedBy || 'System'],
    ['Issued at', fmtTime(new Date().toISOString())],
  ];
  if (election.cancel_reason) rows.push(['Cancellation reason', election.cancel_reason]);
  if (election.resolution_note) rows.push(['Tie resolution', election.resolution_note]);
  for (const [label, value] of rows) {
    doc.fontSize(9).font('Helvetica-Bold').text(`${label}: `, { continued: true });
    doc.font('Helvetica').text(value);
    doc.x = LEFT;
  }
  doc.moveDown(0.5);
}

const RESULT_COLUMNS = [
  { key: 'ranking', label: 'Rank', x: 60, width: 34 },
  { key: 'name', label: 'Candidate', x: 96, width: 155 },
  { key: 'klass', label: 'Class', x: 253, width: 88 },
  { key: 'votes', label: 'Votes', x: 343, width: 38 },
  { key: 'percentage', label: '%', x: 383, width: 48 },
  { key: 'result', label: 'Result', x: 433, width: 102 },
];

/** One ranked block per position: a heading, a header rule, then one pinned-column row per candidate. */
function scoreboardTables(doc, scoreboard, { withManifestos }) {
  for (const position of scoreboard) {
    if (doc.y > FOOT_LIMIT - 60) doc.addPage();
    doc.x = LEFT;
    doc.fontSize(11).font('Helvetica-Bold')
      .text(`${position.position_name} - ${position.total_valid_votes} valid vote${position.total_valid_votes === 1 ? '' : 's'}`);
    doc.moveDown(0.25);
    if (doc.y > FOOT_LIMIT) doc.addPage();
    doc.x = LEFT;
    placeRow(doc, RESULT_COLUMNS.map((c) => ({ text: c.label, x: c.x, width: c.width })), { font: 'Helvetica-Bold', size: 8.5, gap: 3 });
    const ruleY = doc.y - 1;
    doc.moveTo(LEFT, ruleY).lineTo(RIGHT, ruleY).lineWidth(0.5).stroke();
    doc.y = ruleY + 4;
    doc.x = LEFT;
    for (const candidate of position.candidates) {
      if (doc.y > FOOT_LIMIT) doc.addPage();
      doc.x = LEFT;
      const values = {
        ranking: candidate.ranking ?? '-',
        name: candidate.full_name,
        klass: candidate.class_name || '-',
        votes: candidate.votes,
        percentage: `${candidate.percentage}%`,
        result: labelFor(candidate),
      };
      placeRow(doc, RESULT_COLUMNS.map((c) => ({ text: values[c.key], x: c.x, width: c.width })));
      if (withManifestos && candidate.campaign_title) {
        doc.x = LEFT;
        placeRow(doc, [{ text: `Campaign: ${candidate.campaign_title}`, x: 96, width: 439 }], { font: 'Helvetica-Oblique', size: 8, gap: 2 });
      }
    }
    doc.moveDown(0.7);
    doc.x = LEFT;
  }
}

const labelFor = (candidate) => (candidate.status === 'tied' ? 'TIED' : candidate.status === 'winner' ? 'ELECTED' : candidate.votes === 0 ? 'No votes' : 'Not elected');

export async function streamElectionPdf(res, { kind, school, election, scoreboard, turnout, issuedBy }) {
  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  const filename = `election-${kind}-${String(election.id).slice(0, 8)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);

  if (school?.logo_url) {
    const logo = await readLogo(school.logo_url);
    if (logo) school.__logo = logo;
  }
  election.__turnout = turnout;

  const subtitle = kind === 'winners' ? 'Declaration of results'
    : kind === 'participation' ? 'Voter participation report'
      : 'Official result sheet';
  letterhead(doc, { school, election, subtitle });
  metaLines(doc, { school, election, issuedBy });

  if (kind === 'participation') {
    for (const [heading, groupLabel, source] of [
      ['Participation by class', 'Class', turnout.by_class],
      ['Participation by gender', 'Gender', turnout.by_gender],
    ]) {
      const columns = [
        { label: groupLabel, x: 60, width: 190 },
        { label: 'Eligible', x: 255, width: 60 },
        { label: 'Voted', x: 320, width: 55 },
        { label: 'Did not vote', x: 380, width: 80 },
        { label: 'Turnout', x: 465, width: 70 },
      ];
      if (doc.y > FOOT_LIMIT - 40) doc.addPage();
      doc.x = LEFT;
      doc.fontSize(11).font('Helvetica-Bold').text(heading);
      doc.moveDown(0.2);
      doc.x = LEFT;
      placeRow(doc, columns.map((c) => ({ text: c.label, x: c.x, width: c.width })), { font: 'Helvetica-Bold', size: 8.5, gap: 3 });
      const ruleY = doc.y - 1;
      doc.moveTo(LEFT, ruleY).lineTo(RIGHT, ruleY).lineWidth(0.5).stroke();
      doc.y = ruleY + 4;
      doc.x = LEFT;
      for (const row of source) {
        if (doc.y > FOOT_LIMIT) doc.addPage();
        doc.x = LEFT;
        placeRow(doc, [
          { text: row.name || row.group, x: 60, width: 190 },
          { text: row.eligible, x: 255, width: 60 },
          { text: row.voted, x: 320, width: 55 },
          { text: row.eligible - row.voted, x: 380, width: 80 },
          { text: `${row.percentage}%`, x: 465, width: 70 },
        ]);
      }
      doc.moveDown(0.8);
      doc.x = LEFT;
    }
    doc.fontSize(8.5).font('Helvetica-Oblique')
      .text('Individual ballots are secret: this report shows group totals only, so no reader can tell how any learner voted.');
  } else if (kind === 'winners') {
    doc.fontSize(12).font('Helvetica-Bold').text('Declared officeholders');
    doc.moveDown(0.4);
    doc.fontSize(10).font('Helvetica');
    for (const position of scoreboard) {
      const winner = position.winner;
      if (position.tied) {
        doc.font('Helvetica-Bold').text(`${position.position_name}: TIED`);
        doc.font('Helvetica').text(`  ${position.candidates.filter((c) => c.status === 'tied').map((c) => `${c.full_name} (${c.votes})`).join(', ')}`);
        doc.text(`  ${position.total_valid_votes} valid votes. The school must record how the tie is resolved.`);
      } else if (winner) {
        doc.font('Helvetica-Bold').text(`${position.position_name}: ${winner.full_name}`);
        doc.font('Helvetica').text(`  Class ${winner.class_name || '-'} | ${winner.votes} votes | ${winner.percentage}% of valid votes for this position`);
      } else {
        doc.font('Helvetica-Bold').text(`${position.position_name}: no officeholder`);
        doc.font('Helvetica').text(`  ${position.total_valid_votes} valid votes were cast.`);
      }
      doc.moveDown(0.5);
    }
    if (election.results_published === false) {
      doc.moveDown(0.4).fontSize(9).font('Helvetica-Oblique')
        .text('These figures are the school\'s internal tally and have not been published to learners yet.');
    }
  } else {
    scoreboardTables(doc, scoreboard, { withManifestos: kind === 'full' });
  }

  doc.end();
}

export async function buildElectionWorkbook({ school, election, scoreboard, turnout }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = school?.school_name || 'E-MADAARIS';
  workbook.created = new Date();
  // ExcelJS tables want column objects (each named), an explicit range and the rows — `headers` alone
  // parses as a plain object and fails validation at save time.
  const columns = (names) => names.map((name) => ({ name }));

  const cover = workbook.addWorksheet('Election');
  const metaRows = [
    ['School', school?.school_name || '—'],
    ['Title', election.title],
    ['Status', election.status],
    ['Opens', fmtTime(election.start_at)],
    ['Closes', fmtTime(election.end_at)],
    ['Timezone', election.timezone || 'Africa/Mogadishu'],
    ['Eligible learners', turnout.eligible],
    ['Ballots recorded', turnout.voted],
    ['Turnout %', turnout.percentage],
    ['Results published', election.results_published ? 'yes' : 'no'],
  ];
  cover.addTable({
    name: 'Election__meta',
    ref: `A1:B${metaRows.length + 1}`,
    columns: columns(['Field', 'Value']),
    rows: metaRows,
  });
  cover.columns = [{ width: 24 }, { width: 40 }];

  const results = workbook.addWorksheet('Results');
  const resultRows = scoreboard.flatMap((position) => position.candidates.map((c) => [
    position.position_name, c.ranking ?? '', c.full_name, c.class_name || '', c.votes, `${c.percentage}%`,
    labelFor(c), position.total_valid_votes,
  ]));
  results.addTable({
    name: 'Results__t',
    ref: `A1:H${resultRows.length + 1}`,
    columns: columns(['Position', 'Rank', 'Candidate', 'Class', 'Votes', 'Percentage', 'Result', 'Valid votes for position']),
    rows: resultRows,
  });
  results.columns = [{ width: 26 }, { width: 7 }, { width: 26 }, { width: 14 }, { width: 8 }, { width: 12 }, { width: 13 }, { width: 24 }];

  const participation = workbook.addWorksheet('Participation');
  const participationRows = [
    ...turnout.by_class.map((r) => [`Class ${r.name || r.group}`, r.eligible, r.voted, r.eligible - r.voted, `${r.percentage}%`]),
    ...turnout.by_gender.map((r) => [`${r.name || r.group}`, r.eligible, r.voted, r.eligible - r.voted, `${r.percentage}%`]),
  ];
  participation.addTable({
    name: 'Participation__t',
    ref: `A1:E${participationRows.length + 1}`,
    columns: columns(['Group', 'Eligible', 'Voted', 'Did not vote', 'Turnout %']),
    rows: participationRows,
  });
  participation.columns = [{ width: 26 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 12 }];

  return workbook;
}

/**
 * Rows for the per-position CSV. One candidate per line, with the position's valid-vote total so
 * the percentage can be re-checked outside the app — and nothing that identifies a voter.
 */
export function positionRows(scoreboard, positionKey) {
  const position = positionKey
    ? scoreboard.find((p) => p.position_key === positionKey || p.position_id === positionKey)
    : scoreboard[0];
  if (!position) return { columns: ['candidate', 'votes'], rows: [] };
  return {
    columns: ['position', 'rank', 'candidate', 'admission_number', 'class', 'votes', 'percentage', 'result', 'total_valid_votes'],
    rows: position.candidates.map((c) => ({
      position: position.position_name,
      rank: c.ranking ?? '',
      candidate: c.full_name,
      admission_number: c.admission_number || '',
      class: c.class_name || '',
      votes: c.votes,
      percentage: c.percentage,
      result: labelFor(c),
      total_valid_votes: position.total_valid_votes,
    })),
  };
}

export function participationRows(turnout, dimension) {
  const source = dimension === 'gender' ? turnout.by_gender : (dimension === 'all' ? [...turnout.by_class, ...turnout.by_gender] : turnout.by_class);
  return {
    columns: ['group', 'eligible', 'voted', 'not_voted', 'turnout_percentage'],
    rows: source.map((r) => ({
      group: r.name || r.group,
      eligible: r.eligible,
      voted: r.voted,
      not_voted: r.eligible - r.voted,
      turnout_percentage: r.percentage,
    })),
  };
}
