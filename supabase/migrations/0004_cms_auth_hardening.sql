-- =====================================================================
-- Skyline Website CMS — auth hardening (0004)
-- Project: Skyline Test (dev)  |  Target ref: xcpydisstlvtvcsqnjob
--
-- WHY: The original accounts were provisioned by hand-writing rows into
-- auth.users / auth.identities. That bypasses GoTrue's invariants and produced
-- `unexpected_failure: Database error querying schema` at sign-in time.
--
-- RULE FROM NOW ON: the `auth` schema is NEVER written by hand. Staff accounts
-- are created/updated/deleted exclusively through the Supabase Auth Admin API
-- via the `cms-admin-users` Edge Function.
--
-- This migration only touches the PUBLIC schema. It links each CMS profile to
-- its real Auth user id and records a forced password rotation.
-- =====================================================================

-- 1) Link cms_users to the real Supabase Auth user, and add a rotation flag.
alter table public.cms_users
  add column if not exists auth_user_id uuid,
  add column if not exists must_change_password boolean not null default false;

-- 2) FK to the Auth user (deleting the Auth user clears the link, not the profile).
alter table public.cms_users
  add constraint cms_users_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete set null;

-- 3) Backfill the link from the existing email match.
update public.cms_users u
set auth_user_id = a.id
from auth.users a
where lower(a.email) = lower(u.email)
  and u.auth_user_id is null;

-- 4) Force a password rotation for any account whose credentials were exposed.
update public.cms_users
set must_change_password = true
where lower(email) in ('itadmin@slit.edu.au', 'editor@slit.edu.au');

-- 5) Harden the RLS helpers: match on the Auth uid first, email as a fallback.
create or replace function public.cms_is_staff()
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.cms_users u
    where u.status = 'Active'
      and (u.auth_user_id = auth.uid()
           or lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );
$function$;

create or replace function public.cms_is_admin()
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.cms_users u
    where u.status = 'Active' and u.role = 'Admin'
      and (u.auth_user_id = auth.uid()
           or lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );
$function$;

-- 6) Safe self-service helper: clears ONLY the caller's own rotation flag.
create or replace function public.cms_clear_password_rotation()
returns void language sql security definer set search_path to 'public' as $function$
  update public.cms_users set must_change_password = false where auth_user_id = auth.uid();
$function$;