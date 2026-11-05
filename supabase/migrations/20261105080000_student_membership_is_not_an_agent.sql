-- Fix for migration 118: a student's portal membership is not an agent. agent_sync_membership (20261104090000) mirrors
-- every membership into public.agents, whose role check allows only agent / agency_admin, so accepting a student
-- invitation (role 'student') failed inside portal_resolve_access and the student could not sign in.
-- Same function, plus: student memberships are skipped.
-- Rollback (manual): recreate agent_sync_membership from 20261104090000 (which brings the failure back).
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.agent_sync_membership() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare p public.portal_profiles; v_id uuid; v_status text;
begin
 -- Students sign in to see their own applications; they are never agents of the business.
 if new.role = 'student' then return new; end if;
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
