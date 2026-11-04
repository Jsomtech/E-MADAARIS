import { requireDb } from '../config/supabase.js';

/**
 * Migration 0016 adds hemis_id/phone/notes to students. Installations that have not run it yet
 * keep working: the API strips those fields instead of failing every insert with PGRST204.
 * The answer is probed once per process — a missing column is a schema fact, not a transient error.
 */
let studentsProfile = null;

export async function studentsProfileColumns() {
  if (studentsProfile !== null) return studentsProfile;
  const { error } = await requireDb().from('students').select('id, hemis_id, phone, notes').limit(1);
  if (!error) { studentsProfile = true; return true; }
  if (/could not find|does not exist|schema cache|unknown column/i.test(error.message || '')) {
    studentsProfile = false;
    return false;
  }
  // Unknown failure (network, auth): assume the columns exist rather than silently dropping data.
  return true;
}

/**
 * Migration 0019 adds room/teacher_id to classes. Same contract as studentsProfileColumns():
 * probe once, and when the columns are missing the API drops them instead of failing writes.
 */
let classesExtras = null;

export async function classesExtraColumns() {
  if (classesExtras !== null) return classesExtras;
  const { error } = await requireDb().from('classes').select('id, room, teacher_id').limit(1);
  if (!error) { classesExtras = true; return true; }
  if (/could not find|does not exist|schema cache|unknown column/i.test(error.message || '')) {
    classesExtras = false;
    return false;
  }
  return true;
}

/**
 * Migration 0020 adds learning_materials.link_url (Google Drive video links) and the
 * student_transfers table. The lessons UI probes this so it can prompt for the migration
 * instead of failing every video save with PGRST204.
 */
let lessonLink = null;

export async function learningMaterialLinkColumn() {
  if (lessonLink !== null) return lessonLink;
  const { error } = await requireDb().from('learning_materials').select('id, link_url').limit(1);
  if (!error) { lessonLink = true; return true; }
  if (/could not find|does not exist|schema cache|unknown column/i.test(error.message || '')) {
    lessonLink = false;
    return false;
  }
  return true;
}
