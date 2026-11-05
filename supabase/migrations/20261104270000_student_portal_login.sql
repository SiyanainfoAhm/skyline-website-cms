-- Migration 118: students can sign in. Additive; local only until released.
--
-- A SLIT or agency administrator invites a student (agency_invitations.role = 'student', student_id = the student record;
-- the email and name come from the record). Accepting the invitation creates a portal profile and an agency membership
-- with role 'student' tied to that record, in the student's business. A signed-in student:
--   * reads and edits only the applications whose student_id is their own record (portal_scoped_applications,
--     portal_can_access_application; every policy and command already goes through these two);
--   * uploads documents and submits through the same commands as an agent (gated by portal_can_edit_application);
--   * starts a new application for themselves (portal_create_student_application now accepts the student).
-- Disabling the student (enrollment_students.status) or their business ends their access; deleting the student removes
-- the membership and any invitation. Students never appear as agents: role checks everywhere are 'agent' / 'agency_admin'.
-- The CMS student lists show each student's sign-in state (login: none / invited / active).
--
-- Requires: 86 (invitations), 89 (invitation input rules), 109 (enrollment_students.agent_id, status 114), 117.
-- Rollback (manual): drop policy enrollment_students_self_read; drop functions portal_student_id, student_login_state;
-- re-create portal_identity (20261025160800), portal_scoped_applications (20261025160406), portal_can_access_application
-- (20261024180429), portal_resolve_access (20261027000000), portal_invitation_create (20261027030000),
-- portal_create_student_application (20261104090000), admin_students_list (20261104250000), admin_student_detail
-- (20261104090000); drop columns agency_memberships.student_id and agency_invitations.student_id and restore both role
-- checks to ('agency_admin','agent').
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ------------------------------------------------------------------ 1. 'student' as a third portal role
do $$ declare r record; begin
 for r in select c.conname, c.conrelid::regclass as tab from pg_constraint c
  where c.contype = 'c' and c.conrelid in ('public.agency_memberships'::regclass, 'public.agency_invitations'::regclass)
   and pg_get_constraintdef(c.oid) ilike '%(role%' loop
  execute format('alter table %s drop constraint %I', r.tab, r.conname);
 end loop;
end $$;
alter table public.agency_memberships add constraint agency_memberships_role_check check (role in ('agency_admin','agent','student'));
alter table public.agency_invitations add constraint agency_invitations_role_check check (role in ('agency_admin','agent','student'));

alter table public.agency_memberships add column student_id uuid references public.enrollment_students(id) on delete cascade;
alter table public.agency_memberships add constraint agency_memberships_student_role check ((role = 'student') = (student_id is not null));
create unique index agency_memberships_one_login_per_student on public.agency_memberships(student_id) where student_id is not null;
comment on column public.agency_memberships.student_id is 'Role student: the student record this sign-in belongs to (one sign-in per student).';

alter table public.agency_invitations add column student_id uuid references public.enrollment_students(id) on delete cascade;
alter table public.agency_invitations add constraint agency_invitations_student_role check ((role = 'student') = (student_id is not null));
create index agency_invitations_student on public.agency_invitations(student_id) where student_id is not null;
comment on column public.agency_invitations.student_id is 'Role student: the student record the invitation is for.';

-- ------------------------------------------------------------------ 2. The signed-in student
-- Null unless the caller has an Active membership with role student, the student record is Active and so is its business.
create function public.portal_student_id() returns uuid
language sql stable security definer set search_path = public as $$
 select m.student_id from public.agency_memberships m
 join public.portal_profiles p on p.id = m.user_id and p.status = 'Active'
 join public.enrollment_students s on s.id = m.student_id and s.status = 'Active'
 join public.agencies a on a.id = m.agency_id and a.status = 'Active'
 where p.auth_user_id = auth.uid() and m.status = 'Active' and m.role = 'student' limit 1;
$$;
revoke all on function public.portal_student_id() from public, anon;
grant execute on function public.portal_student_id() to authenticated, service_role;

-- A student reads their own record (the form seeds from it).
create policy enrollment_students_self_read on public.enrollment_students for select to authenticated
 using (public.tenant_scope(tenant_id) and id = public.portal_student_id());

-- ------------------------------------------------------------------ 3. Identity and scope
create or replace function public.portal_identity() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare role text; v_student uuid := public.portal_student_id();
begin
 if public.tenant_request_domain() is not null then
  if public.tenant_current() is null then raise exception 'Unknown or inactive institution' using errcode='42501'; end if;
  if public.portal_is_slit_admin() then role:='slit_admin';
  elsif v_student is not null then
   if exists(select 1 from public.agency_tenants at where at.tenant_id=public.tenant_current() and at.agency_id=public.portal_agency_id() and at.active) then role:='student'; end if;
  elsif public.tenant_agency_access(public.tenant_current(),public.portal_agency_id()) then
   role:=case when public.portal_is_agency_admin() then 'agency_admin' else 'agent' end;
  end if;
 else
  if not public.tenant_scope(null) then raise exception 'Legacy scope not authorized' using errcode='42501'; end if;
  role:=case when public.portal_is_slit_admin() then 'slit_admin' when v_student is not null then 'student'
   when public.portal_agency_id() is not null and public.portal_is_agency_admin() then 'agency_admin'
   when public.portal_agency_id() is not null and public.portal_is_agent() then 'agent' end;
 end if;
 return jsonb_build_object('is_slit_admin',role='slit_admin','profile_id',public.portal_profile_id(),'agency_id',public.portal_agency_id(),'role',role,'tenant_id',public.tenant_current(),
  'student_id',case when role='student' then v_student end);
end; $$;

-- Same as before, plus the student's own applications (by student_id, within their business).
create or replace function public.portal_scoped_applications() returns setof public.enrollment_applications
language plpgsql stable security definer set search_path=public as $$
declare t uuid:=public.tenant_current(); agency uuid:=public.portal_agency_id(); profile uuid:=public.portal_profile_id(); student uuid:=public.portal_student_id();
 reviewer boolean; agency_admin boolean; access boolean;
begin
 if auth.uid() is null then return; end if;
 if public.tenant_request_domain() is null then
  if not public.tenant_scope(null) then return; end if;
  return query select a.* from public.enrollment_applications a where a.tenant_id is null and
   (skyline_private.legacy_application_access(a.id) or (student is not null and a.student_id=student and a.agency_id=agency));
 elsif t is not null then
  reviewer:=public.tenant_has_role(t,array['tenant_admin','staff']);
  agency_admin:=public.portal_is_agency_admin();access:=public.tenant_agency_access(t,agency);
  return query select a.* from public.enrollment_applications a where a.tenant_id=t and
   (reviewer or access and a.agency_id=agency and (agency_admin or a.assigned_agent_id=profile)
    or (student is not null and a.student_id=student and a.agency_id=agency
     and exists(select 1 from public.agency_tenants at where at.tenant_id=t and at.agency_id=a.agency_id and at.active)));
 end if;
end; $$;

create or replace function public.portal_can_access_application(app_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.enrollment_applications a where a.id=app_id and (
  (a.student_id is not null and a.student_id=public.portal_student_id() and a.agency_id=public.portal_agency_id() and
   case when a.tenant_id is null then public.tenant_request_domain() is null
   else public.tenant_scope(a.tenant_id) and exists(select 1 from public.agency_tenants at where at.tenant_id=a.tenant_id and at.agency_id=a.agency_id and at.active) end)
  or case when a.tenant_id is null then public.tenant_request_domain() is null and skyline_private.legacy_application_access(app_id)
  else public.tenant_scope(a.tenant_id) and (public.tenant_has_role(a.tenant_id,array['tenant_admin','staff']) or
  (public.tenant_agency_access(a.tenant_id,a.agency_id) and (public.portal_is_agency_admin() or a.assigned_agent_id=public.portal_profile_id()))) end));
$$;

-- ------------------------------------------------------------------ 4. Inviting a student
-- Same rules as migration 89 for agents and administrators. Role student: p_student names the record; its email and name
-- are used (the body's email may only repeat it); the student must be Active, of the chosen agency, and without a sign-in.
drop function public.portal_invitation_create(uuid, uuid, text, text, text);
create function public.portal_invitation_create(p_actor uuid, p_agency uuid, p_email text, p_name text, p_role text, p_student uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb := public.portal_actor_context(p_actor); v_agency uuid; v_email text := lower(btrim(coalesce(p_email, ''))); v_name text := btrim(coalesce(p_name, '')); inv public.agency_invitations;
 s public.enrollment_students;
begin
 if not (c->>'slit')::boolean and c->>'role' is distinct from 'agency_admin' then
  raise exception 'Only organization or agency administrators can invite users.' using errcode = '42501'; end if;
 if p_role in ('slit_admin','org_admin','admin','Admin') then
  raise exception 'Organization administrators cannot be invited to an agency.' using errcode = '42501'; end if;
 if p_role is null or p_role not in ('agency_admin','agent','student') then
  raise exception 'Role must be agency administrator, agent or student.' using errcode = '22023'; end if;
 if (p_role = 'student') <> (p_student is not null) then
  raise exception 'A student invitation names the student; other invitations do not.' using errcode = '22023'; end if;
 if p_role = 'student' then
  select * into s from public.enrollment_students where id = p_student;
  if not found then raise exception 'Student not found.' using errcode = 'P0002'; end if;
  if s.status <> 'Active' then raise exception 'This student is disabled. Enable them before inviting them to sign in.' using errcode = '22023'; end if;
  if v_email <> '' and v_email <> lower(btrim(coalesce(s.email, ''))) then
   raise exception 'The invitation goes to the student''s email on record. Edit the student first to change it.' using errcode = '22023'; end if;
  v_email := lower(btrim(coalesce(s.email, '')));
  if v_email = '' then raise exception 'Add the student''s email before inviting them to sign in.' using errcode = '22023'; end if;
  v_name := btrim(coalesce(s.full_name, ''));
  if char_length(v_name) < 2 then v_name := v_email; end if;
  if exists (select 1 from public.agency_memberships m where m.student_id = s.id and m.status = 'Active') then
   raise exception 'This student already has a sign-in.' using errcode = '23505'; end if;
 end if;
 if v_name = '' then raise exception 'Full name is required.' using errcode = '22023'; end if;
 if v_name ~ '[[:cntrl:]]' then raise exception 'The name contains characters that are not allowed.' using errcode = '22023'; end if;
 if char_length(v_name) not between 2 and 100 then raise exception 'The name must be 2 to 100 characters.' using errcode = '22023'; end if;
 if (c->>'slit')::boolean then
  v_agency := coalesce(p_agency, s.agency_id);
  if v_agency is null then raise exception 'An agency must be selected.' using errcode = '22023'; end if;
 else
  -- The agency comes from the caller's own membership; a body value may only repeat it.
  v_agency := (c->>'agencyId')::uuid;
  if p_agency is not null and p_agency <> v_agency then
   raise exception 'You can only invite users into your own agency.' using errcode = '42501'; end if;
 end if;
 if s.id is not null and s.agency_id <> v_agency then
  raise exception 'This student belongs to another business.' using errcode = '42501'; end if;
 if not exists (select 1 from public.agencies a where a.id = v_agency and a.status = 'Active') then
  raise exception 'The agency is not active.' using errcode = '22023'; end if;
 if v_email ~ '[[:cntrl:]]' or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
  raise exception 'Enter a valid email address (254 characters at most).' using errcode = '22023'; end if;
 if exists (select 1 from public.cms_users u where lower(u.email) = v_email and u.role = 'Admin') then
  raise exception 'Organization administrators cannot be invited to an agency.' using errcode = '42501'; end if;
 if exists (select 1 from public.portal_profiles p join public.agency_memberships m on m.user_id = p.id
  where lower(p.email) = v_email and m.status = 'Active' and p.status = 'Active') then
  raise exception 'This email already belongs to an active portal user.' using errcode = '23505'; end if;
 select * into inv from public.agency_invitations i where i.email = v_email and i.status = 'pending';
 if found then
  if inv.expires_at < now() then raise exception 'An earlier invitation for this email has expired. Resend it instead of creating a new one.' using errcode = '23505'; end if;
  raise exception 'This email has already been invited. Resend or revoke the pending invitation.' using errcode = '23505'; end if;
 insert into public.agency_invitations(agency_id, email, full_name, role, invited_by, invited_by_name, student_id)
 values (v_agency, v_email, v_name, p_role, p_actor, coalesce(c->>'name', ''), s.id) returning * into inv;
 perform public.portal_user_audit(p_actor, c, 'invite_user', inv.id::text, v_agency, jsonb_build_object('email', v_email, 'role', p_role, 'student', s.id));
 return jsonb_build_object('invitationId', inv.id, 'agencyId', v_agency, 'email', v_email, 'name', inv.full_name, 'role', p_role, 'expiresAt', inv.expires_at, 'studentId', s.id);
end; $$;
revoke all on function public.portal_invitation_create(uuid, uuid, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.portal_invitation_create(uuid, uuid, text, text, text, uuid) to service_role;

-- ------------------------------------------------------------------ 5. Accepting the invitation
-- As migration 86, plus: a student invitation becomes a membership tied to the student record (which must still be Active),
-- and a sign-in whose student record is disabled reports user_suspended.
create or replace function public.portal_resolve_access() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text; v_confirmed timestamptz; inv public.agency_invitations; p public.portal_profiles; m public.agency_memberships;
 v_accepted boolean := false; v_state text; v_agency_active boolean;
begin
 if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
 if public.cms_is_admin() then return jsonb_build_object('state', 'org_admin', 'accepted', false); end if;
 select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;
 select * into p from public.portal_profiles where auth_user_id = v_uid;
 select * into m from public.agency_memberships where user_id = p.id;
 if v_confirmed is not null then
  select * into inv from public.agency_invitations i where i.email = v_email and i.status = 'pending' for update;
  if found and inv.expires_at >= now() and exists (select 1 from public.agencies a where a.id = inv.agency_id and a.status = 'Active')
   and (inv.student_id is null or exists (select 1 from public.enrollment_students s where s.id = inv.student_id and s.status = 'Active' and s.agency_id = inv.agency_id))
   and not coalesce(m.status = 'Active' and p.status = 'Active' and m.agency_id <> inv.agency_id, false) then
   if p.id is null then
    insert into public.portal_profiles(auth_user_id, email, full_name, status) values (v_uid, v_email, coalesce(nullif(inv.full_name, ''), split_part(v_email, '@', 1)), 'Active') returning * into p;
   else
    update public.portal_profiles set status = 'Active', updated_at = now() where id = p.id returning * into p;
   end if;
   insert into public.agency_memberships(user_id, agency_id, role, status, student_id) values (p.id, inv.agency_id, inv.role, 'Active', inv.student_id)
   on conflict (user_id) do update set agency_id = excluded.agency_id, role = excluded.role, status = 'Active', student_id = excluded.student_id, updated_at = now() returning * into m;
   update public.agency_invitations set status = 'accepted', accepted_at = now() where id = inv.id;
   perform public.portal_user_audit(v_uid, jsonb_build_object('name', p.full_name, 'role', inv.role), 'accept_invitation', p.id::text, inv.agency_id, jsonb_build_object('email', v_email, 'role', inv.role, 'student', inv.student_id));
   v_accepted := true;
  end if;
 end if;
 if m.user_id is null then
  v_state := case when exists (select 1 from public.agency_invitations i where i.email = v_email and i.status = 'pending' and i.expires_at < now()) then 'invite_expired' else 'no_access' end;
 else
  select a.status = 'Active' into v_agency_active from public.agencies a where a.id = m.agency_id;
  v_state := case when p.status <> 'Active' or m.status <> 'Active' then 'user_suspended'
   when m.role = 'student' and not exists (select 1 from public.enrollment_students s where s.id = m.student_id and s.status = 'Active') then 'user_suspended'
   when not coalesce(v_agency_active, false) then 'agency_suspended' else 'active' end;
 end if;
 return jsonb_build_object('state', v_state, 'accepted', v_accepted);
end; $$;

-- ------------------------------------------------------------------ 6. A student starts their own application
-- As migration 109, plus the student themselves. Their application is created by them and assigned to their agent (never
-- to the student: portal_create_application would assign a non-administrator member to themselves).
create or replace function public.portal_create_student_application(p_client_key text, p_student uuid)
returns table(application_id uuid, application_reference text) language plpgsql security definer set search_path = public as $fn$
declare s public.enrollment_students; g public.agents; v_agent uuid; v_id uuid; v_ref text; v_self boolean;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
 select * into s from public.enrollment_students where id = p_student;
 if not found then raise exception 'Student not found' using errcode = 'P0002'; end if;
 if s.agent_id is not null then select * into g from public.agents where id = s.agent_id; end if;
 v_self := public.portal_student_id() = s.id;
 if public.portal_student_id() is not null and not v_self then raise exception 'You can only start your own application' using errcode = '42501'; end if;
 if not v_self and not public.portal_is_slit_admin() then
  if s.agency_id is distinct from public.portal_agency_id() then raise exception 'This student belongs to another business' using errcode = '42501'; end if;
  if not public.portal_is_agency_admin() and g.profile_id is distinct from public.portal_profile_id() then
   raise exception 'Only the student''s agent or an agency administrator can start their application' using errcode = '42501'; end if;
 end if;
 -- The application is assigned to the student's agent when that agent can sign in as an agent of the business.
 if g.profile_id is not null and exists (select 1 from public.agency_memberships m join public.portal_profiles p on p.id = m.user_id
   where m.user_id = g.profile_id and m.agency_id = s.agency_id and m.status = 'Active' and p.status = 'Active' and m.role = 'agent') then
  v_agent := g.profile_id;
 end if;
 if v_self then
  if nullif(btrim(p_client_key), '') is null or length(p_client_key) > 200 then raise exception 'Creation request key required' using errcode = '22023'; end if;
  if public.tenant_request_domain() is null and not public.tenant_scope(null) then raise exception 'Legacy scope not authorized' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_key, 8304));
  select e.id into v_id from public.enrollment_applications e where e.client_key = p_client_key limit 1;
  if v_id is not null then
   if not public.portal_can_access_application(v_id) then raise exception 'This creation request is not available to this user.' using errcode = '42501'; end if;
   return query select e.id, e.reference from public.enrollment_applications e where e.id = v_id;
   return;
  end if;
  v_ref := public.portal_next_application_reference();
  perform set_config('skyline.student_id', s.id::text, true);
  insert into public.enrollment_applications(reference, agency_id, created_by, assigned_agent_id, status, client_key)
   values (v_ref, s.agency_id, public.portal_profile_id(), v_agent, 'draft', p_client_key) returning id into v_id;
  perform set_config('skyline.student_id', '', true);
  return query select v_id, v_ref;
 else
  perform set_config('skyline.student_id', s.id::text, true);
  return query select * from public.portal_create_application(p_client_key, v_agent, s.agency_id);
  perform set_config('skyline.student_id', '', true);
 end if;
 -- The student's details start the form. This is the draft command for the new application (portal_draft_revision).
 select e.id into v_id from public.enrollment_applications e
  where e.student_id = s.id and e.client_key = p_client_key and e.status = 'draft' and e.data -> 'values' is null;
 if v_id is not null then
  perform set_config('portal.draft_command', v_id::text, true);
  update public.enrollment_applications e set student_name = s.full_name, student_email = coalesce(s.email, ''),
   data = jsonb_set(e.data, '{values}', coalesce(e.data -> 'values', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'email', s.email, 'confirm_email', s.email, 'mobile', s.phone, 'passport_number', nullif(s.passport_number, ''), 'nationality', nullif(s.nationality, ''),
    'dob', case when s.date_of_birth is null then null else to_char(s.date_of_birth, 'YYYY-MM-DD') end)))
  where e.id = v_id;
  perform set_config('portal.draft_command', '', true);
 end if;
end $fn$;

-- ------------------------------------------------------------------ 7. Direct table access for a student
-- The child tables (courses, documents, consents, messages, history) already go through portal_can_access_application /
-- portal_can_edit_application. The application row itself has permissive agent policies; these are the student's.
create policy portal_applications_student_read on public.enrollment_applications for select to authenticated
 using (student_id is not null and student_id = public.portal_student_id() and agency_id = public.portal_agency_id());
create policy portal_applications_student_update on public.enrollment_applications for update to authenticated
 using (student_id is not null and student_id = public.portal_student_id() and agency_id = public.portal_agency_id() and status in ('draft', 'action_required'))
 with check (student_id is not null and student_id = public.portal_student_id() and agency_id = public.portal_agency_id() and status in ('draft', 'action_required'));
create policy portal_applications_student_delete on public.enrollment_applications for delete to authenticated
 using (student_id is not null and student_id = public.portal_student_id() and agency_id = public.portal_agency_id() and status = 'draft');

-- ------------------------------------------------------------------ 8. CMS: each student's sign-in state
-- {status: none | invited | expired | active, invitationId, invitedAt, expiresAt, profileId, email}
create function public.student_login_state(p_student uuid) returns jsonb
language sql stable security definer set search_path = public as $fn$
 select coalesce(
  (select jsonb_build_object('status', case when p.status = 'Active' and m.status = 'Active' then 'active' else 'disabled' end,
    'invitationId', null, 'invitedAt', null, 'expiresAt', null, 'profileId', p.id, 'email', p.email)
   from public.agency_memberships m join public.portal_profiles p on p.id = m.user_id
   where m.student_id = p_student and m.role = 'student' limit 1),
  (select jsonb_build_object('status', case when i.expires_at < now() then 'expired' else 'invited' end,
    'invitationId', i.id, 'invitedAt', i.last_sent_at, 'expiresAt', i.expires_at, 'profileId', null, 'email', i.email)
   from public.agency_invitations i where i.student_id = p_student and i.status = 'pending' order by i.created_at desc limit 1),
  jsonb_build_object('status', 'none', 'invitationId', null, 'invitedAt', null, 'expiresAt', null, 'profileId', null, 'email', null));
$fn$;
revoke all on function public.student_login_state(uuid) from public, anon, authenticated;
grant execute on function public.student_login_state(uuid) to service_role;

-- The list and the detail keep their current definitions (whichever migration last set them) and gain a 'login' field.
do $m$ declare body text; begin
 body := pg_get_functiondef('public.admin_students_list(text,text,uuid,uuid,integer,integer,text)'::regprocedure);
 if position('''applicationRows'', (select coalesce(jsonb_agg(' in body) = 0 then raise exception 'admin_students_list: applicationRows anchor not found'; end if;
 body := replace(body, '''applicationRows'', (select coalesce(jsonb_agg(', '''login'', public.student_login_state(p.id), ''applicationRows'', (select coalesce(jsonb_agg(');
 execute body;
 body := pg_get_functiondef('public.admin_student_detail(uuid)'::regprocedure);
 if position('''applications'', public.admin_application_rows(s.id, null)' in body) = 0 then raise exception 'admin_student_detail: applications anchor not found'; end if;
 body := replace(body, '''applications'', public.admin_application_rows(s.id, null)', '''login'', public.student_login_state(s.id), ''applications'', public.admin_application_rows(s.id, null)');
 execute body;
end $m$;

commit;
