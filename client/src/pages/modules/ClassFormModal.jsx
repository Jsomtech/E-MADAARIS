// Create/edit a class: name, grade level, homeroom teacher, room, capacity and sections.
// Sections can be added as chips (Section A/B/C) while the class is created.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { DoorOpen, GraduationCap, Layers, Loader2, Plus, School, Trash2 } from 'lucide-react';
import { apiPatch, apiPost } from '../../api/client.js';
import Field from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';

const EMPTY = { name: '', level: '', room: '', teacher_id: '', capacity: '', sections: [] };
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function ClassFormModal({ open, onClose, initial, teachers = [], capabilities, onSaved }) {
  const { t } = useTranslation();
  const editing = Boolean(initial?.id);
  const canRoom = capabilities?.room !== false;
  const canTeacher = capabilities?.teacher !== false;
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setBusy(false);
    setForm(initial ? {
      name: initial.name || '',
      level: initial.level ?? '',
      room: initial.room || '',
      teacher_id: initial.teacher_id || '',
      capacity: initial.capacity ?? '',
      sections: (initial.sections || []).map((s) => ({ id: s.id, name: s.name, capacity: s.capacity ?? '' })),
    } : { ...EMPTY, sections: [] });
  }, [open, initial]);

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  const setSection = (index, key, value) => setForm((prev) => ({
    ...prev,
    sections: prev.sections.map((s, i) => (i === index ? { ...s, [key]: value } : s)),
  }));

  const addSection = (name = '') => setForm((prev) => ({
    ...prev,
    sections: [...prev.sections, { name, capacity: '' }],
  }));

  const removeSection = (index) => setForm((prev) => ({
    ...prev,
    sections: prev.sections.filter((_, i) => i !== index),
  }));

  const existingNames = form.sections.map((s) => String(s.name || '').trim().toLowerCase()).filter(Boolean);
  const suggestions = LETTERS.filter((letter) => !existingNames.includes(letter.toLowerCase()));

  const submit = async () => {
    const next = {};
    if (String(form.name).trim().length < 2) next.name = t('sections.classNameRequired', { defaultValue: 'Enter a class name' });

    const sections = form.sections
      .map((s) => ({ id: s.id, name: String(s.name || '').trim(), capacity: s.capacity === '' ? null : Number(s.capacity) }))
      .filter((s) => s.name);
    const seen = new Set();
    for (const section of sections) {
      const key = section.name.toLowerCase();
      if (seen.has(key)) next.sections = t('sections.duplicateSection', { defaultValue: 'Section names must be unique.' });
      seen.add(key);
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    const payload = {
      name: String(form.name).trim(),
      level: form.level === '' ? null : Number(form.level),
      capacity: form.capacity === '' ? null : Number(form.capacity),
      sections,
    };
    if (canRoom) payload.room = String(form.room || '').trim() || null;
    if (canTeacher) payload.teacher_id = form.teacher_id || null;

    setBusy(true);
    try {
      const { data } = editing
        ? await apiPatch(`/school/classes/${initial.id}`, payload)
        : await apiPost('/school/classes', payload);
      toast.success(editing
        ? t('sections.classUpdated', { defaultValue: '{{name}} updated.', name: data.name })
        : t('sections.classCreated', { defaultValue: '{{name}} created.', name: data.name }));
      onSaved?.(data);
      onClose?.();
    } catch (error) {
      setErrors({ form: error.status === 402 || error.status === 409 ? error.message : error.message });
    } finally {
      setBusy(false);
    }
  };

  const teacherOptions = teachers.map((teacher) => ({ value: teacher.id, label: teacher.full_name }));

  return (
    <Modal
      open={open}
      size="lg"
      title={editing
        ? t('sections.editClass', { defaultValue: 'Edit class' })
        : t('sections.addClass', { defaultValue: 'Add New Class' })}
      subtitle={t('sections.classModalHint', { defaultValue: 'A class can hold several sections, for example Form Four → Section A and Section B.' })}
      icon={School}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-1" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <School size={15} />}
            {busy ? t('common.loading') : editing ? t('common.save') : t('sections.createClass', { defaultValue: 'Create class' })}
          </button>
        </>
      )}
    >
      {errors.form && <div className="alert alert-danger small py-2">{errors.form}</div>}

      <div className="row">
        <Field field={{
          name: 'class_name', required: true, col: 8, label: t('sections.className', { defaultValue: 'Class name' }),
          placeholder: t('sections.classNameExample', { defaultValue: 'Form Four' }),
        }} value={form.name} error={errors.name} onChange={set('name')} />
        <Field field={{
          name: 'class_level', type: 'number', col: 4, label: t('sections.gradeLevel', { defaultValue: 'Grade / level' }),
          placeholder: '4',
        }} value={form.level} onChange={set('level')} />

        {canTeacher && (
          <Field field={{
            name: 'class_teacher', type: 'select', col: 6, label: t('sections.assignedTeacher', { defaultValue: 'Assigned teacher' }),
            options: teacherOptions, placeholder: t('sections.pickTeacher', { defaultValue: 'No teacher assigned' }),
            help: teacherOptions.length ? undefined : t('sections.noTeachersYet', {
              defaultValue: 'Nobody holds the Teacher role yet. Create one under Users → Staff, or give an existing member the Teacher role.',
            }),
          }} value={form.teacher_id} onChange={set('teacher_id')} />
        )}
        {canRoom && (
          <Field field={{
            name: 'class_room', col: 6, label: t('sections.room', { defaultValue: 'Room' }),
            placeholder: t('sections.roomExample', { defaultValue: 'Room 12' }),
          }} value={form.room} onChange={set('room')} />
        )}

        <Field field={{
          name: 'class_capacity', type: 'number', col: 6, label: t('sections.capacity', { defaultValue: 'Capacity' }),
          placeholder: '40', help: t('sections.capacityHelp', { defaultValue: 'Used to show how full the class is.' }),
        }} value={form.capacity} onChange={set('capacity')} />

        {!canRoom && (
          <div className="col-12 col-md-6 mb-3">
            <div className="alert alert-light border small py-2 mb-0">
              {t('sections.roomMigration', { defaultValue: 'Room needs migration 0019. Classes, sections and the homeroom teacher work without it.' })}
            </div>
          </div>
        )}
      </div>

      <div className="class-section-editor">
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
          <div className="d-flex align-items-center gap-2 fw-semibold">
            <span className="section-icon"><Layers size={15} /></span>
            {t('sections.sections', { defaultValue: 'Sections' })}
            <span className="badge-soft tone-neutral">{form.sections.length}</span>
          </div>
          <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" onClick={() => addSection()}>
            <Plus size={14} /> {t('sections.addSection', { defaultValue: 'Add section' })}
          </button>
        </div>

        {suggestions.length > 0 && (
          <div className="d-flex align-items-center gap-1 flex-wrap mb-2">
            <span className="small text-muted">{t('sections.quickAdd', { defaultValue: 'Quick add:' })}</span>
            {suggestions.slice(0, 5).map((letter) => (
              <button key={letter} type="button" className="class-chip class-chip-btn" onClick={() => addSection(letter)}>
                Section {letter}
              </button>
            ))}
          </div>
        )}

        {form.sections.length === 0 ? (
          <div className="small text-muted border rounded-3 p-3 text-center">
            {t('sections.noSections', { defaultValue: 'No sections yet. A class without sections is fine — add them when the stream is split.' })}
          </div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {form.sections.map((section, index) => (
              <div className="class-section-row" key={section.id || `new-${index}`}>
                <input
                  className="form-control form-control-sm"
                  value={section.name}
                  placeholder={t('sections.sectionNameExample', { defaultValue: 'Section A' })}
                  aria-label={t('sections.sectionName', { defaultValue: 'Section name' })}
                  onChange={(e) => setSection(index, 'name', e.target.value)}
                />
                <input
                  className="form-control form-control-sm"
                  type="number"
                  min="0"
                  value={section.capacity}
                  placeholder={t('sections.capacity', { defaultValue: 'Capacity' })}
                  aria-label={t('sections.capacity', { defaultValue: 'Capacity' })}
                  onChange={(e) => setSection(index, 'capacity', e.target.value)}
                />
                <button type="button" className="btn-icon sm" aria-label={t('common.remove')} onClick={() => removeSection(index)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {errors.sections && <div className="field-error">{errors.sections}</div>}
          </div>
        )}
      </div>

      <div className="d-flex flex-wrap gap-3 mt-3 small text-muted">
        <span className="d-inline-flex align-items-center gap-1"><GraduationCap size={14} /> {t('sections.teacherFromStaff', { defaultValue: 'Only staff with the Teacher role can be assigned.' })}</span>
        <span className="d-inline-flex align-items-center gap-1"><DoorOpen size={14} /> {t('sections.roomOptional', { defaultValue: 'The room is optional.' })}</span>
      </div>
    </Modal>
  );
}
