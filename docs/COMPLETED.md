# Completed log (newest first)

## 2026-10-26 - Repo cleanup
docs/ cut to TASKS, COMPLETED, SUPABASE, ARCHITECTURE; evidence trees, phase docs and one-off scripts deleted (zip backup outside repo). Kept: product tests, native lab chain, backup-task scripts. Not committed.

## 2026-10-26 - P05-02 DONE (local)
Azure adapter `_shared/document-extraction/azure.ts` (REST 2024-11-30, async poll, bounded timeouts, same-origin Operation-Location only) and provider selection via `EF_DOCUMENT_EXTRACTION_PROVIDER` (default openai). 22 Azure + 17 + 9 + 3 cases, Deno check, tsc PASS. Undeployed; live Azure NOT RUN; worker does not yet persist operation ids (P05-03).

## 2026-10-26 - P05-01 DONE (local)
Provider interface, OpenAI adapter behind it, test-only deterministic mock. 17 contract + 9 helper + 3 passport + 20 mock-handler + 4 portal cases, native lab 10 PASS / 0 FAIL before and after. No migration; hosted portal-document-extract stays v12.

## 2026-10-26 - Phase reorder (ADR-012)
Order is now 5 Azure, 6 RTO administration, 7 Postmark, 8 PRISMS, 9 multi-tenant RAG, 10 Stripe, 11 hardening. P06-01 deps re-derived to P03-05 and P04-05 (owner to confirm).

## 2026-10-26 - Phase 1-4 hosted release VERIFIED (do not rerun)
Project xcpydisstlvtvcsqnjob (system ID 7692130048193495360), manifest SHA256 d32c862a...a1378d81. 44 migrations applied: 72 hosted, 0 pending. Completed 04:39 UTC.
Functions (all ACTIVE): cms-admin-users v7 JWT true; portal-admin-users v7 JWT true; portal-document-delete v7 JWT true; portal-document-extract v12 JWT false; public-assistant-index v5 JWT false; public-assistant v8 JWT false.
Acceptance: 10 hosted read-only checks, 16 synthetic canaries, 4 public routes PASS; 83 tables / 1140 original rows unchanged. Verified at http://localhost:3001 (TenderFlow stays on 3000). Writers open, both original cron jobs restored, 3 failed extraction jobs retained without retry.
Frontend artifact SHA256 509d8752...cdf3d unchanged. Frontend hosting for https://slit.edu.au is UNVERIFIED and separately gated; no frontend/DNS deploy happened.

## 2026-10-26 - Backup and recovery
Windows task `Skyline-xcpydisstlvtvcsqnjob-Recovery-15m` (every 15 min, keeps last 48 successful, IgnoreNew, 12 min stop) runs scripts/release-close/scheduled-checkpoint.ps1: encrypted AES-256-GCM checkpoint to C:\Users\goura\Skyline-Recovery, DPAPI keys in C:\Users\goura\.skyline-recovery-keys, journal in docs/release-evidence/close-20261026/. Do not move or delete these paths.
Latest verified checkpoint 73e15717...ed847 (99 tables, 2 private objects, 802087 bytes). Isolated restore + 44-migration + Auth/CMS rehearsal 68.8 s.
RTO 4 h / RPO 1 h hold only with the original project and a healthy Windows user session, network, CLI and DPAPI profile. Not a hosted SLA; daily hosted backups alone do not meet 1 h RPO; no PITR; account/machine-loss recovery unproven.

## 2026-10-25 - Phases 1-4 DONE locally
Phase 2 foundation (tenant registry, authorization boundary, SEC-18 fencing, 56-file clean replay), Phase 3 CMS/branding (98 checks), Phase 4 agency portal (109 checks, 320 SQL assertions).

## Known lint debt
`npm run lint` has pre-existing errors: no-explicit-any in public-assistant, no-control-regex at supabase/functions/portal-document-extract/index.ts:81.

## Open blockers
- P05-03 and later need owner go-ahead per phase (local, mock-only unless stated).
- Any hosted migration, Edge deploy, secret/cron/DNS change or live provider call needs explicit release-specific approval.
- Frontend hosting for slit.edu.au UNVERIFIED.
- Owner to confirm P06-01 re-derived dependencies.
