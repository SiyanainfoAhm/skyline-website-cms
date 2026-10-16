-- Safe incremental reconciliation for the portal schema already present in
-- production. Apply only after recording the earlier out-of-band migrations;
-- this does not alter applications or their existing values.
--
-- Rollback guidance:
--   1. Recreate portal_applications_update with the prior body from 0006.
--   2. Replace portal_create_application with its two-argument 0008 version.
-- No data rollback is needed because this migration changes policy/function
-- definitions only.

-- Draft and action-required applications are editable. Submitted and all
-- admissions-decision states remain read-only to agency users; SLIT Admin keeps
-- its established administrative access.
drop policy if exists portal_applications_update on public.enrollment_applications;
create policy portal_applications_update on public.enrollment_applications
  for update using (
    public.portal_is_slit_admin()
    or (
      status in ('draft', 'action_required')
      and agency_id = public.portal_agency_id()
      and (public.portal_is_agency_admin() or assigned_agent_id = public.portal_profile_id())
    )
  )
  with check (
    public.portal_is_slit_admin()
    or (
      status in ('draft', 'action_required')
      and agency_id = public.portal_agency_id()
      and (public.portal_is_agency_admin() or assigned_agent_id = public.portal_profile_id())
    )
  );

-- The prior two-argument function cannot represent a selected agency for an
-- SLIT administrator. Drop only this exact overload before replacing it.
drop function if exists public.portal_create_application(text, uuid);
create function public.portal_create_application(
  p_client_key text,
  p_assigned_agent_id uuid default null,
  p_agency_id uuid default null
)
returns table (application_id uuid, application_reference text)
language plpgsql security definer set search_path = public
as $fn$
declare
  v_profile uuid := public.portal_profile_id();
  v_agency uuid := public.portal_agency_id();
  v_agent uuid;
  v_ref text;
  v_id uuid;
  v_existing uuid;
begin
  if p_client_key is not null and length(btrim(p_client_key)) > 0 then
    select a.id into v_existing from public.enrollment_applications a
    where a.client_key = p_client_key limit 1;
    if v_existing is not null then
      if not public.portal_can_access_application(v_existing) then
        raise exception 'This creation request is not available to this user.' using errcode = '42501';
      end if;
      return query select a.id, a.reference from public.enrollment_applications a where a.id = v_existing;
      return;
    end if;
  end if;

  if public.portal_is_slit_admin() then
    if p_agency_id is null or not exists (select 1 from public.agencies where id = p_agency_id) then
      raise exception 'SLIT Admin must select an existing agency.';
    end if;
    v_agency := p_agency_id;
  elsif v_profile is null or v_agency is null then
    raise exception 'You do not have an active agency membership.';
  elsif not public.portal_is_agency_admin() then
    v_agent := v_profile;
  end if;

  if p_assigned_agent_id is not null then
    if exists (select 1 from public.agency_memberships m where m.user_id = p_assigned_agent_id
      and m.agency_id = v_agency and m.status = 'Active' and m.role = 'agent') then
      v_agent := p_assigned_agent_id;
    else
      raise exception 'The selected agent is not active in the selected agency.';
    end if;
  end if;

  v_ref := public.portal_next_application_reference();
  insert into public.enrollment_applications(reference, agency_id, created_by, assigned_agent_id, status, client_key)
  values (v_ref, v_agency, v_profile, v_agent, 'draft', nullif(btrim(coalesce(p_client_key, '')), ''))
  returning id into v_id;
  return query select v_id, v_ref;
end;
$fn$;
revoke all on function public.portal_create_application(text, uuid, uuid) from public;
grant execute on function public.portal_create_application(text, uuid, uuid) to authenticated;
