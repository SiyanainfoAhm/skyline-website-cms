-- Student status: Active or Inactive (shown as Disabled). A disabled student's applications are locked: no edits,
-- uploads, document reads, student-link answers, submission or status changes, and no new application for them.
-- Their application statuses are kept, so enabling the student again unlocks everything as it was.
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.enrollment_students
 add column status text not null default 'Active' check (status in ('Active','Inactive')),
 add column status_changed_at timestamptz,
 add column status_changed_by uuid;
comment on column public.enrollment_students.status is 'Inactive (Disabled) locks every application of the student until they are Active again.';

create function public.application_student_active(p_application uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
 select coalesce((select s.status = 'Active' from public.enrollment_applications a join public.enrollment_students s on s.id = a.student_id where a.id = p_application), true);
$fn$;
revoke all on function public.application_student_active(uuid) from public, anon;
grant execute on function public.application_student_active(uuid) to authenticated;

-- Editing, uploads and anything else that asks "can this be edited?" now also needs an active student.
create or replace function public.portal_can_edit_application(app_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $function$
  select auth.uid() is not null and public.portal_can_access_application(app_id)
    and public.application_student_active(app_id)
    and exists(select 1 from public.enrollment_applications a where a.id=app_id
      and (public.portal_is_slit_admin() or a.status in ('draft','action_required')));
$function$;

-- Saving a draft and submitting go through this lock.
create or replace function public.portal_lock_draft(p_application_id uuid, p_expected_version bigint) returns enrollment_applications
language plpgsql security definer set search_path to 'public' as $function$
declare a public.enrollment_applications;
begin
 select * into a from public.enrollment_applications where id=p_application_id for update;
 if auth.uid() is null or not public.portal_can_access_application(a.id) or a.status not in ('draft','action_required') then
  raise exception 'Application is not editable' using errcode='42501'; end if;
 if not public.application_student_active(a.id) then
  raise exception 'This student is disabled, so their applications are locked' using errcode='42501'; end if;
 if a.draft_version is distinct from p_expected_version then
  raise exception 'Another session changed this application. Reload before saving; your unsaved values remain on this page.' using errcode='PT409'; end if;
 perform set_config('portal.draft_command',a.id::text,true);
 return a;
end; $function$;

-- Every other path that writes an application's answers (document reads, student links) or starts one is stopped too.
create function public.application_student_disabled_guard() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
 if new.student_id is not null and exists (select 1 from public.enrollment_students s where s.id = new.student_id and s.status <> 'Active') then
  raise exception 'This student is disabled, so their applications are locked' using errcode = '42501';
 end if;
 return new;
end $fn$;
revoke all on function public.application_student_disabled_guard() from public, anon, authenticated;
create trigger a_student_disabled_guard before insert or update of data on public.enrollment_applications
 for each row execute function public.application_student_disabled_guard();

-- No status changes while the student is disabled.
create or replace function public.portal_set_application_status(p_application_id uuid, p_status text, p_note text default ''::text) returns void
language plpgsql security definer set search_path to 'public' as $function$
declare a public.enrollment_applications; allowed boolean; v_config jsonb; v_role text;
begin
 select * into a from public.enrollment_applications where id=p_application_id for update;
 if not public.portal_is_slit_admin() or not public.portal_can_access_application(a.id) then raise exception 'Reviewer access required' using errcode='42501'; end if;
 if a.status=p_status then return; end if;
 if not public.application_student_active(a.id) then raise exception 'This student is disabled, so their applications are locked' using errcode='42501'; end if;
 select config into v_config from public.tenant_config_versions where id=a.workflow_version_id;
 if v_config is null then
  allowed:=public.portal_legacy_transition_allowed(a.status,p_status);
 else
  select role into v_role from public.tenant_memberships where tenant_id=a.tenant_id and auth_user_id=auth.uid() and active;
  allowed:=public.portal_pinned_transition_allowed(v_config,a.status,p_status,v_role,public.tenant_is_platform_admin());
 end if;
 if not allowed then raise exception 'Invalid admissions transition: % to %',a.status,p_status using errcode='22023'; end if;
 if p_status='action_required' and nullif(btrim(p_note),'') is null then raise exception 'A correction reason is required' using errcode='22023'; end if;
 perform set_config('portal.status_command',a.id::text,true);
 perform set_config('portal.status_note',coalesce(p_note,''),true);
 update public.enrollment_applications set status=p_status where id=a.id;
 insert into public.portal_audit_log(actor,actor_name,actor_role,action,target_type,target_id,application_id,detail)
 values(auth.uid(),coalesce(auth.jwt()->>'email','Authorized reviewer'),'slit_admin','status_change','application',a.id::text,a.id,jsonb_build_object('from',a.status,'to',p_status,'note',p_note)||case when v_config is null then '{}'::jsonb else jsonb_build_object('workflowVersion',(select version from public.tenant_config_versions where id=a.workflow_version_id)) end);
 insert into public.admission_event_outbox(application_id,tenant_id,event,payload)
 values(a.id,a.tenant_id,case p_status when 'offer_accepted' then 'offer_accepted' when 'coe_issued' then 'coe_voe_issued' else 'application_status_changed' end,jsonb_build_object('from',a.status,'to',p_status,'actor',auth.uid()));
end; $function$;

-- The lists offer no status moves for a disabled student's applications.
create or replace function public.application_next_statuses(p_application uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare a public.enrollment_applications; v_config jsonb; v_role text; v_platform boolean; out jsonb := '[]'::jsonb; t text;
begin
 if not public.portal_is_slit_admin() then return '[]'::jsonb; end if;
 if not public.application_student_active(p_application) then return '[]'::jsonb; end if;
 select * into a from public.enrollment_applications where id = p_application;
 if not found then return '[]'::jsonb; end if;
 select config into v_config from public.tenant_config_versions where id = a.workflow_version_id;
 if v_config is not null then
  select role into v_role from public.tenant_memberships where tenant_id = a.tenant_id and auth_user_id = auth.uid() and active;
  v_platform := public.tenant_is_platform_admin();
 end if;
 foreach t in array array['submitted','action_required','offer_accepted','coe_issued','enrolled','rejected','withdrawn'] loop
  if t = a.status then continue; end if;
  if (v_config is null and public.portal_legacy_transition_allowed(a.status, t))
   or (v_config is not null and public.portal_pinned_transition_allowed(v_config, a.status, t, v_role, v_platform)) then
   out := out || to_jsonb(t);
  end if;
 end loop;
 return out;
end $fn$;

-- Enable or disable a student (SLIT administrators).
create function public.admin_student_set_status(p_student uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare s public.enrollment_students;
begin
 perform public.admin_business_require();
 if p_status is null or p_status not in ('Active','Inactive') then raise exception 'Status must be Active or Inactive' using errcode = '22023'; end if;
 select * into s from public.enrollment_students where id = p_student for update;
 if not found then raise exception 'Student not found' using errcode = 'P0002'; end if;
 if s.status is distinct from p_status then
  update public.enrollment_students set status = p_status, status_changed_at = now(), status_changed_by = auth.uid() where id = s.id;
 end if;
 perform public.admin_business_audit(case when p_status = 'Active' then 'student_enabled' else 'student_disabled' end, s.agency_id, s.agency_id,
  jsonb_build_object('student', s.id, 'name', s.full_name, 'applications', (select count(*) from public.enrollment_applications e where e.student_id = s.id)));
 return jsonb_build_object('studentId', s.id, 'status', p_status);
end $fn$;
revoke all on function public.admin_student_set_status(uuid, text) from public, anon;
grant execute on function public.admin_student_set_status(uuid, text) to authenticated;

-- Students list: adds the student's status (same signature; only fields added).
create or replace function public.admin_students_list(p_search text default '', p_status text default '', p_business uuid default null, p_agent uuid default null,
 p_limit integer default 25, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_words text[] := public.admin_search_words(p_search); result jsonb;
begin
 perform public.admin_business_require();
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

-- The status catalogue gains the student statuses.
create or replace function public.portal_status_catalog() returns jsonb
language sql stable security definer set search_path = public as $fn$
 select jsonb_build_object(
  'application', public.portal_application_statuses(),
  'business', jsonb_build_array(
   jsonb_build_object('value','Active','label','Active'),
   jsonb_build_object('value','Inactive','label','Inactive')),
  'agent', jsonb_build_array(
   jsonb_build_object('value','Active','label','Active','note','Approved and signed in'),
   jsonb_build_object('value','Invited','label','Invited','note','Approved, invitation not accepted yet'),
   jsonb_build_object('value','Inactive','label','Inactive','note','Cannot sign in')),
  'student', jsonb_build_array(
   jsonb_build_object('value','Active','label','Active','note','Applications can be worked on'),
   jsonb_build_object('value','Inactive','label','Disabled','note','All applications are locked')));
$fn$;
