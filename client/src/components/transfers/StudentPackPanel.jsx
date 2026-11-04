// One student's shared record, shown exactly as the sending school holds it.
// Used by the transfer detail dialogs (school and platform) so the administrator deciding the
// request sees class, results, guardians and attendance before approving. Money stays out: the
// sending school's fee ledger belongs to its own finance module, not to a learner's academic record.
import { useTranslation } from 'react-i18next';
import { FileDown, Loader2 } from 'lucide-react';
import { dateOnly } from '../ui/Basics.jsx';

const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);

function Stat({ label, value }) {
  return (
    <div className="col-6 col-md-4 col-lg-2">
      <div className="card-soft p-2 text-center h-100">
        <div className="fs-5 fw-semibold tabular-nums">{value}</div>
        <div className="text-muted" style={{ fontSize: 12 }}>{label}</div>
      </div>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <div className="mb-3">
      <div className="fw-semibold small mb-2 text-uppercase text-muted">{title}</div>
      {children}
    </div>
  );
}

function FieldRow({ items }) {
  return (
    <div className="row g-2 small">
      {items.map((f) => (
        <div className="col-6 col-md-4" key={f.label}>
          <div className="text-muted" style={{ fontSize: 12 }}>{f.label}</div>
          <div className="fw-semibold">{dash(f.value)}</div>
        </div>
      ))}
    </div>
  );
}

export default function StudentPackPanel({ pack, loading, onDownload, downloadBusy }) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="text-muted small mb-3">
        <Loader2 size={14} className="animate-spin me-1" />
        {t('transfers.loadingRecords', { defaultValue: 'Loading the shared records…' })}
      </div>
    );
  }
  if (!pack) return null;

  const s = pack.student || {};
  const e = pack.enrolment || {};
  const school = pack.school || {};
  const attendance = pack.attendance || {};
  const name = s.full_name || [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ');

  return (
    <div className="student-pack">
      {pack.legacy && (
        <div className="alert alert-secondary small">
          {t('transfers.legacyNote', { defaultValue: 'Archived snapshot taken when this transfer completed; class placement and class ranks were not captured then.' })}
        </div>
      )}
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div className="d-flex align-items-center gap-2 min-width-0">
          {school.logo_url && <img src={school.logo_url} alt="" className="round-logo" width={30} height={30} />}
          <div className="min-width-0">
            <div className="fw-semibold small text-uppercase text-muted">
              {t('transfers.sharedRecords', { defaultValue: 'Full record shared by the sending school' })}
            </div>
            {school.name && <div className="small text-truncate">{school.name}</div>}
          </div>
        </div>
        {onDownload && (
          <button type="button" className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1"
            onClick={onDownload} disabled={downloadBusy}>
            {downloadBusy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            {t('students.clearance', { defaultValue: 'Clearance document' })}
          </button>
        )}
      </div>

      <div className="row g-2 mb-3">
        <Stat label={t('transfers.guardians', { defaultValue: 'Guardians' })} value={pack.guardians?.length || 0} />
        <Stat label={t('transfers.resultSets', { defaultValue: 'Examinations' })} value={pack.results?.length || 0} />
        <Stat label={t('transfers.attendanceDays', { defaultValue: 'Attendance days' })} value={attendance.days_recorded || 0} />
        <Stat label={t('transfers.documents', { defaultValue: 'Documents' })} value={pack.documents?.length || 0} />
      </div>

      <Block title={t('transfers.studentDetails', { defaultValue: 'Student details' })}>
        <FieldRow items={[
          { label: t('transfers.fullName', { defaultValue: 'Full name' }), value: name },
          { label: t('transfers.admissionNumber', { defaultValue: 'Admission number' }), value: e.admission_number },
          { label: t('transfers.hemis', { defaultValue: 'Hemis / national ID' }), value: e.hemis_id },
          { label: t('transfers.dateOfBirth', { defaultValue: 'Date of birth' }), value: s.date_of_birth ? dateOnly(s.date_of_birth) : null },
          { label: t('transfers.gender', { defaultValue: 'Gender' }), value: s.gender },
          { label: t('transfers.phone', { defaultValue: 'Phone' }), value: s.phone },
          { label: t('transfers.address', { defaultValue: 'Address' }), value: s.address },
          { label: t('transfers.emergencyContact', { defaultValue: 'Emergency contact' }), value: s.emergency_contact },
        ]} />
      </Block>

      <Block title={t('transfers.classEnrolment', { defaultValue: 'Class and enrolment' })}>
        <FieldRow items={[
          { label: t('transfers.class', { defaultValue: 'Class' }), value: e.class_name },
          { label: t('transfers.section', { defaultValue: 'Section' }), value: e.section_name },
          { label: t('transfers.academicYear', { defaultValue: 'Academic year' }), value: e.academic_year },
          { label: t('transfers.admissionDate', { defaultValue: 'Admitted on' }), value: e.admission_date ? dateOnly(e.admission_date) : null },
          { label: t('transfers.enrolmentStatus', { defaultValue: 'Enrolment status' }), value: e.status },
          { label: t('transfers.previousSchool', { defaultValue: 'Previous school' }), value: e.previous_school },
        ]} />
      </Block>

      <Block title={t('transfers.parentsGuardians', { defaultValue: 'Parents and guardians' })}>
        {pack.guardians?.length ? (
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr className="small text-muted">
                  <th>{t('transfers.name', { defaultValue: 'Name' })}</th>
                  <th>{t('transfers.relationship', { defaultValue: 'Relationship' })}</th>
                  <th>{t('transfers.phone', { defaultValue: 'Phone' })}</th>
                  <th>{t('transfers.email', { defaultValue: 'Email' })}</th>
                  <th>{t('transfers.occupation', { defaultValue: 'Occupation' })}</th>
                </tr>
              </thead>
              <tbody className="small">
                {pack.guardians.map((g, i) => (
                  <tr key={g.id || i}>
                    <td>{dash(g.full_name)}{g.is_primary ? <span className="text-muted"> · {t('transfers.primary', { defaultValue: 'primary' })}</span> : null}</td>
                    <td>{dash(g.link_relationship || g.relationship)}</td>
                    <td>{dash(g.phone)}</td>
                    <td>{dash(g.email)}</td>
                    <td>{dash(g.occupation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="small text-muted">{t('transfers.noGuardians', { defaultValue: 'No guardian is recorded for this student.' })}</div>}
      </Block>

      <Block title={t('transfers.results', { defaultValue: 'Academic results' })}>
        {pack.results?.length ? pack.results.map((set) => (
          <div className="mb-3" key={set.examination_id}>
            <div className="small fw-semibold mb-1">
              {[set.examination, set.term, set.academic_year].filter(Boolean).join(' · ')}
              {set.examination_status ? <span className="text-muted"> · {set.examination_status}</span> : null}
            </div>
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-1">
                <thead>
                  <tr className="small text-muted">
                    <th>{t('transfers.subject', { defaultValue: 'Subject' })}</th>
                    <th className="text-end">{t('transfers.marks', { defaultValue: 'Marks' })}</th>
                    <th className="text-end">{t('transfers.outOf', { defaultValue: 'Out of' })}</th>
                    <th className="text-end">%</th>
                  </tr>
                </thead>
                <tbody className="small">
                  {(set.subjects || []).map((sub, i) => (
                    <tr key={`${set.examination_id}-${sub.name || i}`}>
                      <td>{dash(sub.name)}</td>
                      <td className="text-end tabular-nums">{dash(sub.obtained)}</td>
                      <td className="text-end tabular-nums">{dash(sub.maximum)}</td>
                      <td className="text-end tabular-nums">{dash(sub.percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="small">
              <span className="text-muted">{t('transfers.total', { defaultValue: 'Total' })}: </span>
              <span className="fw-semibold tabular-nums">{dash(set.total_obtained)} / {dash(set.total_maximum)}</span>
              <span className="text-muted ms-2">%</span>
              <span className="fw-semibold tabular-nums">{dash(set.percent)}</span>
              {set.grade ? (
                <span className="ms-2">{t('transfers.grade', { defaultValue: 'Grade' })}: <span className="fw-semibold">{set.grade}</span>{set.remark ? <span className="text-muted"> ({set.remark})</span> : null}</span>
              ) : null}
              {set.class_rank ? (
                <span className="ms-2 text-muted">{t('transfers.classPosition', { defaultValue: 'Class position' })}: {set.class_rank} / {dash(set.class_size)}</span>
              ) : null}
            </div>
          </div>
        )) : <div className="small text-muted">{t('transfers.noResults', { defaultValue: 'No examination marks have been entered for this student.' })}</div>}
      </Block>

      <Block title={t('transfers.attendance', { defaultValue: 'Attendance' })}>
        {Object.keys(attendance.summary || {}).length ? (
          <div className="small">
            <div className="d-flex flex-wrap gap-3">
              {Object.entries(attendance.summary).map(([k, v]) => (
                <span key={k}><span className="text-muted">{k}:</span> <span className="fw-semibold tabular-nums">{v}</span></span>
              ))}
            </div>
            <div className="text-muted mt-1">
              {t('transfers.attendanceDays', { defaultValue: 'Attendance days' })}: {dash(attendance.days_recorded)}
              {attendance.percent_present != null ? <> · {t('transfers.presentPercent', { defaultValue: 'Present' })}: {attendance.percent_present}%</> : null}
            </div>
          </div>
        ) : <div className="small text-muted">{t('transfers.noAttendance', { defaultValue: 'No attendance has been recorded.' })}</div>}
      </Block>

      {pack.documents?.length > 0 && (
        <Block title={t('transfers.documentsOnFile', { defaultValue: 'Documents held on file' })}>
          <div className="small">
            {pack.documents.slice(0, 12).map((d, i) => (
              <div key={d.file_path || i} className="d-flex justify-content-between border-bottom py-1">
                <span>{dash(d.document_type)} <span className="text-muted">· {dash(d.file_name)}</span></span>
                <span className="text-muted">{d.created_at ? dateOnly(d.created_at) : ''}</span>
              </div>
            ))}
          </div>
        </Block>
      )}

      <div className="small text-muted mt-2">
        {pack.issued_by
          ? t('transfers.issuedBy', { defaultValue: 'Released by {{name}}', name: pack.issued_by })
          : t('transfers.issuedByUnknown', { defaultValue: 'Released by the sending school' })}
        {pack.captured_at ? ` · ${dateOnly(pack.captured_at)}` : ''}
      </div>
    </div>
  );
}
