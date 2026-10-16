# Skyline – Website UI/UX Redesign & Modern Frontend

## 1. Project Description
A UI/UX redesign and frontend modernisation of the Skyline Institute of Technology public website
(https://slit.edu.au). The existing WordPress site is the **single source of truth for content**.

- **Goal:** keep 100% of approved content, rebuild the presentation on a modern React frontend,
  improve information architecture, navigation, usability and accessibility.
- **Audience:** prospective international students, current students, education agents, partners.
- **Core value:** make Skyline look like a credible, modern Australian RTO / CRICOS provider.

**Hard rules for this project**
- Do NOT rewrite, shorten, summarise or invent content.
- Preserve headings, paragraphs, lists, tables, phone numbers, emails, course codes and policy wording exactly.
- Where content is uncertain or duplicated, flag it as **CLIENT CONTENT REVIEW REQUIRED** — never silently fix.
- Keep the original URLs so SEO is preserved (no redirects required).

## 1b. Admin / CMS Module (ADDED — see §8)
Skyline wants a staff-facing CMS/Admin portal so non-technical staff can manage all editable website
content. Chosen architecture:
- Public website: `slit.edu.au`
- CMS/Admin: `slit.edu.au/admin` — a **logically separate, secured Admin module** (not mixed into public pages)
- Shared backend/content API + shared database/media storage
- `/admin` MUST be protected by real authentication + authorization + server-side access control;
  merely visiting the route must never grant CMS access.

**Hard dependency (BLOCKER):** the CMS requires authentication, user roles/permissions, a database
and media storage. It therefore MUST run on a connected backend (Readdy Backend or SaaS Supabase).
It cannot be built on mock data, because mock auth provides no real security.

**RESOLVED — real backend in place (supersedes the earlier prototype-first decision):**
the CMS now runs on a connected Supabase project (`xcpydisstlvtvcsqnjob`) with **real Supabase
Auth** (email + password), real database tables (`cms_` prefix) and Storage. The earlier
front-end-only prototype login has been removed entirely.

**Auth hardening rules (enforced):**
- The `auth` schema is **never** written by hand. Staff accounts are provisioned exclusively
  through the official **Supabase Auth Admin API**, exposed as the `cms-admin-users` Edge Function
  (Admin-guarded): `inviteUserByEmail` / `createUser` / `generateLink` / `deleteUser`.
- Each `cms_users` profile is linked to the real Auth user via `auth_user_id` (FK to `auth.users`).
- No password is ever hardcoded in the app or repo. Users set their own password via a single-use
  invite/reset link (`/reset-password` for email recovery; `/admin/set-password` for forced
  rotation); the login screen exposes a working "Forgot password?".
- `cms_users.must_change_password` forces a rotation on the next sign-in for any account whose
  credentials were exposed.
- `/admin/*` is protected by authentication AND role authorization (Admin vs Editor); unauthorized
  visitors are redirected to `/admin/login`.

## 2. Page Structure (URLs preserved from source)
Public routes (same paths as the live site):

- `/` – Home
- `/about-us` – About Us
- `/our-courses` – Courses (listing)
- `/courses/:slug` – Course detail (template)
- `/agents` – Registered Agents
- `/become-an-agent` – Become an Agent
- `/information` – Student Information
- `/student-visa` – Student Visa
- `/oshc` – OSHC
- `/forms-policies` – Forms & Policies
- `/contact` – Contact Us
- `/enroll-now` – Enroll Now
- `*` – Not Found

External (kept as-is): social profiles; policy/form PDF links; OSHC Konpare link; government resource links;
the Student Submissions portal URL retained as CMS-managed data (Website Settings).
Internal (CMS): header **Sign In → `/admin/login`** (the website's own Admin CMS login, backed by Supabase Auth).

### Page inventory classification
| ID | Page | URL | Type | Disposition |
|----|------|-----|------|-------------|
| PG-001 | Home | `/` | Marketing | ACTIVE / REQUIRED |
| PG-002 | About Us | `/about-us` | Content | ACTIVE / REQUIRED |
| PG-003 | Our Courses | `/our-courses` | Catalogue | ACTIVE / REQUIRED |
| PG-004 | Course detail | `/courses/*` | Course template | ACTIVE / REQUIRED |
| PG-005 | Contact | `/contact` | Contact + form | ACTIVE / REQUIRED |
| PG-006 | Enroll Now | `/enroll-now` | Application | ACTIVE / REQUIRED |
| PG-007 | Information | `/information` | Student info | ACTIVE / REQUIRED |
| PG-008 | Student Visa | `/student-visa` | Student info | ACTIVE / REQUIRED |
| PG-009 | OSHC | `/oshc` | Student info | ACTIVE / REQUIRED |
| PG-010 | Forms & Policies | `/forms-policies` | Resources | ACTIVE / REQUIRED |
| PG-011 | Become an Agent | `/become-an-agent` | Agent | ACTIVE / REQUIRED |
| PG-012 | Agents | `/agents` | Agent directory | ACTIVE / REQUIRED |
| PG-013 | Home Page 02/03 | `/home-page-02`, `/home-page-03` | Theme demo | LEGACY / TEMPLATE — NOT MIGRATED |
| PG-014 | Sample Page, Pricing, Teacher, Our Event, Our Gallery, Blog, FAQ, Under Maintenance | various | Theme demo/obsolete | LEGACY / TEMPLATE — NOT MIGRATED |

### Content review flags
- **CLIENT CONTENT REVIEW REQUIRED:** Agents page "BANSAL EDUCATION GROUP" phone `0456 000 518` appears
  inconsistent with typical mobile format — preserved exactly as found, not corrected.
- **CLIENT CONTENT REVIEW REQUIRED:** Forms link `/under-maintenance` targets for all Policies —
  the policy PDFs are not published on the live site. Links preserved pointing to the same targets.
- **CLIENT CONTENT REVIEW REQUIRED:** Become an Agent form references `marketing@iti.edu.au`
  (different domain) inside source description — preserved exactly, not corrected.

## 3. Core Features
- [x] Responsive global header with mega menu (Courses) and dropdowns (Students, Agents)
- [x] Mobile navigation drawer
- [x] Reusable content-page template (content separated from presentation)
- [x] Course catalogue + reusable course detail template
- [x] Contact enquiry form (Built-in Form)
- [x] Enrolment enquiry form (Built-in Form)
- [x] Document / policy resource listing
- [x] Responsive footer with acknowledgement, RTO/CRICOS and quick links
- [x] Per-page SEO metadata: title, description, canonical URL, Open Graph / Twitter tags on every route
- [x] schema.org structured data: Organization + LocalBusiness (site-wide), WebSite + SearchAction, Course per course, BreadcrumbList, ItemList for the course catalogue
- [ ] Headless CMS / editable content source — **approved, blocked on backend connection (see §8)**

## 4. Data Model Design
No database required for this redesign (static public content). Content currently lives in typed
data modules under `src/data/` so it is cleanly separated from presentation. If Skyline wants
staff-editable content later, the same shapes map directly onto a headless CMS.

## 5. Backend / Third-party Integration Plan
- Database: **not required now** (public, static content).
- Forms: **Built-in Form** (Contact & Enquiry, Enrolment Enquiry) — no Supabase needed.
- Shopify / Stripe / payments: not required.
- Sign In: the public header **Sign In** button now routes to the website's own Admin CMS login
  (`/admin/login`), reusing the existing CMS login UI and Supabase Authentication. It no longer
  points at the external Submissions portal. The external student submissions portal URL is kept
  only as CMS-managed data (Website Settings → Student portal sign-in URL) for intentional use
  elsewhere — never as the Admin CMS sign-in flow.
- Auth: **Supabase Auth** (email + password). CMS roles/profiles live in `cms_users`, linked to the
  Auth user via `auth_user_id`. New staff are provisioned through the `cms-admin-users` Edge Function
  (official Auth Admin API) — never by writing the `auth` schema. Exposed credentials are rotated via
  the `must_change_password` flag. RLS helpers (`cms_is_staff` / `cms_is_admin`) authorize writes by
  Auth uid (email fallback).

## 6. Development Phase Plan

### Phase 1: Design system, global shell & Home (this delivery)
- Goal: establish the reusable design system + navigation + footer, and ship a fully redesigned Home.
- Deliverable: palette/typography tokens, header, footer, Home page using the approved hero image.

### Phase 2: Core pages (this delivery)
- Goal: About Us, Courses listing, Course detail template, Contact, Enroll Now.
- Deliverable: reusable templates driven by data, contact + enrolment forms.

### Phase 3: Students & Agents (this delivery)
- Goal: Information, Student Visa, OSHC, Forms & Policies, Become an Agent, Registered Agents.

### Phase 4: Course detail content depth — COMPLETE
- Goal: crawl and migrate the full unit-of-competency lists and full descriptions for every course.
- Deliverable: complete course detail content, no invented data.
- Status: DONE. `src/data/courseUnits.ts` holds verbatim unit lists for all 13 courses
  (codes, names, Core/Elective category, including Elective Group A/B and Imported Elective
  markers where the source defines them) and `src/data/courseDetails.ts` holds the full verbatim
  descriptions, entry requirements, careers, duration and fees. Unit counts reconcile with the
  "X Core / Y Elective" totals stated in each course's training-package section.
  These same data shapes are the source of truth the CMS will read and write in Phase 6.

### Phase 5: SEO + structured data — COMPLETE
- Goal: full SEO and structured-data pass on the public website.
- Status: DONE. Every route now emits its own title, meta description, canonical URL and social
  tags via the reusable `Seo` component (React 19 native document metadata). schema.org JSON-LD
  covers the organisation, the site (with SearchAction), each course (Course + Offer + provider),
  breadcrumbs and the course catalogue ItemList. Document language set to `en-AU`.
- Still open from §7: OQ-002 policy PDFs linking to `/under-maintenance`.

### Phase 6: Admin / CMS portal (NEW direction — see §8)
Delivered in sub-phases (do NOT build all at once). **Order revised to match how Skyline staff
actually work day to day** — get in, set the global identity once, load the assets, then run the
offering, pages and forms, with governance and safety brought forward so nothing is edited blind:

- **6.1 Backend + Admin auth & shell + Dashboard** — connect backend; secure `/admin`;
  login / forgot-password / session states; role model (Admin / Editor); protected Admin layout
  with persistent left nav; operational Dashboard. *Foundation — the gate for everything else.*
- **6.2 Global Settings + Header & Navigation + Footer** — the first real editing job: staff
  set the phone, email, address, logo, RTO/CRICOS numbers, nav menu and footer **once**, and every
  page that shows them updates. (Moved up from the old 6.4 — this is what staff touch first and it
  removes duplicate editing of the same contact info.)
- **6.3 Media Library + Documents & Policies** — load images and PDFs *before* building courses and
  pages, because courses, pages and forms all pull from these. (Moved up from the old 6.5.)
- **6.4 Course management** — courses listing (search/filter/sort/paginate), add/edit course,
  display order + Featured-on-homepage control, media & attachments. Reads/writes the Phase 4
  course + unit data directly. (Was 6.2 — now that globals and assets exist, courses can be
  completed in one pass without revisiting.)
- **6.5 Pages + page builder** — pages list, page editor, create page, controlled content blocks.
- **6.6 Forms** — form list + form field builder + preview (Enroll Now,
  Become an Agent, Contact Us — the three live forms).
- **6.7 Governance** — Links, SEO / page settings, Users & Permissions, Activity/Audit log.
- **6.8 Safety & protection** — confirmations, version history and system states. **Note:** the
  draft → preview → publish flow is a cross-cutting rule introduced with 6.2 and applied to every
  module from then on; 6.8 hardens it (restore previous version, destructive-action confirmations,
  empty/error/permission-denied/unsaved-changes states everywhere).

> Rationale for the reorder: the original order (Courses before Settings/Media) forced staff to
> re-enter shared contact details and re-upload assets as each module arrived. Setting global
> content and the asset library first, then courses, means each later module can be finished once
> and the public site stays consistent throughout.

## 7. Open Questions
- **OQ-001** — Content source for course detail pages. Source page: every `/courses/*`. Impact: full unit
  lists are only partially visible on the public listing. Recommendation: crawl each course page and
  migrate verbatim. Client confirmation required: Yes.
- **OQ-002** — Policy documents currently link to `/under-maintenance`. Impact: resources unusable.
  Recommendation: supply the published policy PDFs. Client confirmation required: Yes.
- **OQ-003** — CMS/editability target. **RESOLVED:** a secured Admin/CMS module at `/admin` backed by a
  connected backend (Readdy Backend or SaaS Supabase). Requires backend connection before build.
- **OQ-004** — Legacy WordPress theme demo pages (Pricing, Teacher, Our Gallery, Our Event, Blog, Sample Page,
  Home Page 02/03, Under Maintenance). Recommendation: exclude from the new site. Client confirmation required: Yes.

## 8. CMS Information Architecture (target navigation)
Dashboard · Courses · Pages · Header & Navigation · Footer · Website Settings ·
Documents & Policies · Forms · Contact Information · SEO / Page Settings ·
Users & Permissions · Activity / Audit Log · (Settings & account controls pinned at bottom).

> Removed per client review: **Media Library** and **Links** modules. Images are managed through
the Logo/Favicon and course image URL fields; navigation links live in Header & Navigation.

## 9. CMS → Public Website Synchronisation (runtime read layer)

**Problem (root cause):** the CMS persisted every change to the Supabase `cms_*` tables, but the
public website rendered entirely from hard-coded modules under `src/data/` and **never queried
Supabase at runtime**. So CMS edits were saved but never surfaced — this was a data-source
disconnect, not a caching issue.

**Fix:** a shared runtime read layer for the public site. Supabase is the single source of truth.

- `src/lib/publicData.ts` — anonymous runtime loaders that read `cms_settings`, `cms_social_links`,
  `cms_navigation_items`, `cms_footer`, `cms_courses`, `cms_course_sections`, `cms_pages` and
  `cms_documents` and map them into the public view models (settings, navigation, footer, courses,
  pages, documents). Ordering uses `sort` / `display_order` with a deterministic name tiebreaker.
- `src/hooks/usePublicSite.tsx` — `PublicSiteProvider` loads once on mount, keeps the latest data in
  context and re-reads silently on route navigation. `isLive` (a.k.a. `backedByDatabase`) is true
  only when the data came from real CMS records.
- Static `src/data/*` content is kept **only** as a first-paint / unreachable-database fallback. Once
  the database is authoritative, its state (including intentionally empty lists) is used verbatim —
  stale fallback never overrides a successful database response.
- Wired surfaces: header navigation + settings, footer, home featured courses, courses listing,
  course detail, content pages (`cms_pages.body`), contact info/map, documents (Forms & Policies),
  Enroll admissions link.
- RLS already permits anonymous SELECT on the public tables (`settings`/`social`/`nav`/`footer`/`seo`
  unconditionally; `courses`/`pages`/`documents` only when `status = 'Published'`), so unpublished
  rows correctly disappear without weakening security.

**Known remaining static content:** the Registered Agents directory (`AgentsTable`) still reads the
static agents table; the Latest News cards are static marketing content (not a CMS module).

### CMS cross-cutting rules
- Conditional content: if a field/section is empty or N/A, it is NOT rendered on the public site.
- Rich-text editor for long-form content (no arbitrary fonts/colors that break the design system).
- Draft → Preview → Publish, plus basic version history (restore previous version).
- Destructive actions require confirmation; prefer archive/unpublish over hard delete.
- Every listing screen supports search / filter / sort / pagination.
- Every screen defines loading, empty, success, error, validation, no-results, permission-denied
  and unsaved-changes states.
- Visual direction: Skyline orange as primary action/accent, white surfaces, neutral grey backgrounds,
  dark text, clear borders, moderate rounded corners — restrained and professional, not decorative.