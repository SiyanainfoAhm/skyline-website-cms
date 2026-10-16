-- Additive support for the resumable legacy-attachment migration.
-- Apply this schema migration before running scripts/migrate-course-content.mjs --apply.
-- The data migration itself remains approval-gated and is not performed here.

alter table public.cms_course_attachments
  add column if not exists legacy_url text,
  add column if not exists migration_status text,
  add column if not exists migration_error text,
  add column if not exists migrated_at timestamptz;

create index if not exists idx_cms_course_attachments_migration_status
  on public.cms_course_attachments (migration_status)
  where storage_path is null;

-- Source data uses deterministic ids and the runner only inserts when no row
-- with the same course and code already exists. This protects CMS edits.
create unique index if not exists cms_course_units_course_code_unique
  on public.cms_course_units (course_id, code)
  where code <> '';
