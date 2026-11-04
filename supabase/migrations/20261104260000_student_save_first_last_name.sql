-- Add student (no passport yet) asks for first and last name. They are kept on the student (full name, and first/last
-- name in the student's answers so the application form starts with them). The passport, when read, replaces them.

drop function if exists public.portal_student_save(uuid, uuid, text, text, text, date, text, text);

create function public.portal_student_save(p_student uuid, p_agent uuid, p_full_name text, p_email text, p_phone text,
 p_date_of_birth date default null, p_passport text default '', p_nationality text default '',
 p_first_name text default '', p_last_name text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare g public.agents; s public.enrollment_students;
 v_first text := btrim(coalesce(p_first_name, '')); v_last text := btrim(coalesce(p_last_name, ''));
 v_name text := coalesce(nullif(btrim(coalesce(p_full_name, '')), ''), btrim(concat_ws(' ', nullif(btrim(coalesce(p_first_name, '')), ''), nullif(btrim(coalesce(p_last_name, '')), ''))));
 v_email text := lower(btrim(coalesce(p_email, ''))); v_phone text := btrim(coalesce(p_phone, ''));
 v_passport text := upper(regexp_replace(coalesce(p_passport, ''), '\s', '', 'g')); v_tenant uuid := public.tenant_current();
 v_details jsonb;
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
 if length(v_name) > 200 or v_name ~ '[[:cntrl:]]' or length(v_first) > 100 or length(v_last) > 100 or concat(v_first, v_last) ~ '[[:cntrl:]]' then
  raise exception 'Enter a valid name' using errcode = '22023'; end if;
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
 v_details := jsonb_build_object('email', v_email, 'confirm_email', v_email, 'mobile', v_phone);
 if v_first <> '' then v_details := v_details || jsonb_build_object('first_name', v_first); end if;
 if v_last <> '' then v_details := v_details || jsonb_build_object('last_name', v_last); end if;
 insert into public.enrollment_students(agency_id, tenant_id, agent_id, full_name, email, phone, date_of_birth, passport_number, nationality, created_by, details)
 values (g.business_id, v_tenant, g.id, v_name, v_email, v_phone, p_date_of_birth, v_passport, btrim(coalesce(p_nationality, '')), public.portal_profile_id(), v_details)
 returning * into s;
 return jsonb_build_object('id', s.id, 'name', s.full_name, 'email', coalesce(s.email, ''), 'phone', coalesce(s.phone, ''), 'businessId', s.agency_id, 'agentId', s.agent_id, 'reused', false);
exception when unique_violation then
 raise exception 'A student with this email or mobile already exists' using errcode = '23505';
end $$;

revoke all on function public.portal_student_save(uuid, uuid, text, text, text, date, text, text, text, text) from public, anon;
grant execute on function public.portal_student_save(uuid, uuid, text, text, text, date, text, text, text, text) to authenticated, service_role;
