-- The applications list reads the student and agent records and works out progress and status moves on the server:
-- * student name and email come from the student record (the name is read from the passport);
-- * the agent shown is the assigned portal agent, else the student's agent;
-- * progress is the share of required answers and documents in place (the same rules as submission);
-- * nextStatuses is what a SLIT administrator may move each application to, from the admissions rules the status
--   command enforces (default or the institution's own workflow), so the dropdown always matches the backend.
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Required answers and documents in place, as a percentage, following the submission rules and the form's conditions.
create function public.application_completion(p_application uuid) returns integer
language plpgsql stable security definer set search_path = public as $fn$
declare vals jsonb := coalesce(public.application_values(p_application), '{}'::jsonb); s jsonb; f jsonb; total integer := 0; done integer := 0;
 v jsonb; cat text;
begin
 for s in select value from jsonb_array_elements(public.portal_required_schema()) loop
  if not public.portal_condition_met(s->'showIf', vals) then continue; end if;
  for f in select value from jsonb_array_elements(s->'fields') loop
   if not public.portal_condition_met(f->'showIf', vals) then continue; end if;
   total := total + 1;
   v := vals -> (f->>'name');
   if f->>'type' = 'file' then
    cat := case f->>'name' when 'passport_copy' then 'Passport' when 'visa_copy' then 'Visa' when 'english_upload' then 'English Test' when 'academic_upload' then 'Academic' end;
    if cat is not null and exists (select 1 from public.enrollment_application_documents d where d.application_id = p_application and d.category = cat and d.is_current) then done := done + 1; end if;
   elsif f->>'type' = 'checkbox' then
    if f->>'name' = 'courses_of_interest' then
     if exists (select 1 from public.enrollment_application_courses c where c.application_id = p_application) then done := done + 1; end if;
    elsif jsonb_typeof(v) = 'array' and jsonb_array_length(v) > 0 then done := done + 1; end if;
   elsif nullif(btrim(coalesce(v #>> '{}', '')), '') is not null then done := done + 1;
   end if;
  end loop;
 end loop;
 if total = 0 then return 0; end if;
 return least(100, round(100.0 * done / total)::integer);
end $fn$;
revoke all on function public.application_completion(uuid) from public, anon, authenticated;

-- Where a SLIT administrator may move an application now: the same check as portal_set_application_status.
create function public.application_next_statuses(p_application uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare a public.enrollment_applications; v_config jsonb; v_role text; v_platform boolean; out jsonb := '[]'::jsonb; t text;
begin
 if not public.portal_is_slit_admin() then return '[]'::jsonb; end if;
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
revoke all on function public.application_next_statuses(uuid) from public, anon, authenticated;

create or replace function public.portal_query_applications(p_search text default ''::text, p_status text default ''::text, p_agency uuid default null::uuid, p_agent uuid default null::uuid, p_course text default ''::text, p_intake text default ''::text, p_sort text default 'updated'::text, p_direction text default 'desc'::text, p_limit integer default 25, p_offset integer default 0, p_stale_days integer default 0)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare result jsonb; sort_column text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  sort_column := case p_sort when 'reference' then 'reference' when 'student' then 'student_name' when 'agency' then 'agency_name' when 'agent' then 'agent_name' when 'status' then 'status' when 'completion' then 'completion' when 'created' then 'created_at' else 'updated_at' end;
  if p_direction not in ('asc', 'desc') or p_limit not between 1 and 100 or p_offset < 0 or length(p_search) > 200 or p_stale_days not between 0 and 3650 then raise exception 'Invalid page request' using errcode = '22023'; end if;
  execute format($query$
  with filtered as materialized (
    select a.id,a.reference,a.status,
    coalesce(nullif(btrim(s.full_name),''), nullif(btrim(concat_ws(' ',s.details->>'first_name',s.details->>'last_name')),''), a.student_name) student_name,
    coalesce(nullif(s.email,''), a.student_email) student_email,
    a.intake,public.application_completion(a.id) completion,a.agency_id,a.assigned_agent_id,
    a.created_at,a.updated_at,a.submitted_at,a.is_test,coalesce(g.name,'') agency_name,
    coalesce(nullif(p.full_name,''), ag.full_name, '') agent_name,
    (select coalesce(jsonb_agg(jsonb_build_object('courseId',c.course_id,'code',c.course_code,'title',c.course_title,'variant',c.variant)),'[]') from public.enrollment_application_courses c where c.application_id=a.id) courses,
    public.application_next_statuses(a.id) next_statuses,
    exists(select 1 from public.guest_document_links l where l.application_id=a.id and l.revoked_at is null and l.completed_at is null and l.expires_at>now()) live_link
    from public.portal_scoped_applications() a left join public.agencies g on g.id=a.agency_id left join public.portal_profiles p on p.id=a.assigned_agent_id
    left join public.enrollment_students s on s.id=a.student_id left join public.agents ag on ag.id=s.agent_id
    where ($1='' or position(lower($1) in lower(concat_ws(' ',a.student_name,a.student_email,a.reference,s.full_name,s.email,s.phone,s.details->>'first_name',s.details->>'last_name')))>0)
    and ($2='' or a.status=$2) and ($3 is null or a.agency_id=$3) and ($4 is null or a.assigned_agent_id=$4)
    and ($5='' or exists(select 1 from public.enrollment_application_courses c where c.application_id=a.id and c.course_code=$5))
    and ($6='' or position(lower($6) in lower(a.intake))>0)
    and ($9=0 or (a.status='draft'
      and greatest(a.updated_at, coalesce((select max(l.last_used_at) from public.guest_document_links l where l.application_id=a.id), a.updated_at)) < now()-make_interval(days=>$9)
      and not exists(select 1 from public.guest_document_links l where l.application_id=a.id and l.revoked_at is null and l.completed_at is null and l.expires_at>now())))
  ), page as (select * from filtered order by %I %s,id asc limit $7 offset $8)
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'))
  $query$, sort_column, p_direction) into result using p_search, p_status, p_agency, p_agent, p_course, p_intake, p_limit, p_offset, p_stale_days;
  return result;
end; $function$;

-- The statuses offered in filters and dropdowns, from the backend (value and label), in workflow order.
create function public.portal_application_statuses() returns jsonb
language sql stable security definer set search_path = public as $fn$
 select jsonb_build_array(
  jsonb_build_object('value','draft','label','Draft'),
  jsonb_build_object('value','submitted','label','Submitted'),
  jsonb_build_object('value','action_required','label','Action required'),
  jsonb_build_object('value','offer_accepted','label','Offer accepted'),
  jsonb_build_object('value','coe_issued','label','CoE / VoE issued'),
  jsonb_build_object('value','enrolled','label','Enrolled'),
  jsonb_build_object('value','rejected','label','Rejected'),
  jsonb_build_object('value','withdrawn','label','Withdrawn'));
$fn$;
revoke all on function public.portal_application_statuses() from public, anon;
grant execute on function public.portal_application_statuses() to authenticated;
