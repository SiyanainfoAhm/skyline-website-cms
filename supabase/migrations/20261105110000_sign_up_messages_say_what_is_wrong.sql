-- The sign-up functions raise their own clear messages with errcode 23505 ("A business with this ABN is already
-- registered…", "A student with this mobile number is already on record…"), but each ends with
-- "exception when unique_violation", which also caught those and replaced them with a vague "already registered".
-- The handler now passes the function's own messages through and only rewords a real duplicate-key error.
-- Patches the live definitions of portal_self_register, portal_self_enrol_complete and
-- portal_self_register_agent_complete in place (whatever version is applied), and stops if the handler is not found.
-- Rollback (manual): recreate the three functions from 20261105090000 / 20261105100000.
set local lock_timeout='5s';
set local statement_timeout='30s';

do $do$
declare f text; v_src text; v_new text;
begin
 foreach f in array array['public.portal_self_register(text, jsonb)', 'public.portal_self_enrol_complete(jsonb)', 'public.portal_self_register_agent_complete(jsonb)'] loop
  select pg_get_functiondef(f::regprocedure) into v_src;
  if strpos(v_src, 'sqlerrm not like') > 0 then continue; end if;
  v_new := regexp_replace(v_src, 'exception when unique_violation then(\s+)raise exception',
   'exception when unique_violation then\1if sqlerrm not like ''duplicate key value%'' then raise; end if;\1raise exception');
  if v_new = v_src then raise exception '% has no unique_violation handler; update this migration', f; end if;
  execute v_new;
 end loop;
end $do$;
