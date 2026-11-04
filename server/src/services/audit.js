import { db } from '../config/supabase.js';

/**
 * Append-only audit trail. Recorded for sensitive operations.
 * Never store passwords/tokens in metadata.
 */
export async function audit(req, { module: mod, action, recordId, summary, status = 'success', metadata = {} }) {
  try {
    const a = req?.auth;
    const row = {
      school_id: a?.type === 'school' ? a.schoolId : null,
      user_id: a?.userId || null,
      user_scope: a?.type || 'anonymous',
      action,
      module: mod,
      record_id: recordId ? String(recordId) : null,
      summary: summary || `${action} ${mod}`,
      ip_address: req?.ip || null,
      metadata,
      status,
    };
    await db().from('audit_logs').insert(row);
  } catch (err) {
    // Audit failures must not break the business operation, but must be visible.
    console.error('[audit] failed to record', err.message);
  }
}
