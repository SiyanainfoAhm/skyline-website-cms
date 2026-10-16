# Document extraction deployment runbook

## Target and authentication

The only project reference present in this checkout is `xcpydisstlvtvcsqnjob`,
from the public client URL. `supabase/README.md` describes it as **Skyline Test
(CMS)**, so do not use it for portal document migrations unless its owner
explicitly confirms it is also the intended portal backend. The checkout is not
linked to any project and the Supabase CLI is not authenticated.

An Owner or Administrator should authenticate the official CLI using their own
personal access token (or the interactive `supabase login` flow), then link the
confirmed portal project. Keep the token in the operating-system credential
store or CI secret store; it must never be placed in `.env`, source, or Git.

```powershell
npx supabase login
npx supabase link --project-ref <CONFIRMED_PORTAL_PROJECT_REF>
npx supabase migration list
```

Check the migration history first. These migrations depend on the prior portal
schema (`0006` through `0011`), and must not be applied to a CMS-only project.

## Edge Function secrets

Set these only in **Supabase Dashboard → Edge Functions → Secrets**, or from a
gitignored local secret file passed to `supabase secrets set --env-file`:

| Secret | Required value |
| --- | --- |
| `OPENAI_API_KEY` | A project-scoped OpenAI API key with Responses API access. |
| `OPENAI_DOCUMENT_MODEL` | `gpt-4.1-mini` (pin a dated snapshot after acceptance testing if reproducibility is required). |
| `DOCUMENT_EXTRACTION_WORKER_SECRET` | A new high-entropy random secret, generated and stored by the organisation's password/secret manager. |

Do not set any `SUPABASE_*` value manually: hosted Edge Functions inject their
Supabase credentials. The service-role key must never be a frontend variable.

`gpt-4.1-mini` is the selected model because the Responses API accepts
`input_file` content and strict JSON Schema output; validate this against the
actual OpenAI project by processing a non-production fixture before enabling
the worker. See the official [Responses input-file and structured-output
reference](https://platform.openai.com/docs/api-reference/responses-streaming/response/content_part).

## Database, functions, and scheduler

After a backup and a migration-history review, apply only the two new migrations
requested for this release:

```powershell
npx supabase db push
npx supabase functions deploy portal-document-extract --no-verify-jwt
npx supabase functions deploy portal-document-delete
```

The `--no-verify-jwt` setting is intentional only for `portal-document-extract`:
its browser branch performs its own bearer-token/RLS lookup and its worker branch
requires `x-worker-secret`. `portal-document-delete` remains JWT-gated.

Configure the scheduler in the SQL editor as a database administrator. Create
the Vault values interactively; substitute neither secret values nor API keys in
migration files. Then schedule one worker invocation per minute (the worker
claims one job atomically; use more schedules only after capacity testing):

```sql
select vault.create_secret('https://<CONFIRMED_PORTAL_PROJECT_REF>.supabase.co', 'document_extraction_project_url');
select vault.create_secret('<THE_SAME_SECRET_STORED_AS_DOCUMENT_EXTRACTION_WORKER_SECRET>', 'document_extraction_worker_secret');

select cron.schedule(
  'portal-document-extraction-worker-v1',
  '* * * * *',
  $$select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'document_extraction_project_url') || '/functions/v1/portal-document-extract',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'document_extraction_worker_secret')),
    body := '{}'::jsonb
  )$$
);
```

Confirm there is only one active job named
`portal-document-extraction-worker-v1`; inspect `cron.job` and the relevant
`net` response table after the first scheduled run. Supabase documents the
Vault + `pg_cron`/`pg_net` pattern in its [function scheduling
guide](https://supabase.com/docs/guides/functions/schedule-functions).

## Frontend

No Vercel, Netlify, Cloudflare, GitHub Actions, or other frontend deployment
configuration exists in this checkout, and it is not a Git repository. The
only reproducible frontend action available here is `npm run build`, which
generates `out/`. Use the established host's existing upload/publish workflow
for `out/` after setting the public Supabase URL and publishable key in that
host's environment. Do not invent a new host or upload credentials.

## Controlled verification

Use a disposable application, an authorised assigned agent, and a synthetic
passport image/PDF. Verify: upload creates a private Storage object and document
row; queue creates a job; the scheduled worker succeeds; the worker writes the
document extraction plus application values and field-review rows; a correction
and confirmation remain after reload; deletion removes the object/row or leaves
a recovery row; and a different agency and an unassigned same-agency agent see
neither document nor review data.
