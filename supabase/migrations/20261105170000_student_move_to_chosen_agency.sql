-- The "Are you working with an education agency?" step (migration 20261105160000) failed with "A student identity
-- cannot be moved between agencies or institutions": the enrollment_students update trigger refuses any business change.
-- The guard stays, with one exception: portal_student_choose_agency marks the move it makes (transaction-local setting
-- skyline.student_move = the student's id) and the trigger lets that one row through. Institution (tenant) changes
-- are still refused. Requires 20261102094611 and 20261105160000.
-- Rollback (manual): recreate business_student_touch_updated_at from 20261102094611 and portal_student_choose_agency
-- from 20261105160000.
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.business_student_touch_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $fn$
begin
 if tg_table_name = 'enrollment_students' then
  if new.tenant_id is distinct from old.tenant_id then
   raise exception 'A student identity cannot be moved between agencies or institutions' using errcode = '23514';
  end if;
  -- Only portal_student_choose_agency moves a student between businesses, and it marks the row it moves.
  if new.agency_id is distinct from old.agency_id and current_setting('skyline.student_move', true) is distinct from old.id::text then
   raise exception 'A student identity cannot be moved between agencies or institutions' using errcode = '23514';
  end if;
 end if;
 new.updated_at := now(); return new;
end $fn$;
revoke all on function public.business_student_touch_updated_at() from public, anon, authenticated;

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
 -- This is the one sanctioned move between businesses (see business_student_touch_updated_at).
 perform set_config('skyline.student_move', s.id::text, true);
 update public.enrollment_students set agency_id = a.id, agent_id = g.id where id = s.id;
 perform set_config('skyline.student_move', '', true);
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
