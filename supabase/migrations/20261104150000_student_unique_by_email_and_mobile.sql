-- A student is identified by their email and their mobile only, each unique across the whole system. Name, passport and
-- other documents say nothing about who the student is (several students may upload the same kind of document).
-- Replaces the passport + birth date and email + birth date rules of migration 102. Checked before applying: no two
-- students share an email or a mobile (2026-11-04).
set local lock_timeout='5s';
set local statement_timeout='60s';

drop index if exists public.enrollment_students_passport_unique;
drop index if exists public.enrollment_students_email_dob_unique;

-- The mobile is compared on its digits and leading +, so "+61 412 345 678" and "+61412345678" are the same number.
create function public.student_phone_key(p_phone text) returns text
language sql immutable parallel safe as $fn$ select nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), ''); $fn$;

create unique index enrollment_students_email_unique on public.enrollment_students (lower(btrim(email)))
 where coalesce(btrim(email), '') <> '';
create unique index enrollment_students_phone_unique on public.enrollment_students (public.student_phone_key(phone))
 where public.student_phone_key(phone) is not null;

-- A new student needs an email and a mobile that no other student has. An existing student is never matched or merged
-- by name or passport.
create or replace function public.portal_student_save(p_student uuid, p_agent uuid, p_full_name text, p_email text, p_phone text,
 p_date_of_birth date default null, p_passport text default '', p_nationality text default '') returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare g public.agents; s public.enrollment_students;
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
  return jsonb_build_object('id', s.id, 'name', s.full_name, 'email', coalesce(s.email, ''), 'phone', coalesce(s.phone, ''), 'businessId', s.agency_id, 'agentId', s.agent_id, 'reused', true);
 end if;
 if v_email = '' or v_phone = '' then raise exception 'Enter the student''s email and mobile' using errcode = '22023'; end if;
 if exists (select 1 from public.enrollment_students x where lower(btrim(coalesce(x.email, ''))) = v_email) then
  raise exception 'A student with this email already exists' using errcode = '23505'; end if;
 if exists (select 1 from public.enrollment_students x where public.student_phone_key(x.phone) = public.student_phone_key(v_phone)) then
  raise exception 'A student with this mobile already exists' using errcode = '23505'; end if;
 insert into public.enrollment_students(agency_id, tenant_id, agent_id, full_name, email, phone, date_of_birth, passport_number, nationality, created_by, details)
 values (g.business_id, v_tenant, g.id, v_name, v_email, v_phone, p_date_of_birth, v_passport, btrim(coalesce(p_nationality, '')), public.portal_profile_id(),
  jsonb_build_object('email', v_email, 'confirm_email', v_email, 'mobile', v_phone))
 returning * into s;
 return jsonb_build_object('id', s.id, 'name', s.full_name, 'email', coalesce(s.email, ''), 'phone', coalesce(s.phone, ''), 'businessId', s.agency_id, 'agentId', s.agent_id, 'reused', false);
exception when unique_violation then
 raise exception 'A student with this email or mobile already exists' using errcode = '23505';
end $fn$;

-- The search behind the New application check looks at every student for an email or mobile clash (only the clash and
-- the business name are shown to someone outside that business).
create or replace function public.portal_student_find(p_email text default '', p_phone text default '', p_passport text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_phone text := public.student_phone_key(p_phone); v_agency uuid := public.portal_agency_id();
 v_admin boolean := public.portal_is_slit_admin();
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
 if v_email = '' and v_phone is null then return '[]'::jsonb; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
   'id', case when v_admin or s.agency_id = v_agency then s.id end,
   'name', case when v_admin or s.agency_id = v_agency then s.full_name else '' end,
   'email', case when v_admin or s.agency_id = v_agency then coalesce(s.email, '') else '' end,
   'phone', case when v_admin or s.agency_id = v_agency then coalesce(s.phone, '') else '' end,
   'dateOfBirth', null, 'passportNumber', '',
   'businessId', case when v_admin or s.agency_id = v_agency then a.id end, 'businessName', a.name,
   'agentId', case when v_admin or s.agency_id = v_agency then g.id end, 'agentName', case when v_admin or s.agency_id = v_agency then coalesce(g.full_name, '') else '' end,
   'applications', (select count(*) from public.enrollment_applications e where e.student_id = s.id),
   'emailMatch', v_email <> '' and lower(btrim(coalesce(s.email, ''))) = v_email,
   'phoneMatch', v_phone is not null and public.student_phone_key(s.phone) = v_phone,
   'passportMatch', false
  ) order by s.updated_at desc)
  from (
   select * from public.enrollment_students x
   where (v_email <> '' and lower(btrim(coalesce(x.email, ''))) = v_email) or (v_phone is not null and public.student_phone_key(x.phone) = v_phone)
   order by x.updated_at desc limit 10
  ) s
  join public.agencies a on a.id = s.agency_id
  left join public.agents g on g.id = s.agent_id), '[]'::jsonb);
end $fn$;
