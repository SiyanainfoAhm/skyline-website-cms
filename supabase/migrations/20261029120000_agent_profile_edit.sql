-- Migration 105: CMS > Agencies > Agents dialog. Additive; local only until released.
-- 1. An invitation can carry the person's phone (E.164, optional). It is copied to their profile when they accept (trigger below), so
--    migration 86's portal_resolve_access() is not touched.
-- 2. portal_agent_invite: the existing atomic create-and-invite (portal_invitation_create, same checks, same audit row) plus the phone.
-- 3. portal_member_profile_update: name and phone of an existing member, audited ('update_user_profile'). Same authorization as
--    portal_member_update: an organization administrator anywhere; an agency administrator only inside their own agency, and only an
--    organization administrator for another agency administrator. Replaces the unaudited direct write to portal_profiles.
-- 4. portal_invitation_update: name, phone and role of a still-pending invitation, audited ('update_invitation').
-- All three are service-role only; the portal-admin-users Edge Function derives the actor from the verified JWT, so an Editor (not an
-- administrator, no membership) is refused by portal_actor_context. Role and status changes keep going through portal_member_update
-- (audited, last-active-administrator guard).
-- Rollback (manual): drop the trigger and the three functions, then alter table public.agency_invitations drop column phone.
begin;

alter table public.agency_invitations
  add column phone text not null default '' check (phone = '' or phone ~ '^\+[0-9]{8,15}$');

create function public.portal_agent_invite(p_actor uuid, p_agency uuid, p_email text, p_name text, p_role text, p_phone text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_phone text := btrim(coalesce(p_phone, '')); r jsonb;
begin
  if v_phone <> '' and v_phone !~ '^\+[0-9]{8,15}$' then raise exception 'Enter a valid phone number.' using errcode = '22023'; end if;
  r := public.portal_invitation_create(p_actor, p_agency, p_email, p_name, p_role);
  if v_phone <> '' then update public.agency_invitations set phone = v_phone where id = (r->>'invitationId')::uuid; end if;
  return r || jsonb_build_object('phone', v_phone);
end; $$;

create function public.portal_member_profile_update(p_actor uuid, p_profile uuid, p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb := public.portal_actor_context(p_actor); m public.agency_memberships; p public.portal_profiles;
  v_name text := btrim(coalesce(p_name, '')); v_phone text := btrim(coalesce(p_phone, ''));
begin
  select * into m from public.agency_memberships where user_id = p_profile for update;
  if not found then raise exception 'Portal user not found.' using errcode = 'P0002'; end if;
  select * into p from public.portal_profiles where id = p_profile;
  if not (c->>'slit')::boolean then
    if c->>'role' is distinct from 'agency_admin' or m.agency_id is distinct from (c->>'agencyId')::uuid then
      raise exception 'You can only manage users in your own agency.' using errcode = '42501'; end if;
    if m.role = 'agency_admin' and p.auth_user_id is distinct from p_actor then
      raise exception 'Only an organization administrator can change another agency administrator.' using errcode = '42501'; end if;
  end if;
  if v_name = '' then raise exception 'Full name is required.' using errcode = '22023'; end if;
  if coalesce(p_name, '') ~ '[[:cntrl:]]' then raise exception 'The name contains characters that are not allowed.' using errcode = '22023'; end if;
  if char_length(v_name) not between 2 and 100 then raise exception 'The name must be 2 to 100 characters.' using errcode = '22023'; end if;
  if v_phone <> '' and v_phone !~ '^\+[0-9]{8,15}$' then raise exception 'Enter a valid phone number.' using errcode = '22023'; end if;
  update public.portal_profiles set full_name = v_name, phone = v_phone, updated_at = now() where id = p_profile;
  perform public.portal_user_audit(p_actor, c, 'update_user_profile', p_profile::text, m.agency_id,
    jsonb_build_object('previousName', p.full_name, 'name', v_name, 'phoneChanged', coalesce(p.phone, '') is distinct from v_phone));
  return jsonb_build_object('profileId', p_profile, 'name', v_name, 'phone', v_phone, 'agencyId', m.agency_id);
end; $$;

create function public.portal_invitation_update(p_actor uuid, p_invitation uuid, p_name text, p_phone text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb := public.portal_actor_context(p_actor); inv public.agency_invitations;
  v_name text := btrim(coalesce(p_name, '')); v_phone text := btrim(coalesce(p_phone, ''));
begin
  select * into inv from public.agency_invitations where id = p_invitation for update;
  if not found then raise exception 'Invitation not found.' using errcode = 'P0002'; end if;
  if not ((c->>'slit')::boolean or (c->>'role' = 'agency_admin' and inv.agency_id = (c->>'agencyId')::uuid)) then
    raise exception 'You can only manage invitations in your own agency.' using errcode = '42501'; end if;
  if inv.status <> 'pending' then raise exception 'Only pending invitations can be edited.' using errcode = '22023'; end if;
  if p_role is null or p_role not in ('agency_admin','agent') then raise exception 'Role must be agency administrator or agent.' using errcode = '22023'; end if;
  if v_name = '' then raise exception 'Full name is required.' using errcode = '22023'; end if;
  if coalesce(p_name, '') ~ '[[:cntrl:]]' then raise exception 'The name contains characters that are not allowed.' using errcode = '22023'; end if;
  if char_length(v_name) not between 2 and 100 then raise exception 'The name must be 2 to 100 characters.' using errcode = '22023'; end if;
  if v_phone <> '' and v_phone !~ '^\+[0-9]{8,15}$' then raise exception 'Enter a valid phone number.' using errcode = '22023'; end if;
  update public.agency_invitations set full_name = v_name, phone = v_phone, role = p_role where id = inv.id returning * into inv;
  perform public.portal_user_audit(p_actor, c, 'update_invitation', inv.id::text, inv.agency_id,
    jsonb_build_object('email', inv.email, 'role', inv.role, 'name', inv.full_name));
  return jsonb_build_object('invitationId', inv.id, 'agencyId', inv.agency_id, 'email', inv.email, 'name', inv.full_name, 'phone', inv.phone, 'role', inv.role);
end; $$;

-- Accepting an invitation copies its phone to the profile, but never replaces a phone the profile already has.
create function public.agency_invitation_accept_phone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and old.status <> 'accepted' and new.phone <> '' then
    update public.portal_profiles set phone = new.phone, updated_at = now() where lower(email) = new.email and coalesce(phone, '') = '';
  end if;
  return new;
end; $$;

create trigger agency_invitation_accept_phone after update of status on public.agency_invitations
for each row execute function public.agency_invitation_accept_phone();

revoke all on function public.portal_agent_invite(uuid, uuid, text, text, text, text), public.portal_member_profile_update(uuid, uuid, text, text),
  public.portal_invitation_update(uuid, uuid, text, text, text), public.agency_invitation_accept_phone() from public, anon, authenticated, service_role;

grant execute on function public.portal_agent_invite(uuid, uuid, text, text, text, text), public.portal_member_profile_update(uuid, uuid, text, text),
  public.portal_invitation_update(uuid, uuid, text, text, text) to service_role;

commit;
