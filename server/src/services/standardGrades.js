/**
 * Standard grade ladder so a school can start registering students and assigning teachers
 * without building every class by hand first. Existing class names are never overwritten:
 * the ladder is only applied when the school has no classes at all.
 */
const PRIMARY = Array.from({ length: 8 }, (_, index) => ({
  name: `Grade ${index + 1}`,
  level: index + 1,
}));

const SECONDARY = Array.from({ length: 4 }, (_, index) => ({
  name: `Form ${index + 1}`,
  level: index + 9,
}));

export function standardGradeLadder(schoolType) {
  if (schoolType === 'primary') return PRIMARY;
  if (schoolType === 'secondary') return SECONDARY;
  return [...PRIMARY, ...SECONDARY];
}

export async function ensureStandardGrades(supabase, schoolId, schoolType) {
  const { data: existing, error: existingError } = await supabase.from('classes')
    .select('id, name, level').eq('school_id', schoolId).order('name');
  if (existingError) throw existingError;
  if (existing?.length) return { created: 0, classes: existing, alreadySetUp: true };

  const ladder = standardGradeLadder(schoolType);
  const { data: created, error } = await supabase.from('classes')
    .upsert(
      ladder.map((row) => ({ school_id: schoolId, name: row.name, level: row.level })),
      { onConflict: 'school_id,name', ignoreDuplicates: true },
    )
    .select('id, name, level');

  if (error) throw error;

  // A concurrent request may have inserted the ladder between the check and the upsert;
  // read back so the caller always receives the full list.
  if ((created?.length || 0) < ladder.length) {
    const { data: all } = await supabase.from('classes')
      .select('id, name, level').eq('school_id', schoolId).order('name');
    return { created: created?.length || 0, classes: all || created || [], alreadySetUp: false };
  }

  return { created: created?.length || 0, classes: created || [], alreadySetUp: false };
}
