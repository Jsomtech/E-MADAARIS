// Student registration matching the admissions form: student details, guarantor (damiin),
// additional notes, then an issued login whose password starts as the generated student ID.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  AlertTriangle, BadgeCheck, ClipboardList, Copy, Download, FileSpreadsheet, Hash, ImagePlus,
  KeyRound, Loader2, Lock, Percent, RefreshCw, ShieldCheck, Upload, UploadCloud, UserRound, Users,
} from 'lucide-react';
import { apiPatch, apiPost, apiUpload, downloadFile } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import Field from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Spinner } from '../../components/ui/Basics.jsx';

const EMPTY = {
  full_name: '', hemis_id: '', gender: '', date_of_birth: '', phone: '', address: '',
  admission_date: '', academic_year_id: '', class_id: '', section_id: '',
  photo_url: '', status: 'active', notes: '',
  g_full_name: '', g_relationship: 'parent', g_phone: '', g_address: '',
};

const today = () => new Date().toISOString().slice(0, 10);

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: '', middle_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0], middle_name: '', last_name: '' };
  if (parts.length === 2) return { first_name: parts[0], middle_name: '', last_name: parts[1] };
  return {
    first_name: parts[0],
    middle_name: parts.slice(1, -1).join(' '),
    last_name: parts[parts.length - 1],
  };
}

export default function StudentFormModal({
  open, onClose, student = null, years = [], defaultYearId = '', classes = [], classesLoading = false,
  defaultClassId = '', mayGuardian = false, onCreated, onSaved, onImport, onClassesChanged,
}) {
  const { t } = useTranslation();
  const isEdit = Boolean(student?.id);
  const gradeSetupTried = useRef(false);
  const [gradeSetup, setGradeSetup] = useState('idle');
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(null);
  const [copied, setCopied] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoRef = useRef(null);

  const schema = useApi('/school/students/schema', undefined, open);
  const nextId = useApi('/school/students/next-admission-number', undefined, open && !isEdit);
  const sections = useApi('/sections', { pageSize: 200, class_id: form.class_id || undefined }, open && Boolean(form.class_id));

  // Until the probe answers, assume the columns exist so validation stays strict.
  const profileFields = schema.data ? Boolean(schema.data.profile_fields) : true;

  const blank = () => ({
    ...EMPTY,
    admission_date: today(),
    academic_year_id: defaultYearId || '',
    class_id: defaultClassId || '',
  });

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setForm({
        ...EMPTY,
        full_name: student.full_name
          || [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' '),
        hemis_id: student.hemis_id || '',
        gender: student.gender || '',
        date_of_birth: String(student.date_of_birth || '').slice(0, 10),
        phone: student.phone || student.emergency_contact || '',
        address: student.address || '',
        admission_date: String(student.admission_date || '').slice(0, 10),
        academic_year_id: student.academic_year_id || '',
        class_id: student.class_id || '',
        section_id: student.section_id || '',
        photo_url: student.photo_url || '',
        status: student.status || 'active',
        notes: student.notes || '',
      });
    } else {
      setForm(blank());
    }
    setErrors({});
    setSuccess(null);
    setCopied(false);
    setPhotoError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student]);

  useEffect(() => {
    if (!open || isEdit || !defaultYearId) return;
    setForm((prev) => (prev.academic_year_id ? prev : { ...prev, academic_year_id: defaultYearId }));
  }, [open, isEdit, defaultYearId]);

  // A school with no classes cannot register or assign anyone, so the standard ladder is
  // prepared once per dialog when the parent confirms the list is empty (not still loading).
  useEffect(() => {
    if (!open) {
      gradeSetupTried.current = false;
      setGradeSetup('idle');
      return;
    }
    if (isEdit || classesLoading || classes.length || gradeSetupTried.current) return;
    gradeSetupTried.current = true;
    setGradeSetup('working');
    apiPost('/school/classes/standard', {})
      .then(({ data }) => {
        setGradeSetup('done');
        if (data?.created) {
          toast.success(t('sections.standardGradesCreated', {
            defaultValue: '{{count}} standard grade classes were created automatically.',
            count: data.created,
          }));
        }
        onClassesChanged?.();
      })
      .catch(() => setGradeSetup('error'));
  }, [open, isEdit, classesLoading, classes.length, onClassesChanged, t]);

  const set = (name) => (value) => setForm((prev) => ({ ...prev, [name]: value }));

  const uploadPhoto = async (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoError(t('sections.photoType', { defaultValue: 'Choose a JPG, PNG or WebP image.' }));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setPhotoError(t('sections.photoTooLarge2', { defaultValue: 'That photo is larger than 2 MB — resize it and try again.' }));
      return;
    }
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await apiUpload('/school/students/photo', body);
      setForm((prev) => ({ ...prev, photo_url: data.url }));
    } catch (error) {
      setPhotoError(error.message);
    } finally {
      setPhotoBusy(false);
      if (photoRef.current) photoRef.current.value = '';
    }
  };

  const downloadTemplate = async () => {
    try {
      await downloadFile('/school/students/import-template?format=xlsx', 'student-import-template.xlsx');
    } catch (error) { toast.error(error.message); }
  };

  const validate = () => {
    const missing = {};
    if (form.full_name.trim().length < 2) missing.full_name = t('sections.fullNameRequired', { defaultValue: 'Enter the student’s full name' });
    if (!form.gender) missing.gender = t('common.required');
    if (!form.date_of_birth) missing.date_of_birth = t('common.required');
    if (!isEdit && !form.phone.trim()) missing.phone = t('sections.phoneRequired', { defaultValue: 'Phone number is required' });
    if (!isEdit && !form.address.trim()) missing.address = t('sections.addressRequired', { defaultValue: 'Address is required' });
    if (!form.admission_date) missing.admission_date = t('common.required');
    if (!form.academic_year_id) missing.academic_year_id = t('sections.pickYear', { defaultValue: 'Pick an academic year first' });
    if (!form.class_id) missing.class_id = t('sections.classRequired', { defaultValue: 'Choose a class' });
    if (mayGuardian && !isEdit) {
      if (form.g_full_name.trim().length < 2) missing.g_full_name = t('sections.guardianNameMin', { defaultValue: 'Guardian full name needs 2+ characters' });
      if (!form.g_relationship.trim()) missing.g_relationship = t('common.required');
      if (!form.g_phone.trim()) missing.g_phone = t('sections.phoneRequired', { defaultValue: 'Phone number is required' });
      if (!form.g_address.trim()) missing.g_address = t('sections.addressRequired', { defaultValue: 'Address is required' });
    }
    return missing;
  };

  const submit = async () => {
    const missing = validate();
    setErrors(missing);
    if (Object.keys(missing).length) {
      toast.error(t('sections.formIncomplete', { defaultValue: 'Some required fields still need attention.' }));
      return;
    }

    setBusy(true);
    try {
      const name = splitName(form.full_name);
      const payload = {
        ...name,
        status: form.status || 'active',
        admission_date: form.admission_date,
        academic_year_id: form.academic_year_id,
        class_id: form.class_id,
      };
      for (const key of ['gender', 'date_of_birth', 'phone', 'address', 'hemis_id', 'notes', 'section_id', 'photo_url']) {
        const value = String(form[key] ?? '').trim();
        if (value) payload[key] = value;
      }

      if (isEdit) {
        const { data: updated } = await apiPatch(`/students/${student.id}`, payload);
        toast.success(t('sections.studentUpdated', { defaultValue: 'Student details saved.' }));
        onSaved?.(updated || student);
        onClose?.();
        return;
      }

      const { data: created } = await apiPost('/students', payload);

      let guardianError = '';
      if (mayGuardian) {
        try {
          const { data: guardian } = await apiPost('/guardians', {
            full_name: form.g_full_name.trim(),
            relationship: form.g_relationship.trim() || 'parent',
            phone: form.g_phone.trim(),
            address: form.g_address.trim(),
          });
          await apiPost('/student-guardians', {
            student_id: created.id, guardian_id: guardian.id,
            relationship: form.g_relationship.trim() || 'parent', is_primary: true,
          });
        } catch (error) {
          guardianError = error.message;
        }
      }

      setSuccess({ student: created, guardianError });
      onCreated?.(created);
      toast.success(t('sections.studentAdmitted', {
        defaultValue: '{{name}} enrolled as {{adm}}.',
        name: created.full_name || form.full_name, adm: created.admission_number,
      }));
    } catch (error) {
      if (error.status === 403) {
        setErrors({ form: t('sections.admissionsForbidden', { defaultValue: 'Enrolling students needs students.create (and the plan feature "students.management").' }) });
      } else if (error.status === 409) {
        setErrors({ form: error.message });
      } else if (error.status === 402) {
        setErrors({ form: error.message });
      } else {
        setErrors({ form: error.details ? JSON.stringify(error.details) : error.message });
      }
    } finally {
      setBusy(false);
    }
  };

  const copyCredentials = async () => {
    const text = `${success.student.full_name}\nStudent ID: ${success.student.admission_number}\nPassword: ${success.student.admission_number}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  };

  const yearOptions = years.map((y) => ({
    value: y.id,
    label: `${y.name}${y.is_current ? ` · ${t('sections.currentYear', { defaultValue: 'current' })}` : ''}`,
  }));
  const classOptions = classes.map((c) => ({ value: c.id, label: c.name }));
  const sectionOptions = (sections.data || []).map((s) => ({ value: s.id, label: s.name }));

  const successFooter = success && (
    <>
      <button type="button" className="btn btn-outline-secondary" onClick={() => { setForm(blank()); setErrors({}); setSuccess(null); }}>
        {t('sections.registerAnother', { defaultValue: 'Register another' })}
      </button>
      <button type="button" className="btn btn-primary" onClick={onClose}>{t('common.done', { defaultValue: 'Done' })}</button>
    </>
  );

  const formFooter = !success && (
    <>
      {!isEdit && (
        <button type="button" className="btn btn-outline-secondary" disabled={busy}
          onClick={() => { setForm(blank()); setErrors({}); setPhotoError(''); }}>
          {t('sections.resetForm', { defaultValue: 'Reset' })}
        </button>
      )}
      <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
      <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" onClick={submit} disabled={busy}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <UserRound size={15} />}
        {busy
          ? t('common.loading')
          : isEdit
            ? t('sections.saveChanges', { defaultValue: 'Save changes' })
            : t('sections.saveStudent', { defaultValue: 'Save Student' })}
      </button>
    </>
  );

  return (
    <Modal open={open} size="xl"
      title={isEdit
        ? t('sections.editStudent', { defaultValue: 'Edit student' })
        : t('sections.newStudent', { defaultValue: 'Add New Student' })}
      subtitle={isEdit
        ? t('sections.editStudentSubtitle', { defaultValue: '{{id}} · update the record without changing the login.', id: student?.admission_number || '' })
        : t('sections.newStudentSubtitle', { defaultValue: 'Student ID and first password are generated automatically.' })}
      icon={UserRound} onClose={onClose} footer={success ? successFooter : formFooter}>
      {schema.loading && !schema.data && <Spinner label={t('common.loading')} />}

      {!schema.loading && schema.data && !profileFields && (
        <div className="alert alert-warning small py-2 d-flex align-items-start gap-2">
          <AlertTriangle size={15} className="mt-1 flex-shrink-0" />
          <div>
            {t('sections.migrationNeeded', { defaultValue: 'This database has not enabled HEMIS, phone and notes on student records yet. Ask your platform administrator to run supabase/migrations/0016_student_profile.sql once; until then those three fields are not stored and HEMIS is optional.' })}
          </div>
        </div>
      )}

      {success ? (
        <div>
          <div className="alert alert-success small py-2 d-flex align-items-center gap-2">
            <ShieldCheck size={16} /> {t('sections.studentRegistered', { defaultValue: 'Student registered. Their login is ready.' })}
          </div>
          <div className="credential-card mb-3">
            <div className="fw-semibold mb-1 d-flex align-items-center gap-1"><KeyRound size={15} /> {t('sections.loginDetails', { defaultValue: 'Student login' })}</div>
            <div className="small text-muted mb-2">
              {t('sections.loginDetailsHelp', { defaultValue: 'Give these to the student or guardian. The student signs in with the ID and can set their own password from Account & security.' })}
            </div>
            <div className="credential-row">
              <span className="small text-muted">{t('sections.studentId', { defaultValue: 'Student ID' })}</span>
              <span className="credential-value">{success.student.admission_number}</span>
            </div>
            <div className="credential-row">
              <span className="small text-muted">{t('sections.password', { defaultValue: 'Password' })}</span>
              <span className="credential-value">{success.student.admission_number}</span>
            </div>
            <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={copyCredentials}>
              <Copy size={13} /> {copied ? t('sections.copied', { defaultValue: 'Copied' }) : t('sections.copyLogin', { defaultValue: 'Copy login details' })}
            </button>
          </div>
          <div className="small text-muted d-flex align-items-center gap-1">
            <BadgeCheck size={14} className="text-success" />
            {t('sections.familyCredentials', { defaultValue: '{{name}} · {{class}} · admitted {{date}}', name: success.student.full_name, class: classes.find((c) => c.id === form.class_id)?.name || '—', date: form.admission_date })}
          </div>
          {success.guardianError && (
            <div className="alert alert-warning small py-2 mt-2 mb-0">
              {t('sections.guardianFailed', { defaultValue: 'Student enrolled, but the guardian step failed: {{message}}', message: success.guardianError })}
            </div>
          )}
        </div>
      ) : (
        <>
          {errors.form && <div className="alert alert-danger small py-2">{errors.form}</div>}

          {!isEdit && (
            <div className="student-import-callout">
              <span className="student-import-callout-icon"><FileSpreadsheet size={17} /></span>
              <div className="flex-grow-1 min-w-0">
                <div className="fw-semibold small">{t('sections.enrollingWholeClass', { defaultValue: 'Enrolling a whole class?' })}</div>
                <div className="small text-muted">
                  {t('sections.enrollingWholeClassHint', { defaultValue: 'Import a CSV or Excel file, or download the template to fill in later.' })}
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={downloadTemplate}>
                  <Download size={13} /> {t('sections.template', { defaultValue: 'Template' })}
                </button>
                {onImport && (
                  <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" onClick={onImport}>
                    <UploadCloud size={13} /> {t('sections.importFile', { defaultValue: 'Import file' })}
                  </button>
                )}
              </div>
            </div>
          )}

          <section className="student-form-section">
            <header><span className="section-icon"><UserRound size={15} /></span> {t('sections.studentInformation', { defaultValue: 'Student Information' })}</header>
            <div className="section-body row">
              <div className="col-12 col-md-3 mb-3 d-flex flex-column align-items-center gap-2">
                <div className="student-photo-box">
                  {form.photo_url ? <img src={form.photo_url} alt="" /> : <ImagePlus size={24} />}
                </div>
                <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
                  onChange={(e) => uploadPhoto(e.target.files?.[0])} />
                <div className="d-flex gap-1">
                  <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                    disabled={photoBusy} onClick={() => photoRef.current?.click()}>
                    {photoBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    {form.photo_url ? t('sections.replacePhoto', { defaultValue: 'Replace' }) : t('sections.chooseFile', { defaultValue: 'Choose File' })}
                  </button>
                  {form.photo_url && !photoBusy && (
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setForm((p) => ({ ...p, photo_url: '' }))}>
                      {t('common.remove', { defaultValue: 'Remove' })}
                    </button>
                  )}
                </div>
                <div className="form-text text-center">{t('sections.photoHintShort', { defaultValue: 'JPG or PNG · max 2 MB' })}</div>
                {photoError && <div className="text-danger small text-center">{photoError}</div>}
              </div>

              <Field field={{ name: 'full_name', required: true, col: 9, label: t('sections.fullName', { defaultValue: 'Full Name' }), placeholder: t('sections.fullNameExample', { defaultValue: 'Amina Hassan Ali' }) }}
                value={form.full_name} error={errors.full_name} onChange={set('full_name')} />

              <div className="col-12 mb-3">
                {isEdit ? (
                  <div className="student-record-strip">
                    <div className="record-cell">
                      <span className="record-label"><Hash size={13} /> {t('sections.admissionNumber', { defaultValue: 'Admission number' })}</span>
                      <span className="record-value">{student?.admission_number || '—'}</span>
                      <span className="record-note">{t('sections.admissionNumberLocked', { defaultValue: 'Generated at admission · read-only' })}</span>
                    </div>
                    <div className="record-cell">
                      <span className="record-label"><Lock size={13} /> {t('sections.studentPassword', { defaultValue: 'Student Password' })}</span>
                      <span className="record-value">{t('sections.passwordUnchanged', { defaultValue: 'Unchanged' })}</span>
                      <span className="record-note">{t('sections.studentCanChange', { defaultValue: 'Student can change it later' })}</span>
                    </div>
                  </div>
                ) : (
                  <div className="student-record-strip">
                    <div className="record-cell">
                      <span className="record-label"><Hash size={13} /> {t('sections.studentRecordId', { defaultValue: 'Student Record ID' })}</span>
                      <span className="record-value">
                        {nextId.loading ? '…' : nextId.data?.admission_number || t('sections.autoOnSave', { defaultValue: 'Auto-generated on save' })}
                      </span>
                      <button type="button" className="btn-icon sm ms-auto" onClick={() => nextId.reload()}
                        aria-label={t('sections.refreshId', { defaultValue: 'Refresh student ID' })}>
                        <RefreshCw size={13} className={nextId.loading ? 'animate-spin' : undefined} />
                      </button>
                    </div>
                    <div className="record-cell">
                      <span className="record-label"><Percent size={13} /> {t('sections.attendancePercent', { defaultValue: 'Attendance %' })}</span>
                      <span className="record-value text-muted">—</span>
                      <span className="record-note">{t('sections.attendanceDerived', { defaultValue: 'From attendance records' })}</span>
                    </div>
                    <div className="record-cell">
                      <span className="record-label"><Lock size={13} /> {t('sections.studentPassword', { defaultValue: 'Student Password' })}</span>
                      <span className="record-value">
                        {nextId.data?.admission_number || t('sections.passwordIsId', { defaultValue: 'The Student ID' })}
                      </span>
                      <span className="record-note">{t('sections.studentCanChange', { defaultValue: 'Student can change it later' })}</span>
                    </div>
                  </div>
                )}
              </div>

              <Field field={{
                name: 'hemis_id', col: 4,
                label: t('sections.hemisNumberOptional', { defaultValue: 'HEMIS NUMBER (OPTIONAL)' }),
                help: t('sections.hemisOptionalHelp', { defaultValue: 'Leave blank if the number is not available yet — it can be added later.' }),
                placeholder: 'H-000000',
              }} value={form.hemis_id} error={errors.hemis_id} onChange={set('hemis_id')} disabled={!profileFields} />
              <Field field={{
                name: 'gender', type: 'select', required: true, col: 4, label: t('sections.gender', { defaultValue: 'Gender' }),
                options: [{ value: 'male', label: t('sections.male', { defaultValue: 'Male' }) }, { value: 'female', label: t('sections.female', { defaultValue: 'Female' }) }],
                placeholder: t('sections.selectGender', { defaultValue: 'Select gender' }),
              }} value={form.gender} error={errors.gender} onChange={set('gender')} />
              <Field field={{ name: 'date_of_birth', type: 'date', required: true, col: 4, label: t('sections.dateOfBirth', { defaultValue: 'Date of Birth' }) }}
                value={form.date_of_birth} error={errors.date_of_birth} onChange={set('date_of_birth')} />
              <Field field={{ name: 'phone', type: 'tel', required: !isEdit, col: 4, label: t('sections.phoneNumber', { defaultValue: 'Phone Number' }), placeholder: '+252 61 000 0000' }}
                value={form.phone} error={errors.phone} onChange={set('phone')} />
              <Field field={{ name: 'admission_date', type: 'date', required: true, col: 4, label: t('sections.admissionDate', { defaultValue: 'Admission Date' }) }}
                value={form.admission_date} error={errors.admission_date} onChange={set('admission_date')} />
              <Field field={{ name: 'academic_year_id', type: 'select', required: true, col: 4, label: t('sections.academicYear', { defaultValue: 'Academic Year' }), options: yearOptions, placeholder: t('sections.pickYear', { defaultValue: 'Pick an academic year' }) }}
                value={form.academic_year_id} error={errors.academic_year_id} onChange={set('academic_year_id')} />
              <Field field={{
                name: 'class_id', type: 'select', required: true, col: 6,
                label: t('sections.gradeClass', { defaultValue: 'Grade / Class' }),
                options: classOptions,
                placeholder: classesLoading || gradeSetup === 'working'
                  ? t('sections.preparingGrades', { defaultValue: 'Preparing grades…' })
                  : t('sections.pickClass', { defaultValue: 'Select class' }),
                help: gradeSetup === 'working'
                  ? t('sections.standardGradesWorking', { defaultValue: 'Creating the standard grade classes automatically…' })
                  : gradeSetup === 'error'
                    ? t('sections.standardGradesFailed', { defaultValue: 'Could not create standard grades automatically — add classes from Class Management.' })
                    : gradeSetup === 'done' && !classOptions.length
                      ? t('sections.standardGradesDone', { defaultValue: 'Standard grades are ready — choose one.' })
                      : undefined,
              }} value={form.class_id} error={errors.class_id}
                onChange={(v) => setForm((prev) => ({ ...prev, class_id: v, section_id: '' }))} />
              <Field field={{ name: 'section_id', type: 'select', col: 6, label: t('sections.section', { defaultValue: 'Section' }), options: sectionOptions, placeholder: form.class_id ? t('sections.pickSection', { defaultValue: 'Pick a section' }) : t('sections.pickClassFirst', { defaultValue: 'choose a class first' }) }}
                value={form.section_id} onChange={set('section_id')} />
              <Field field={{ name: 'address', required: !isEdit, col: 12, label: t('sections.address', { defaultValue: 'Address' }), placeholder: t('sections.addressExample', { defaultValue: 'District, street, house number' }) }}
                value={form.address} error={errors.address} onChange={set('address')} />
            </div>
          </section>

          {!isEdit && (
          <section className="student-form-section">
            <header><span className="section-icon"><Users size={15} /></span> {t('sections.parentAccount', { defaultValue: 'Parent Account (Damiin)' })}</header>
            <div className="section-body row">
              <div className="col-12 mb-3">
                <div className="alert alert-light border small py-2 mb-0">
                  {t('sections.parentAccountHint', { defaultValue: 'The parent or guarantor is linked to this student so fees, attendance and results can be shared with the family.' })}
                </div>
              </div>
              {!mayGuardian && (
                <div className="col-12 mb-3">
                  <div className="alert alert-secondary small py-2 mb-0">
                    {t('sections.noGuardianPerm', { defaultValue: 'Your role lacks guardians.create — the student is saved without a guarantor. Add one later from the Guardians module.' })}
                  </div>
                </div>
              )}
              <Field field={{ name: 'g_full_name', required: mayGuardian, col: 6, label: t('sections.guarantorName', { defaultValue: 'Guarantor Name' }) }}
                value={form.g_full_name} error={errors.g_full_name} onChange={set('g_full_name')} disabled={!mayGuardian} />
              <Field field={{ name: 'g_relationship', required: mayGuardian, col: 6, label: t('sections.relationship', { defaultValue: 'Relationship' }), placeholder: t('sections.relationshipExample', { defaultValue: 'Father, mother, uncle…' }) }}
                value={form.g_relationship} error={errors.g_relationship} onChange={set('g_relationship')} disabled={!mayGuardian} />
              <Field field={{ name: 'g_phone', type: 'tel', required: mayGuardian, col: 6, label: t('sections.phoneNumber', { defaultValue: 'Phone Number' }) }}
                value={form.g_phone} error={errors.g_phone} onChange={set('g_phone')} disabled={!mayGuardian} />
              <Field field={{ name: 'g_address', required: mayGuardian, col: 6, label: t('sections.address', { defaultValue: 'Address' }) }}
                value={form.g_address} error={errors.g_address} onChange={set('g_address')} disabled={!mayGuardian} />
            </div>
          </section>
          )}

          <section className="student-form-section">
            <header><span className="section-icon"><ClipboardList size={15} /></span> {t('sections.additionalInformation', { defaultValue: 'Additional Information' })}</header>
            <div className="section-body row">
              <Field field={{
                name: 'status', type: 'select', required: true, col: 4, label: t('common.status'),
                options: ['active', 'inactive', 'transferred', 'withdrawn', 'graduated'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })),
                placeholder: t('sections.selectStatus', { defaultValue: 'Select status' }),
              }} value={form.status} onChange={set('status')} />
              {!isEdit && (
                <div className="col-12 col-md-8">
                  <div className="alert alert-light border small py-2 mb-3">
                    <BadgeCheck size={14} className="me-1 text-primary" />
                    {t('sections.studentIdAutoShort', { defaultValue: 'The student ID is generated when you save: school prefix + academic year + sequence. The first password is the same ID.' })}
                  </div>
                </div>
              )}
              <Field field={{ name: 'notes', type: 'textarea', col: 12, label: t('sections.notes', { defaultValue: 'Notes' }), rows: 3, placeholder: t('sections.notesPlaceholder', { defaultValue: 'Medical notes, transport, previous school or anything the office should know.' }) }}
                value={form.notes} onChange={set('notes')} />
            </div>
          </section>
        </>
      )}
    </Modal>
  );
}
