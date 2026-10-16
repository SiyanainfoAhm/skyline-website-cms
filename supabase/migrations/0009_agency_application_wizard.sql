-- =====================================================================
-- Skyline Agency Portal — 0009 (Document Upload Wizard)
--
-- Additive only. Does not touch cms_* or the frozen student_* tables.
--
-- The Add New Form document wizard reuses the existing private
-- `enrollment-documents` bucket and the `enrollment_application_documents`
-- table. The only genuinely-needed addition is a small `metadata` bag to
-- remember what was read from each file (extraction source, which fields
-- were captured, review warnings/conflicts) so the wizard can be resumed
-- and the review screen is stable across reloads.
-- =====================================================================

alter table public.enrollment_application_documents
  add column if not exists metadata jsonb not null default jsonb_build_object();

comment on column public.enrollment_application_documents.metadata is
  'Wizard/extraction metadata: document kind, extracted field names, confidence/review warnings. Never replaces the stored file itself.';