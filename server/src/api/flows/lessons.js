import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { requireDb } from '../../config/supabase.js';
import { ApiError } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { sniffImage, IMAGE_MIME } from '../../core/images.js';
import { learningMaterialLinkColumn } from '../../services/schemaSupport.js';

export const lessonsRouter = Router();

/** Whether migration 0020 has added link_url, so the UI can gate video lessons. */
lessonsRouter.get('/capabilities', requirePermission('learning.view'), async (req, res, next) => {
  try { res.json({ data: { link_column: await learningMaterialLinkColumn() } }); } catch (e) { next(e); }
});

/**
 * Lesson files are documents and slide decks (PDF, PowerPoint, Word) plus still images.
 * Videos are NEVER uploaded here — a teacher puts the video on Google Drive and pastes the
 * share link, which the learning-materials resource stores in `link_url`. Keeping large media
 * out of app storage bounds cost and matches how schools already share lesson recordings.
 */
const LESSON_BUCKET = 'lesson-materials';
const MAX_BYTES = 25 * 1024 * 1024;

// Extension → canonical content type. The magic-byte check below is the real gate; this only
// labels the stored object.
const DOC_TYPES = {
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

function extensionOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/** Identify the real file family from its signature, not the (spoofable) browser MIME type. */
function sniffDocument(buffer, ext) {
  if (!buffer || buffer.length < 8) return null;
  const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
  const isOle = buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const image = sniffImage(buffer);
  if (image) return { ext: image === 'jpg' ? 'jpg' : image, contentType: IMAGE_MIME[image] };
  if (isPdf && ext === 'pdf') return { ext: 'pdf', contentType: DOC_TYPES.pdf };
  // Office Open XML (pptx/docx) are ZIP containers; legacy ppt/doc are OLE2. Trust the declared
  // extension within the matching family so we cannot accept an arbitrary .zip.
  if (isZip && ['pptx', 'docx'].includes(ext)) return { ext, contentType: DOC_TYPES[ext] };
  if (isOle && ['ppt', 'doc'].includes(ext)) return { ext, contentType: DOC_TYPES[ext] };
  return null;
}

const lessonUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = extensionOf(file.originalname);
    const ok = Boolean(DOC_TYPES[ext]);
    cb(ok ? null : new ApiError(400, 'Lesson files must be a PDF, PowerPoint (.ppt/.pptx), Word (.doc/.docx) or an image. Videos must be shared as a Google Drive link instead.'), ok);
  },
});

let bucketPromise = null;
async function ensureLessonBucket(supabase) {
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const { data: buckets, error } = await supabase.storage.listBuckets();
      if (error) throw new ApiError(502, `Storage is not reachable: ${error.message}`);
      if (!(buckets || []).some((b) => b.name === LESSON_BUCKET)) {
        const { error: createError } = await supabase.storage.createBucket(LESSON_BUCKET, {
          public: true, fileSizeLimit: MAX_BYTES,
        });
        if (createError && !/already exists/i.test(createError.message)) throw new ApiError(502, createError.message);
      }
    })().catch((error) => { bucketPromise = null; throw error; });
  }
  return bucketPromise;
}

/** Upload one lesson document; returns the public URL to store on the learning material. */
lessonsRouter.post('/upload', requirePermission('learning.create', 'learning.edit'), lessonUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, 'Attach a lesson file.');
    const ext = extensionOf(req.file.originalname);
    const sniffed = sniffDocument(req.file.buffer, ext);
    if (!sniffed) throw new ApiError(400, 'That file is not a readable PDF, PowerPoint, Word document or image.');

    const supabase = requireDb();
    await ensureLessonBucket(supabase);
    const path = `${req.auth.schoolId}/${randomUUID()}.${sniffed.ext}`;
    const { error } = await supabase.storage.from(LESSON_BUCKET).upload(path, req.file.buffer, {
      contentType: sniffed.contentType, cacheControl: '3600', upsert: false,
    });
    if (error) throw new ApiError(502, `Lesson upload failed: ${error.message}`);
    const { data } = supabase.storage.from(LESSON_BUCKET).getPublicUrl(path);
    res.status(201).json({
      data: {
        url: data.publicUrl, path,
        file_name: req.file.originalname, size_bytes: req.file.size,
        content_type: sniffed.contentType,
        material_type: sniffed.ext === 'pdf' ? 'document' : (['ppt', 'pptx'].includes(sniffed.ext) ? 'presentation' : 'document'),
      },
    });
  } catch (e) { next(e); }
});
