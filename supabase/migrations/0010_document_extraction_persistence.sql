-- Per-document OCR persistence. This is additive and safe after either legacy
-- 0006/0007 file: migration runners must record files by checksum/name, not prefix.
alter table public.enrollment_application_documents
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Prevent retrying the same file from creating another document/qualification.
-- Rows created before the wizard have no digest and remain unaffected.
create unique index if not exists idx_app_docs_content_digest
  on public.enrollment_application_documents
  (application_id, category, (metadata ->> 'contentSha256'))
  where metadata ? 'contentSha256';

comment on column public.enrollment_application_documents.metadata is
  'Document-local extraction envelope: contentSha256, extraction.extracted (immutable OCR), extraction.confirmed (agent edits), extraction.status and source. Unreviewed data is never verified application data.';
