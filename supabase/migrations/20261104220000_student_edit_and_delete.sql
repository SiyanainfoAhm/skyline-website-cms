-- SLIT administrators edit a student's details and delete a student.
-- * Edit: name, email, mobile, date of birth, passport, nationality and agent (of the same business). The student's form
--   answers follow. Email and mobile stay unique across all students.
-- * Delete: only a student with no applications left. The screen first removes their drafts (and the drafts' files);
--   a student with a submitted application is never deleted (disable them instead), so admissions records are kept.
set local lock_timeout='5s';
set local statement_timeout='60s';

create function public.admin_student_update(p_student uuid, p_full_name text, p_email text, p_phone text, p_date_of_birth date,
 p_passport text, p_nationality text, p_agent uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare s public.enrollment_students; g public.agents;
 v_name text := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g')); v_email text := lower(btrim(coalesce(p_email, '')));
 v_phone text := btrim(coalesce(p_phone, '')); v_passport text := upper(regexp_replace(coalesce(p_passport, ''), '\s', '', 'g'));
 v_nationality text := btrim(coalesce(p_nationality, '')); v_first text; v_last text; d jsonb;
begin
 perform public.admin_business_require();
 select * into s from public.enrollment_students where id = p_student for update;
 if not found then raise exception 'Student not found' using errcode = 'P0002'; end if;
 if v_email = '' or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' or length(v_email) > 254 then raise exception 'Enter a valid email address' using errcode = '22023'; end if;
 if v_phone = '' or length(v_phone) > 40 then raise exception 'Enter the student''s mobile number' using errcode = '22023'; end if;
 if length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then raise exception 'Enter a valid name' using errcode = '22023'; end if;
 if length(v_passport) > 40 or length(v_nationality) > 100 then raise exception 'Enter a valid passport number and nationality' using errcode = '22023'; end if;
 if p_date_of_birth is not null and (p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01') then raise exception 'Enter a valid date of birth' using errcode = '22023'; end if;
 if exists (select 1 from public.enrollment_students x where x.id <> s.id and lower(btrim(coalesce(x.email, ''))) = v_email) then
  raise exception 'Another student already has this email' using errcode = '23505'; end if;
 if exists (select 1 from public.enrollment_students x where x.id <> s.id and public.student_phone_key(x.phone) = public.student_phone_key(v_phone)) then
  raise exception 'Another student already has this mobile' using errcode = '23505'; end if;
 if p_agent is not null then
  select * into g from public.agents where id = p_agent;
  if not found or g.business_id <> s.agency_id then raise exception 'Choose an agent of the student''s business' using errcode = '22023'; end if;
 end if;
 -- The form's answers follow the record: the name splits into given name(s) and surname.
 if v_name <> '' then
  v_first := case when position(' ' in v_name) > 0 then regexp_replace(v_name, '\s+\S+$', '') else v_name end;
  v_last := case when position(' ' in v_name) > 0 then substring(v_name from '\S+$') else '' end;
 end if;
 d := coalesce(s.details, '{}'::jsonb) || jsonb_build_object('email', v_email, 'confirm_email', v_email, 'mobile', v_phone)
  || case when v_name <> '' then jsonb_build_object('first_name', v_first, 'last_name', v_last) else '{}'::jsonb end
  || case when p_date_of_birth is not null then jsonb_build_object('dob', to_char(p_date_of_birth, 'YYYY-MM-DD')) else '{}'::jsonb end
  || case when v_passport <> '' then jsonb_build_object('passport_number', v_passport) else '{}'::jsonb end
  || case when v_nationality <> '' then jsonb_build_object('nationality', v_nationality) else '{}'::jsonb end;
 if v_name <> '' and position(' ' in v_name) > 0 then d := d - 'middle_name'; end if;
 update public.enrollment_students set full_name = v_name, email = v_email, phone = v_phone, date_of_birth = p_date_of_birth,
  passport_number = v_passport, nationality = v_nationality, agent_id = coalesce(p_agent, agent_id), details = d
 where id = s.id returning * into s;
 perform public.admin_business_audit('student_updated', s.agency_id, s.agency_id, jsonb_build_object('student', s.id, 'name', s.full_name));
 return jsonb_build_object('id', s.id, 'name', s.full_name, 'email', s.email, 'phone', s.phone);
exception when unique_violation then
 raise exception 'Another student already has this email or mobile' using errcode = '23505';
end $fn$;
revoke all on function public.admin_student_update(uuid, text, text, text, date, text, text, uuid) from public, anon;
grant execute on function public.admin_student_update(uuid, text, text, text, date, text, text, uuid) to authenticated;

create function public.admin_student_delete(p_student uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare s public.enrollment_students; v_left integer;
begin
 perform public.admin_business_require();
 select * into s from public.enrollment_students where id = p_student for update;
 if not found then raise exception 'Student not found' using errcode = 'P0002'; end if;
 if exists (select 1 from public.enrollment_applications e where e.student_id = s.id and e.status <> 'draft') then
  raise exception 'This student has submitted applications, so they cannot be deleted. Disable the student instead.' using errcode = '23514'; end if;
 select count(*) into v_left from public.enrollment_applications e where e.student_id = s.id;
 if v_left > 0 then raise exception 'Delete this student''s drafts first' using errcode = '23514'; end if;
 delete from public.enrollment_students where id = s.id;
 perform public.admin_business_audit('student_deleted', s.agency_id, s.agency_id, jsonb_build_object('student', s.id, 'name', s.full_name, 'email', s.email));
 return jsonb_build_object('studentId', s.id, 'deleted', true);
end $fn$;
revoke all on function public.admin_student_delete(uuid) from public, anon;
grant execute on function public.admin_student_delete(uuid) to authenticated;
