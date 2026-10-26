# CLAUDE.md - Skyline ERP

React 19 / Vite / TypeScript app on Supabase (Postgres, Auth, Storage, Deno Edge Functions). Surfaces: public site, CMS (`src/pages/admin`), Agency Portal (`src/pages/agency`), application wizard, document-extraction queue, public RAG assistant. Preserve all of them with their records, accounts, documents and published URLs.

## Session start
1. `git status --short`: the tree has many intentional uncommitted changes. Preserve them; never revert, stash or clean. Nothing is committed.
2. Read this file, then the phase table and your task in `docs/TASKS.md` only.
3. Read `docs/SUPABASE.md` only for Edge Function, migration or env work; `docs/ARCHITECTURE.md` only if you need the tenancy/security model.

## Per task
- Do the work, run the real checks (`npm run type-check`, lint on changed files, relevant `test:*`), report results in chat.
- Then update only the status line in `docs/TASKS.md` and add <=3 lines to `docs/COMPLETED.md`. If functions, migrations or env names changed, update `docs/SUPABASE.md`. Nothing else.
- Never create: new docs, evidence/log/JSON result files, phase folders, handoff/status/test-results files, or one-off scripts. Tests go in `scripts/test-*.ts|mjs` only when they test product logic. Scratch files go in the OS temp dir, not the repo.
- Owner saying "continue phase N" or "go" authorises local, mock-only work on that task only.
- Report PASS/FAIL/BLOCKED/NOT RUN with exact evidence; compile or mock success is not end-to-end proof. Keep replies short; no recaps of steps.

## Status values
TODO, IN_PROGRESS, BLOCKED, DONE (DONE needs verified acceptance). Local status and hosted release status are separate.

## Safety
- Only project `xcpydisstlvtvcsqnjob` (system ID `7692130048193495360`) is approved; verify real project metadata and DB identity before any hosted operation. Project `qoylrmorezlqdvufonmx` (Submissions) is never touched.
- No hosted migrations, `db push`, reset, repair, Edge deploys, secret/cron/DNS/frontend-hosting changes or provider calls without explicit release-specific approval. The completed Phase 1-4 release is not to be rerun.
- No real student documents; no live provider calls (Azure, OpenAI, Postmark, Stripe, PRISMS); no email or charges. Use deterministic mocks.
- Migrations are additive and timestamp-ordered (72 exist, never edit applied ones). Unknown ownership is never assigned to a default tenant; client tenant IDs are not authorization.
- Keep SEC-18 lease/source fencing and cancellation. JWT stays on; never disable it as an auth workaround.
- Dev server: `vite --port 3001` (http://localhost:3001). Port 3000 belongs to TenderFlow; never disturb it.
- Never print or commit `.env` or CLI secret files. New env vars are named `EF_<SERVICE>_<SETTING>`; `.env.example` stays placeholder-only.
- Backup task `Skyline-xcpydisstlvtvcsqnjob-Recovery-15m` runs `scripts/release-close/*` and writes to `docs/release-evidence/close-20261026/`, `C:\Users\goura\Skyline-Recovery` and `C:\Users\goura\.skyline-recovery-keys`. Do not move, edit or delete those.

## Map
- `src/` frontend; `supabase/functions/` six Edge Functions + `_shared/`; `supabase/migrations/` 72 files; `supabase/tests/` SQL tests; `ocr-service/` local PaddleOCR, not wired to the app.
- `scripts/test-*.{ts,mjs}` product-logic tests (npm `test:*`); `scripts/lab/native-extraction.mjs` native lab (needs `node scripts/lab/server.mjs --p04-complete` and the Docker lab); `scripts/release-close/` backup task only.
- npm: `type-check`, `lint` (known errors: no-explicit-any in public-assistant, no-control-regex at `portal-document-extract/index.ts:81`), `build`, `test:*`; `*:integration` need local Supabase only.

## Current position
Phases 1-4 DONE and hosted-VERIFIED. Phase 5: P05-01, P05-02 DONE locally (undeployed); P05-03, P05-04 TODO. Live Azure NOT RUN. Frontend hosting for https://slit.edu.au is UNVERIFIED and separately gated.
