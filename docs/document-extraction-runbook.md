# Document extraction deployment runbook

This repository has no linked Supabase CLI project or deployment credentials. The steps below are intentionally not executed locally.

1. Apply migrations in order after the existing `0011` migration: `0012_openai_document_extraction_jobs.sql`, then `0013_document_extraction_field_audit.sql`. Use the target **Submissions/Agency Portal** project, not the separate CMS project described in `supabase/README.md`.
2. Deploy `portal-document-delete` and `portal-document-extract` Edge Functions. Keep JWT verification enabled for browser calls.
3. Set Edge Function secrets only (never Vite/browser variables):

   ```text
   OPENAI_API_KEY=<server-side key>
   OPENAI_DOCUMENT_MODEL=<approved vision + Structured Outputs Responses model>
   DOCUMENT_EXTRACTION_WORKER_SECRET=<32+ byte random value>
   ```

4. Create a scheduler (Supabase Cron/pg_cron, a protected CI scheduler, or another trusted server) that POSTs to the deployed `portal-document-extract` URL every minute with `X-Worker-Secret`. It must not use an end-user JWT or expose the secret to a browser. One call claims at most one job; invoke a bounded number of calls per minute to set concurrency.
5. Confirm with a synthetic JPG/PDF: upload from an assigned agent’s draft, observe `queued` then `processing` then `succeeded` in `enrollment_document_extraction_jobs`, verify the document metadata and `enrollment_document_field_reviews`, and confirm only empty `data.values` fields received `fieldProvenance.kind = ai_unverified`.
6. Exercise recovery: force a Storage denial and confirm a `storage_failed` row; force database deletion failure after object deletion and confirm `storage_deleted_row_failed`. Resolve each item explicitly before deleting its recovery row.

Rollback: disable the scheduler and remove the extraction action from the deployed frontend. This preserves documents, applications, extraction history, and unreviewed values. Do not drop the added tables as part of rollback.
