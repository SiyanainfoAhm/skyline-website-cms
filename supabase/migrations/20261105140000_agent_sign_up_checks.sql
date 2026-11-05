-- Agent sign-up checks (owner's wording, 2026-11-05):
-- 1. An ABN already in the system: "The ABN you entered already exists in our system. Please contact Skyline to get
--    registered." Checked when the agent searches the ABN (portal_abn_registered, used by portal-self-register) and again
--    on submit.
-- 2. Then the agent's email and phone must not belong to an agent of another company (agents, agent / admin sign-ins,
--    waiting agent invitations, staff). The message names what matched; the sign-in page shows it as a popup.
-- portal_self_register and portal_self_register_agent_complete are recreated in full: the student path is unchanged, and
-- the fixes made in place today (own messages pass through the unique_violation handler; the agent is listed on the
-- business straight away) are kept.
-- Rollback (manual): recreate both functions from their live definitions before this migration; drop portal_abn_registered,
-- agent_contact_conflict and agent_phone_key.
set local lock_timeout='5s';
set local statement_timeout='30s';

-- ------------------------------------------------------------------ helpers
-- Phone digits for comparing: +61 4xx / 04xx / 61 4xx all compare equal; anything shorter than 6 digits never matches.
create or replace function public.agent_phone_key(p_phone text) returns text
language sql immutable parallel safe as $fn$
 select case when length(d) < 6 then null when d ~ '^61\d{9}$' then '0' || substr(d, 3) else d end
 from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) x;
$fn$;

create or replace function public.portal_abn_registered(p_abn text) returns boolean
language sql stable security definer set search_path = public as $fn$
 select exists (select 1 from public.agencies a
  where nullif(btrim(a.registration_number), '') is not null
   and regexp_replace(a.registration_number, '\s', '', 'g') = regexp_replace(coalesce(p_abn, ''), '\s', '', 'g'));
$fn$;
revoke all on function public.portal_abn_registered(text) from public, anon, authenticated;
grant execute on function public.portal_abn_registered(text) to service_role;

-- The message to show when this email and/or phone already belong to an agent of another company, or null. p_self is the
-- signing-in account (its own profile never counts against it).
create or replace function public.agent_contact_conflict(p_email text, p_phone text, p_self uuid default null) returns text
language plpgsql stable security definer set search_path = public as $fn$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_phone text := public.agent_phone_key(p_phone); v_e boolean := false; v_p boolean := false;
begin
 if v_email <> '' then
  v_e := exists (select 1 from public.agents g where g.email = v_email)
   or exists (select 1 from public.portal_profiles pp join public.agency_memberships m on m.user_id = pp.id
     where lower(pp.email) = v_email and m.role in ('agent', 'agency_admin') and pp.auth_user_id is distinct from p_self)
   or exists (select 1 from public.agency_invitations i where i.email = v_email and i.status = 'pending' and i.role in ('agent', 'agency_admin'))
   or exists (select 1 from public.cms_users c where lower(c.email) = v_email);
 end if;
 if v_phone is not null then
  v_p := exists (select 1 from public.agents g where public.agent_phone_key(g.phone) = v_phone)
   or exists (select 1 from public.portal_profiles pp join public.agency_memberships m on m.user_id = pp.id
     where public.agent_phone_key(pp.phone) = v_phone and m.role in ('agent', 'agency_admin') and pp.auth_user_id is distinct from p_self);
 end if;
 if v_e and v_p then return 'The email and phone number you entered are already linked to another company. Please enter a different email and phone number, since this will be the admin account for your company.'; end if;
 if v_e then return 'The email you entered is already linked to another company. Please enter a different email, since this will be the admin account for your company.'; end if;
 if v_p then return 'The phone number you entered is already linked to another company. Please enter a different phone number, since this will be the admin account for your company.'; end if;
 return null;
end $fn$;
revoke all on function public.agent_contact_conflict(text, text, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ sign-up from the form (company email)
create or replace function public.portal_self_register(p_kind text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(btrim(coalesce(p_input->>'email', ''))); v_name text; a public.agencies; s public.enrollment_students; inv public.agency_invitations;
 v_first text := btrim(coalesce(p_input->>'firstName', '')); v_last text := btrim(coalesce(p_input->>'lastName', ''));
 v_phone text := btrim(coalesce(p_input->>'phone', '')); v_dob date; v_course text := left(btrim(coalesce(p_input->>'course', '')), 200);
 v_ref text := btrim(coalesce(p_input->>'referralCode', '')); v_abn text; v_business text := left(btrim(coalesce(p_input->>'businessName', '')), 200);
 v_details jsonb; v_code text; v_conflict text;
begin
 if p_kind is null or p_kind not in ('student', 'agent') then raise exception 'Unknown enrolment type.' using errcode = '22023'; end if;
 if v_email = '' or v_email ~ '[[:cntrl:]]' or char_length(v_email) > 254 or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' then
  raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
 if v_phone ~ '[[:cntrl:]]' or char_length(v_phone) > 40 then raise exception 'Enter a valid phone number.' using errcode = '22023'; end if;
 select * into inv from public.agency_invitations i where i.email = v_email and i.status = 'pending';

 if p_kind = 'student' then
  -- Someone who can already sign in uses the Sign in tab.
  if exists (select 1 from public.cms_users u where lower(u.email) = v_email)
   or exists (select 1 from public.portal_profiles p join public.agency_memberships m on m.user_id = p.id where lower(p.email) = v_email and m.status = 'Active' and p.status = 'Active') then
   raise exception 'This email already has an account. Sign in instead, or use "Forgot password?".' using errcode = '23505'; end if;
  v_name := btrim(concat_ws(' ', nullif(v_first, ''), nullif(v_last, '')));
  if char_length(v_first) not between 1 and 100 or char_length(v_last) not between 1 and 100 or v_name ~ '[[:cntrl:]]' then
   raise exception 'Enter your first and last name.' using errcode = '22023'; end if;
  if v_phone = '' then raise exception 'Enter your mobile number.' using errcode = '22023'; end if;
  begin v_dob := (p_input->>'dateOfBirth')::date; exception when others then v_dob := null; end;
  if v_dob is null or v_dob > current_date - interval '10 years' or v_dob < current_date - interval '100 years' then
   raise exception 'Enter a valid date of birth.' using errcode = '22023'; end if;
  -- An existing record with this email is the student (never a second record); otherwise the referral code or the direct business decides.
  select * into s from public.enrollment_students x where lower(btrim(coalesce(x.email, ''))) = v_email order by x.created_at, x.id limit 1;
  if s.id is not null then
   if s.status <> 'Active' then raise exception 'This student record is disabled. Please contact SLIT Administration.' using errcode = '22023'; end if;
   if exists (select 1 from public.agency_memberships m where m.student_id = s.id and m.status = 'Active') then
    raise exception 'This email already has an account. Sign in instead.' using errcode = '23505'; end if;
   select * into a from public.agencies where id = s.agency_id;
   if a.status <> 'Active' then raise exception 'Your business is not active. Please contact SLIT Administration.' using errcode = '22023'; end if;
  else
   if v_ref <> '' then
    select * into a from public.agencies where lower(code) = lower(v_ref) and status = 'Active' and not is_direct;
    if not found then raise exception 'We do not recognise that referral code. Check it with your agent, or leave it blank.' using errcode = '22023'; end if;
   else
    select * into a from public.agencies where is_direct and status = 'Active';
    if not found then raise exception 'Direct enrolment is not open right now. Please contact SLIT Administration.' using errcode = '22023'; end if;
   end if;
   if exists (select 1 from public.enrollment_students x where public.student_phone_key(x.phone) = public.student_phone_key(v_phone)) then
    raise exception 'A student with this mobile number is already on record. Sign in, or contact SLIT Administration.' using errcode = '23505'; end if;
   v_details := jsonb_build_object('email', v_email, 'confirm_email', v_email, 'mobile', v_phone, 'first_name', v_first, 'last_name', v_last);
   if v_course <> '' then v_details := v_details || jsonb_build_object('course_of_interest', v_course); end if;
   insert into public.enrollment_students(agency_id, tenant_id, agent_id, full_name, email, phone, date_of_birth, details)
    values (a.id, null, null, v_name, v_email, v_phone, v_dob, v_details) returning * into s;
  end if;
  if inv.id is not null then
   if inv.student_id is distinct from s.id then
    raise exception 'This email has already been invited. Check your inbox for the invitation, or sign in.' using errcode = '23505'; end if;
   update public.agency_invitations set expires_at = greatest(expires_at, now() + interval '7 days'), sent_count = sent_count + 1, last_sent_at = now()
    where id = inv.id returning * into inv;
  else
   insert into public.agency_invitations(agency_id, email, full_name, role, invited_by, invited_by_name, student_id)
    values (s.agency_id, v_email, coalesce(nullif(s.full_name, ''), v_name), 'student', null, 'Self-enrolment', s.id) returning * into inv;
  end if;
  insert into public.portal_audit_log(actor, actor_name, actor_role, action, target_type, target_id, agency_id, detail)
   values (null, 'Self-enrolment', 'public', 'self_enrol_student', 'student', s.id::text, s.agency_id,
    jsonb_build_object('email', v_email, 'invitation', inv.id, 'referral', v_ref <> '', 'course', v_course));
  return jsonb_build_object('kind', 'student', 'invitationId', inv.id, 'email', v_email, 'name', inv.full_name, 'studentId', s.id, 'agencyId', s.agency_id, 'direct', a.is_direct);
 end if;

 -- An agent registers their business: the ABN first, then their email and phone.
 v_name := btrim(coalesce(p_input->>'contactName', ''));
 if char_length(v_name) not between 2 and 100 or v_name ~ '[[:cntrl:]]' then raise exception 'Enter the contact person''s name.' using errcode = '22023'; end if;
 if char_length(v_business) < 2 or v_business ~ '[[:cntrl:]]' then raise exception 'Enter the agency or company name.' using errcode = '22023'; end if;
 v_abn := regexp_replace(coalesce(p_input->>'abn', ''), '\s', '', 'g');
 if v_abn !~ '^\d{11}$' then raise exception 'Enter an 11-digit ABN.' using errcode = '22023'; end if;
 if v_phone = '' then raise exception 'Enter a phone number.' using errcode = '22023'; end if;
 if public.portal_abn_registered(v_abn) then
  raise exception 'The ABN you entered already exists in our system. Please contact Skyline to get registered.' using errcode = '23505'; end if;
 v_conflict := public.agent_contact_conflict(v_email, v_phone, null);
 if v_conflict is not null then raise exception '%', v_conflict using errcode = '23505'; end if;
 if inv.id is not null then raise exception 'This email has already been invited. Check your inbox for the invitation, or sign in.' using errcode = '23505'; end if;
 loop
  v_code := 'R-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  exit when not exists (select 1 from public.agencies where lower(code) = lower(v_code));
 end loop;
 insert into public.agencies(name, code, registration_number, business_email, phone, address, country, primary_contact, status, registration_requested_at)
  values (v_business, v_code, v_abn, v_email, v_phone, '', 'Australia', v_name, 'Inactive', now()) returning * into a;
 insert into public.agency_invitations(agency_id, email, full_name, role, invited_by, invited_by_name)
  values (a.id, v_email, v_name, 'agency_admin', null, 'Self-registration') returning * into inv;
 -- Listed as the business's administrator straight away, like a CMS-added agent.
 insert into public.agents(business_id, full_name, email, phone, role, status, status_changed_at)
  values (a.id, v_name, v_email, left(v_phone, 40), 'agency_admin', 'Active', now());
 insert into public.portal_audit_log(actor, actor_name, actor_role, action, target_type, target_id, agency_id, detail)
  values (null, 'Self-registration', 'public', 'self_register_agent', 'business', a.id::text, a.id, jsonb_build_object('email', v_email, 'abn', v_abn, 'name', a.name, 'invitation', inv.id));
 return jsonb_build_object('kind', 'agent', 'invitationId', inv.id, 'email', v_email, 'name', v_name, 'agencyId', a.id, 'businessName', a.name);
exception when unique_violation then
 if sqlerrm not like 'duplicate key value%' then raise; end if;
 raise exception 'This business or email is already registered. Sign in, or contact SLIT Administration.' using errcode = '23505';
end $$;
revoke all on function public.portal_self_register(text, jsonb) from public, anon, authenticated;
grant execute on function public.portal_self_register(text, jsonb) to service_role;

-- ------------------------------------------------------------------ sign-up with Google
create or replace function public.portal_self_register_agent_complete(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); u record; v_email text; v_phone text; v_email_verified boolean; v_phone_verified boolean;
 v_contact text := btrim(coalesce(p_input->>'contactName', '')); v_business text := left(btrim(coalesce(p_input->>'businessName', '')), 200);
 v_abn text := regexp_replace(coalesce(p_input->>'abn', ''), '\s', '', 'g'); v_code text; a public.agencies; p public.portal_profiles; v_conflict text;
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
 if public.portal_abn_registered(v_abn) then
  raise exception 'The ABN you entered already exists in our system. Please contact Skyline to get registered.' using errcode = '23505'; end if;
 v_conflict := public.agent_contact_conflict(v_email, v_phone, v_uid);
 if v_conflict is not null then raise exception '%', v_conflict using errcode = '23505'; end if;
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
