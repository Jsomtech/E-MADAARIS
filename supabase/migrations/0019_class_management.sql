-- 0019: Class management — homeroom teacher and room on classes.
-- The API probes for these columns (services/schemaSupport.js) so an installation that
-- has not run this file keeps working; teacher/room are simply not stored there.

alter table classes add column if not exists room text;
alter table classes add column if not exists teacher_id uuid references school_users (id) on delete set null;

create index if not exists idx_classes_teacher on classes (school_id, teacher_id);
