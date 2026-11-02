-- Migration 107: audit entry for a USI that staff looked up in the USI portal and typed in by hand. Additive; local only until released.
-- Who entered it, when, and the source ("USI portal (manual)") are kept on the draft itself (data.wizard.usiEntry, no schema change). The audit log accepts
-- no client writes, so this one function writes the entry. It takes the application only: the USI is never an argument, never stored in the audit
-- detail and never logged. Callable by a signed-in user who can edit the application (the same rule as saving the draft): an organization
-- administrator, or the agency's own staff while the application is a draft or returned for action. Not callable by anyone else.
-- Rollback (manual): drop function public.portal_log_usi_entry(uuid).
begin;

create function public.portal_log_usi_entry(p_application uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_agency uuid; v_name text; v_role text;
begin
  if auth.uid() is null or not public.portal_can_edit_application(p_application) then
    raise exception 'You cannot edit this application' using errcode = '42501';
  end if;
  select agency_id into v_agency from public.enrollment_applications where id = p_application;
  if public.portal_is_slit_admin() then
    v_role := 'slit_admin';
    select c.name into v_name from public.cms_users c where c.auth_user_id = auth.uid() limit 1;
  else
    select m.role, p.full_name into v_role, v_name
    from public.portal_profiles p join public.agency_memberships m on m.user_id = p.id
    where p.auth_user_id = auth.uid() and m.status = 'Active' limit 1;
  end if;
  insert into public.portal_audit_log(actor, actor_name, actor_role, action, target_type, target_id, agency_id, detail)
  values (auth.uid(), coalesce(v_name, auth.jwt() ->> 'email', 'Staff'), coalesce(v_role, ''), 'usi_entered_manually', 'application', p_application::text, v_agency,
    jsonb_build_object('source', 'USI portal (manual)'));
end;
$$;

revoke all on function public.portal_log_usi_entry(uuid) from public, anon, authenticated, service_role;

grant execute on function public.portal_log_usi_entry(uuid) to authenticated;

commit;
