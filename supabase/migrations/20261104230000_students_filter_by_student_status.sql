set local lock_timeout='5s';
set local statement_timeout='60s';

-- Students list filtered by the student's status (p_student_status: '' for all, or a value from the catalogue's student list).
-- Replaces the 6-argument version; p_status (application status) stays for other callers.
drop function if exists public.admin_students_list(text, text, uuid, uuid, integer, integer);
create function public.admin_students_list(p_search text default '', p_status text default '', p_business uuid default null, p_agent uuid default null,
 p_limit integer default 25, p_offset integer default 0, p_student_status text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_words text[] := public.admin_search_words(p_search); result jsonb;
begin
 perform public.admin_business_require();
 if coalesce(p_student_status, '') not in ('', 'Active', 'Inactive') then raise exception 'Invalid student status' using errcode = '22023'; end if;
 with base as (
  select s.id,
   coalesce(nullif(btrim(s.full_name), ''), nullif(btrim(concat_ws(' ', s.details ->> 'first_name', s.details ->> 'middle_name', s.details ->> 'last_name')), ''), '') as full_name,
   coalesce(nullif(s.email, ''), s.details ->> 'email', '') as email,
   coalesce(nullif(s.phone, ''), s.details ->> 'mobile', '') as phone,
   coalesce(nullif(s.nationality, ''), s.details ->> 'nationality', '') as nationality,
   s.status as student_status, s.status_changed_at,
   s.created_at, s.date_of_birth, s.passport_number,
   a.id as business_id, a.name as business_name, g.id as agent_id, coalesce(g.full_name, '') as agent_name,
   (select max(e.updated_at) from public.enrollment_applications e where e.student_id = s.id) as last_updated
  from public.enrollment_students s
  join public.agencies a on a.id = s.agency_id
  left join public.agents g on g.id = s.agent_id
  where (p_business is null or a.id = p_business) and (p_agent is null or s.agent_id = p_agent)
   and (coalesce(p_student_status, '') = '' or s.status = p_student_status)
   and (coalesce(p_status, '') = '' or exists (select 1 from public.enrollment_applications e where e.student_id = s.id and e.status = p_status))
   and not exists (select 1 from unnest(v_words) w where strpos(lower(concat_ws(' ', s.full_name, s.details ->> 'first_name', s.details ->> 'last_name', s.email, s.phone,
     s.passport_number, a.name, g.full_name,
     (select string_agg(coalesce(e.reference, ''), ' ') from public.enrollment_applications e where e.student_id = s.id))), w) = 0)
 ), page as (
  select * from base order by last_updated desc nulls last, lower(full_name), id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset least(greatest(coalesce(p_offset, 0), 0), 1000000)
 )
 select jsonb_build_object('total', (select count(*) from base),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
   'id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone, 'nationality', p.nationality,
   'status', p.student_status, 'statusChangedAt', p.status_changed_at,
   'dateOfBirth', p.date_of_birth, 'passportNumber', p.passport_number,
   'createdAt', p.created_at, 'lastUpdated', p.last_updated,
   'agencyId', p.business_id, 'businessId', p.business_id, 'businessName', p.business_name, 'agentId', p.agent_id, 'agentName', p.agent_name,
   'applications', (select count(*) from public.enrollment_applications e where e.student_id = p.id),
   'statusCounts', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from
     (select e.status, count(*) n from public.enrollment_applications e where e.student_id = p.id group by e.status) x),
   'applicationRows', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'reference', coalesce(e.reference, ''), 'status', e.status, 'intake', coalesce(e.intake, ''), 'completion', public.application_completion(e.id),
      'updatedAt', e.updated_at, 'nextStatuses', public.application_next_statuses(e.id),
      'course', (select string_agg(c.course_code, ', ' order by c.course_code) from public.enrollment_application_courses c where c.application_id = e.id)
     ) order by e.updated_at desc), '[]'::jsonb)
     from (select * from public.enrollment_applications e2 where e2.student_id = p.id order by e2.updated_at desc limit 20) e)
  ) order by p.last_updated desc nulls last, lower(p.full_name), p.id) from page p), '[]'::jsonb))
 into result;
 return result;
end $fn$;

revoke all on function public.admin_students_list(text, text, uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.admin_students_list(text, text, uuid, uuid, integer, integer, text) to authenticated;
