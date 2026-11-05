-- 1. The sign-up functions raise their own clear messages with errcode 23505 ("A business with this ABN is already
--    registered…", "A student with this mobile number is already on record…"), but each ended with
--    "exception when unique_violation", which also caught those and replaced them with a vague "already registered".
--    The handler now passes the function's own messages through and only rewords a real duplicate-key error.
-- 2. Hosted was given an earlier copy of migration 119 without section 7, so the agent Google sign-up
--    (portal_self_register_agent_complete, abn_checksum_ok) is (re)created here, with the fixed handler.
-- portal_self_register and portal_self_enrol_complete are patched in place from their live definitions.
-- Rollback (manual): recreate the functions from 20261105090000 / 20261105100000.
set local lock_timeout='5s';
set local statement_timeout='30s';

-- ------------------------------------------------------------------ agent Google sign-up (migration 119 section 7)
create or replace function public.abn_checksum_ok(p_abn text) returns boolean
language sql immutable as $fn$
 select p_abn ~ '^\d{11}$' and (
  (substr(p_abn,1,1)::int - 1) * 10 + substr(p_abn,2,1)::int * 1 + substr(p_abn,3,1)::int * 3 + substr(p_abn,4,1)::int * 5
  + substr(p_abn,5,1)::int * 7 + substr(p_abn,6,1)::int * 9 + substr(p_abn,7,1)::int * 11 + substr(p_abn,8,1)::int * 13
  + substr(p_abn,9,1)::int * 15 + substr(p_abn,10,1)::int * 17 + substr(p_abn,11,1)::int * 19) % 89 = 0;
$fn$;

create or replace function public.portal_self_register_agent_complete(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); u record; v_email text; v_phone text; v_email_verified boolean; v_phone_verified boolean;
 v_contact text := btrim(coalesce(p_input->>'contactName', '')); v_business text := left(btrim(coalesce(p_input->>'businessName', '')), 200);
 v_abn text := regexp_replace(coalesce(p_input->>'abn', ''), '\s', '', 'g'); v_code text; a public.agencies; p public.portal_profiles;
begin
 if v_uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
 if exists (select 1 from public.cms_users c where c.auth_user_id = v_uid) then
  raise exception 'Staff accounts cannot register an agency.' using errcode = '42501'; end if;
 if exists (select 1 from public.portal_profiles pp join public.agency_memberships m on m.user_id = pp.id where pp.auth_user_id = v_uid) then
  raise exception 'This account is already set up. Sign in again to continue.' using errcode = '23505'; end if;
 select lower(btrim(coalesce(x.email, ''))) as email, x.email_confirmed_at, nullif(btrim(coalesce(x.phone, '')), '') as phone, x.phone_confirmed_at
  into u from auth.users x where x.id = v_uid;
 v_email_verified := u.email <> '' and u.email_confirmed_at is not null;
 v_phone_verified := u.phone is not null and u.phone_confirmed_at is not null;
 if not v_email_verified and not v_phone_verified then raise exception 'Confirm your email or phone number first.' using errcode = '42501'; end if;
 v_email := case when v_email_verified then u.email else lower(btrim(coalesce(p_input->>'email', ''))) end;
 v_phone := case when v_phone_verified then '+' || ltrim(u.phone, '+') else left(btrim(coalesce(p_input->>'phone', '')), 40) end;
 if v_email = '' or char_length(v_email) > 254 or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' then
  raise exception 'Enter a valid work email address.' using errcode = '22023'; end if;
 if v_phone !~ '^\+?[\d\s().-]{6,40}$' then raise exception 'Enter a phone number.' using errcode = '22023'; end if;
 if char_length(v_contact) not between 2 and 100 or v_contact ~ '[[:cntrl:]]' then raise exception 'Enter the contact person''s name.' using errcode = '22023'; end if;
 if char_length(v_business) < 2 or v_business ~ '[[:cntrl:]]' then raise exception 'Enter the agency or company name.' using errcode = '22023'; end if;
 if not public.abn_checksum_ok(v_abn) then raise exception 'That is not a valid ABN. Check the 11 digits.' using errcode = '22023'; end if;
 if exists (select 1 from public.agencies x where regexp_replace(coalesce(x.registration_number, ''), '\s', '', 'g') = v_abn) then
  raise exception 'A business with this ABN is already registered. Ask its administrator to invite you, or contact SLIT Administration.' using errcode = '23505'; end if;
 -- A typed (unverified) email someone else already signs in with, or was invited with, cannot be used.
 if not v_email_verified and (
   exists (select 1 from public.portal_profiles x where lower(x.email) = v_email and x.auth_user_id <> v_uid)
   or exists (select 1 from public.cms_users c where lower(c.email) = v_email)
   or exists (select 1 from public.agency_invitations i where i.email = v_email and i.status = 'pending')) then
  raise exception 'This email already belongs to another account. Use a different work email.' using errcode = '23505'; end if;
 loop
  v_code := 'R-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  exit when not exists (select 1 from public.agencies where lower(code) = lower(v_code));
 end loop;
 insert into public.agencies(name, code, registration_number, business_email, phone, address, country, primary_contact, status, registration_requested_at)
  values (v_business, v_code, v_abn, v_email, v_phone, '', 'Australia', v_contact, 'Inactive', now()) returning * into a;
 select * into p from public.portal_profiles where auth_user_id = v_uid;
 if p.id is null then
  insert into public.portal_profiles(auth_user_id, email, full_name, phone, status) values (v_uid, v_email, v_contact, v_phone, 'Active') returning * into p;
 else
  update public.portal_profiles set status = 'Active', email = v_email, full_name = v_contact, phone = v_phone, updated_at = now() where id = p.id returning * into p;
 end if;
 insert into public.agency_memberships(user_id, agency_id, role, status) values (p.id, a.id, 'agency_admin', 'Active');
 insert into public.portal_audit_log(actor, actor_name, actor_role, action, target_type, target_id, agency_id, detail)
  values (v_uid, v_contact, 'agency_admin', 'self_register_agent_signed_in', 'business', a.id::text, a.id,
   jsonb_build_object('email', v_email, 'abn', v_abn, 'name', a.name, 'emailVerified', v_email_verified, 'phoneVerified', v_phone_verified));
 return jsonb_build_object('agencyId', a.id, 'businessName', a.name);
exception when unique_violation then
 if sqlerrm not like 'duplicate key value%' then raise; end if;
 raise exception 'This business or email is already registered. Sign in, or contact SLIT Administration.' using errcode = '23505';
end $$;
revoke all on function public.portal_self_register_agent_complete(jsonb) from public, anon;
grant execute on function public.portal_self_register_agent_complete(jsonb) to authenticated;

-- ------------------------------------------------------------------ clear messages in the other two
do $do$
declare f text; v_src text; v_new text;
begin
 foreach f in array array['public.portal_self_register(text, jsonb)', 'public.portal_self_enrol_complete(jsonb)'] loop
  if to_regprocedure(f) is null then raise exception '% does not exist; apply migration 20261105090000 first', f; end if;
  select pg_get_functiondef(f::regprocedure) into v_src;
  if strpos(v_src, 'sqlerrm not like') > 0 then continue; end if;
  v_new := regexp_replace(v_src, 'exception when unique_violation then(\s+)raise exception',
   'exception when unique_violation then\1if sqlerrm not like ''duplicate key value%'' then raise; end if;\1raise exception');
  if v_new = v_src then raise exception '% has no unique_violation handler; update this migration', f; end if;
  execute v_new;
 end loop;
end $do$;
