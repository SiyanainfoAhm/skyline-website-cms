-- Businesses for SLIT administrators (CMS): status, activation, linking and read views.
-- Builds on 20261102094611 (businesses, business_agent_affiliations, enrollment_students,
-- agent_directory_links). Additive: new columns, functions and policies only. The sidebar
-- change ships separately with the frontend that has the new pages.
--
-- * businesses.status: Active / Inactive, switched only by a SLIT administrator.
--   Imported (OMARA) businesses start Inactive; a business created for an agency added
--   in the CMS takes that agency's status (Active by default).
-- * Activating a business without a workspace creates its agency record (the workspace).
--   Deactivating it sets the agency Inactive, which blocks its portal users at sign-in.
-- * agencies.status and businesses.status are kept equal both ways.
-- * The OMARA directory and business records become readable by SLIT administrators and,
--   for its own business only, by that agency's portal users.
set local lock_timeout='5s';
set local statement_timeout='60s';

-- ------------------------------------------------------------------ status
alter table public.businesses
 add column status text not null default 'Inactive' check (status in ('Active','Inactive')),
 add column status_changed_at timestamptz,
 add column status_changed_by uuid;
comment on column public.businesses.status is 'Active only when a SLIT administrator activates it; then its agency workspace is usable. Imported directory businesses start Inactive.';

update public.businesses b set status = 'Active'
 from public.agencies a where a.business_id = b.id and a.status = 'Active';

create function public.agency_sync_business_status() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
 update public.businesses set status = new.status
  where id = new.business_id and status is distinct from new.status;
 return new;
end $fn$;
revoke all on function public.agency_sync_business_status() from public, anon, authenticated;
create trigger agency_business_status_sync after insert or update of status, business_id on public.agencies
 for each row execute function public.agency_sync_business_status();

-- ------------------------------------------------------------------ helpers
create function public.admin_business_require() returns void
language plpgsql stable security definer set search_path = public as $fn$
begin
 if auth.uid() is null or not public.portal_is_slit_admin() then
  raise exception 'SLIT administrator access required' using errcode = '42501';
 end if;
 if public.tenant_request_domain() is not null then
  raise exception 'Businesses are managed on the main SLIT site' using errcode = '42501';
 end if;
end $fn$;
revoke all on function public.admin_business_require() from public, anon;
grant execute on function public.admin_business_require() to authenticated;

create function public.admin_business_audit(p_action text, p_business uuid, p_agency uuid, p_detail jsonb) returns void
language sql security definer set search_path = public as $fn$
 insert into public.portal_audit_log(actor, actor_name, actor_role, action, target_type, target_id, agency_id, detail)
 values (auth.uid(), coalesce(auth.jwt() ->> 'email', 'Administrator'), 'administrator', p_action, 'business', p_business::text, p_agency, coalesce(p_detail, '{}'::jsonb));
$fn$;
revoke all on function public.admin_business_audit(text, uuid, uuid, jsonb) from public, anon, authenticated;

create function public.admin_status_counts(p_agency uuid) returns jsonb
language sql stable security definer set search_path = public as $fn$
 select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
 from (select e.status, count(*) n from public.enrollment_applications e where e.agency_id = p_agency group by e.status) x;
$fn$;
revoke all on function public.admin_status_counts(uuid) from public, anon, authenticated;

create function public.admin_search_words(p_search text) returns text[]
language sql immutable set search_path = public as $fn$
 select array(select w from regexp_split_to_table(lower(left(btrim(coalesce(p_search, '')), 200)), '\s+') w where w <> '' limit 8);
$fn$;

-- ------------------------------------------------------------------ actions
create function public.admin_business_set_status(p_business uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare b public.businesses; a public.agencies; c record; v_created boolean := false;
begin
 perform public.admin_business_require();
 if p_status is null or p_status not in ('Active','Inactive') then raise exception 'Status must be Active or Inactive' using errcode = '22023'; end if;
 select * into b from public.businesses where id = p_business for update;
 if not found then raise exception 'Business not found' using errcode = 'P0002'; end if;
 if b.identity_status = 'archived' then raise exception 'This business record was merged into another one' using errcode = '22023'; end if;
 select * into a from public.agencies where business_id = b.id for update;
 if p_status = 'Active' and a.id is null then
  -- First activation creates the workspace, filled from the best current OMARA contact.
  select o.full_name, o.email, o.phone, o.business_address, o.country into c
   from public.business_agent_affiliations f join public.omara_agents o on o.id = f.omara_agent_id
   where f.business_id = b.id and f.ended_at is null
   order by o.is_active desc, (nullif(btrim(o.email), '') is not null) desc, o.last_synced_at desc nulls last, o.id
   limit 1;
  begin
   insert into public.agencies(name, code, business_email, phone, address, country, primary_contact, status, business_id)
   values (b.display_name, 'B-' || upper(substr(replace(b.id::text, '-', ''), 1, 8)),
    coalesce(c.email, ''), coalesce(c.phone, ''), coalesce(c.business_address, ''),
    coalesce(nullif(c.country, ''), b.registration_country, 'Australia'), coalesce(c.full_name, ''), 'Active', b.id)
   returning * into a;
  exception when unique_violation then
   raise exception 'An agency with this name already exists. Open that agency and link it to this business instead.' using errcode = '23505';
  end;
  v_created := true;
 elsif a.id is not null and a.status is distinct from p_status then
  update public.agencies set status = p_status, updated_at = now() where id = a.id;
 end if;
 update public.businesses set status = p_status, status_changed_at = now(), status_changed_by = auth.uid() where id = b.id;
 perform public.admin_business_audit(case when p_status = 'Active' then 'business_activated' else 'business_deactivated' end,
  b.id, a.id, jsonb_build_object('name', b.display_name, 'workspaceCreated', v_created));
 return jsonb_build_object('businessId', b.id, 'status', p_status, 'agencyId', a.id, 'workspaceCreated', v_created);
end $fn$;
revoke all on function public.admin_business_set_status(uuid, text) from public, anon;
grant execute on function public.admin_business_set_status(uuid, text) to authenticated;

-- An agency added before the directory existed got its own placeholder business. Linking moves it onto
-- the directory business an administrator picked (never matched automatically) and archives the empty placeholder.
create function public.admin_business_link_agency(p_agency uuid, p_business uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare a public.agencies; b public.businesses; v_old uuid;
begin
 perform public.admin_business_require();
 select * into a from public.agencies where id = p_agency for update;
 if not found then raise exception 'Agency not found' using errcode = 'P0002'; end if;
 select * into b from public.businesses where id = p_business for update;
 if not found then raise exception 'Business not found' using errcode = 'P0002'; end if;
 if b.identity_status = 'archived' then raise exception 'This business record was merged into another one' using errcode = '22023'; end if;
 if a.business_id = b.id then return jsonb_build_object('businessId', b.id, 'agencyId', a.id, 'changed', false); end if;
 if exists (select 1 from public.agencies x where x.business_id = b.id) then
  raise exception 'That business already has a workspace' using errcode = '23505';
 end if;
 v_old := a.business_id;
 update public.agencies set business_id = b.id, updated_at = now() where id = a.id;
 update public.businesses set status = a.status, status_changed_at = now(), status_changed_by = auth.uid() where id = b.id;
 update public.businesses o set identity_status = 'archived', status = 'Inactive'
  where o.id = v_old and o.directory_name_key is null
   and not exists (select 1 from public.business_agent_affiliations f where f.business_id = o.id)
   and not exists (select 1 from public.agencies x where x.business_id = o.id);
 perform public.admin_business_audit('business_linked', b.id, a.id, jsonb_build_object('agency', a.name, 'business', b.display_name, 'previousBusiness', v_old));
 return jsonb_build_object('businessId', b.id, 'agencyId', a.id, 'changed', true);
end $fn$;
revoke all on function public.admin_business_link_agency(uuid, uuid) from public, anon;
grant execute on function public.admin_business_link_agency(uuid, uuid) to authenticated;

-- Links a portal login to its OMARA record. The MARN must be listed for the agent's own business.
create function public.admin_link_agent_marn(p_profile uuid, p_omara uuid, p_evidence text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare m public.agency_memberships; o public.omara_agents;
begin
 perform public.admin_business_require();
 if p_omara is null then
  delete from public.agent_directory_links where profile_id = p_profile;
  return jsonb_build_object('profileId', p_profile, 'linked', false);
 end if;
 if coalesce(btrim(p_evidence), '') = '' then raise exception 'Say how the MARN was checked' using errcode = '22023'; end if;
 select * into m from public.agency_memberships where user_id = p_profile;
 if not found then raise exception 'Portal user not found' using errcode = 'P0002'; end if;
 select * into o from public.omara_agents where id = p_omara;
 if not found then raise exception 'OMARA agent not found' using errcode = 'P0002'; end if;
 if not exists (select 1 from public.business_agent_affiliations f join public.agencies a on a.business_id = f.business_id
   where f.omara_agent_id = o.id and f.ended_at is null and a.id = m.agency_id) then
  raise exception 'This MARN is not listed for this business' using errcode = '22023';
 end if;
 if exists (select 1 from public.agent_directory_links l where l.omara_agent_id = o.id and l.profile_id <> p_profile) then
  raise exception 'This MARN is already linked to another portal user' using errcode = '23505';
 end if;
 insert into public.agent_directory_links(profile_id, omara_agent_id, verification_evidence)
 values (p_profile, o.id, left(btrim(p_evidence), 500))
 on conflict (profile_id) do update set omara_agent_id = excluded.omara_agent_id, verification_evidence = excluded.verification_evidence, verified_at = now();
 insert into public.portal_audit_log(actor, actor_name, actor_role, action, target_type, target_id, agency_id, detail)
 values (auth.uid(), coalesce(auth.jwt() ->> 'email', 'Administrator'), 'administrator', 'agent_marn_linked', 'portal_user', p_profile::text, m.agency_id, jsonb_build_object('marn', o.marn));
 return jsonb_build_object('profileId', p_profile, 'linked', true, 'marn', o.marn);
end $fn$;
revoke all on function public.admin_link_agent_marn(uuid, uuid, text) from public, anon;
grant execute on function public.admin_link_agent_marn(uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------------ reads
create function public.admin_business_list(p_search text default '', p_status text default '', p_source text default '',
 p_workspace text default '', p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_words text[] := public.admin_search_words(p_search); result jsonb;
begin
 perform public.admin_business_require();
 if coalesce(p_status, '') not in ('', 'Active', 'Inactive') then raise exception 'Invalid status' using errcode = '22023'; end if;
 if coalesce(p_source, '') not in ('', 'omara', 'manual') then raise exception 'Invalid source' using errcode = '22023'; end if;
 if coalesce(p_workspace, '') not in ('', 'yes', 'no') then raise exception 'Invalid workspace filter' using errcode = '22023'; end if;
 with base as (
  select b.id, b.display_name as name, b.status, b.identity_status, b.directory_name_key,
   a.id as agency_id, a.code as agency_code, a.business_email, a.primary_contact, a.phone as agency_phone, a.address as agency_address,
   coalesce(ag.current_agents, 0) as current_agents, coalesce(ag.ended_agents, 0) as ended_agents, ag.place, ag.haystack
  from public.businesses b
  left join public.agencies a on a.business_id = b.id
  left join lateral (
   select count(*) filter (where f.ended_at is null) as current_agents,
    count(*) filter (where f.ended_at is not null) as ended_agents,
    max(concat_ws(' ', nullif(btrim(o.suburb), ''), nullif(btrim(o.state), ''))) filter (where f.ended_at is null) as place,
    string_agg(concat_ws(' ', o.full_name, o.marn, o.email, o.phone, o.suburb, o.state, o.postcode), ' ') as haystack
   from public.business_agent_affiliations f join public.omara_agents o on o.id = f.omara_agent_id
   where f.business_id = b.id
  ) ag on true
  where b.identity_status <> 'archived'
 ), sourced as (
  select *, case when directory_name_key is not null or current_agents + ended_agents > 0 then 'omara' else 'manual' end as source
  from base
 ), searched as (
  select * from sourced s
  where (coalesce(p_source, '') = '' or s.source = p_source)
   and (coalesce(p_workspace, '') = '' or (p_workspace = 'yes') = (s.agency_id is not null))
   and not exists (select 1 from unnest(v_words) w where strpos(lower(concat_ws(' ', s.name, s.agency_code, s.business_email,
     s.primary_contact, s.agency_phone, s.agency_address, s.haystack)), w) = 0)
 ), filtered as (
  select *, case when status = 'Active' then 0 when agency_id is not null then 1 else 2 end as rank_key
  from searched where coalesce(p_status, '') = '' or status = p_status
 ), page as (
  select * from filtered order by rank_key, lower(name), id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset least(greatest(coalesce(p_offset, 0), 0), 1000000)
 )
 select jsonb_build_object(
  'total', (select count(*) from filtered),
  'counts', jsonb_build_object('all', (select count(*) from searched),
   'active', (select count(*) from searched where status = 'Active'),
   'inactive', (select count(*) from searched where status = 'Inactive')),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'status', p.status, 'source', p.source, 'identityStatus', p.identity_status,
    'agencyId', p.agency_id, 'agencyCode', coalesce(p.agency_code, ''),
    'place', coalesce(nullif(p.place, ''), nullif(p.agency_address, ''), ''),
    'contact', coalesce(p.primary_contact, ''), 'email', coalesce(p.business_email, ''),
    'omaraAgents', p.current_agents, 'omaraEnded', p.ended_agents,
    'admins', (select count(*) from public.agency_memberships m join public.portal_profiles pp on pp.id = m.user_id
      where m.agency_id = p.agency_id and m.role = 'agency_admin' and m.status = 'Active' and pp.status = 'Active'),
    'agents', (select count(*) from public.agency_memberships m join public.portal_profiles pp on pp.id = m.user_id
      where m.agency_id = p.agency_id and m.role = 'agent' and m.status = 'Active' and pp.status = 'Active'),
    'students', (select count(*) from public.enrollment_students s where s.agency_id = p.agency_id),
    'applications', (select count(*) from public.enrollment_applications e where e.agency_id = p.agency_id),
    'statusCounts', case when p.agency_id is null then '{}'::jsonb else public.admin_status_counts(p.agency_id) end
   ) order by p.rank_key, lower(p.name), p.id) from page p), '[]'::jsonb))
 into result;
 return result;
end $fn$;
revoke all on function public.admin_business_list(text, text, text, text, integer, integer) from public, anon;
grant execute on function public.admin_business_list(text, text, text, text, integer, integer) to authenticated;

create function public.admin_business_detail(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare b public.businesses; a public.agencies; c record; result jsonb;
begin
 perform public.admin_business_require();
 select * into b from public.businesses where id = p_business;
 if not found then return null; end if;
 select * into a from public.agencies where business_id = b.id;
 select o.full_name, o.email, o.phone, o.business_address, o.website,
  concat_ws(' ', nullif(btrim(o.suburb), ''), nullif(btrim(o.state), '')) as place into c
  from public.business_agent_affiliations f join public.omara_agents o on o.id = f.omara_agent_id
  where f.business_id = b.id and f.ended_at is null
  order by o.is_active desc, (nullif(btrim(o.email), '') is not null) desc, o.last_synced_at desc nulls last, o.id limit 1;
 result := jsonb_build_object(
  'id', b.id, 'name', b.display_name, 'status', b.status, 'identityStatus', b.identity_status,
  'registration', jsonb_build_object('country', b.registration_country, 'type', b.registration_type, 'number', b.registration_number),
  'statusChangedAt', b.status_changed_at, 'createdAt', b.created_at,
  'source', case when b.directory_name_key is not null or exists (select 1 from public.business_agent_affiliations f where f.business_id = b.id) then 'omara' else 'manual' end,
  'directoryContact', jsonb_build_object('name', coalesce(c.full_name, ''), 'email', coalesce(c.email, ''), 'phone', coalesce(c.phone, ''),
   'address', coalesce(c.business_address, ''), 'website', coalesce(c.website, ''), 'place', coalesce(c.place, '')),
  'agency', case when a.id is null then null else jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'status', a.status,
   'email', a.business_email, 'phone', a.phone, 'address', a.address, 'country', a.country, 'contact', a.primary_contact,
   'registrationNumber', a.registration_number, 'createdAt', a.created_at) end,
  'counts', jsonb_build_object(
   'omaraAgents', (select count(*) from public.business_agent_affiliations f where f.business_id = b.id and f.ended_at is null),
   'omaraEnded', (select count(*) from public.business_agent_affiliations f where f.business_id = b.id and f.ended_at is not null),
   'admins', (select count(*) from public.agency_memberships m join public.portal_profiles pp on pp.id = m.user_id
     where m.agency_id = a.id and m.role = 'agency_admin' and m.status = 'Active' and pp.status = 'Active'),
   'agents', (select count(*) from public.agency_memberships m join public.portal_profiles pp on pp.id = m.user_id
     where m.agency_id = a.id and m.role = 'agent' and m.status = 'Active' and pp.status = 'Active'),
   'students', (select count(*) from public.enrollment_students s where s.agency_id = a.id),
   'applications', (select count(*) from public.enrollment_applications e where e.agency_id = a.id)),
  'statusCounts', case when a.id is null then '{}'::jsonb else public.admin_status_counts(a.id) end);
 return result;
end $fn$;
revoke all on function public.admin_business_detail(uuid) from public, anon;
grant execute on function public.admin_business_detail(uuid) to authenticated;

create function public.admin_business_agents(p_business uuid) returns jsonb
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
   (f.ended_at is not null) as sort_ended, (not o.is_active) as sort_registered
  from public.business_agent_affiliations f
  join public.omara_agents o on o.id = f.omara_agent_id
  left join public.agent_directory_links l on l.omara_agent_id = o.id
  left join public.portal_profiles p on p.id = l.profile_id
  left join public.agency_memberships m on m.user_id = p.id and m.agency_id = v_agency
  where f.business_id = p_business
 ) r;
 return (select coalesce(jsonb_agg(e - 'sort_ended' - 'sort_registered'), '[]'::jsonb) from jsonb_array_elements(result) e);
end $fn$;
revoke all on function public.admin_business_agents(uuid) from public, anon;
grant execute on function public.admin_business_agents(uuid) to authenticated;

-- Students across businesses, or of one business. p_status keeps students with at least one application in that status.
create function public.admin_students_list(p_search text default '', p_status text default '', p_business uuid default null,
 p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_words text[] := public.admin_search_words(p_search); result jsonb;
begin
 perform public.admin_business_require();
 with base as (
  select s.id, s.full_name, coalesce(s.email, '') as email, coalesce(s.phone, '') as phone, s.created_at,
   a.id as agency_id, a.name as agency_name, b.id as business_id, b.display_name as business_name,
   last_app.agent_id, coalesce(last_app.agent_name, '') as agent_name, last_app.updated_at as last_updated
  from public.enrollment_students s
  join public.agencies a on a.id = s.agency_id
  join public.businesses b on b.id = a.business_id
  left join lateral (
   select e.assigned_agent_id as agent_id, pp.full_name as agent_name, e.updated_at
   from public.enrollment_applications e left join public.portal_profiles pp on pp.id = e.assigned_agent_id
   where e.student_id = s.id order by e.updated_at desc limit 1
  ) last_app on true
  where (p_business is null or b.id = p_business)
   and (coalesce(p_status, '') = '' or exists (select 1 from public.enrollment_applications e where e.student_id = s.id and e.status = p_status))
   and not exists (select 1 from unnest(v_words) w where strpos(lower(concat_ws(' ', s.full_name, s.email, s.phone, a.name, b.display_name, last_app.agent_name,
     (select string_agg(coalesce(e.reference, ''), ' ') from public.enrollment_applications e where e.student_id = s.id))), w) = 0)
 ), page as (
  select * from base order by last_updated desc nulls last, lower(full_name), id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset least(greatest(coalesce(p_offset, 0), 0), 1000000)
 )
 select jsonb_build_object('total', (select count(*) from base),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
   'id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone, 'createdAt', p.created_at, 'lastUpdated', p.last_updated,
   'agencyId', p.agency_id, 'businessId', p.business_id, 'businessName', p.business_name,
   'agentId', p.agent_id, 'agentName', p.agent_name,
   'applications', (select count(*) from public.enrollment_applications e where e.student_id = p.id),
   'statusCounts', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from
     (select e.status, count(*) n from public.enrollment_applications e where e.student_id = p.id group by e.status) x)
  ) order by p.last_updated desc nulls last, lower(p.full_name), p.id) from page p), '[]'::jsonb))
 into result;
 return result;
end $fn$;
revoke all on function public.admin_students_list(text, text, uuid, integer, integer) from public, anon;
grant execute on function public.admin_students_list(text, text, uuid, integer, integer) to authenticated;

create function public.admin_application_rows(p_student uuid, p_agent uuid) returns jsonb
language sql stable security definer set search_path = public as $fn$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id', e.id, 'reference', coalesce(e.reference, ''), 'status', e.status, 'intake', e.intake, 'completion', e.completion,
  'createdAt', e.created_at, 'updatedAt', e.updated_at, 'submittedAt', e.submitted_at,
  'studentId', e.student_id, 'agentId', e.assigned_agent_id, 'agentName', coalesce(pp.full_name, ''),
  'courses', (select coalesce(jsonb_agg(jsonb_build_object('code', c.course_code, 'title', c.course_title)), '[]'::jsonb)
    from public.enrollment_application_courses c where c.application_id = e.id)
 ) order by e.updated_at desc), '[]'::jsonb)
 from public.enrollment_applications e left join public.portal_profiles pp on pp.id = e.assigned_agent_id
 where (p_student is null or e.student_id = p_student) and (p_agent is null or e.assigned_agent_id = p_agent)
  and (p_student is not null or p_agent is not null);
$fn$;
revoke all on function public.admin_application_rows(uuid, uuid) from public, anon, authenticated;

create function public.admin_student_detail(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare s public.enrollment_students; a public.agencies; b public.businesses;
begin
 perform public.admin_business_require();
 select * into s from public.enrollment_students where id = p_student;
 if not found then return null; end if;
 select * into a from public.agencies where id = s.agency_id;
 select * into b from public.businesses where id = a.business_id;
 return jsonb_build_object('id', s.id, 'name', s.full_name, 'email', coalesce(s.email, ''), 'phone', coalesce(s.phone, ''),
  'dateOfBirth', s.date_of_birth, 'createdAt', s.created_at,
  'business', jsonb_build_object('id', b.id, 'name', b.display_name, 'status', b.status), 'agencyId', a.id,
  'applications', public.admin_application_rows(s.id, null));
end $fn$;
revoke all on function public.admin_student_detail(uuid) from public, anon;
grant execute on function public.admin_student_detail(uuid) to authenticated;

create function public.admin_agents_list(p_search text default '', p_status text default '', p_business uuid default null,
 p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_words text[] := public.admin_search_words(p_search); result jsonb;
begin
 perform public.admin_business_require();
 if coalesce(p_status, '') not in ('', 'Active', 'Inactive') then raise exception 'Invalid status' using errcode = '22023'; end if;
 with base as (
  select p.id, p.full_name, p.email, m.role, case when p.status = 'Active' and m.status = 'Active' then 'Active' else 'Inactive' end as status,
   a.id as agency_id, b.id as business_id, b.display_name as business_name, b.status as business_status, o.marn
  from public.agency_memberships m
  join public.portal_profiles p on p.id = m.user_id
  join public.agencies a on a.id = m.agency_id
  join public.businesses b on b.id = a.business_id
  left join public.agent_directory_links l on l.profile_id = p.id
  left join public.omara_agents o on o.id = l.omara_agent_id
  where (p_business is null or b.id = p_business)
   and not exists (select 1 from unnest(v_words) w where strpos(lower(concat_ws(' ', p.full_name, p.email, b.display_name, o.marn)), w) = 0)
 ), filtered as (select * from base where coalesce(p_status, '') = '' or status = p_status),
 page as (
  select * from filtered order by case when status = 'Active' then 0 else 1 end, lower(full_name), id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset least(greatest(coalesce(p_offset, 0), 0), 1000000)
 )
 select jsonb_build_object('total', (select count(*) from filtered),
  'counts', jsonb_build_object('all', (select count(*) from base), 'active', (select count(*) from base where status = 'Active'),
   'inactive', (select count(*) from base where status = 'Inactive')),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
   'id', p.id, 'name', p.full_name, 'email', p.email, 'role', p.role, 'status', p.status, 'marn', coalesce(p.marn, ''),
   'agencyId', p.agency_id, 'businessId', p.business_id, 'businessName', p.business_name, 'businessStatus', p.business_status,
   'students', (select count(distinct e.student_id) from public.enrollment_applications e where e.assigned_agent_id = p.id and e.agency_id = p.agency_id),
   'statusCounts', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (select e.status, count(*) n from public.enrollment_applications e
     where e.assigned_agent_id = p.id and e.agency_id = p.agency_id group by e.status) x)
  ) order by case when p.status = 'Active' then 0 else 1 end, lower(p.full_name), p.id) from page p), '[]'::jsonb))
 into result;
 return result;
end $fn$;
revoke all on function public.admin_agents_list(text, text, uuid, integer, integer) from public, anon;
grant execute on function public.admin_agents_list(text, text, uuid, integer, integer) to authenticated;

create function public.admin_agent_detail(p_profile uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare p public.portal_profiles; m public.agency_memberships; a public.agencies; b public.businesses; o public.omara_agents;
begin
 perform public.admin_business_require();
 select * into p from public.portal_profiles where id = p_profile;
 if not found then return null; end if;
 select * into m from public.agency_memberships where user_id = p.id;
 select * into a from public.agencies where id = m.agency_id;
 select * into b from public.businesses where id = a.business_id;
 select o2.* into o from public.agent_directory_links l join public.omara_agents o2 on o2.id = l.omara_agent_id where l.profile_id = p.id;
 return jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone, 'jobTitle', p.job_title,
  'role', m.role, 'status', case when p.status = 'Active' and m.status = 'Active' then 'Active' else 'Inactive' end,
  'agencyId', a.id, 'business', case when b.id is null then null else jsonb_build_object('id', b.id, 'name', b.display_name, 'status', b.status) end,
  'omara', case when o.id is null then null else jsonb_build_object('id', o.id, 'marn', o.marn, 'registered', o.is_active, 'registrationStatus', o.registration_status) end,
  'marnOptions', (select coalesce(jsonb_agg(jsonb_build_object('id', o3.id, 'name', o3.full_name, 'marn', o3.marn) order by lower(o3.full_name)), '[]'::jsonb)
    from public.business_agent_affiliations f join public.omara_agents o3 on o3.id = f.omara_agent_id
    where f.business_id = b.id and f.ended_at is null
     and not exists (select 1 from public.agent_directory_links l where l.omara_agent_id = o3.id and l.profile_id <> p.id)),
  'applications', public.admin_application_rows(null, p.id),
  'students', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'email', coalesce(s.email, ''))), '[]'::jsonb)
    from public.enrollment_students s where exists (select 1 from public.enrollment_applications e where e.student_id = s.id and e.assigned_agent_id = p.id)));
end $fn$;
revoke all on function public.admin_agent_detail(uuid) from public, anon;
grant execute on function public.admin_agent_detail(uuid) to authenticated;

-- ------------------------------------------------------------------ privacy
-- The registry holds personal contact details: SLIT administrators read all of it; an agency's own
-- portal users read only their own business and its agents. The import runs as service_role.
drop policy if exists "Authenticated users can search OMARA directory" on public.omara_agents;
drop policy if exists admin_directory_read on public.omara_agents;
create policy omara_agents_scoped_read on public.omara_agents for select to authenticated using (
 public.portal_is_slit_admin() or exists (select 1 from public.business_agent_affiliations f join public.agencies a on a.business_id = f.business_id
  where f.omara_agent_id = omara_agents.id and a.id = public.portal_agency_id()));
drop policy if exists businesses_directory_read on public.businesses;
create policy businesses_scoped_read on public.businesses for select to authenticated using (
 public.portal_is_slit_admin() or exists (select 1 from public.agencies a where a.business_id = businesses.id and a.id = public.portal_agency_id()));
drop policy if exists business_affiliations_directory_read on public.business_agent_affiliations;
create policy business_affiliations_scoped_read on public.business_agent_affiliations for select to authenticated using (
 public.portal_is_slit_admin() or exists (select 1 from public.agencies a where a.business_id = business_agent_affiliations.business_id and a.id = public.portal_agency_id()));
