-- Edge Function portal-document-delete performs the coordinated storage/row workflow.
-- This index helps its authorised document lookup and does not change existing rows.
create index if not exists idx_app_docs_id_application on public.enrollment_application_documents (id, application_id);
