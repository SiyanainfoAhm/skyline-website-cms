-- =====================================================================
-- Skyline Agency Portal — 0007 (safeguards)
--
-- Adds durable reference/labelling flags so that:
--   * The two seeded reference agencies (Global Pathways Education,
--     Sunrise Overseas Consultants) are marked is_permanent = true and are
--     never removed or deactivated by any automated seed/cleanup step.
--     SLIT Admin may still manage them normally (activate / deactivate /
--     delete) from the portal — the flag only protects them from automated
--     data-hygiene routines and makes them recognisable in the UI.
--   * Any future test rows (agents, applications, memberships) can be
--     flagged is_test = true, so test data can be identified and purged
--     without ever touching the agencies themselves.
--
-- Additive only. Does not touch cms_* or the frozen student_* tables.
-- =====================================================================

alter table public.agencies
  add column if not exists is_permanent boolean not null default false;

alter table public.enrollment_applications
  add column if not exists is_test boolean not null default false;

alter table public.portal_profiles
  add column if not exists is_test boolean not null default false;

alter table public.agency_memberships
  add column if not exists is_test boolean not null default false;

comment on column public.agencies.is_permanent is
  'Reference agency that must never be auto-removed or auto-deactivated by seed/cleanup routines. Still manageable by SLIT Admin.';

comment on column public.enrollment_applications.is_test is
  'Test/demo application. Safe to purge without affecting real agency or reference data.';

comment on column public.portal_profiles.is_test is
  'Test/demo portal user. Safe to purge without affecting real users.';

-- Mark the two seeded reference agencies as permanent.
update public.agencies
  set is_permanent = true, updated_at = now()
  where code in ('GPE-001', 'SOC-002');