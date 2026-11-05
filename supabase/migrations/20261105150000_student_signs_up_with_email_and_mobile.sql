-- A student signs up with their email and mobile only, like an application: name and date of birth come later from the
-- passport and the application form. portal_self_register (email sign-up) and portal_self_enrol_complete (Google /
-- phone sign-up) still check a name or date of birth when one is given, but no longer require them.
-- Both functions are patched in place from their live definitions (they were patched by 20261105110000/120000).
-- Rollback (manual): put back "char_length(v_first) not between 1 and 100 or char_length(v_last) not between 1 and 100"
-- in both functions and "if v_dob is null or v_dob > …" in portal_self_register.
set local lock_timeout='5s';
set local statement_timeout='30s';

do $do$
declare f text; v_src text; v_new text;
 v_name_old text := 'char_length(v_first) not between 1 and 100 or char_length(v_last) not between 1 and 100';
 v_name_new text := 'char_length(v_first) > 100 or char_length(v_last) > 100';
 v_dob_old text := $a$if v_dob is null or v_dob > current_date - interval '10 years' or v_dob < current_date - interval '100 years' then$a$;
 v_dob_new text := $a$if nullif(btrim(coalesce(p_input->>'dateOfBirth', '')), '') is not null and (v_dob is null or v_dob > current_date - interval '10 years' or v_dob < current_date - interval '100 years') then$a$;
begin
 foreach f in array array['public.portal_self_register(text, jsonb)', 'public.portal_self_enrol_complete(jsonb)'] loop
  if to_regprocedure(f) is null then raise exception '% does not exist; apply migration 20261105090000 first', f; end if;
  select pg_get_functiondef(f::regprocedure) into v_src;
  v_new := replace(v_src, v_name_old, v_name_new);
  if f = 'public.portal_self_register(text, jsonb)' then v_new := replace(v_new, v_dob_old, v_dob_new); end if;
  if v_new = v_src then
   if strpos(v_src, v_name_new) > 0 then continue; end if;
   raise exception '% has changed; update this migration', f;
  end if;
  execute v_new;
 end loop;
end $do$;
