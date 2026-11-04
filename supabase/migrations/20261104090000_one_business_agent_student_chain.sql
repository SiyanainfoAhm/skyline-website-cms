-- One chain: business (the agencies table, unique by ABN) -> agents -> students -> applications.
--
-- Removes the duplicate records that grew around it:
-- * businesses (names generated from the OMARA register) and business_agent_affiliations: a business is an
--   agency row with an ABN; the OMARA register stays a read-only lookup for an agent's MARN.
-- * business_agents and agent_directory_links: replaced by one agents table (business, contact, MARN, login, status).
-- * The one-student-per-application trigger: an application is created for a chosen student, so a student can
--   have many applications. Students carry their agent and are kept in step with their latest application.
-- Existing students are merged inside a business when they share a passport and date of birth, or an email and
-- date of birth; nothing is merged on a name or an email alone.
set local lock_timeout='5s';
set local statement_timeout='300s';

-- ------------------------------------------------------------------ old functions and triggers
drop trigger if exists business_agent_membership_sync on public.agency_memberships;
drop function if exists public.business_agent_sync_membership();
drop trigger if exists agency_business_identity_before_write on public.agencies;
drop function if exists public.agency_ensure_business_identity();
drop trigger if exists agency_business_status_sync on public.agencies;
drop function if exists public.agency_sync_business_status();
drop trigger if exists omara_directory_business_after_insert on public.omara_agents;
drop function if exists public.omara_attach_directory_business();
drop function if exists public.admin_business_set_status(uuid, text);
drop function if exists public.admin_business_link_agency(uuid, uuid);
drop function if exists public.admin_link_agent_marn(uuid, uuid, text);
drop function if exists public.admin_business_list(text, text, text, text, integer, integer);
drop function if exists public.admin_business_detail(uuid);
drop function if exists public.admin_business_agents(uuid);
drop function if exists public.admin_students_list(text, text, uuid, integer, integer);
drop function if exists public.admin_application_rows(uuid, uuid);
drop function if exists public.admin_student_detail(uuid);
drop function if exists public.admin_agents_list(text, text, uuid, integer, integer);
drop function if exists public.admin_agent_detail(uuid);
drop function if exists public.admin_agent_activate(uuid, uuid, uuid, text, text, text, text);
drop function if exists public.admin_agent_deactivate(uuid);
drop function if exists public.admin_agent_directory(text, text, uuid, integer, integer);
drop function if exists public.admin_agent_overview(uuid);

-- ------------------------------------------------------------------ businesses are agencies, unique by ABN
drop index if exists public.agencies_directory_business_unique;
create unique index agencies_abn_unique on public.agencies (regexp_replace(registration_number, '\s', '', 'g'))
 where nullif(btrim(registration_number), '') is not null;
comment on table public.agencies is 'A business (education or migration agency) identified by its ABN. Its agents, students and applications hang off this row.';

-- ------------------------------------------------------------------ agents
create table public.agents (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.agencies(id) on delete restrict,
 profile_id uuid unique references public.portal_profiles(id) on delete set null,
 omara_agent_id uuid unique references public.omara_agents(id) on delete set null,
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
create index agents_business_idx on public.agents(business_id);
create index agents_email_idx on public.agents(lower(email)) where email <> '';
comment on table public.agents is 'An agent of one business. MARN (omara_agent_id) and portal login (profile_id) are optional. Students belong to an agent.';
alter table public.agents enable row level security;
revoke all on public.agents from public, anon, authenticated;
grant select on public.agents to authenticated;
grant all on public.agents to service_role;
create policy agents_scoped_read on public.agents for select to authenticated
 using (public.portal_is_slit_admin() or business_id = public.portal_agency_id());
create trigger agents_touch_updated before update on public.agents
 for each row execute function public.business_student_touch_updated_at();

-- Agents activated so far, mapped from their business record to the agency row behind it.
insert into public.agents(id, business_id, profile_id, omara_agent_id, full_name, email, phone, role, status, status_changed_at, status_changed_by, created_at)
select g.id, a.id, g.profile_id, g.omara_agent_id, g.full_name, g.email, g.phone, g.role, g.status, g.status_changed_at, g.status_changed_by, g.created_at
from public.business_agents g join public.agencies a on a.business_id = g.business_id
on conflict do nothing;
-- Everyone with a portal login who is not an agent record yet.
insert into public.agents(business_id, profile_id, omara_agent_id, full_name, email, phone, role, status, status_changed_at)
select m.agency_id, p.id, l.omara_agent_id, coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''), 'Portal user'),
 lower(btrim(coalesce(p.email, ''))), left(coalesce(p.phone, ''), 40), m.role,
 case when m.status = 'Active' and p.status = 'Active' then 'Active' else 'Inactive' end, now()
from public.agency_memberships m
join public.portal_profiles p on p.id = m.user_id
left join public.agent_directory_links l on l.profile_id = p.id
where not exists (select 1 from public.agents g where g.profile_id = p.id)
 and (l.omara_agent_id is null or not exists (select 1 from public.agents g where g.omara_agent_id = l.omara_agent_id));

-- The register is readable by SLIT administrators and, for its own agents, by a business's portal users.
drop policy if exists omara_agents_scoped_read on public.omara_agents;
create policy omara_agents_scoped_read on public.omara_agents for select to authenticated using (
 public.portal_is_slit_admin() or exists (select 1 from public.agents g where g.omara_agent_id = omara_agents.id and g.business_id = public.portal_agency_id()));

drop table public.business_agents;
drop table public.agent_directory_links;
drop table public.business_agent_affiliations;
alter table public.agencies drop column business_id;
drop table public.businesses;

-- Portal memberships -> agents (invitation accepted, role or status changed by an agency administrator).
create function public.agent_sync_membership() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare p public.portal_profiles; v_id uuid; v_status text;
begin
 select * into p from public.portal_profiles where id = new.user_id;
 v_status := case when new.status = 'Active' and coalesce(p.status, 'Active') = 'Active' then 'Active' else 'Inactive' end;
 select id into v_id from public.agents where profile_id = new.user_id;
 if v_id is null then
  -- A SLIT activation waiting for this person: same business and email, no login yet.
  select id into v_id from public.agents
   where profile_id is null and business_id = new.agency_id and email <> '' and email = lower(btrim(coalesce(p.email, '')))
   order by updated_at desc limit 1;
 end if;
 if v_id is null then
  insert into public.agents(business_id, profile_id, full_name, email, phone, role, status, status_changed_at)
  values (new.agency_id, new.user_id, coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''), 'Portal user'),
   lower(btrim(coalesce(p.email, ''))), left(coalesce(p.phone, ''), 40), new.role, v_status, now());
 else
  update public.agents set profile_id = new.user_id, business_id = new.agency_id, role = new.role,
   status_changed_at = case when status is distinct from v_status then now() else status_changed_at end,
   status = v_status, updated_at = now()
  where id = v_id;
 end if;
 return new;
end $fn$;
revoke all on function public.agent_sync_membership() from public, anon, authenticated;
create trigger agent_membership_sync after insert or update of status, role, agency_id on public.agency_memberships
 for each row execute function public.agent_sync_membership();

-- ------------------------------------------------------------------ students
alter table public.enrollment_students
 add column agent_id uuid references public.agents(id) on delete set null,
 add column passport_number text not null default '' check (length(passport_number) <= 40),
 add column nationality text not null default '';
create index enrollment_students_agent_idx on public.enrollment_students(agent_id);
comment on column public.enrollment_students.agent_id is 'The agent who looks after this student; follows the student''s latest application.';

-- A date typed or read from a document: ISO, or day/month/year. Anything else is unknown.
create function public.student_safe_date(p text) returns date
language plpgsql stable as $fn$
begin
 if p ~ '^\d{4}-\d{2}-\d{2}' then return left(p, 10)::date;
 elsif p ~ '^\d{1,2}/\d{1,2}/\d{4}$' then return to_date(p, 'DD/MM/YYYY');
 end if;
 return null;
exception when others then return null;
end $fn$;
revoke all on function public.student_safe_date(text) from public, anon, authenticated;

-- Fill each student from their latest application, and give them that application's agent.
with latest as (
 select distinct on (e.student_id) e.student_id, e.student_name, e.student_email, e.assigned_agent_id, e.data -> 'values' as v
 from public.enrollment_applications e order by e.student_id, e.updated_at desc
)
update public.enrollment_students s set
 full_name = coalesce(nullif(btrim(concat_ws(' ', l.v ->> 'first_name', l.v ->> 'last_name')), ''), nullif(btrim(l.student_name), ''), s.full_name),
 email = coalesce(nullif(lower(btrim(l.v ->> 'email')), ''), nullif(lower(btrim(l.student_email)), ''), s.email),
 phone = coalesce(nullif(btrim(l.v ->> 'mobile'), ''), s.phone),
 date_of_birth = coalesce(public.student_safe_date(l.v ->> 'dob'), s.date_of_birth),
 passport_number = coalesce(nullif(upper(regexp_replace(coalesce(l.v ->> 'passport_number', ''), '\s', '', 'g')), ''), s.passport_number),
 nationality = coalesce(nullif(btrim(l.v ->> 'nationality'), ''), s.nationality),
 agent_id = coalesce((select g.id from public.agents g where g.profile_id = l.assigned_agent_id), s.agent_id)
from latest l where l.student_id = s.id;

-- Merge duplicates inside a business: first the same passport and date of birth, then the same email and date of birth
-- (so a record with a passport and one without, for the same person, become one). The oldest row stays.
create function pg_temp.merge_students(p_by_passport boolean) returns void language plpgsql as $fn$
begin
 create temp table merge_map on commit drop as
  with keyed as (
   select id, agency_id, created_at,
    case when p_by_passport then (case when passport_number <> '' and date_of_birth is not null then passport_number || ':' || date_of_birth end)
         else (case when coalesce(email, '') <> '' and date_of_birth is not null then lower(email) || ':' || date_of_birth end) end as k
   from public.enrollment_students
  )
  select id, first_value(id) over (partition by agency_id, k order by created_at, id) as keep_id from keyed where k is not null;
 update public.enrollment_applications e set student_id = r.keep_id from merge_map r where e.student_id = r.id and r.id <> r.keep_id;
 delete from public.enrollment_students s using merge_map r where s.id = r.id and r.id <> r.keep_id;
 drop table merge_map;
end $fn$;
select pg_temp.merge_students(true);
select pg_temp.merge_students(false);
-- Students left behind by applications that no longer exist.
delete from public.enrollment_students s where not exists (select 1 from public.enrollment_applications e where e.student_id = s.id);

create unique index enrollment_students_passport_unique on public.enrollment_students(agency_id, passport_number, date_of_birth)
 where passport_number <> '' and date_of_birth is not null;
create unique index enrollment_students_email_dob_unique on public.enrollment_students(agency_id, lower(email), date_of_birth)
 where coalesce(email, '') <> '' and date_of_birth is not null;

-- An agent reads their own students.
create policy enrollment_students_agent_read on public.enrollment_students for select to authenticated
 using (public.tenant_scope(tenant_id) and exists (select 1 from public.agents g where g.id = enrollment_students.agent_id and g.profile_id = public.portal_profile_id()));

-- An application is created for a chosen student (portal_create_student_application sets skyline.student_id). A direct insert
-- without one reuses the student with the same email in the business, or creates one, so nothing is left without a student.
create or replace function public.application_verify_student_scope() returns trigger
language plpgsql security invoker set search_path = '' as $fn$
declare s record; v_set text := nullif(current_setting('skyline.student_id', true), '');
begin
 if tg_op = 'INSERT' and new.student_id is null then
  if v_set is not null then new.student_id := v_set::uuid;
  else
   select id into new.student_id from public.enrollment_students
    where agency_id = new.agency_id and tenant_id is not distinct from new.tenant_id
     and coalesce(email, '') <> '' and email = lower(btrim(new.student_email)) limit 1;
   if new.student_id is null then
    insert into public.enrollment_students(agency_id, tenant_id, full_name, email, created_by, agent_id)
    values (new.agency_id, new.tenant_id, new.student_name, nullif(lower(btrim(new.student_email)), ''), new.created_by,
     (select g.id from public.agents g where g.profile_id = new.assigned_agent_id))
    returning id into new.student_id;
   end if;
  end if;
 end if;
 if new.student_id is not null then
  select agency_id, tenant_id into s from public.enrollment_students where id = new.student_id;
  if not found or s.agency_id is distinct from new.agency_id or s.tenant_id is distinct from new.tenant_id then
   raise exception 'Student identity must belong to the same agency and institution' using errcode = '23514';
  end if;
 end if;
 return new;
end $fn$;

-- The student record follows the application: details from the form, and the agent it is assigned to. A detail that would
-- clash with another student of the business (same passport or email and birth date) is left as it was; the save still goes through.
create function public.application_sync_student() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare v jsonb := new.data -> 'values'; v_agent uuid;
begin
 if new.student_id is null then return new; end if;
 if tg_op = 'INSERT' or new.assigned_agent_id is distinct from old.assigned_agent_id then
  select g.id into v_agent from public.agents g where g.profile_id = new.assigned_agent_id;
  if v_agent is not null then update public.enrollment_students set agent_id = v_agent where id = new.student_id and agent_id is distinct from v_agent; end if;
 end if;
 if tg_op = 'UPDATE' and (new.data is distinct from old.data or new.student_name is distinct from old.student_name or new.student_email is distinct from old.student_email) then
  begin
   update public.enrollment_students s set
    full_name = coalesce(nullif(btrim(concat_ws(' ', v ->> 'first_name', v ->> 'last_name')), ''), nullif(btrim(new.student_name), ''), s.full_name),
    email = coalesce(nullif(lower(btrim(v ->> 'email')), ''), nullif(lower(btrim(new.student_email)), ''), s.email),
    phone = coalesce(nullif(btrim(v ->> 'mobile'), ''), s.phone),
    date_of_birth = coalesce(public.student_safe_date(v ->> 'dob'), s.date_of_birth),
    passport_number = coalesce(nullif(upper(regexp_replace(coalesce(v ->> 'passport_number', ''), '\s', '', 'g')), ''), s.passport_number),
    nationality = coalesce(nullif(btrim(v ->> 'nationality'), ''), s.nationality)
   where s.id = new.student_id;
  exception when unique_violation then
   raise warning 'Student % details not updated: they would match another student of the business', new.student_id;
  end;
 end if;
 return new;
end $fn$;
revoke all on function public.application_sync_student() from public, anon, authenticated;
create trigger zz_application_sync_student after insert or update of data, student_name, student_email, assigned_agent_id on public.enrollment_applications
 for each row execute function public.application_sync_student();

-- ------------------------------------------------------------------ student commands (portal and CMS)
-- Finds students the caller may see by email, mobile or passport, with their business and agent, for "new application for an existing student".
create function public.portal_student_find(p_email text default '', p_phone text default '', p_passport text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_phone text := btrim(coalesce(p_phone, ''));
 v_passport text := upper(regexp_replace(coalesce(p_passport, ''), '\s', '', 'g')); v_agency uuid := public.portal_agency_id();
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
 if v_email = '' and v_phone = '' and v_passport = '' then return '[]'::jsonb; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
   'id', s.id, 'name', s.full_name, 'email', coalesce(s.email, ''), 'phone', coalesce(s.phone, ''), 'dateOfBirth', s.date_of_birth,
   'passportNumber', s.passport_number, 'businessId', a.id, 'businessName', a.name,
   'agentId', g.id, 'agentName', coalesce(g.full_name, ''),
   'applications', (select count(*) from public.enrollment_applications e where e.student_id = s.id),
   'emailMatch', v_email <> '' and lower(coalesce(s.email, '')) = v_email,
   'phoneMatch', v_phone <> '' and coalesce(s.phone, '') = v_phone,
   'passportMatch', v_passport <> '' and s.passport_number = v_passport
  ) order by s.updated_at desc)
  from (
   select * from public.enrollment_students x
   where public.tenant_scope(x.tenant_id)
    and (public.portal_is_slit_admin() or x.agency_id = v_agency)
    and ((v_email <> '' and lower(coalesce(x.email, '')) = v_email) or (v_phone <> '' and coalesce(x.phone, '') = v_phone)
      or (v_passport <> '' and x.passport_number = v_passport))
   order by x.updated_at desc limit 10
  ) s
  join public.agencies a on a.id = s.agency_id
  left join public.agents g on g.id = s.agent_id), '[]'::jsonb);
end $fn$;
revoke all on function public.portal_student_find(text, text, text) from public, anon;
grant execute on function public.portal_student_find(text, text, text) to authenticated;

-- Creates or updates a student of an agent. A new student who matches an existing one of the business (passport and birth
-- date, or email and birth date) is that student: their details are updated and the same id comes back with reused = true.
create function public.portal_student_save(p_student uuid, p_agent uuid, p_full_name text, p_email text, p_phone text,
 p_date_of_birth date default null, p_passport text default '', p_nationality text default '') returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare g public.agents; s public.enrollment_students; v_reused boolean := false;
 v_name text := btrim(coalesce(p_full_name, '')); v_email text := lower(btrim(coalesce(p_email, ''))); v_phone text := btrim(coalesce(p_phone, ''));
 v_passport text := upper(regexp_replace(coalesce(p_passport, ''), '\s', '', 'g')); v_tenant uuid := public.tenant_current();
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
 select * into g from public.agents where id = p_agent;
 if not found then raise exception 'Agent not found' using errcode = 'P0002'; end if;
 if not public.portal_is_slit_admin() then
  if g.business_id is distinct from public.portal_agency_id() then raise exception 'This agent belongs to another business' using errcode = '42501'; end if;
  if not public.portal_is_agency_admin() and g.profile_id is distinct from public.portal_profile_id() then
   raise exception 'Agents can add only their own students' using errcode = '42501'; end if;
 end if;
 if v_email <> '' and (length(v_email) > 254 or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$') then raise exception 'Enter a valid email address' using errcode = '22023'; end if;
 if length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then raise exception 'Enter a valid name' using errcode = '22023'; end if;
 if length(v_phone) > 40 or length(v_passport) > 40 then raise exception 'Enter a valid phone number and passport number' using errcode = '22023'; end if;
 if p_student is not null then
  select * into s from public.enrollment_students where id = p_student for update;
  if not found then raise exception 'Student not found' using errcode = 'P0002'; end if;
  if s.agency_id <> g.business_id then raise exception 'This student belongs to another business' using errcode = '23514'; end if;
 else
  if v_passport <> '' and p_date_of_birth is not null then
   select * into s from public.enrollment_students where agency_id = g.business_id and passport_number = v_passport and date_of_birth = p_date_of_birth for update;
  end if;
  if s.id is null and v_email <> '' and p_date_of_birth is not null then
   select * into s from public.enrollment_students where agency_id = g.business_id and lower(coalesce(email, '')) = v_email and date_of_birth = p_date_of_birth for update;
  end if;
  v_reused := s.id is not null;
 end if;
 if s.id is null then
  if v_name = '' then raise exception 'Enter the student''s name' using errcode = '22023'; end if;
  insert into public.enrollment_students(agency_id, tenant_id, agent_id, full_name, email, phone, date_of_birth, passport_number, nationality, created_by)
  values (g.business_id, v_tenant, g.id, v_name, nullif(v_email, ''), nullif(v_phone, ''), p_date_of_birth, v_passport, btrim(coalesce(p_nationality, '')), public.portal_profile_id())
  returning * into s;
 else
  update public.enrollment_students set agent_id = g.id,
   full_name = coalesce(nullif(v_name, ''), full_name), email = coalesce(nullif(v_email, ''), email), phone = coalesce(nullif(v_phone, ''), phone),
   date_of_birth = coalesce(p_date_of_birth, date_of_birth), passport_number = coalesce(nullif(v_passport, ''), passport_number),
   nationality = coalesce(nullif(btrim(coalesce(p_nationality, '')), ''), nationality)
  where id = s.id returning * into s;
 end if;
 return jsonb_build_object('id', s.id, 'name', s.full_name, 'email', coalesce(s.email, ''), 'phone', coalesce(s.phone, ''), 'businessId', s.agency_id, 'agentId', s.agent_id, 'reused', v_reused);
exception when unique_violation then
 raise exception 'Another student of this business already has this passport number or email with the same date of birth' using errcode = '23505';
end $fn$;
revoke all on function public.portal_student_save(uuid, uuid, text, text, text, date, text, text) from public, anon;
grant execute on function public.portal_student_save(uuid, uuid, text, text, text, date, text, text) to authenticated;

-- A new application for a student: its business and assigned agent come from the student.
create function public.portal_create_student_application(p_client_key text, p_student uuid)
returns table(application_id uuid, application_reference text) language plpgsql security definer set search_path = public as $fn$
declare s public.enrollment_students; g public.agents; v_agent uuid; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
 select * into s from public.enrollment_students where id = p_student;
 if not found then raise exception 'Student not found' using errcode = 'P0002'; end if;
 if s.agent_id is not null then select * into g from public.agents where id = s.agent_id; end if;
 if not public.portal_is_slit_admin() then
  if s.agency_id is distinct from public.portal_agency_id() then raise exception 'This student belongs to another business' using errcode = '42501'; end if;
  if not public.portal_is_agency_admin() and g.profile_id is distinct from public.portal_profile_id() then
   raise exception 'Only the student''s agent or an agency administrator can start their application' using errcode = '42501'; end if;
 end if;
 -- The application is assigned to the student's agent when that agent can sign in as an agent of the business.
 if g.profile_id is not null and exists (select 1 from public.agency_memberships m join public.portal_profiles p on p.id = m.user_id
   where m.user_id = g.profile_id and m.agency_id = s.agency_id and m.status = 'Active' and p.status = 'Active' and m.role = 'agent') then
  v_agent := g.profile_id;
 end if;
 perform set_config('skyline.student_id', s.id::text, true);
 return query select * from public.portal_create_application(p_client_key, v_agent, s.agency_id);
 perform set_config('skyline.student_id', '', true);
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
revoke all on function public.portal_create_student_application(text, uuid) from public, anon;
grant execute on function public.portal_create_student_application(text, uuid) to authenticated;

-- ------------------------------------------------------------------ CMS: businesses
create function public.admin_business_set_status(p_business uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare a public.agencies;
begin
 perform public.admin_business_require();
 if p_status is null or p_status not in ('Active','Inactive') then raise exception 'Status must be Active or Inactive' using errcode = '22023'; end if;
 select * into a from public.agencies where id = p_business for update;
 if not found then raise exception 'Business not found' using errcode = 'P0002'; end if;
 if a.status is distinct from p_status then update public.agencies set status = p_status, updated_at = now() where id = a.id; end if;
 perform public.admin_business_audit(case when p_status = 'Active' then 'business_activated' else 'business_deactivated' end, a.id, a.id, jsonb_build_object('name', a.name));
 return jsonb_build_object('businessId', a.id, 'status', p_status, 'agencyId', a.id, 'workspaceCreated', false);
end $fn$;
revoke all on function public.admin_business_set_status(uuid, text) from public, anon;
grant execute on function public.admin_business_set_status(uuid, text) to authenticated;

create function public.admin_business_list(p_search text default '', p_status text default '', p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_words text[] := public.admin_search_words(p_search); result jsonb;
begin
 perform public.admin_business_require();
 if coalesce(p_status, '') not in ('', 'Active', 'Inactive') then raise exception 'Invalid status' using errcode = '22023'; end if;
 with searched as (
  select a.id, a.name, a.code, a.status, a.registration_number, a.business_email, a.primary_contact, a.phone, a.address, a.country, a.created_at
  from public.agencies a
  where not exists (select 1 from unnest(v_words) w where strpos(lower(concat_ws(' ', a.name, a.code, a.registration_number, a.business_email, a.primary_contact, a.phone, a.address,
    (select string_agg(concat_ws(' ', g.full_name, g.email, o.marn), ' ') from public.agents g left join public.omara_agents o on o.id = g.omara_agent_id where g.business_id = a.id))), w) = 0)
 ), filtered as (
  select * from searched where coalesce(p_status, '') = '' or status = p_status
 ), page as (
  select * from filtered order by case when status = 'Active' then 0 else 1 end, lower(name), id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset least(greatest(coalesce(p_offset, 0), 0), 1000000)
 )
 select jsonb_build_object(
  'total', (select count(*) from filtered),
  'counts', jsonb_build_object('all', (select count(*) from searched), 'active', (select count(*) from searched where status = 'Active'),
   'inactive', (select count(*) from searched where status = 'Inactive')),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'status', p.status, 'agencyId', p.id, 'agencyCode', coalesce(p.code, ''), 'abn', coalesce(p.registration_number, ''),
    'place', coalesce(p.address, ''), 'contact', coalesce(p.primary_contact, ''), 'email', coalesce(p.business_email, ''),
    'admins', (select count(*) from public.agents g where g.business_id = p.id and g.role = 'agency_admin' and g.status = 'Active'),
    'agents', (select count(*) from public.agents g where g.business_id = p.id and g.role = 'agent' and g.status = 'Active'),
    'students', (select count(*) from public.enrollment_students s where s.agency_id = p.id),
    'applications', (select count(*) from public.enrollment_applications e where e.agency_id = p.id),
    'statusCounts', public.admin_status_counts(p.id)
   ) order by case when p.status = 'Active' then 0 else 1 end, lower(p.name), p.id) from page p), '[]'::jsonb))
 into result;
 return result;
end $fn$;
revoke all on function public.admin_business_list(text, text, integer, integer) from public, anon;
grant execute on function public.admin_business_list(text, text, integer, integer) to authenticated;

create function public.admin_business_detail(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare a public.agencies;
begin
 perform public.admin_business_require();
 select * into a from public.agencies where id = p_business;
 if not found then return null; end if;
 return jsonb_build_object(
  'id', a.id, 'name', a.name, 'status', a.status, 'createdAt', a.created_at,
  'agency', jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'status', a.status, 'email', a.business_email, 'phone', a.phone,
   'address', a.address, 'country', a.country, 'contact', a.primary_contact, 'registrationNumber', a.registration_number, 'createdAt', a.created_at),
  'counts', jsonb_build_object(
   'admins', (select count(*) from public.agents g where g.business_id = a.id and g.role = 'agency_admin' and g.status = 'Active'),
   'agents', (select count(*) from public.agents g where g.business_id = a.id and g.role = 'agent' and g.status = 'Active'),
   'inactiveAgents', (select count(*) from public.agents g where g.business_id = a.id and g.status <> 'Active'),
   'students', (select count(*) from public.enrollment_students s where s.agency_id = a.id),
   'applications', (select count(*) from public.enrollment_applications e where e.agency_id = a.id)),
  'statusCounts', public.admin_status_counts(a.id));
end $fn$;
revoke all on function public.admin_business_detail(uuid) from public, anon;
grant execute on function public.admin_business_detail(uuid) to authenticated;

-- ------------------------------------------------------------------ CMS: agents
-- Status shown: Active (approved and signed up), Invited (approved, no login yet), Inactive (everything else).
create function public.admin_agent_rows(p_business uuid, p_search text, p_status text, p_limit integer, p_offset integer) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_words text[] := public.admin_search_words(p_search); result jsonb;
begin
 with rows as (
  select g.id as agent_id, g.omara_agent_id as omara_id, g.profile_id, g.full_name as name, g.email, g.phone, g.role, g.business_id, g.status_changed_at,
   case when g.status <> 'Active' then 'Inactive'
        when g.profile_id is null then 'Invited'
        when exists (select 1 from public.agency_memberships m join public.portal_profiles pp on pp.id = m.user_id
          where m.user_id = g.profile_id and m.status = 'Active' and pp.status = 'Active') then 'Active'
        else 'Inactive' end as status,
   o.marn, o.is_active as registered, a.name as business_name, a.status as business_status,
   (select i.id from public.agency_invitations i where i.agency_id = g.business_id and i.email = g.email and i.status = 'pending' and g.email <> '' limit 1) as invitation_id
  from public.agents g
  join public.agencies a on a.id = g.business_id
  left join public.omara_agents o on o.id = g.omara_agent_id
  where (p_business is null or g.business_id = p_business)
   and not exists (select 1 from unnest(v_words) w where strpos(lower(concat_ws(' ', g.full_name, g.email, g.phone, o.marn, a.name)), w) = 0)
 ), filtered as (
  select *, case status when 'Active' then 0 when 'Invited' then 1 else 2 end as rank_key from rows where coalesce(p_status, '') = '' or status = p_status
 ), page as (
  select * from filtered order by rank_key, lower(name), agent_id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset least(greatest(coalesce(p_offset, 0), 0), 1000000)
 )
 select jsonb_build_object('total', (select count(*) from filtered),
  'counts', jsonb_build_object('all', (select count(*) from rows), 'active', (select count(*) from rows where status = 'Active'),
   'invited', (select count(*) from rows where status = 'Invited'), 'inactive', (select count(*) from rows where status = 'Inactive')),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
   'key', p.agent_id, 'agentId', p.agent_id, 'omaraId', p.omara_id, 'profileId', p.profile_id, 'invitationId', p.invitation_id,
   'name', p.name, 'email', p.email, 'phone', p.phone, 'role', p.role, 'status', p.status, 'statusChangedAt', p.status_changed_at,
   'marn', coalesce(p.marn, ''), 'registered', p.registered,
   'businessId', p.business_id, 'businessName', p.business_name, 'businessStatus', p.business_status,
   'students', (select count(*) from public.enrollment_students s where s.agent_id = p.agent_id),
   'statusCounts', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (select e.status, count(*) n from public.enrollment_applications e
     join public.enrollment_students s on s.id = e.student_id where s.agent_id = p.agent_id group by e.status) x)
  ) order by p.rank_key, lower(p.name), p.agent_id) from page p), '[]'::jsonb))
 into result;
 return result;
end $fn$;
revoke all on function public.admin_agent_rows(uuid, text, text, integer, integer) from public, anon, authenticated;

create function public.admin_agent_directory(p_search text default '', p_status text default '', p_business uuid default null,
 p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
 perform public.admin_business_require();
 if coalesce(p_status, '') not in ('', 'Active', 'Invited', 'Inactive') then raise exception 'Invalid status' using errcode = '22023'; end if;
 return public.admin_agent_rows(p_business, p_search, p_status, p_limit, p_offset);
end $fn$;
revoke all on function public.admin_agent_directory(text, text, uuid, integer, integer) from public, anon;
grant execute on function public.admin_agent_directory(text, text, uuid, integer, integer) to authenticated;

-- A business's agents, every status, for its Agents tab.
create function public.admin_business_agents(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
 perform public.admin_business_require();
 return public.admin_agent_rows(p_business, '', '', 100, 0) -> 'rows';
end $fn$;
revoke all on function public.admin_business_agents(uuid) from public, anon;
grant execute on function public.admin_business_agents(uuid) to authenticated;

create function public.admin_application_rows(p_student uuid, p_agent uuid) returns jsonb
language sql stable security definer set search_path = public as $fn$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id', e.id, 'reference', coalesce(e.reference, ''), 'status', e.status, 'intake', e.intake, 'completion', e.completion,
  'createdAt', e.created_at, 'updatedAt', e.updated_at, 'submittedAt', e.submitted_at,
  'studentId', e.student_id, 'agentId', e.assigned_agent_id, 'agentName', coalesce(pp.full_name, ''),
  'courses', (select coalesce(jsonb_agg(jsonb_build_object('code', c.course_code, 'title', c.course_title)), '[]'::jsonb)
    from public.enrollment_application_courses c where c.application_id = e.id)
 ) order by e.updated_at desc), '[]'::jsonb)
 from public.enrollment_applications e
 join public.enrollment_students s on s.id = e.student_id
 left join public.portal_profiles pp on pp.id = e.assigned_agent_id
 where (p_student is null or e.student_id = p_student) and (p_agent is null or s.agent_id = p_agent)
  and (p_student is not null or p_agent is not null);
$fn$;
revoke all on function public.admin_application_rows(uuid, uuid) from public, anon, authenticated;

-- One agent by its id, its portal login id or its OMARA record id.
create function public.admin_agent_overview(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare g public.agents; o public.omara_agents; a public.agencies; p public.portal_profiles; v_status text;
begin
 perform public.admin_business_require();
 select * into g from public.agents where id = p_id or profile_id = p_id or omara_agent_id = p_id limit 1;
 if not found then return null; end if;
 if g.omara_agent_id is not null then select * into o from public.omara_agents where id = g.omara_agent_id; end if;
 select * into a from public.agencies where id = g.business_id;
 if g.profile_id is not null then select * into p from public.portal_profiles where id = g.profile_id; end if;
 v_status := case when g.status <> 'Active' then 'Inactive' when g.profile_id is null then 'Invited'
  when exists (select 1 from public.agency_memberships m where m.user_id = g.profile_id and m.status = 'Active') and p.status = 'Active' then 'Active' else 'Inactive' end;
 return jsonb_build_object(
  'key', g.id, 'agentId', g.id, 'profileId', g.profile_id, 'omaraId', o.id,
  'name', g.full_name, 'email', g.email, 'phone', coalesce(nullif(g.phone, ''), p.phone, ''), 'role', g.role, 'status', v_status, 'statusChangedAt', g.status_changed_at,
  'invitationId', (select i.id from public.agency_invitations i where i.agency_id = g.business_id and i.email = g.email and i.status = 'pending' and g.email <> '' limit 1),
  'business', jsonb_build_object('id', a.id, 'name', a.name, 'status', a.status),
  'omara', case when o.id is null then null else jsonb_build_object('id', o.id, 'marn', o.marn, 'registered', o.is_active,
    'registrationStatus', o.registration_status, 'place', concat_ws(' ', nullif(btrim(o.suburb), ''), nullif(btrim(o.state), ''))) end,
  'applications', public.admin_application_rows(null, g.id),
  'students', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'email', coalesce(s.email, '')) order by lower(s.full_name)), '[]'::jsonb)
    from public.enrollment_students s where s.agent_id = g.id));
end $fn$;
revoke all on function public.admin_agent_overview(uuid) from public, anon;
grant execute on function public.admin_agent_overview(uuid) to authenticated;

-- Add or activate an agent of a business. p_agent updates an existing record; otherwise one is created. p_marn (optional)
-- links the agent to their OMARA record. An inactive business is activated too. The sign-in invitation is sent afterwards
-- by the portal-admin-users Edge Function; when accepted, the login is linked to this record automatically.
create function public.admin_agent_activate(p_agent uuid, p_business uuid, p_name text, p_email text, p_phone text default '',
 p_marn text default '', p_role text default 'agent') returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare g public.agents; o public.omara_agents; a public.agencies; v_old uuid; v_business_activated boolean := false;
 v_name text := btrim(coalesce(p_name, '')); v_email text := lower(btrim(coalesce(p_email, ''))); v_phone text := left(btrim(coalesce(p_phone, '')), 40);
 v_marn text := btrim(coalesce(p_marn, ''));
begin
 perform public.admin_business_require();
 if coalesce(p_role, '') not in ('agent', 'agency_admin') then raise exception 'Role must be agent or agency admin' using errcode = '22023'; end if;
 if v_email <> '' and (length(v_email) > 254 or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$') then raise exception 'Enter a valid email address' using errcode = '22023'; end if;
 if v_name ~ '[[:cntrl:]]' or length(v_name) > 200 then raise exception 'Enter a valid name' using errcode = '22023'; end if;
 if p_agent is not null then
  select * into g from public.agents where id = p_agent for update;
  if not found then raise exception 'Agent not found' using errcode = 'P0002'; end if;
 end if;
 select * into a from public.agencies where id = coalesce(p_business, g.business_id) for update;
 if not found then raise exception 'Choose the business this agent works for' using errcode = '22023'; end if;
 if v_marn <> '' then
  select * into o from public.omara_agents where upper(regexp_replace(marn, '\s', '', 'g')) = upper(regexp_replace(v_marn, '\s', '', 'g'));
  if not found then raise exception 'This MARN is not on the OMARA register' using errcode = '22023'; end if;
  if exists (select 1 from public.agents x where x.omara_agent_id = o.id and x.id is distinct from g.id) then
   raise exception 'This MARN is already linked to another agent' using errcode = '23505'; end if;
 elsif g.omara_agent_id is not null then
  select * into o from public.omara_agents where id = g.omara_agent_id;
 end if;
 if v_name = '' then v_name := coalesce(nullif(btrim(g.full_name), ''), nullif(btrim(o.full_name), ''), ''); end if;
 if v_name = '' then raise exception 'Enter the agent''s name' using errcode = '22023'; end if;
 if v_email = '' then v_email := coalesce(nullif(g.email, ''), lower(btrim(coalesce(o.email, '')))); end if;
 if v_phone = '' then v_phone := coalesce(nullif(g.phone, ''), left(coalesce(o.phone, ''), 40), ''); end if;
 if v_email <> '' and exists (select 1 from public.agents x where x.email = v_email and x.business_id = a.id and x.id is distinct from g.id) then
  raise exception 'An agent with this email is already in this business' using errcode = '23505'; end if;
 if a.status <> 'Active' then
  update public.agencies set status = 'Active', updated_at = now() where id = a.id;
  v_business_activated := true;
 end if;
 -- A person who already has a login moves only if no student ties them to their current business.
 if g.id is not null and g.business_id <> a.id then
  if exists (select 1 from public.enrollment_students s where s.agent_id = g.id) then
   raise exception 'This agent has students with their current business, so they stay attached to it.' using errcode = '23514'; end if;
  v_old := g.business_id;
 end if;
 if g.id is null then
  insert into public.agents(omara_agent_id, business_id, full_name, email, phone, role, status, status_changed_at, status_changed_by)
  values (o.id, a.id, v_name, v_email, v_phone, p_role, 'Active', now(), auth.uid()) returning * into g;
 else
  update public.agents set business_id = a.id, omara_agent_id = coalesce(o.id, omara_agent_id), full_name = v_name, email = v_email, phone = v_phone, role = p_role,
   status = 'Active', status_changed_at = now(), status_changed_by = auth.uid(), updated_at = now() where id = g.id returning * into g;
 end if;
 if g.profile_id is not null then
  update public.portal_profiles set status = 'Active', updated_at = now() where id = g.profile_id and status <> 'Active';
  update public.agency_memberships set status = 'Active', role = p_role, agency_id = a.id, updated_at = now() where user_id = g.profile_id;
 end if;
 perform public.admin_business_audit('agent_activated', a.id, a.id, jsonb_build_object('agent', v_name, 'marn', o.marn, 'businessActivated', v_business_activated, 'previousBusiness', v_old));
 return jsonb_build_object('agentId', g.id, 'businessId', a.id, 'businessName', a.name, 'agencyId', a.id,
  'businessCreated', false, 'businessActivated', v_business_activated, 'hasLogin', g.profile_id is not null, 'email', v_email, 'name', v_name, 'role', p_role);
end $fn$;
revoke all on function public.admin_agent_activate(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.admin_agent_activate(uuid, uuid, text, text, text, text, text) to authenticated;

-- Deactivate: the agent can no longer sign in and any invitation still waiting is withdrawn. Students and applications stay.
create function public.admin_agent_deactivate(p_agent uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare g public.agents;
begin
 perform public.admin_business_require();
 select * into g from public.agents where id = p_agent for update;
 if not found then raise exception 'Agent not found' using errcode = 'P0002'; end if;
 update public.agents set status = 'Inactive', status_changed_at = now(), status_changed_by = auth.uid(), updated_at = now() where id = g.id;
 if g.profile_id is not null then update public.agency_memberships set status = 'Inactive', updated_at = now() where user_id = g.profile_id; end if;
 if g.email <> '' then
  update public.agency_invitations set status = 'revoked', revoked_at = now() where agency_id = g.business_id and email = g.email and status = 'pending';
 end if;
 perform public.admin_business_audit('agent_deactivated', g.business_id, g.business_id, jsonb_build_object('agent', g.full_name));
 return jsonb_build_object('agentId', g.id, 'status', 'Inactive');
end $fn$;
revoke all on function public.admin_agent_deactivate(uuid) from public, anon;
grant execute on function public.admin_agent_deactivate(uuid) to authenticated;

-- ------------------------------------------------------------------ CMS: students
create function public.admin_students_list(p_search text default '', p_status text default '', p_business uuid default null, p_agent uuid default null,
 p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_words text[] := public.admin_search_words(p_search); result jsonb;
begin
 perform public.admin_business_require();
 with base as (
  select s.id, s.full_name, coalesce(s.email, '') as email, coalesce(s.phone, '') as phone, s.created_at, s.date_of_birth, s.passport_number,
   a.id as business_id, a.name as business_name, g.id as agent_id, coalesce(g.full_name, '') as agent_name,
   (select max(e.updated_at) from public.enrollment_applications e where e.student_id = s.id) as last_updated
  from public.enrollment_students s
  join public.agencies a on a.id = s.agency_id
  left join public.agents g on g.id = s.agent_id
  where (p_business is null or a.id = p_business) and (p_agent is null or s.agent_id = p_agent)
   and (coalesce(p_status, '') = '' or exists (select 1 from public.enrollment_applications e where e.student_id = s.id and e.status = p_status))
   and not exists (select 1 from unnest(v_words) w where strpos(lower(concat_ws(' ', s.full_name, s.email, s.phone, s.passport_number, a.name, g.full_name,
     (select string_agg(coalesce(e.reference, ''), ' ') from public.enrollment_applications e where e.student_id = s.id))), w) = 0)
 ), page as (
  select * from base order by last_updated desc nulls last, lower(full_name), id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset least(greatest(coalesce(p_offset, 0), 0), 1000000)
 )
 select jsonb_build_object('total', (select count(*) from base),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
   'id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone, 'dateOfBirth', p.date_of_birth, 'passportNumber', p.passport_number,
   'createdAt', p.created_at, 'lastUpdated', p.last_updated,
   'agencyId', p.business_id, 'businessId', p.business_id, 'businessName', p.business_name, 'agentId', p.agent_id, 'agentName', p.agent_name,
   'applications', (select count(*) from public.enrollment_applications e where e.student_id = p.id),
   'statusCounts', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from
     (select e.status, count(*) n from public.enrollment_applications e where e.student_id = p.id group by e.status) x)
  ) order by p.last_updated desc nulls last, lower(p.full_name), p.id) from page p), '[]'::jsonb))
 into result;
 return result;
end $fn$;
revoke all on function public.admin_students_list(text, text, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.admin_students_list(text, text, uuid, uuid, integer, integer) to authenticated;

create function public.admin_student_detail(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare s public.enrollment_students; a public.agencies; g public.agents;
begin
 perform public.admin_business_require();
 select * into s from public.enrollment_students where id = p_student;
 if not found then return null; end if;
 select * into a from public.agencies where id = s.agency_id;
 if s.agent_id is not null then select * into g from public.agents where id = s.agent_id; end if;
 return jsonb_build_object('id', s.id, 'name', s.full_name, 'email', coalesce(s.email, ''), 'phone', coalesce(s.phone, ''),
  'dateOfBirth', s.date_of_birth, 'passportNumber', s.passport_number, 'nationality', s.nationality, 'createdAt', s.created_at,
  'business', jsonb_build_object('id', a.id, 'name', a.name, 'status', a.status), 'agencyId', a.id,
  'agent', case when g.id is null then null else jsonb_build_object('id', g.id, 'name', g.full_name, 'email', g.email) end,
  'applications', public.admin_application_rows(s.id, null));
end $fn$;
revoke all on function public.admin_student_detail(uuid) from public, anon;
grant execute on function public.admin_student_detail(uuid) to authenticated;
