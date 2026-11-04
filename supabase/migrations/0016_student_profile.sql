-- 0016 — Student HEMIS number, phone and registration notes.
-- The admissions form captures these fields; the API detects their absence at runtime so the
-- application keeps working until this migration is applied once (SQL editor or supabase db push).

alter table public.students add column if not exists hemis_id text;
alter table public.students add column if not exists phone text;
alter table public.students add column if not exists notes text;

comment on column public.students.hemis_id is 'Ministry of Education HEMIS identifier — unique per school, never auto-generated.';
comment on column public.students.phone is 'Contact phone for the student or the household.';
comment on column public.students.notes is 'Free-form registration notes captured at admission.';

-- HEMIS numbers are typed by hand, so compare case-insensitively and ignore blank rows.
create unique index if not exists students_school_hemis_uidx
  on public.students (school_id, upper(hemis_id))
  where hemis_id is not null and btrim(hemis_id) <> '';
