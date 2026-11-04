// Lessons (digital learning). Teachers attach documents and slide decks, or share a video as a
// Google Drive link — a video is never uploaded. Students/parents see published lessons for their class.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  FileText, FolderOpen, Link2, Loader2, Paperclip, Pencil, Play, Plus, RefreshCw, Trash2, Upload, Video,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '../../api/client.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Field from '../../components/ui/Field.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { PageHeader, StatusBadge } from '../../components/ui/Basics.jsx';

const TYPE_LABEL = { document: 'Document', presentation: 'Presentation', video: 'Video', note: 'Note' };

export default function LessonsPage() {
  const { t } = useTranslation();
  const { canAny } = useAuth();
  const canManage = canAny(['learning.create', 'learning.edit', 'learning.manage']);

  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [editing, setEditing] = useState(null); // null | {mode:'create'|'edit', row}

  const params = useMemo(() => ({ page, pageSize: 25, material_type: type || undefined }), [page, type]);
  const list = useApi('/learning-materials', params);

  const openResource = useCallback((row) => {
    const target = row.material_type === 'video' ? row.link_url : (row.file_path || row.link_url);
    if (!target) { toast.info(t('lessons.noFile', { defaultValue: 'Nothing to open for this lesson yet.' })); return; }
    window.open(target, '_blank', 'noopener,noreferrer');
  }, [t]);

  const remove = useCallback(async (row) => {
    try {
      await apiDelete(`/learning-materials/${row.id}`);
      toast.success(t('common.deleted', { defaultValue: 'Deleted.' }));
      list.reload();
    } catch (e) { toast.error(e.message); }
  }, [list, t]);

  const columns = [
    {
      key: 'title', label: t('lessons.title', { defaultValue: 'Lesson' }), render: (r) => (
        <div>
          <div className="fw-semibold">{r.title}</div>
          {r.description && <div className="small text-muted text-truncate" style={{ maxWidth: 320 }}>{r.description}</div>}
        </div>
      ),
    },
    {
      key: 'material_type', label: t('common.type', { defaultValue: 'Type' }), width: 130, render: (r) => (
        <span className="d-inline-flex align-items-center gap-1 small">
          {r.material_type === 'video' ? <Video size={13} /> : <FileText size={13} />}
          {TYPE_LABEL[r.material_type] || r.material_type || '—'}
        </span>
      ),
    },
    { key: 'classes', label: t('modules.classes', { defaultValue: 'Class' }), render: (r) => <span className="small">{r.classes?.name || t('lessons.allClasses', { defaultValue: 'All classes' })}</span> },
    { key: 'subjects', label: t('modules.subjects', { defaultValue: 'Subject' }), render: (r) => <span className="small">{r.subjects?.name || '—'}</span> },
    canManage && { key: 'is_published', label: t('lessons.published', { defaultValue: 'Published' }), width: 110, render: (r) => <StatusBadge value={r.is_published ? 'published' : 'draft'} /> },
    {
      key: 'actions', label: t('common.actions'), width: canManage ? 150 : 80, className: 'text-end', render: (r) => (
        <div className="d-inline-flex gap-1">
          <button type="button" className="btn btn-icon sm" title={t('lessons.open', { defaultValue: 'Open' })} onClick={() => openResource(r)}>
            {r.material_type === 'video' ? <Play size={14} /> : <FolderOpen size={14} />}
          </button>
          {canManage && (
            <button type="button" className="btn btn-icon sm" title={t('common.edit')} onClick={() => setEditing({ mode: 'edit', row: r })}>
              <Pencil size={14} />
            </button>
          )}
          {canManage && (
            <button type="button" className="btn btn-icon sm text-danger" title={t('common.delete')} onClick={() => remove(r)}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
  ].filter(Boolean);

  const chips = [['', t('common.all')], ['document', 'Documents'], ['presentation', 'Presentations'], ['video', 'Videos'], ['note', 'Notes']];

  return (
    <>
      <PageHeader
        title={t('lessons.section', { defaultValue: 'Lessons' })}
        subtitle={t('lessons.subtitle', { defaultValue: 'Share notes, slides and documents. Post a video as a Google Drive link — never upload the file.' })}
        actions={(
          <>
            <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={list.reload}>
              <RefreshCw size={14} /> {t('common.refresh', { defaultValue: 'Refresh' })}
            </button>
            {canManage && (
              <button type="button" className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={() => setEditing({ mode: 'create' })}>
                <Plus size={14} /> {t('lessons.newLesson', { defaultValue: 'New lesson' })}
              </button>
            )}
          </>
        )}
      />

      <div className="nav nav-pills gap-1 mb-3 flex-wrap">
        {chips.map(([value, label]) => (
          <button type="button" key={value} className={`btn btn-sm ${type === value ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => { setType(value); setPage(1); }}>{label}</button>
        ))}
      </div>

      <DataTable columns={columns} rows={list.data} total={list.total} page={page} pageSize={25} onPage={setPage}
        loading={list.loading} error={list.error} onRetry={list.reload}
        empty={t('lessons.empty', { defaultValue: 'No lessons here yet.' })} />

      {canManage && (
        <LessonFormModal state={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />
      )}
    </>
  );
}

function LessonFormModal({ state, onClose, onSaved }) {
  const { t } = useTranslation();
  const isEdit = state?.mode === 'edit';
  const fileRef = useRef(null);
  const capabilities = useApi('/school/lessons/capabilities', null, Boolean(state));
  const classes = useApi('/classes', { pageSize: 200 }, Boolean(state));
  const subjects = useApi('/subjects', { pageSize: 200 }, Boolean(state));

  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileMeta, setFileMeta] = useState(null); // { url, file_name, size_bytes, material_type }

  useEffect(() => {
    if (!state) return;
    setErrors({});
    setFileMeta(null);
    if (isEdit) {
      const r = state.row || {};
      setValues({
        title: r.title || '', description: r.description || '', material_type: r.material_type || 'document',
        class_id: r.class_id || '', subject_id: r.subject_id || '', link_url: r.link_url || '', is_published: r.is_published ?? true,
      });
      if (r.file_path) setFileMeta({ url: r.file_path, file_name: r.file_name, size_bytes: r.size_bytes, material_type: r.material_type });
    } else {
      setValues({ title: '', description: '', material_type: 'document', class_id: '', subject_id: '', link_url: '', is_published: true });
    }
  }, [state, isEdit]);

  const linkEnabled = capabilities.data?.link_column !== false;
  const type = values.material_type;
  const isVideo = type === 'video';

  const uploadFile = useCallback(async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await apiUpload('/school/lessons/upload', body);
      setFileMeta(data);
      setValues((prev) => ({ ...prev, material_type: data.material_type || prev.material_type, title: prev.title || data.file_name?.replace(/\.[^.]+$/, '') || '' }));
      toast.success(t('lessons.fileUploaded', { defaultValue: 'Lesson file attached.' }));
    } catch (e) { toast.error(e.message); } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [t]);

  const submit = useCallback(async () => {
    const missing = {};
    if (!String(values.title || '').trim()) missing.title = t('common.required');
    if (isVideo && !String(values.link_url || '').trim()) missing.link_url = t('lessons.needDriveLink', { defaultValue: 'Paste the Google Drive share link for this video.' });
    if (!isVideo && isEdit === false && !fileMeta && !String(values.link_url || '').trim() && type !== 'note') {
      missing.file = t('lessons.needContent', { defaultValue: 'Attach a file or add a link.' });
    }
    setErrors(missing);
    if (Object.keys(missing).length) return;

    const payload = {
      title: String(values.title).trim(),
      description: String(values.description || '').trim() || undefined,
      material_type: isVideo ? 'video' : type,
      class_id: values.class_id || null,
      subject_id: values.subject_id || null,
      is_published: Boolean(values.is_published),
      link_url: String(values.link_url || '').trim() || undefined,
    };
    if (!isVideo) {
      // Videos must not carry a file; documents/slides store the uploaded public URL on file_path.
      if (fileMeta) { payload.file_path = fileMeta.url; payload.file_name = fileMeta.file_name; payload.size_bytes = fileMeta.size_bytes; }
      else { payload.file_path = ''; }
    }
    // Notes/documents without an attached file clear any stale link on video→other type switches.
    if (isVideo) { payload.file_path = ''; payload.file_name = ''; payload.size_bytes = null; }

    setBusy(true);
    try {
      if (isEdit) await apiPatch(`/learning-materials/${state.row.id}`, payload);
      else await apiPost('/learning-materials', payload);
      toast.success(t('common.saved'));
      onSaved();
    } catch (e) {
      toast.error(e.message);
      if (Array.isArray(e.details)) setErrors(Object.fromEntries(e.details.map((d) => [d.field, d.message])));
    } finally { setBusy(false); }
  }, [values, isVideo, type, fileMeta, isEdit, state, onSaved, t]);

  const classOptions = (classes.data || []).map((c) => ({ value: c.id, label: c.name }));
  const subjectOptions = (subjects.data || []).map((s) => ({ value: s.id, label: s.name }));

  return (
    <Modal open={Boolean(state)} size="md" icon={FolderOpen}
      title={isEdit ? t('lessons.editLesson', { defaultValue: 'Edit lesson' }) : t('lessons.newLesson', { defaultValue: 'New lesson' })}
      subtitle={t('lessons.lessonSubtitle', { defaultValue: 'Documents and slides can be uploaded; videos are shared as a Google Drive link.' })}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={submit} disabled={busy || uploading}>
            {busy && <Loader2 size={15} className="animate-spin" />}{busy ? t('common.loading') : t('common.save')}
          </button>
        </>
      )}>
      <div className="row">
        <Field field={{ name: 'title', required: true, col: 12, label: t('lessons.title', { defaultValue: 'Lesson' }), placeholder: 'e.g. Fractions — Week 3' }}
          value={values.title} error={errors.title} onChange={(v) => setValues((p) => ({ ...p, title: v }))} />

        <Field field={{ name: 'material_type', type: 'select', required: true, col: 6, label: t('common.type', { defaultValue: 'Type' }) }}
          options={Object.entries(TYPE_LABEL).filter(([k]) => k !== 'video' || linkEnabled).map(([value, label]) => ({ value, label }))}
          value={values.material_type} onChange={(v) => setValues((p) => ({ ...p, material_type: v }))} />
        <Field field={{ name: 'is_published', type: 'checkbox', col: 6, label: t('lessons.published', { defaultValue: 'Published' }), checkLabel: t('lessons.publishNow', { defaultValue: 'Show to students' }) }}
          value={values.is_published} onChange={(v) => setValues((p) => ({ ...p, is_published: v }))} />

        <Field field={{ name: 'class_id', type: 'select', col: 6, label: t('modules.classes', { defaultValue: 'Class' }), placeholder: t('lessons.allClasses', { defaultValue: 'All classes' }) }}
          options={classOptions} value={values.class_id} onChange={(v) => setValues((p) => ({ ...p, class_id: v }))} />
        <Field field={{ name: 'subject_id', type: 'select', col: 6, label: t('modules.subjects', { defaultValue: 'Subject' }), placeholder: t('common.none') }}
          options={subjectOptions} value={values.subject_id} onChange={(v) => setValues((p) => ({ ...p, subject_id: v }))} />

        <Field field={{ name: 'description', type: 'textarea', col: 12, rows: 2, label: t('lessons.description', { defaultValue: 'Description' }) }}
          value={values.description} onChange={(v) => setValues((p) => ({ ...p, description: v }))} />

        {/* Videos: a Drive link only. Other types: an uploaded file (plus an optional link). */}
        {isVideo ? (
          <Field field={{
            name: 'link_url', required: true, col: 12, label: t('lessons.driveLink', { defaultValue: 'Google Drive link' }),
            placeholder: 'https://drive.google.com/file/d/…/view?usp=sharing',
            help: t('lessons.driveLinkHelp', { defaultValue: 'Upload the video to Google Drive, set sharing to “anyone with the link”, then paste the link here. Videos are never uploaded into the app.' }),
          }}
            value={values.link_url} error={errors.link_url} onChange={(v) => setValues((p) => ({ ...p, link_url: v }))} />
        ) : (
          <div className="col-12 mb-3">
            <label className="form-label">{type === 'note' ? t('lessons.optionalAttachment', { defaultValue: 'Attachment (optional)' }) : t('lessons.attachment', { defaultValue: 'Lesson file' })}</label>
            <div className="d-flex flex-wrap align-items-center gap-2">
              <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? t('common.loading') : t('lessons.uploadFile', { defaultValue: 'Upload PDF / slides / doc' })}
              </button>
              {fileMeta && (
                <span className="small d-inline-flex align-items-center gap-1">
                  <Paperclip size={13} /> <span className="text-truncate" style={{ maxWidth: 220 }}>{fileMeta.file_name}</span>
                  <button type="button" className="btn btn-link btn-sm p-0 ms-1 text-danger" onClick={() => setFileMeta(null)}>{t('common.remove', { defaultValue: 'Remove' })}</button>
                </span>
              )}
              <input ref={fileRef} type="file" accept=".pdf,.ppt,.pptx,.doc,.docx,.jpg,.jpeg,.png,.webp" hidden onChange={(e) => uploadFile(e.target.files?.[0])} />
            </div>
            <div className="form-text">{t('lessons.fileHelp', { defaultValue: 'PDF, PowerPoint, Word or an image · up to 25 MB. For video, switch the type to “Video” and paste a Drive link.' })}</div>
            {errors.file && <div className="field-error small text-danger">{errors.file}</div>}
          </div>
        )}

        {/* Optional link for documents/slides too (e.g. a companion Drive folder). */}
        {!isVideo && (
          <Field field={{ name: 'link_url', col: 12, label: t('lessons.linkOptional', { defaultValue: 'Google Drive link (optional)' }), placeholder: 'https://drive.google.com/…' }}
            value={values.link_url} error={errors.link_url} onChange={(v) => setValues((p) => ({ ...p, link_url: v }))} />
        )}

        {!linkEnabled && (
          <div className="alert alert-warning small mt-2 mb-0">
            <Link2 size={14} className="me-1 align-text-bottom" />
            {t('lessons.linkNotEnabled', { defaultValue: 'Video lessons need migration 0020 applied on Supabase before they can be saved.' })}
          </div>
        )}
      </div>
    </Modal>
  );
}
