-- An approved agent is Active as soon as their business is active (owner's decision, 2026-11-05), even before they set a
-- password; the screens say "Hasn't set a password yet" with Resend invite until they do. "Invited" now means the agent
-- is waiting for their business to be approved. Patched in place in admin_agent_rows (20261104250000).
-- Rollback (manual): recreate admin_agent_rows from 20261104250000.
set local lock_timeout='5s';
set local statement_timeout='30s';

do $do$
declare v_src text; v_old text := $a$when g.profile_id is null then 'Invited'$a$;
 v_new text := $a$when g.profile_id is null then case when a.status = 'Active' then 'Active' else 'Invited' end$a$;
begin
 select pg_get_functiondef('public.admin_agent_rows(uuid, text, text, integer, integer)'::regprocedure) into v_src;
 if strpos(v_src, v_new) > 0 then return; end if;
 if strpos(v_src, v_old) = 0 then raise exception 'admin_agent_rows has changed; update this migration'; end if;
 execute replace(v_src, v_old, v_new);
end $do$;
