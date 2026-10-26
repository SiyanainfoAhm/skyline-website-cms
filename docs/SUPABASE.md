# Supabase: Edge Functions, migrations, env, hosted release gate

Only project **xcpydisstlvtvcsqnjob** (Skyline Web, ap-southeast-2, PostgreSQL 17, DB system ID **7692130048193495360**) is approved. The Submissions project `qoylrmorezlqdvufonmx` is out of scope: never query or touch it. Everything hosted below needs explicit, release-specific owner approval.

## Edge Functions (`supabase/functions/`)

| Function | verify_jwt | Auth model | Hosted version |
|---|---|---|---|
| cms-admin-users | true | CMS admin JWT | 7 |
| portal-admin-users | true | portal admin JWT | 7 |
| portal-document-delete | true | caller JWT + RLS, validated application-owned path | 7 |
| portal-document-extract | false | worker secret / user enqueue; leased, fenced | 12 |
| public-assistant-index | false | worker secret | 5 |
| public-assistant | false | public, rate-limited | 8 |

`supabase/config.toml` sets `verify_jwt=false` only for the last three; never disable JWT as an auth workaround. Shared code: `_shared/config.ts`, `_shared/document-extraction/` (contract, openai, azure, select, test-only mock). Locked imports via `deno.lock`.

Local source is ahead of hosted for **portal-document-extract** (provider seam P05-01, Azure adapter P05-02): undeployed, hosted stays v12 until a release is approved.

## Env and secret names (never values; never print .env)

Supabase secrets are project-wide; the prefix gives no function isolation. Existing names are compatibility contracts. New integration vars use `EF_<SERVICE>_<SETTING>`. Local values live in ignored `supabase/functions/.env`; `.env.example` is placeholder-only.

| Name | Used by | Notes |
|---|---|---|
| SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY | all six (service role: secret) | managed |
| SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY | user-facing handlers | managed; anon or publishable required |
| DOCUMENT_EXTRACTION_WORKER_SECRET | portal-document-extract | secret; absent = worker never claims |
| OPENAI_API_KEY | extract, assistant, index | secret; absent = deterministic/FAQ only |
| OPENAI_DOCUMENT_MODEL | portal-document-extract | required for extraction |
| OPENAI_BASE_URL | assistant, index | optional; test adapter only |
| EF_DOCUMENT_EXTRACTION_PROVIDER | portal-document-extract | unset/`openai` = OpenAI, `azure` = Azure adapter |
| EF_AZURE_DOCUMENT_ENDPOINT, EF_AZURE_DOCUMENT_API_KEY (secret), EF_AZURE_DOCUMENT_MODEL | portal-document-extract | all required when provider=azure; incomplete = typed unavailable, manual entry continues |
| EF_AZURE_DOCUMENT_MODEL_MAP, EF_AZURE_DOCUMENT_API_VERSION | portal-document-extract | optional (API version default 2024-11-30) |
| PUBLIC_ASSISTANT_WORKER_SECRET | public-assistant-index | secret |
| PUBLIC_ASSISTANT_EMBEDDING_MODEL, _EMBEDDING_DIMENSIONS (1536) | assistant, index | keep query/index compatible |
| PUBLIC_ASSISTANT_GENERATION_MODEL, _ENABLE_GENERATION | public-assistant | generation off unless literal `true` |
| PUBLIC_ASSISTANT_CHUNK_TOKENS (420), _CHUNK_OVERLAP (60), _MAX_CHUNKS (512), _MAX_CONTENT_CHARS, _DOCUMENT_MAX_BYTES, _DOCUMENT_MAX_PAGES, _DOCUMENT_EXTRACTION_MODEL | public-assistant-index | optional tuning; invalid value fails closed |
| Planned: EF_POSTMARK_SERVER_TOKEN, EF_POSTMARK_FROM_EMAIL (P07); EF_STRIPE_SECRET_KEY, EF_STRIPE_WEBHOOK_SECRET (P10) | none yet | not consumed |

## Migrations (`supabase/migrations/`)

- 72 files: `0001`-`0003` legacy, then timestamp-ordered `2026...`. Hosted has all 72, 0 pending. Count must stay 72 until a new migration is added.
- Additive only. Never edit, rename or reorder an applied file; fix forward with a new timestamped file.
- No `db reset`, no blanket `db push`, no history repair. Hosted history had out-of-band drift; apply reviewed wrappers per file.
- Test on a disposable local DB first (clean replay + upgrade from previous schema, RLS/grants/RPC, compensation). SQL tests live in `supabase/tests/`.
- Unknown legacy ownership stays unresolved; never backfill a default tenant.

## Hosted release gate (all steps need explicit approval; stop on any drift)

1. Verify identity: authenticated CLI metadata AND DB `system_identifier = 7692130048193495360` (not just env names or CLI link). Compare hosted migration history with local files.
2. Take a fresh verified encrypted checkpoint (`scripts/release-close/collect-production-checkpoint.mjs`, needs `--approved-recovery-export`).
3. Build a new reviewed manifest: ordered migration files + Edge source hashes + frontend fingerprint + exact commands. Show it to the owner.
4. If writers/workers are affected: install temporary writer guards, hold cron/dispatch and new claims, wait 460 s drain (no running cron, leases or pending pg_net), freeze, fresh checkpoint.
5. Apply migrations in timestamp order with `supabase db query --project-ref xcpydisstlvtvcsqnjob --linked --file <guarded wrapper>`.
6. Deploy only the named functions: `supabase functions deploy <name> --project-ref xcpydisstlvtvcsqnjob` (JWT per table above).
7. Read-only hosted checks, synthetic canaries, public-route smoke at http://localhost:3001; verify versions, JWT, cron state.
8. Remove guards, resume original cron/dispatch, confirm empty queues, clean synthetic data. Record result in COMPLETED.md.

Original cron: extraction worker `*/5 * * * *`, public indexing `*/15 * * * *`.

## Rollback notes

- DB: forward compensation (new additive migration); never remove RLS to roll back; production restore needs separate approval (checkpoints in C:\Users\goura\Skyline-Recovery, see COMPLETED.md for conditions).
- Edge: redeploy the previous source version of the function; JWT settings stay as in the table.
- Scheduler: restoring `* * * * *` schedules is done by the reviewed alter_job statements for `portal-document-extraction-worker` and `public-assistant-index-worker`; do not drop the event-dispatch helpers.
- Local DB-backed lab: disposable network:none Docker containers only; never point tests at hosted data.
