-- Agents and students of an inactive business sort after everyone else, and each row says its business status
-- (the lists grey those rows out). The students list also returns counts per student status, for its tabs.

create or replace function public.admin_agent_rows(p_business uuid, p_search text, p_status text, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_words text[] := public.admin_search_words(p_search); result jsonb;
begin
 with rows as (
  select g.id as agent_id, g.profile_id, g.full_name as name, g.email, g.phone, g.marn, g.role, g.business_id, g.status_changed_at,
   case when g.status <> 'Active' then 'Inactive'
        when g.profile_id is null then 'Invited'
        when exists (select 1 from public.agency_memberships m join public.portal_profiles pp on pp.id = m.user_id
          where m.user_id = g.profile_id and m.status = 'Active' and pp.status = 'Active') then 'Active'
        else 'Inactive' end as status,
   a.name as business_name, a.status as business_status,
   (select i.id from public.agency_invitations i where i.agency_id = g.business_id and i.email = g.email and i.status = 'pending' and g.email <> '' limit 1) as invitation_id
  from public.agents g
  join public.agencies a on a.id = g.business_id
  where (p_business is null or g.business_id = p_business)
   and not exists (select 1 from unnest(v_words) w where strpos(lower(concat_ws(' ', g.full_name, g.email, g.phone, g.marn, a.name)), w) = 0)
 ), filtered as (
  select *, case when business_status = 'Active' then 0 else 1 end as business_rank,
   case status when 'Active' then 0 when 'Invited' then 1 else 2 end as rank_key
  from rows where coalesce(p_status, '') = '' or status = p_status
 ), page as (
  select * from filtered order by business_rank, rank_key, lower(name), agent_id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset least(greatest(coalesce(p_offset, 0), 0), 1000000)
 )
 select jsonb_build_object('total', (select count(*) from filtered),
  'counts', jsonb_build_object('all', (select count(*) from rows), 'active', (select count(*) from rows where status = 'Active'),
   'invited', (select count(*) from rows where status = 'Invited'), 'inactive', (select count(*) from rows where status = 'Inactive')),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
   'key', p.agent_id, 'agentId', p.agent_id, 'omaraId', null, 'profileId', p.profile_id, 'invitationId', p.invitation_id,
   'name', p.name, 'email', p.email, 'phone', p.phone, 'role', p.role, 'status', p.status, 'statusChangedAt', p.status_changed_at,
   'marn', p.marn, 'registered', null,
   'businessId', p.business_id, 'businessName', p.business_name, 'businessStatus', p.business_status,
   'students', (select count(*) from public.enrollment_students s where s.agent_id = p.agent_id),
   'statusCounts', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (select e.status, count(*) n from public.enrollment_applications e
     join public.enrollment_students s on s.id = e.student_id where s.agent_id = p.agent_id group by e.status) x)
  ) order by p.business_rank, p.rank_key, lower(p.name), p.agent_id) from page p), '[]'::jsonb))
 into result;
 return result;
end $$;

create or replace function public.admin_students_list(p_search text default '', p_status text default '', p_business uuid default null,
 p_agent uuid default null, p_limit integer default 25, p_offset integer default 0, p_student_status text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
   a.id as business_id, a.name as business_name, a.status as business_status,
   case when a.status = 'Active' then 0 else 1 end as business_rank,
   g.id as agent_id, coalesce(g.full_name, '') as agent_name,
   (select max(e.updated_at) from public.enrollment_applications e where e.student_id = s.id) as last_updated
  from public.enrollment_students s
  join public.agencies a on a.id = s.agency_id
  left join public.agents g on g.id = s.agent_id
  where (p_business is null or a.id = p_business) and (p_agent is null or s.agent_id = p_agent)
   and (coalesce(p_status, '') = '' or exists (select 1 from public.enrollment_applications e where e.student_id = s.id and e.status = p_status))
   and not exists (select 1 from unnest(v_words) w where strpos(lower(concat_ws(' ', s.full_name, s.details ->> 'first_name', s.details ->> 'last_name', s.email, s.phone,
     s.passport_number, a.name, g.full_name,
     (select string_agg(coalesce(e.reference, ''), ' ') from public.enrollment_applications e where e.student_id = s.id))), w) = 0)
 ), filtered as (
  select * from base where coalesce(p_student_status, '') = '' or student_status = p_student_status
 ), page as (
  select * from filtered order by business_rank, last_updated desc nulls last, lower(full_name), id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset least(greatest(coalesce(p_offset, 0), 0), 1000000)
 )
 select jsonb_build_object('total', (select count(*) from filtered),
  'counts', jsonb_build_object('all', (select count(*) from base), 'active', (select count(*) from base where student_status = 'Active'),
   'inactive', (select count(*) from base where student_status = 'Inactive')),
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
   'id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone, 'nationality', p.nationality,
   'status', p.student_status, 'statusChangedAt', p.status_changed_at,
   'dateOfBirth', p.date_of_birth, 'passportNumber', p.passport_number,
   'createdAt', p.created_at, 'lastUpdated', p.last_updated,
   'agencyId', p.business_id, 'businessId', p.business_id, 'businessName', p.business_name, 'businessStatus', p.business_status,
   'agentId', p.agent_id, 'agentName', p.agent_name,
   'applications', (select count(*) from public.enrollment_applications e where e.student_id = p.id),
   'statusCounts', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from
     (select e.status, count(*) n from public.enrollment_applications e where e.student_id = p.id group by e.status) x),
   'applicationRows', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'reference', coalesce(e.reference, ''), 'status', e.status, 'intake', coalesce(e.intake, ''), 'completion', public.application_completion(e.id),
      'updatedAt', e.updated_at, 'nextStatuses', public.application_next_statuses(e.id),
      'course', (select string_agg(c.course_code, ', ' order by c.course_code) from public.enrollment_application_courses c where c.application_id = e.id)
     ) order by e.updated_at desc), '[]'::jsonb)
     from (select * from public.enrollment_applications e2 where e2.student_id = p.id order by e2.updated_at desc limit 20) e)
  ) order by p.business_rank, p.last_updated desc nulls last, lower(p.full_name), p.id) from page p), '[]'::jsonb))
 into result;
 return result;
end $$;
