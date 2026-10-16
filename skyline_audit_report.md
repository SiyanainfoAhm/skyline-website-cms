# Skyline / SLIT Website & CMS — Codebase Architecture and Audit

**Source:** Uploaded `project-14794689.zip`, inspected 13 October 2026. **Scope:** Static source review only. No production Supabase policies, deployed functions, browser behavior, or live data were independently verified. No source files were modified.

## 1. Stack and execution model
- React 19 + Vite 8 + TypeScript + React Router 7; Tailwind CSS; i18next; Supabase JS 2.57.4.
- Single-page browser application: public routes and `/admin` route hierarchy in `src/router/config.tsx`.
- No custom Express/Next backend in this ZIP. Browser reads/writes Supabase REST/PostgREST, Storage, Auth; privileged staff provisioning runs in Supabase Edge Function.
- `package.json` scripts: `npm run dev`, `npm run build`, `npm run lint`, `npm run type-check` (not `typecheck`).
- Firebase and Stripe libraries appear in dependency manifest; presence alone does not prove active integrations.

## 2. Code directory map
- `src/router/config.tsx`: route inventory, layout and guard composition.
- `src/components/feature/`: public UI blocks (site header/footer, cards, forms, HTML, SEO).
- `src/pages/`: public route screens.
- `src/pages/admin/`: CMS editor screens.
- `src/pages/admin/lib/supabase.ts`: singleton Supabase anon-key client, persisted sessions, auto token refresh, implicit auth flow.
- `src/pages/admin/lib/auth.tsx`: login/logout/reset/role profile and session logic.
- `src/pages/admin/lib/db.ts`: CMS model ↔ SQL mapping, reads and write reconciliation.
- `src/pages/admin/lib/store.tsx`: in-memory CMS state, 600-ms debounced writes, saveNow.
- `src/pages/admin/lib/seed.ts`: initial static content fallback / initial seed.
- `src/lib/publicData.ts`: public-side Supabase reads, conversion of DB rows into public view models.
- `src/hooks/usePublicSite.tsx`: public data provider / refresh / fallback state.
- `src/lib/tableModel.ts`: rich-text table modeling and DOM manipulation utilities.
- `src/pages/admin/components/RichTextEditor.tsx` and `TableEditor.tsx`: editing UI.
- `supabase/migrations/0001..0005`: tables/RLS/auth hardening/course units and field settings.
- `supabase/functions/cms-admin-users/index.ts`: admin-authorized Auth Admin API operations.

## 3. Frontend routes
Public: `/`, `/about-us`, `/our-courses`, `/courses/:slug`, `/information`, `/student-visa`, `/oshc`, `/forms-policies`, `/forms/:id`, `/agents`, `/become-an-agent`, `/contact`, `/enroll-now`, `/reset-password`, wildcard.

Admin: `/admin/login`, `/admin/set-password`, `/admin`, `/admin/courses`, `/admin/courses/:slug`, `/admin/pages`, `/admin/navigation`, `/admin/footer`, `/admin/settings`, `/admin/documents`, `/admin/forms`, `/admin/forms/:id`, `/admin/contact`, `/admin/seo`, `/admin/users`, `/admin/activity`.

`AdminLayout` requires an authenticated profile and redirects accounts marked for password rotation. `RequireAdmin` additionally protects `/admin/users` on the client. Server-side enforcement for user provisioning is inside the Edge Function and database RLS.

## 4. Database schema and relationships
| Table | Role | Important relationship |
|---|---|---|
| `cms_settings` | One row (id=1), branding/contact/site links/hero imagery | parent of social links |
| `cms_social_links` | Social platform, URL, icon, visibility/order | `settings_id` → `cms_settings` CASCADE |
| `cms_users` | Staff profile, role Admin/Editor, Active/Inactive, auth-user link, rotation | `auth_user_id` → `auth.users` ON DELETE SET NULL |
| `cms_courses` | Catalogue and full course metadata, published/draft | parent of course children |
| `cms_course_sections` | Repeatable explanatory content | `course_id` → `cms_courses` CASCADE |
| `cms_course_units` | Structured code/name/Core or Elective rows | `course_id` text; **no FK in supplied 0005 migration** |
| `cms_course_attachments` | File label and URL for a course | `course_id` → `cms_courses` CASCADE |
| `cms_course_links` | Link label, URL, external flag | `course_id` → `cms_courses` CASCADE |
| `cms_pages` | Editable page slug, title/body, SEO, status | standalone |
| `cms_forms` | Form definition | parent of fields |
| `cms_form_fields` | Field label/type/options/order/visibility/config JSON | `form_id` → `cms_forms` CASCADE |
| `cms_documents` | Document/policy metadata and URL | standalone |
| `cms_navigation_items` | Tree of menus | `parent_id` self-FK CASCADE |
| `cms_footer` | Singleton footer data | id=1 |
| `cms_seo` | Per-path metadata | standalone |
| `cms_revisions` | Snapshot history | logical entity ID, not enforced foreign key |
| `cms_activity_log` | Activity records | text actor/action/item/area |

`0001` defines core tables/indexes; `0002` enables RLS and Storage bucket; `0003` is deprecated comment-only history; `0004` hardens account linking; `0005` adds course units, field config JSON, social icon/visibility and home imagery. Compare deployed migration history to these snapshots: source SQL does not automatically prove live schema parity.

## 5. RLS permissions derived from included SQL
- Helpers `cms_is_staff` and `cms_is_admin` are STABLE SECURITY DEFINER functions. Current 0004 logic accepts Active profile with either matching `auth_user_id = auth.uid()` **or** matching JWT email; Admin additionally needs `role='Admin'`.
- `cms_courses`, `cms_pages`, `cms_forms`, `cms_documents`: anonymous SELECT only when Published; staff SELECT all and perform ALL write operations.
- `cms_course_sections`, `_attachments`, `_links`, `_units`, `cms_form_fields`: public SELECT only if parent Published; staff can read/write.
- `cms_navigation_items`, `cms_footer`, `cms_settings`, `cms_social_links`, `cms_seo`: SELECT by everyone; write by Active staff.
- `cms_users`: staff SELECT; only Active Admin write.
- `cms_revisions` and `cms_activity_log`: staff read/write.
- `storage.objects` for `cms-media`: public SELECT; staff `FOR ALL` using/check in same bucket. Bucket is public. This is appropriate for deliberately public media, not confidential attachments.
- No tenant/company scoping appears in these policies: this code represents a single-institution CMS with Admin/Editor separation.
- Important: UI route visibility is not itself security; Supabase RLS and Edge authorization must be tested against anon/editor/admin JWTs.

## 6. Auth sequence
1. Browser initializes shared `supabase` client with `VITE_PUBLIC_SUPABASE_URL` and `VITE_PUBLIC_SUPABASE_ANON_KEY`.
2. `auth.signInWithPassword` verifies Supabase Auth user.
3. `resolveSessionUser` queries `cms_users` and checks Active profile, with `auth_user_id` query (email fallback when no ID supplied).
4. `AdminLayout` guards admin screens; `RequireAdmin` guards Users.
5. `must_change_password` redirects to `/admin/set-password`; password update calls `auth.updateUser`, then RPC `cms_clear_password_rotation`.
6. Password recovery via `auth.resetPasswordForEmail` and `/reset-password`.
7. Staff invitation/reset/delete/list uses `cms-admin-users` Edge Function; it authenticates caller JWT, checks Active Admin in `cms_users`, then uses service-role Auth Admin API and updates linked profile.

Security review targets: JWT email fallback in RLS, `redirectTo` supplied by browser to privileged invite/reset function (validate allowlist), administration of existing accounts, account deletion partial failures, leaked recovery links, and explicit function JWT verification configuration.

## 7. API and external integration inventory
- Supabase Auth API: sign in, sign out, update password, reset email, get current user, auth session events.
- Supabase PostgREST: `.from('cms_*').select('*')`, upsert, delete, update; used from browser.
- Supabase RPC: `cms_clear_password_rotation`.
- Supabase Storage `cms-media`: upload and public URL construction.
- Supabase Edge Function `cms-admin-users`: POST actions `invite`, `reset`, `delete`, `list`; service role held server side. `redirectTo` and identity checks deserve targeted security tests.
- External submission endpoints in source:
  - Contact: `https://readdy.ai/api/form/db31smmoc082o2i1kl80`
  - Enroll: `https://readdy.ai/api/form/db31st6oc082o2i1kl8g`
  - Become an agent: `https://readdy.ai/api/form/db31t96oc082o2i1kl90`
  - Generic CMS form: `https://readdy.ai/api/form/db6vsjecdv04m4p4ge4g`
  These are **not Supabase tables in the included schema**. Ownership, payload format, retention, spam protection, attachment storage, and submission-view capabilities need external verification.

## 8. How CMS changes reach the public website
- `AdminStoreProvider` loads all CMS data into React state via `loadAdminData()`; if courses/pages/forms are all empty, builds initial seeded content locally and prepares an empty baseline.
- Editor changes go through `update` (600ms debounced) or `saveNow` (immediate persistence with propagated error). `persistAdminData()` builds row lists, compares ID-keyed snapshots and sequentially upserts/deletes each table.
- `PublicSiteProvider` starts with static fallback and invokes `loadPublicSiteData()` to load site settings, navigation, courses, sections, units, pages, documents, forms and fields. It exposes `isLive` and refresh/reload functions.
- Public data loaders fall back to bundled static data when the CMS is entirely unseeded; if Supabase is unreachable, the context initially holds static fallback but signals an error. An editor's saved update may require a public-side refresh/reload to be seen immediately; there is no proof of realtime subscription.
- Sequential cross-table reconciliation is not atomic, so partially saved edits are possible. Dirty-state, concurrent-editor handling, rollback/undo and failed debounced-save visibility need dedicated tests.

## 9. Functional module mapping
| Module | UI source | Persistence / public consumption |
|---|---|---|
| Courses | `CoursesPage`, `CourseEditorPage` | `cms_courses`, child tables → courses listing/detail |
| Units | course editor | `cms_course_units` → course view |
| Attachments/links | course editor | `cms_course_attachments`, `cms_course_links`; verify exact public rendering behavior |
| Pages | `PagesPage` + rich text/table editors | `cms_pages` → content routes |
| Forms | `FormsPage`, `FormBuilderPage`, `FormFieldControl` | `cms_forms`, `cms_form_fields` → `/forms/:id`; submissions via Readdy endpoint |
| Documents | `DocumentsPage` | `cms_documents` → Forms & Policies public page |
| Menus | `NavigationPage` | `cms_navigation_items` → site header |
| Footer | `FooterPage` | `cms_footer` → site footer |
| Settings/social | `SettingsPage` | `cms_settings`, `cms_social_links` → public branding/contact/social |
| SEO | `SeoPage` | `cms_seo` plus page SEO fields → SEO output; precedence needs tests |
| Staff | `UsersPage` | `cms_users` + `cms-admin-users` Edge Function |
| Activity/history | `ActivityPage` | `cms_activity_log` / `cms_revisions` and in-memory state; verify durable persistence for all actions |

## 10. Preliminary risks ranked
**High priority to validate before feature work:**
1. Role and authentication hardening: SQL helpers allow email fallback even when a linked Auth UID exists; evaluate whether stronger UID-only checks are appropriate after migration.
2. External form destinations: submissions may be stored outside Supabase with differing privacy/security, without CMS submission management.
3. Multi-table non-transactional save and silently logged errors on debounced save: partial updates and undetected failures possible.
4. Admin edge function accepts caller-provided redirect URL; validate approved origins and link protection.
5. Validate applied migrations and policies in the actual Supabase instance; included ZIP alone cannot attest to deployment state.

**Medium priority:**
6. `cms_course_units` has no foreign key to `cms_courses` in supplied SQL; orphan child rows possible.
7. `cms-media` is public, so never upload private enrollment documents into it.
8. Static fallback/seed can mask missing data or create uncertainty about source of truth.
9. Potential differences between browser editing state, automatic save and explicit Save buttons; requires UI tests.
10. Check activity/revision durability; some updates are in-memory before persistence.
11. No comprehensive automated tests appear in ZIP package scripts, so functional/RLS regression coverage is unverified.
12. `supabase/README.md` migration checklist stops at 0004 although 0005 exists; update documentation after verifying live migration history.

## 11. Verification plan before any changes
**Phase A: Inventory:** map every route, component and Supabase table; document data transformations and code owners.

**Phase B: Database:** retrieve live `information_schema` tables/columns/FKs/indexes/triggers/functions, `pg_policies`, grants, Storage bucket policies and Auth configuration. Compare with migration snapshots, read-only.

**Phase C: API contracts:** trace request/response/side effects for each Supabase call, Edge action and Readdy submission; verify external form ownership and storage.

**Phase D: Role security:** anonymous/Editor/Admin checks for read, write, draft visibility, media, account invites/deletes, RPC and custom links. Use test accounts only.

**Phase E: Functional acceptance:** audit every admin module Create → Edit → Save → Reload → Public View → Unpublish/Delete/Restore. Include rich text/table Undo/Save, form field types, navigation ordering, document linking and concurrent browser edits.

**Phase F: Baseline report:** mark each feature Working / Broken / Partial / Unverified, with reproduction steps, risk, recommended fix and dependency order. Do not implement until approved.

## 12. Explicit limitations
This is a source-grounded architecture review, not a penetration test or end-to-end QA certification. The uploaded ZIP has source and migrations, but no live Supabase schema export, Edge deployment metadata, test account session, Readdy API contract, network trace, or runnable browser session. Environment secrets were intentionally excluded from the report.
