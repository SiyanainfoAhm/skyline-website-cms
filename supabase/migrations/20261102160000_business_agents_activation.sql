-- Agents for SLIT administrators: every OMARA-registered agent is listed, Inactive until a SLIT administrator
-- activates them. Activating attaches the agent to a business (an existing one, or a new one created on the spot),
-- activates that business when it is inactive (which creates its workspace), and approves the agent. The sign-in
-- invitation is sent afterwards by the portal-admin-users Edge Function; when the person accepts, their login is
-- linked to this record and to their MARN automatically.
--
-- * business_agents: Skyline's own record of an agent attached to a business (the OMARA register stays read-only).
--   Portal memberships keep it in step both ways, so an agency administrator disabling an agent shows here too.
-- * New functions only; nothing the live screens use changes shape. admin_business_agents gains two fields.
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.business_agents (
 id uuid primary key default gen_random_uuid(),
 omara_agent_id uuid unique references public.omara_agents(id) on delete restrict,
 business_id uuid not null references public.businesses(id) on delete restrict,
 profile_id uuid unique references public.portal_profiles(id) on delete set null,
 full_name text not null check (length(btrim(full_name)) between 1 and 200),
 email text not null default '' check (email = lower(btrim(email)) and length(email) <= 254),
 phone text not null default '' check (length(phone) <= 40),
 role text not null default 'agent' check (role in ('agent','agency_admin')),
 status text not null default 'Inactive' check (status in ('Active','Inactive')),
 status_changed_at timestamptz,
 status_changed_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index business_agents_business_idx on public.business_agents(business_id);
create index business_agents_email_idx on public.business_agents(lower(email)) where email <> '';
comment on table public.business_agents is 'An agent approved (or not) by SLIT and attached to a business. Inactive by default. profile_id is set when the person has a portal login.';
alter table public.business_agents enable row level security;
revoke all on public.business_agents from public, anon, authenticated;
grant select on public.business_agents to authenticated;
grant all on public.business_agents to service_role;
create policy business_agents_scoped_read on public.business_agents for select to authenticated using (
 public.portal_is_slit_admin() or exists (select 1 from public.agencies a where a.business_id = business_agents.business_id and a.id = public.portal_agency_id()));

-- Everyone who already has a portal login.
insert into public.business_agents(omara_agent_id, business_id, profile_id, full_name, email, phone, role, status, status_changed_at)
select l.omara_agent_id, a.business_id, p.id, coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''), 'Portal user'),
 lower(btrim(coalesce(p.email, ''))), left(coalesce(p.phone, ''), 40), m.role,
 case when m.status = 'Active' and p.status = 'Active' then 'Active' else 'Inactive' end, now()
from public.agency_memberships m
join public.portal_profiles p on p.id = m.user_id
join public.agencies a on a.id = m.agency_id
left join public.agent_directory_links l on l.profile_id = p.id;

-- Portal memberships -> business_agents (invitation accepted, role or status changed by an agency administrator).
create function public.business_agent_sync_membership() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare p public.portal_profiles; v_business uuid; v_id uuid; v_status text;
begin
 select * into p from public.portal_profiles where id = new.user_id;
 select business_id into v_business from public.agencies where id = new.agency_id;
 if v_business is null then return new; end if;
 v_status := case when new.status = 'Active' and coalesce(p.status, 'Active') = 'Active' then 'Active' else 'Inactive' end;
 select id into v_id from public.business_agents where profile_id = new.user_id;
 if v_id is null then
  -- A SLIT activation waiting for this person: same business and email, no login yet.
  select id into v_id from public.business_agents
   where profile_id is null and business_id = v_business and email <> '' and email = lower(btrim(coalesce(p.email, '')))
   order by updated_at desc limit 1;
 end if;
 if v_id is null then
  insert into public.business_agents(business_id, profile_id, full_name, email, phone, role, status, status_changed_at)
  values (v_business, new.user_id, coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''), 'Portal user'),
   lower(btrim(coalesce(p.email, ''))), left(coalesce(p.phone, ''), 40), new.role, v_status, now());
 else
  update public.business_agents set profile_id = new.user_id, business_id = v_business, role = new.role,
   status_changed_at = case when status is distinct from v_status then now() else status_changed_at end,
   status = v_status, updated_at = now()
  where id = v_id;
 end if;
 -- An agent activated from the OMARA register gets their MARN linked to the login automatically.
 insert into public.agent_directory_links(profile_id, omara_agent_id, verification_evidence)
 select new.user_id, b.omara_agent_id, 'Activated from the OMARA register by a SLIT administrator'
 from public.business_agents b
 where b.profile_id = new.user_id and b.omara_agent_id is not null
  and not exists (select 1 from public.agent_directory_links l where l.profile_id = new.user_id or l.omara_agent_id = b.omara_agent_id);
 return new;
end $fn$;
revoke all on function public.business_agent_sync_membership() from public, anon, authenticated;
create trigger business_agent_membership_sync after insert or update of status, role, agency_id on public.agency_memberships
 for each row execute function public.business_agent_sync_membership();

-- ------------------------------------------------------------------ actions
-- Activate an agent: p_agent (a business_agents row), or p_omara (an OMARA agent), or neither (an agent who is not in OMARA).
-- The business is p_business, or a new one named p_new_business. An inactive business is activated, creating its workspace.
create function public.admin_agent_activate(p_agent uuid, p_omara uuid, p_business uuid, p_new_business text,
 p_name text, p_email text, p_role text default 'agent') returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
 g public.business_agents; o public.omara_agents; b public.businesses; v_agency uuid; v_old_agency uuid;
 v_business_created boolean := false; v_business_activated boolean := false;
 v_name text := btrim(coalesce(p_name, '')); v_email text := lower(btrim(coalesce(p_email, ''))); v_new text := btrim(coalesce(p_new_business, ''));
begin
 perform public.admin_business_require();
 if coalesce(p_role, '') not in ('agent', 'agency_admin') then raise exception 'Role must be agent or agency admin' using errcode = '22023'; end if;
 if v_email <> '' and (length(v_email) > 254 or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$') then
  raise exception 'Enter a valid email address' using errcode = '22023'; end if;
 if v_name ~ '[[:cntrl:]]' or length(v_name) > 200 then raise exception 'Enter a valid name' using errcode = '22023'; end if;

 -- The agent record.
 if p_agent is not null then
  select * into g from public.business_agents where id = p_agent for update;
  if not found then raise exception 'Agent not found' using errcode = 'P0002'; end if;
 elsif p_omara is not null then
  select * into o from public.omara_agents where id = p_omara;
  if not found then raise exception 'OMARA agent not found' using errcode = 'P0002'; end if;
  select * into g from public.business_agents where omara_agent_id = o.id for update;
 end if;
 if g.id is not null and g.omara_agent_id is not null and o.id is null then select * into o from public.omara_agents where id = g.omara_agent_id; end if;
 if v_name = '' then v_name := coalesce(nullif(btrim(g.full_name), ''), nullif(btrim(o.full_name), ''), ''); end if;
 if v_name = '' then raise exception 'Enter the agent''s name' using errcode = '22023'; end if;
 if v_email = '' then v_email := coalesce(nullif(g.email, ''), lower(btrim(coalesce(o.email, '')))); end if;

 -- The business.
 if v_new <> '' then
  if length(v_new) > 200 or v_new ~ '[[:cntrl:]]' then raise exception 'Enter a valid business name' using errcode = '22023'; end if;
  if exists (select 1 from public.businesses x where lower(btrim(x.display_name)) = lower(v_new) and x.identity_status <> 'archived') then
   raise exception 'A business with this name already exists. Choose it from the list instead.' using errcode = '23505'; end if;
  insert into public.businesses(display_name, identity_status) values (v_new, 'unverified') returning * into b;
  v_business_created := true;
 else
  select * into b from public.businesses where id = p_business;
  if not found then raise exception 'Choose the business this agent works for' using errcode = '22023'; end if;
  if b.identity_status = 'archived' then raise exception 'This business record was merged into another one' using errcode = '22023'; end if;
 end if;
 if b.status <> 'Active' then
  perform public.admin_business_set_status(b.id, 'Active');
  v_business_activated := true;
 end if;
 select id into v_agency from public.agencies where business_id = b.id;

 -- A person who already has a login moves only if no application ties them to their current business.
 if g.profile_id is not null then
  select agency_id into v_old_agency from public.agency_memberships where user_id = g.profile_id;
  if v_old_agency is distinct from v_agency then
   if exists (select 1 from public.enrollment_applications e where e.assigned_agent_id = g.profile_id and e.agency_id = v_old_agency) then
    raise exception 'This agent has applications with their current business, so they stay attached to it.' using errcode = '23514'; end if;
  end if;
 end if;

 if g.id is null then
  insert into public.business_agents(omara_agent_id, business_id, full_name, email, phone, role, status, status_changed_at, status_changed_by)
  values (o.id, b.id, v_name, v_email, left(coalesce(o.phone, ''), 40), p_role, 'Active', now(), auth.uid()) returning * into g;
 else
  update public.business_agents set business_id = b.id, full_name = v_name, email = v_email, role = p_role, status = 'Active',
   status_changed_at = now(), status_changed_by = auth.uid(), updated_at = now() where id = g.id returning * into g;
 end if;
 if g.profile_id is not null then
  update public.portal_profiles set status = 'Active', updated_at = now() where id = g.profile_id and status <> 'Active';
  update public.agency_memberships set status = 'Active', role = p_role, agency_id = v_agency, updated_at = now() where user_id = g.profile_id;
 end if;
 perform public.admin_business_audit('agent_activated', b.id, v_agency, jsonb_build_object('agent', v_name, 'marn', o.marn,
  'businessCreated', v_business_created, 'businessActivated', v_business_activated));
 return jsonb_build_object('agentId', g.id, 'businessId', b.id, 'businessName', b.display_name, 'agencyId', v_agency,
  'businessCreated', v_business_created, 'businessActivated', v_business_activated,
  'hasLogin', g.profile_id is not null, 'email', v_email, 'name', v_name, 'role', p_role);
end $fn$;
revoke all on function public.admin_agent_activate(uuid, uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_agent_activate(uuid, uuid, uuid, text, text, text, text) to authenticated;

-- Deactivate: the agent can no longer sign in and any invitation still waiting is withdrawn. Students and applications stay.
create function public.admin_agent_deactivate(p_agent uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare g public.business_agents; v_agency uuid;
begin
 perform public.admin_business_require();
 select * into g from public.business_agents where id = p_agent for update;
 if not found then raise exception 'Agent not found' using errcode = 'P0002'; end if;
 select id into v_agency from public.agencies where business_id = g.business_id;
 update public.business_agents set status = 'Inactive', status_changed_at = now(), status_changed_by = auth.uid(), updated_at = now() where id = g.id;
 if g.profile_id is not null then
  update public.agency_memberships set status = 'Inactive', updated_at = now() where user_id = g.profile_id;
 end if;
 if g.email <> '' and v_agency is not null then
  update public.agency_invitations set status = 'revoked', revoked_at = now() where agency_id = v_agency and email = g.email and status = 'pending';
 end if;
 perform public.admin_business_audit('agent_deactivated', g.business_id, v_agency, jsonb_build_object('agent', g.full_name));
 return jsonb_build_object('agentId', g.id, 'status', 'Inactive');
end $fn$;
revoke all on function public.admin_agent_deactivate(uuid) from public, anon;
grant execute on function public.admin_agent_deactivate(uuid) to authenticated;

-- ------------------------------------------------------------------ reads
-- Status shown: Active (approved and signed up), Invited (approved, invitation not accepted yet), Inactive (everything else).
create function public.admin_agent_directory(p_search text default '', p_status text default '', p_business uuid default null,
 p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_words text[] := public.admin_search_words(p_search); result jsonb;
begin
 perform public.admin_business_require();
 if coalesce(p_status, '') not in ('', 'Active', 'Invited', 'Inactive') then raise exception 'Invalid status' using errcode = '22023'; end if;
 with people as (
  select g.id as agent_id, g.omara_agent_id as omara_id, g.profile_id, g.full_name as name, g.email, g.phone, g.role, g.business_id,
   case when g.status <> 'Active' then 'Inactive'
        when g.profile_id is null then 'Invited'
        when exists (select 1 from public.agency_memberships m join public.portal_profiles pp on pp.id = m.user_id
          where m.user_id = g.profile_id and m.status = 'Active' and pp.status = 'Active') then 'Active'
        else 'Inactive' end as status
  from public.business_agents g
  union all
  select null, o.id, null, o.full_name, lower(btrim(coalesce(o.email, ''))), coalesce(o.phone, ''), null,
   (select f.business_id from public.business_agent_affiliations f where f.omara_agent_id = o.id and f.ended_at is null limit 1), 'Inactive'
  from public.omara_agents o
  where not exists (select 1 from public.business_agents g where g.omara_agent_id = o.id)
 ), rows as (
  select x.*, o.marn, o.is_active as registered, concat_ws(' ', nullif(btrim(o.suburb), ''), nullif(btrim(o.state), '')) as place,
   b.display_name as business_name, b.status as business_status
  from people x
  left join public.omara_agents o on o.id = x.omara_id
  left join public.businesses b on b.id = x.business_id
  where (p_business is null or x.business_id = p_business)
   and not exists (select 1 from unnest(v_words) w where strpos(lower(concat_ws(' ', x.name, x.email, x.phone, o.marn, b.display_name, o.suburb, o.state)), w) = 0)
 ), filtered as (
  select *, case status when 'Active' then 0 when 'Invited' then 1 else 2 end as rank_key from rows where coalesce(p_status, '') = '' or status = p_status
 ), page as (
  select * from filtered order by rank_key, lower(name), coalesce(agent_id, omara_id)
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset least(greatest(coalesce(p_offset, 0), 0), 1000000)
 )
 select jsonb_build_object('total', (select count(*) from filtered),
  'counts', jsonb_build_object('all', (select count(*) from rows), 'active', (select count(*) from rows where status = 'Active'),
   'invited', (select count(*) from rows where status = 'Invited'), 'inactive', (select count(*) from rows where status = 'Inactive')),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
   'key', coalesce(p.agent_id, p.omara_id), 'agentId', p.agent_id, 'omaraId', p.omara_id, 'profileId', p.profile_id,
   'name', p.name, 'email', p.email, 'phone', p.phone, 'role', p.role, 'status', p.status,
   'marn', coalesce(p.marn, ''), 'registered', p.registered, 'place', coalesce(p.place, ''),
   'businessId', p.business_id, 'businessName', coalesce(p.business_name, ''), 'businessStatus', p.business_status,
   'students', case when p.profile_id is null then 0 else (select count(distinct e.student_id) from public.enrollment_applications e where e.assigned_agent_id = p.profile_id) end,
   'statusCounts', case when p.profile_id is null then '{}'::jsonb else (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
     from (select e.status, count(*) n from public.enrollment_applications e where e.assigned_agent_id = p.profile_id group by e.status) s) end
  ) order by p.rank_key, lower(p.name), coalesce(p.agent_id, p.omara_id)) from page p), '[]'::jsonb))
 into result;
 return result;
end $fn$;
revoke all on function public.admin_agent_directory(text, text, uuid, integer, integer) from public, anon;
grant execute on function public.admin_agent_directory(text, text, uuid, integer, integer) to authenticated;

-- One agent by any of its ids: business_agents.id, portal profile id, or OMARA agent id.
create function public.admin_agent_overview(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare g public.business_agents; o public.omara_agents; b public.businesses; ob public.businesses; p public.portal_profiles; v_status text;
begin
 perform public.admin_business_require();
 select * into g from public.business_agents where id = p_id or profile_id = p_id or omara_agent_id = p_id limit 1;
 if g.id is not null and g.omara_agent_id is not null then select * into o from public.omara_agents where id = g.omara_agent_id;
 elsif g.id is null then select * into o from public.omara_agents where id = p_id; end if;
 if g.id is null and o.id is null then return null; end if;
 if g.business_id is not null then select * into b from public.businesses where id = g.business_id; end if;
 if o.id is not null then
  select bb.* into ob from public.business_agent_affiliations f join public.businesses bb on bb.id = f.business_id where f.omara_agent_id = o.id and f.ended_at is null limit 1;
 end if;
 if g.profile_id is not null then select * into p from public.portal_profiles where id = g.profile_id; end if;
 v_status := case when g.id is null or g.status <> 'Active' then 'Inactive' when g.profile_id is null then 'Invited'
  when exists (select 1 from public.agency_memberships m where m.user_id = g.profile_id and m.status = 'Active') and p.status = 'Active' then 'Active' else 'Inactive' end;
 return jsonb_build_object(
  'key', coalesce(g.id, o.id), 'agentId', g.id, 'profileId', g.profile_id, 'omaraId', o.id,
  'name', coalesce(g.full_name, o.full_name), 'email', coalesce(nullif(g.email, ''), lower(btrim(coalesce(o.email, ''))), ''),
  'phone', coalesce(nullif(g.phone, ''), o.phone, ''), 'role', g.role, 'status', v_status, 'statusChangedAt', g.status_changed_at,
  'business', case when b.id is null then null else jsonb_build_object('id', b.id, 'name', b.display_name, 'status', b.status) end,
  'omara', case when o.id is null then null else jsonb_build_object('id', o.id, 'marn', o.marn, 'registered', o.is_active,
    'registrationStatus', o.registration_status, 'place', concat_ws(' ', nullif(btrim(o.suburb), ''), nullif(btrim(o.state), '')),
    'business', case when ob.id is null then null else jsonb_build_object('id', ob.id, 'name', ob.display_name, 'status', ob.status) end) end,
  'applications', case when g.profile_id is null then '[]'::jsonb else public.admin_application_rows(null, g.profile_id) end,
  'students', case when g.profile_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'email', coalesce(s.email, ''))), '[]'::jsonb)
    from public.enrollment_students s where exists (select 1 from public.enrollment_applications e where e.student_id = s.id and e.assigned_agent_id = g.profile_id)) end);
end $fn$;
revoke all on function public.admin_agent_overview(uuid) from public, anon;
grant execute on function public.admin_agent_overview(uuid) to authenticated;

-- The business page's OMARA tab also shows each agent's Skyline status (two added fields; existing fields unchanged).
create or replace function public.admin_business_agents(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_agency uuid; result jsonb;
begin
 perform public.admin_business_require();
 select id into v_agency from public.agencies where business_id = p_business;
 select coalesce(jsonb_agg(r order by r.sort_ended, r.sort_registered, lower(r.name)), '[]'::jsonb) into result from (
  select o.id as "omaraId", o.full_name as name, o.marn, o.registration_status as "registrationStatus", o.is_active as registered,
   coalesce(o.email, '') as email, coalesce(o.phone, '') as phone,
   concat_ws(' ', nullif(btrim(o.suburb), ''), nullif(btrim(o.state), '')) as place,
   f.relationship_status as relationship, f.ended_at as "endedAt", f.first_seen_at as "firstSeenAt",
   case when p.id is null then null else jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email,
    'role', m.role, 'status', case when p.status = 'Active' and m.status = 'Active' then 'Active' else 'Inactive' end) end as profile,
   (select count(distinct e.student_id) from public.enrollment_applications e where p.id is not null and e.assigned_agent_id = p.id and e.agency_id = v_agency) as students,
   (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (select e.status, count(*) n from public.enrollment_applications e
     where p.id is not null and e.assigned_agent_id = p.id and e.agency_id = v_agency group by e.status) x) as "statusCounts",
   ga.id as "agentId",
   case when ga.id is null or ga.status <> 'Active' then 'Inactive' when ga.profile_id is null then 'Invited' else 'Active' end as "agentStatus",
   (f.ended_at is not null) as sort_ended, (not o.is_active) as sort_registered
  from public.business_agent_affiliations f
  join public.omara_agents o on o.id = f.omara_agent_id
  left join public.business_agents ga on ga.omara_agent_id = o.id
  left join public.agent_directory_links l on l.omara_agent_id = o.id
  left join public.portal_profiles p on p.id = l.profile_id
  left join public.agency_memberships m on m.user_id = p.id and m.agency_id = v_agency
  where f.business_id = p_business
 ) r;
 return (select coalesce(jsonb_agg(e - 'sort_ended' - 'sort_registered'), '[]'::jsonb) from jsonb_array_elements(result) e);
end $fn$;
