# CLAUDE.md - Skyline ERP

React 19 / Vite / TypeScript app on Supabase (Postgres, Auth, Storage, Deno Edge Functions). Surfaces: public site, CMS (`src/pages/admin`), Agency Portal (`src/pages/agency`), application wizard, document-extraction queue, public RAG assistant. Preserve all of them with their records, accounts, documents and published URLs.

## Session start
1. `git status --short`: the tree may hold intentional uncommitted changes. Preserve them; never revert, stash or clean.
2. Read this file, then the phase table and your task in `docs/TASKS.md` only.
3. Read `docs/SUPABASE.md` only for Edge Function, migration or env work; `docs/ARCHITECTURE.md` only if you need the tenancy/security model.

## "go" protocol
When the owner says "go" or "continue", do the next eligible task: the first TODO task in `docs/TASKS.md` whose dependencies are all DONE. "go P0X-0Y" picks that task. Local, mock-only work only; finish ONE task, then stop and report.
- Read only that task, plus SUPABASE.md / ARCHITECTURE.md if relevant.
- Migrations: additive, local only, never applied hosted. Tests go into existing test scripts and `supabase/tests`, not new files. Run the native lab when the task touches DB or Edge behavior.
- Before reporting run: type-check, build, lint on src/, offline `test:*`, deno check on all functions, migrations count; if the task touches DB or Edge behavior, run ALL supabase/tests SQL suites in the lab and report counts. Fix lint issues only in files you touch.
- Update only the task's status line in TASKS.md, at most 3 lines in COMPLETED.md, and SUPABASE.md if functions, migrations or env names changed.
- Stop and ask instead of proceeding when the task is BLOCKED or needs hosted/live/credentials, a decision cannot be undone, or acceptance cannot be verified locally.
- Report PASS/FAIL/BLOCKED/NOT RUN with exact evidence in chat; compile or mock success is not end-to-end proof. Keep replies short; no recaps of steps.

## Efficiency
- Search with Grep and read file ranges; don't read whole large files, and don't re-read a file you just edited.
- Run only the relevant tests while developing; run the full pre-report suite once at the end.
- Pipe command output through tail/grep so only failures and summary lines enter the conversation.
- No narration between tool calls. Final report max 15 lines: what changed, PASS/FAIL/NOT RUN per check, decisions needed.
- Don't paste SQL or code into the report; name the file and test.
- Don't create plans or recaps; just do the task.

## Never create
New docs, evidence/log/JSON result files, phase folders, handoff/status/test-results files, or one-off scripts. Scratch files go in the OS temp dir, not the repo.

## Status values
TODO, IN_PROGRESS, BLOCKED, DONE (DONE needs verified acceptance). Local status and hosted release status are separate.

## Safety
- Only project `xcpydisstlvtvcsqnjob` (system ID `7692130048193495360`) is approved; verify real project metadata and DB identity before any hosted operation. Project `qoylrmorezlqdvufonmx` (Submissions) is never touched.
- No hosted migrations, `db push`, reset, repair, Edge deploys, secret/cron/DNS/frontend-hosting changes, commits or provider calls without explicit release-specific approval. The completed Phase 1-4 release is not to be rerun.
- No real student documents; no live provider calls (Azure, OpenAI, Postmark, Stripe, PRISMS); no email or charges. Use deterministic mocks.
- Migrations are additive and timestamp-ordered (never edit applied ones; the newest eleven (73rd-83rd) are local only). Unknown ownership is never assigned to a default tenant; client tenant IDs are not authorization.
- Keep SEC-18 lease/source fencing and cancellation. JWT stays on; never disable it as an auth workaround.
- Dev server: `vite --port 3001`. Port 3000 belongs to TenderFlow; never disturb it.
- Never print or commit `.env` or CLI secret files. New env vars are named `EF_<SERVICE>_<SETTING>`; `.env.example` stays placeholder-only.
- Backup task `Skyline-xcpydisstlvtvcsqnjob-Recovery-15m` runs `scripts/release-close/*` and writes to `docs/release-evidence/close-20261026/`, `C:\Users\goura\Skyline-Recovery` and `C:\Users\goura\.skyline-recovery-keys`. Do not move, edit or delete those.

## Map
- `src/` frontend; `supabase/functions/` seven Edge Functions (notification-delivery is local only) + `_shared/`; `supabase/migrations/` 83 files; `supabase/tests/` SQL tests; `ocr-service/` local PaddleOCR, not wired to the app.
- `scripts/test-*.{ts,mjs}` product-logic tests (npm `test:*`); `scripts/lab/` native lab (start `node scripts/lab/server.mjs --p04-complete`, needs Docker; run `scripts/lab/native-extraction.mjs`, add `--azure` / `--notify` for the Azure / notification paths); `scripts/release-close/` backup task only.
- npm: `type-check`, `lint` (covers `src/` only), `build`, `test:*`; `*:integration` and `test:public-assistant:local-acceptance` need local Supabase.

## Current position
Phases 1-4 DONE and hosted-VERIFIED. Phase 5: P05-01..03 DONE locally (undeployed; hosted needs migrations 73-83 + redeploy + secrets); P05-04 BLOCKED on live Azure approval. Phase 6 DONE locally (migrations 74-77 undeployed). Phase 7 DONE locally (migrations 78-80 and the notification-delivery function undeployed; its config.toml verify_jwt=false entry is added, both routes fail closed). Phase 8 DONE locally (migrations 81-83 undeployed). Next eligible: P09-01. Live Postmark NOT RUN. Live Azure NOT RUN. Frontend hosting for https://slit.edu.au is UNVERIFIED and separately gated.
