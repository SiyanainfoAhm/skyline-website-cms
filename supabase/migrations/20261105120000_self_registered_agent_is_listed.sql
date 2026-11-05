-- An agent who registers their business from the sign-in page (company email) is listed as that business's agent at
-- once, as "Invited" with Resend invite, exactly like an agent SLIT adds in the CMS. Before, only the invitation existed,
-- so the business showed 0 agents until they set their password. When they do, agent_sync_membership links this row
-- (same business and email) instead of creating another.
-- 1. portal_self_register also creates the agents row (patched in place from its live definition).
-- 2. (below, last) Businesses registered before this fix get their row from their waiting administrator invitation.
-- Rollback (manual): recreate portal_self_register from 20261105110000; delete the backfilled agents rows (profile_id null,
-- business with registration_requested_at) if wanted.
set local lock_timeout='5s';
set local statement_timeout='30s';

do $do$
declare v_src text; v_anchor text := $a$values (a.id, v_email, v_name, 'agency_admin', null, 'Self-registration') returning * into inv;$a$;
begin
 select pg_get_functiondef('public.portal_self_register(text, jsonb)'::regprocedure) into v_src;
 if strpos(v_src, 'insert into public.agents(') > 0 then return; end if;
 if strpos(v_src, v_anchor) = 0 then raise exception 'portal_self_register has changed; update this migration'; end if;
 v_src := replace(v_src, v_anchor, v_anchor || $a$
 -- Listed as the business's administrator straight away (Invited until the password is set), like a CMS-added agent.
 insert into public.agents(business_id, full_name, email, phone, role, status, status_changed_at)
  values (a.id, v_name, v_email, left(v_phone, 40), 'agency_admin', 'Active', now());$a$);
 execute v_src;
end $do$;

-- 3. Declining a registration also sets its not-yet-signed-in agents Inactive (their invitation is already revoked).
do $do$
declare v_src text; v_anchor text := $a$update public.agency_invitations set status = 'revoked', revoked_at = now() where agency_id = a.id and status = 'pending';$a$;
begin
 select pg_get_functiondef('public.admin_business_set_status(uuid, text)'::regprocedure) into v_src;
 if strpos(v_src, 'profile_id is null') > 0 then return; end if;
 if strpos(v_src, v_anchor) = 0 then raise exception 'admin_business_set_status has changed; update this migration'; end if;
 v_src := replace(v_src, v_anchor, v_anchor || $a$
   update public.agents set status = 'Inactive', status_changed_at = now(), status_changed_by = auth.uid(), updated_at = now()
    where business_id = a.id and profile_id is null and status <> 'Inactive';$a$);
 execute v_src;
end $do$;

insert into public.agents(business_id, full_name, email, phone, role, status, status_changed_at)
select a.id, coalesce(nullif(btrim(i.full_name), ''), i.email), i.email, left(coalesce(a.phone, ''), 40), 'agency_admin', 'Active', now()
from public.agencies a
join public.agency_invitations i on i.agency_id = a.id and i.role = 'agency_admin' and i.status = 'pending'
where a.registration_requested_at is not null
 and not exists (select 1 from public.agents g where g.business_id = a.id and g.email = i.email);
