-- =====================================================================
-- Skyline Agency Portal — 0008 (Phase 2 + Phase 3)
--
-- Additive only. Does not touch cms_* or the frozen student_* tables.
--
-- Adds the secure, server-side operations the agency workspace needs:
--   * A stable, human-readable application reference (sequence-backed).
--   * portal_create_application  — creates a draft for the caller's agency,
--     never trusting a client-supplied agency id, and is idempotent per
--     client_key so a double-click cannot create two applications.
--   * portal_assign_agent        — Agency Admin / SLIT Admin only, and only
--     to an ACTIVE agent of the SAME agency.
--   * portal_submit_application  — validates access, snapshot + status change
--     in one transaction, records submitted_by, and is idempotent.
-- =====================================================================

-- ------------------------------------------------ Extra columns + ref seq
alter table public.enrollment_applications
  add column if not exists submitted_by uuid;

alter table public.enrollment_applications
  add column if not exists client_key text;

create unique index if not exists idx_applications_client_key
  on public.enrollment_applications (client_key)
  where client_key is not null;

create sequence if not exists public.enrollment_application_ref_seq;

comment on column public.enrollment_applications.submitted_by is
  'Auth uid of the user who performed the final submission.';
comment on column public.enrollment_applications.client_key is
  'Client-generated idempotency key; guarantees a double-click cannot create two drafts.';

-- ------------------------------------------------------------ Reference
create or replace function public.portal_next_application_reference()
returns text
language sql volatile
as $$
  select 'SLIT-' || to_char(now(), 'YYYY') || '-'
         || lpad(nextval('public.enrollment_application_ref_seq')::text, 4, '0');
$$;

-- -------------------------------------------------- Create draft (RPC)
create or replace function public.portal_create_application(
  p_client_key text,
  p_assigned_agent_id uuid default null
)
returns table (application_id uuid, application_reference text)
language plpgsql security definer set search_path = public
as $fn$
declare
  v_profile uuid := public.portal_profile_id();
  v_agency  uuid := public.portal_agency_id();
  v_agent   uuid;
  v_ref     text;
  v_id      uuid;
  v_existing uuid;
begin
  if v_profile is null or v_agency is null then
    raise exception 'You do not have an active agency membership.';
  end if;

  -- Idempotency: the same client_key always returns the same application.
  if p_client_key is not null and length(btrim(p_client_key)) > 0 then
    select a.id into v_existing
    from public.enrollment_applications a
    where a.client_key = p_client_key
    limit 1;
    if v_existing is not null then
      return query
        select a.id, a.reference
        from public.enrollment_applications a
        where a.id = v_existing;
      return;
    end if;
  end if;

  if public.portal_is_agency_admin() then
    -- Agency Admin may open a draft unassigned, or assign it to an active agent now.
    if p_assigned_agent_id is not null then
      if exists (
        select 1 from public.agency_memberships m
        where m.user_id = p_assigned_agent_id
          and m.agency_id = v_agency
          and m.status = 'Active'
          and m.role = 'agent'
      ) then
        v_agent := p_assigned_agent_id;
      else
        raise exception 'The selected agent is not an active agent in your agency.';
      end if;
    end if;
  else
    -- An Agent always owns the applications they create.
    v_agent := v_profile;
  end if;

  v_ref := public.portal_next_application_reference();

  insert into public.enrollment_applications
    (reference, agency_id, created_by, assigned_agent_id, status, client_key)
  values
    (v_ref, v_agency, v_profile, v_agent, 'draft', nullif(btrim(coalesce(p_client_key, '')), ''))
  returning id into v_id;

  return query select v_id, v_ref;
end;
$fn$;

-- -------------------------------------------------- Reassign agent (RPC)
create or replace function public.portal_assign_agent(
  p_application_id uuid,
  p_agent_profile_id uuid
)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  v_agency uuid;
begin
  if not (public.portal_is_slit_admin() or public.portal_is_agency_admin()) then
    raise exception 'Only an agency administrator can reassign applications.';
  end if;

  select a.agency_id into v_agency
  from public.enrollment_applications a
  where a.id = p_application_id;

  if v_agency is null then
    raise exception 'Application not found.';
  end if;

  if not public.portal_is_slit_admin() and v_agency <> public.portal_agency_id() then
    raise exception 'You cannot reassign an application outside your agency.';
  end if;

  if p_agent_profile_id is not null then
    if not exists (
      select 1 from public.agency_memberships m
      where m.user_id = p_agent_profile_id
        and m.agency_id = v_agency
        and m.status = 'Active'
        and m.role = 'agent'
    ) then
      raise exception 'The selected agent is not an active agent in this agency.';
    end if;
  end if;

  update public.enrollment_applications
    set assigned_agent_id = p_agent_profile_id
    where id = p_application_id;
end;
$fn$;

-- -------------------------------------------------- Submit (RPC)
create or replace function public.portal_submit_application(
  p_application_id uuid,
  p_snapshot jsonb
)
returns text
language plpgsql security definer set search_path = public
as $fn$
declare
  v_app     public.enrollment_applications;
  v_ref     text;
  v_uid     uuid := auth.uid();
  v_name    text;
  v_version integer;
begin
  select * into v_app
  from public.enrollment_applications
  where id = p_application_id;

  if v_app.id is null then
    raise exception 'Application not found.';
  end if;

  if not public.portal_can_access_application(p_application_id) then
    raise exception 'You are not authorised to submit this application.';
  end if;

  -- Idempotent: a second submit simply returns the same reference.
  if v_app.status not in ('draft', 'action_required') then
    return coalesce(v_app.reference, '');
  end if;

  v_ref := coalesce(nullif(v_app.reference, ''), public.portal_next_application_reference());
  v_version := greatest(coalesce(v_app.version, 1), 1);

  select coalesce(
           (select p.full_name from public.portal_profiles p where p.auth_user_id = v_uid limit 1),
           (select c.name from public.cms_users c where c.auth_user_id = v_uid limit 1),
           'System'
         ) into v_name;

  update public.enrollment_applications
    set status = 'submitted',
        submitted_at = now(),
        submitted_by = v_uid,
        reference = v_ref,
        version = v_version,
        data = coalesce(p_snapshot, data)
    where id = p_application_id;

  insert into public.enrollment_application_versions
    (application_id, version, snapshot, created_by, created_by_name)
  values
    (p_application_id, v_version, coalesce(p_snapshot, jsonb_build_object()), v_uid, v_name);

  return v_ref;
end;
$fn$;

-- ------------------------------------------------------------ Grants
revoke all on function public.portal_create_application(text, uuid) from public;
revoke all on function public.portal_assign_agent(uuid, uuid) from public;
revoke all on function public.portal_submit_application(uuid, jsonb) from public;

grant execute on function public.portal_create_application(text, uuid) to authenticated;
grant execute on function public.portal_assign_agent(uuid, uuid) to authenticated;
grant execute on function public.portal_submit_application(uuid, jsonb) to authenticated;