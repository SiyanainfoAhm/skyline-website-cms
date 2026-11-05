-- A student who signed up by themselves is asked, when they start their first application, whether they are working
-- with an education agency. Yes: they pick an active business and one of its active agents from lists (never creating
-- either), and their record, sign-in membership and any pending invitation move under that business and agent, so the
-- application is theirs and that agent's. No: they stay under SLIT's direct business. The referral code is gone from
-- sign-up. Asked only while the student is under the direct business with no application yet.
-- Rollback (manual): drop functions portal_student_agency_options(uuid), portal_student_choose_agency(uuid, uuid).
set local lock_timeout='5s';
set local statement_timeout='30s';

-- What a student may choose from: active businesses (not SLIT's direct one) and, for one business, its active agents.
create or replace function public.portal_student_agency_options(p_business uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_student uuid := public.portal_student_id(); s public.enrollment_students; v_ask boolean := false;
begin
 if v_student is null then raise exception 'Only a signed-in student can do this' using errcode = '42501'; end if;
 select * into s from public.enrollment_students where id = v_student;
 if s.id is not null then
  v_ask := exists (select 1 from public.agencies a where a.id = s.agency_id and a.is_direct)
   and not exists (select 1 from public.enrollment_applications e where e.student_id = s.id);
 end if;
 return jsonb_build_object(
  'ask', v_ask,
  'businesses', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by lower(a.name), a.id)
    from public.agencies a where a.status = 'Active' and not a.is_direct), '[]'::jsonb),
  'agents', case when p_business is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.full_name, 'role', g.role) order by lower(g.full_name), g.id)
    from public.agents g join public.agencies a on a.id = g.business_id
    where g.business_id = p_business and g.status = 'Active' and a.status = 'Active' and not a.is_direct), '[]'::jsonb) end);
end $$;
revoke all on function public.portal_student_agency_options(uuid) from public, anon;
grant execute on function public.portal_student_agency_options(uuid) to authenticated;

-- The student moves under the chosen business and agent (their record, their sign-in and any pending invitation).
create or replace function public.portal_student_choose_agency(p_business uuid, p_agent uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_student uuid := public.portal_student_id(); s public.enrollment_students; a public.agencies; g public.agents; p public.portal_profiles;
begin
 if v_student is null then raise exception 'Only a signed-in student can do this' using errcode = '42501'; end if;
 select * into s from public.enrollment_students where id = v_student for update;
 if not found then raise exception 'Student not found' using errcode = 'P0002'; end if;
 if not exists (select 1 from public.agencies x where x.id = s.agency_id and x.is_direct) then
  raise exception 'You are already recorded with an agency. Ask SLIT Administration to change it.' using errcode = '42501'; end if;
 if exists (select 1 from public.enrollment_applications e where e.student_id = s.id) then
  raise exception 'Your agency cannot be changed once an application exists. Ask SLIT Administration.' using errcode = '42501'; end if;
 select * into a from public.agencies where id = p_business;
 if not found or a.status <> 'Active' or a.is_direct then raise exception 'Choose an active business' using errcode = '22023'; end if;
 select * into g from public.agents where id = p_agent;
 if not found or g.business_id <> a.id or g.status <> 'Active' then raise exception 'Choose an active agent of that business' using errcode = '22023'; end if;
 update public.enrollment_students set agency_id = a.id, agent_id = g.id where id = s.id;
 update public.agency_memberships set agency_id = a.id, updated_at = now() where student_id = s.id;
 update public.agency_invitations set agency_id = a.id where student_id = s.id and status = 'pending';
 select * into p from public.portal_profiles where id = public.portal_profile_id();
 insert into public.portal_audit_log(actor, actor_name, actor_role, action, target_type, target_id, agency_id, detail)
  values (auth.uid(), coalesce(p.full_name, s.full_name, ''), 'student', 'student_chose_agency', 'student', s.id::text, a.id,
   jsonb_build_object('from', s.agency_id, 'business', a.name, 'agent', g.full_name, 'agentId', g.id));
 return jsonb_build_object('businessId', a.id, 'businessName', a.name, 'agentId', g.id, 'agentName', g.full_name);
end $$;
revoke all on function public.portal_student_choose_agency(uuid, uuid) from public, anon;
grant execute on function public.portal_student_choose_agency(uuid, uuid) to authenticated;
