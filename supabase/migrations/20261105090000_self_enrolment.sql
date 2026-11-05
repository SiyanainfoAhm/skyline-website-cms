-- Self-enrolment from the sign-in page ("Enroll now"): students and agents (businesses) enrol themselves. Staff stay
-- invite-only. Nothing new is bolted on: a self-enrolled student is an ordinary student record plus the same sign-in
-- invitation a CMS user sends (migration 118); a self-registered agent is an ordinary business (agencies row, unique by
-- ABN) plus the same agency_admin invitation, held Inactive with a pending review until a SLIT administrator approves it.
-- * Student: goes under the business of the referral code they typed (the business's code), otherwise under the one
--   "direct" business SLIT owns for students who apply themselves. No approval needed.
-- * Agent: the business is created Inactive with registration_requested_at set. They can set their password at once; on
--   sign-in the portal reports pending_review until the business is activated (Businesses > Pending review, or its status
--   dropdown), which records the decision and extends the invitation so it can be resent.
-- portal_self_register is service_role only: the portal-self-register Edge Function validates input, rate-limits callers
-- and sends the Auth mail. The admin functions require a SLIT administrator like the rest of the Businesses screen.
-- Rollback (manual): drop functions portal_self_register, admin_registration_list; recreate portal_resolve_access from
-- migration 118, admin_business_set_status from 20261104090000 and admin_student_detail without courseOfInterest; drop the
-- agencies columns (the direct business row stays: students may already hang off it).
set local lock_timeout='5s';
set local statement_timeout='30s';

-- ------------------------------------------------------------------ 1. The business table learns about self-registration
alter table public.agencies
 add column is_direct boolean not null default false,
 add column registration_requested_at timestamptz,
 add column registration_reviewed_at timestamptz,
 add column registration_reviewed_by uuid,
 add column registration_decision text check (registration_decision in ('approved','declined')),
 add constraint agencies_registration_review check ((registration_reviewed_at is null) = (registration_decision is null));
create unique index agencies_one_direct on public.agencies(is_direct) where is_direct;
comment on column public.agencies.is_direct is 'The one business SLIT owns for students who enrol themselves without an agent referral code.';
comment on column public.agencies.registration_requested_at is 'Set when an agent registered this business from the sign-in page; it waits Inactive until a SLIT administrator decides.';
comment on column public.agencies.registration_decision is 'approved: activated by a SLIT administrator; declined: left Inactive and its invitation revoked.';

insert into public.agencies(name, code, registration_number, business_email, phone, address, country, primary_contact, status, is_permanent, is_direct)
 select 'Skyline Institute of Technology (direct students)', 'SLIT-DIRECT', '', '', '', '', 'Australia', 'SLIT Administration', 'Active', true, true
 where not exists (select 1 from public.agencies where is_direct)
  and not exists (select 1 from public.agencies where lower(code) = 'slit-direct');

-- ------------------------------------------------------------------ 2. Enrolling from the sign-in page
create function public.portal_self_register(p_kind text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(btrim(coalesce(p_input->>'email', ''))); v_name text; a public.agencies; s public.enrollment_students; inv public.agency_invitations;
 v_first text := btrim(coalesce(p_input->>'firstName', '')); v_last text := btrim(coalesce(p_input->>'lastName', ''));
 v_phone text := btrim(coalesce(p_input->>'phone', '')); v_dob date; v_course text := left(btrim(coalesce(p_input->>'course', '')), 200);
 v_ref text := btrim(coalesce(p_input->>'referralCode', '')); v_abn text; v_business text := left(btrim(coalesce(p_input->>'businessName', '')), 200);
 v_details jsonb; v_code text; v_direct boolean;
begin
 if p_kind is null or p_kind not in ('student', 'agent') then raise exception 'Unknown enrolment type.' using errcode = '22023'; end if;
 if v_email = '' or v_email ~ '[[:cntrl:]]' or char_length(v_email) > 254 or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' then
  raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
 if v_phone ~ '[[:cntrl:]]' or char_length(v_phone) > 40 then raise exception 'Enter a valid phone number.' using errcode = '22023'; end if;
 -- Someone who can already sign in uses the Sign in tab.
 if exists (select 1 from public.cms_users u where lower(u.email) = v_email)
  or exists (select 1 from public.portal_profiles p join public.agency_memberships m on m.user_id = p.id where lower(p.email) = v_email and m.status = 'Active' and p.status = 'Active') then
  raise exception 'This email already has an account. Sign in instead, or use "Forgot password?".' using errcode = '23505'; end if;
 select * into inv from public.agency_invitations i where i.email = v_email and i.status = 'pending';

 if p_kind = 'student' then
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

 -- An agent registers their business.
 v_name := btrim(coalesce(p_input->>'contactName', ''));
 if char_length(v_name) not between 2 and 100 or v_name ~ '[[:cntrl:]]' then raise exception 'Enter the contact person''s name.' using errcode = '22023'; end if;
 if char_length(v_business) < 2 or v_business ~ '[[:cntrl:]]' then raise exception 'Enter the agency or company name.' using errcode = '22023'; end if;
 v_abn := regexp_replace(coalesce(p_input->>'abn', ''), '\s', '', 'g');
 if v_abn !~ '^\d{11}$' then raise exception 'Enter an 11-digit ABN.' using errcode = '22023'; end if;
 if v_phone = '' then raise exception 'Enter a phone number.' using errcode = '22023'; end if;
 if inv.id is not null then raise exception 'This email has already been invited. Check your inbox for the invitation, or sign in.' using errcode = '23505'; end if;
 if exists (select 1 from public.agencies x where regexp_replace(coalesce(x.registration_number, ''), '\s', '', 'g') = v_abn) then
  raise exception 'A business with this ABN is already registered. Ask its administrator to invite you, or contact SLIT Administration.' using errcode = '23505'; end if;
 loop
  v_code := 'R-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  exit when not exists (select 1 from public.agencies where lower(code) = lower(v_code));
 end loop;
 insert into public.agencies(name, code, registration_number, business_email, phone, address, country, primary_contact, status, registration_requested_at)
  values (v_business, v_code, v_abn, v_email, v_phone, '', 'Australia', v_name, 'Inactive', now()) returning * into a;
 insert into public.agency_invitations(agency_id, email, full_name, role, invited_by, invited_by_name)
  values (a.id, v_email, v_name, 'agency_admin', null, 'Self-registration') returning * into inv;
 insert into public.portal_audit_log(actor, actor_name, actor_role, action, target_type, target_id, agency_id, detail)
  values (null, 'Self-registration', 'public', 'self_register_agent', 'business', a.id::text, a.id, jsonb_build_object('email', v_email, 'abn', v_abn, 'name', a.name, 'invitation', inv.id));
 return jsonb_build_object('kind', 'agent', 'invitationId', inv.id, 'email', v_email, 'name', v_name, 'agencyId', a.id, 'businessName', a.name);
exception when unique_violation then
 raise exception 'This business or email is already registered. Sign in, or contact SLIT Administration.' using errcode = '23505';
end $$;
revoke all on function public.portal_self_register(text, jsonb) from public, anon, authenticated;
grant execute on function public.portal_self_register(text, jsonb) to service_role;

-- ------------------------------------------------------------------ 3. Signing in while the review is pending
-- As migration 118, plus: a pending self-registered business accepts its administrator's invitation (so the membership
-- exists before approval and the invitation cannot expire under them) and reports pending_review; a declined one reports
-- registration_declined.
create or replace function public.portal_resolve_access() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text; v_confirmed timestamptz; inv public.agency_invitations; p public.portal_profiles; m public.agency_memberships; a public.agencies;
 v_accepted boolean := false; v_state text;
begin
 if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
 if public.cms_is_admin() then return jsonb_build_object('state', 'org_admin', 'accepted', false); end if;
 select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;
 select * into p from public.portal_profiles where auth_user_id = v_uid;
 select * into m from public.agency_memberships where user_id = p.id;
 if v_confirmed is not null then
  select * into inv from public.agency_invitations i where i.email = v_email and i.status = 'pending' for update;
  if found and inv.expires_at >= now()
   and exists (select 1 from public.agencies x where x.id = inv.agency_id
    and (x.status = 'Active' or (x.registration_requested_at is not null and x.registration_reviewed_at is null)))
   and (inv.student_id is null or exists (select 1 from public.enrollment_students s where s.id = inv.student_id and s.status = 'Active' and s.agency_id = inv.agency_id))
   and not coalesce(m.status = 'Active' and p.status = 'Active' and m.agency_id <> inv.agency_id, false) then
   if p.id is null then
    insert into public.portal_profiles(auth_user_id, email, full_name, status) values (v_uid, v_email, coalesce(nullif(inv.full_name, ''), split_part(v_email, '@', 1)), 'Active') returning * into p;
   else
    update public.portal_profiles set status = 'Active', updated_at = now() where id = p.id returning * into p;
   end if;
   insert into public.agency_memberships(user_id, agency_id, role, status, student_id) values (p.id, inv.agency_id, inv.role, 'Active', inv.student_id)
   on conflict (user_id) do update set agency_id = excluded.agency_id, role = excluded.role, status = 'Active', student_id = excluded.student_id, updated_at = now() returning * into m;
   update public.agency_invitations set status = 'accepted', accepted_at = now() where id = inv.id;
   perform public.portal_user_audit(v_uid, jsonb_build_object('name', p.full_name, 'role', inv.role), 'accept_invitation', p.id::text, inv.agency_id, jsonb_build_object('email', v_email, 'role', inv.role, 'student', inv.student_id));
   v_accepted := true;
  end if;
 end if;
 if m.user_id is null then
  v_state := case when exists (select 1 from public.agency_invitations i where i.email = v_email and i.status = 'pending' and i.expires_at < now()) then 'invite_expired' else 'no_access' end;
 else
  select * into a from public.agencies where id = m.agency_id;
  v_state := case when p.status <> 'Active' or m.status <> 'Active' then 'user_suspended'
   when m.role = 'student' and not exists (select 1 from public.enrollment_students s where s.id = m.student_id and s.status = 'Active') then 'user_suspended'
   when a.registration_requested_at is not null and a.registration_reviewed_at is null then 'pending_review'
   when a.registration_decision = 'declined' and a.status <> 'Active' then 'registration_declined'
   when coalesce(a.status, '') <> 'Active' then 'agency_suspended' else 'active' end;
 end if;
 return jsonb_build_object('state', v_state, 'accepted', v_accepted);
end; $$;

-- ------------------------------------------------------------------ 4. Reviewing a registration
-- Activating a pending business approves it (and extends its waiting invitation so it can be resent); deactivating it
-- declines it (and revokes the invitation). The result names the waiting administrator invitation so the CMS can email it.
create or replace function public.admin_business_set_status(p_business uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare a public.agencies; inv public.agency_invitations; v_reviewed boolean := false;
begin
 perform public.admin_business_require();
 if p_status is null or p_status not in ('Active','Inactive') then raise exception 'Status must be Active or Inactive' using errcode = '22023'; end if;
 select * into a from public.agencies where id = p_business for update;
 if not found then raise exception 'Business not found' using errcode = 'P0002'; end if;
 if a.status is distinct from p_status then update public.agencies set status = p_status, updated_at = now() where id = a.id; end if;
 if a.registration_requested_at is not null and a.registration_reviewed_at is null then
  update public.agencies set registration_reviewed_at = now(), registration_reviewed_by = auth.uid(),
   registration_decision = case when p_status = 'Active' then 'approved' else 'declined' end, updated_at = now() where id = a.id;
  if p_status = 'Active' then
   update public.agency_invitations set expires_at = greatest(expires_at, now() + interval '7 days') where agency_id = a.id and status = 'pending';
  else
   update public.agency_invitations set status = 'revoked', revoked_at = now() where agency_id = a.id and status = 'pending';
  end if;
  v_reviewed := true;
 end if;
 select * into inv from public.agency_invitations i where i.agency_id = a.id and i.status = 'pending' and i.role = 'agency_admin' order by i.created_at limit 1;
 perform public.admin_business_audit(case when p_status = 'Active' then 'business_activated' else 'business_deactivated' end, a.id, a.id,
  jsonb_build_object('name', a.name, 'registrationReviewed', v_reviewed));
 return jsonb_build_object('businessId', a.id, 'status', p_status, 'agencyId', a.id, 'workspaceCreated', false, 'reviewed', v_reviewed,
  'pendingInvitation', case when p_status = 'Active' and inv.id is not null then jsonb_build_object('id', inv.id, 'email', inv.email, 'name', inv.full_name) else null end);
end $fn$;

create function public.admin_registration_list() returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
 perform public.admin_business_require();
 return coalesce((select jsonb_agg(jsonb_build_object(
   'id', a.id, 'name', a.name, 'abn', coalesce(a.registration_number, ''), 'contact', coalesce(a.primary_contact, ''), 'email', coalesce(a.business_email, ''),
   'phone', coalesce(a.phone, ''), 'requestedAt', a.registration_requested_at,
   'invitation', (select jsonb_build_object('id', i.id, 'status', case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end, 'expiresAt', i.expires_at, 'email', i.email, 'name', i.full_name)
     from public.agency_invitations i where i.agency_id = a.id and i.role = 'agency_admin' order by i.created_at desc limit 1),
   'signedIn', exists (select 1 from public.agency_memberships m where m.agency_id = a.id and m.status = 'Active')
  ) order by a.registration_requested_at, a.id)
  from public.agencies a where a.registration_requested_at is not null and a.registration_reviewed_at is null), '[]'::jsonb);
end $fn$;
revoke all on function public.admin_registration_list() from public, anon;
grant execute on function public.admin_registration_list() to authenticated;

-- ------------------------------------------------------------------ 5. The student page shows the course they asked about
do $do$
declare v_src text; v_anchor text := $a$'applications', public.admin_application_rows(s.id, null)$a$;
begin
 select pg_get_functiondef('public.admin_student_detail(uuid)'::regprocedure) into v_src;
 if strpos(v_src, v_anchor) = 0 then raise exception 'admin_student_detail has changed; update this migration'; end if;
 if strpos(v_src, 'courseOfInterest') > 0 then return; end if;
 v_src := replace(v_src, v_anchor, $a$'courseOfInterest', coalesce(s.details->>'course_of_interest', ''), 'selfEnrolled', s.created_by is null, $a$ || v_anchor);
 execute v_src;
end $do$;

-- ------------------------------------------------------------------ 6. Signing up with Google, Facebook or a phone number
-- The account already exists (Supabase Auth created it and verified its email or phone), so no invitation is needed: the
-- signed-in user completes their details and becomes a student straight away. Only the identifier Auth verified can
-- match an existing student record (that student's record is then linked); a typed, unverified email or mobile that is
-- already on record is refused, so nobody can claim someone else's record.
create function public.portal_self_enrol_complete(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); u record; v_email text; v_phone text; v_email_verified boolean; v_phone_verified boolean;
 v_first text := btrim(coalesce(p_input->>'firstName', '')); v_last text := btrim(coalesce(p_input->>'lastName', '')); v_name text;
 v_dob date; v_course text := left(btrim(coalesce(p_input->>'course', '')), 200); v_ref text := btrim(coalesce(p_input->>'referralCode', ''));
 a public.agencies; s public.enrollment_students; p public.portal_profiles; v_details jsonb; v_linked boolean := false;
begin
 if v_uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
 if exists (select 1 from public.cms_users c where c.auth_user_id = v_uid) then
  raise exception 'Staff accounts cannot enrol as students.' using errcode = '42501'; end if;
 if exists (select 1 from public.portal_profiles pp join public.agency_memberships m on m.user_id = pp.id where pp.auth_user_id = v_uid) then
  raise exception 'This account is already set up. Sign in again to continue.' using errcode = '23505'; end if;
 select lower(btrim(coalesce(x.email, ''))) as email, x.email_confirmed_at, nullif(btrim(coalesce(x.phone, '')), '') as phone, x.phone_confirmed_at
  into u from auth.users x where x.id = v_uid;
 v_email_verified := u.email <> '' and u.email_confirmed_at is not null;
 v_phone_verified := u.phone is not null and u.phone_confirmed_at is not null;
 if not v_email_verified and not v_phone_verified then
  raise exception 'Confirm your email or phone number first.' using errcode = '42501'; end if;

 v_email := case when v_email_verified then u.email else lower(btrim(coalesce(p_input->>'email', ''))) end;
 v_phone := case when v_phone_verified then '+' || ltrim(u.phone, '+') else regexp_replace(coalesce(p_input->>'phone', ''), '[\s().-]', '', 'g') end;
 if v_email = '' or char_length(v_email) > 254 or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' then
  raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
 if v_phone !~ '^\+[1-9]\d{7,14}$' then raise exception 'Enter your mobile number with its country code.' using errcode = '22023'; end if;
 v_name := btrim(concat_ws(' ', nullif(v_first, ''), nullif(v_last, '')));
 if char_length(v_first) not between 1 and 100 or char_length(v_last) not between 1 and 100 or v_name ~ '[[:cntrl:]]' then
  raise exception 'Enter your first and last name.' using errcode = '22023'; end if;
 begin v_dob := (p_input->>'dateOfBirth')::date; exception when others then v_dob := null; end;
 if v_dob is null or v_dob > current_date - interval '10 years' or v_dob < current_date - interval '100 years' then
  raise exception 'Enter a valid date of birth.' using errcode = '22023'; end if;

 -- An existing student is linked only through what Auth verified.
 if v_email_verified then select * into s from public.enrollment_students x where lower(btrim(coalesce(x.email, ''))) = v_email order by x.created_at, x.id limit 1; end if;
 if s.id is null and v_phone_verified then select * into s from public.enrollment_students x where public.student_phone_key(x.phone) = public.student_phone_key(v_phone) order by x.created_at, x.id limit 1; end if;
 if s.id is not null then
  if s.status <> 'Active' then raise exception 'This student record is disabled. Please contact SLIT Administration.' using errcode = '22023'; end if;
  if exists (select 1 from public.agency_memberships m where m.student_id = s.id and m.status = 'Active') then
   raise exception 'This student already has a sign-in. Sign in with that account instead.' using errcode = '23505'; end if;
  select * into a from public.agencies where id = s.agency_id;
  if a.status <> 'Active' then raise exception 'Your business is not active. Please contact SLIT Administration.' using errcode = '22023'; end if;
  v_linked := true;
 else
  if exists (select 1 from public.enrollment_students x where lower(btrim(coalesce(x.email, ''))) = v_email) then
   raise exception 'A student with this email is already on record. Sign in with that email instead, or contact SLIT Administration.' using errcode = '23505'; end if;
  if exists (select 1 from public.enrollment_students x where public.student_phone_key(x.phone) = public.student_phone_key(v_phone)) then
   raise exception 'A student with this mobile number is already on record. Sign in with it instead, or contact SLIT Administration.' using errcode = '23505'; end if;
  if v_ref <> '' then
   select * into a from public.agencies where lower(code) = lower(v_ref) and status = 'Active' and not is_direct;
   if not found then raise exception 'We do not recognise that referral code. Check it with your agent, or leave it blank.' using errcode = '22023'; end if;
  else
   select * into a from public.agencies where is_direct and status = 'Active';
   if not found then raise exception 'Direct enrolment is not open right now. Please contact SLIT Administration.' using errcode = '22023'; end if;
  end if;
  v_details := jsonb_build_object('email', v_email, 'confirm_email', v_email, 'mobile', v_phone, 'first_name', v_first, 'last_name', v_last);
  if v_course <> '' then v_details := v_details || jsonb_build_object('course_of_interest', v_course); end if;
  insert into public.enrollment_students(agency_id, tenant_id, agent_id, full_name, email, phone, date_of_birth, details)
   values (a.id, null, null, v_name, v_email, v_phone, v_dob, v_details) returning * into s;
 end if;

 select * into p from public.portal_profiles where auth_user_id = v_uid;
 if p.id is null then
  insert into public.portal_profiles(auth_user_id, email, full_name, phone, status) values (v_uid, v_email, coalesce(nullif(s.full_name, ''), v_name), left(v_phone, 40), 'Active') returning * into p;
 else
  update public.portal_profiles set status = 'Active', email = v_email, phone = left(v_phone, 40), updated_at = now() where id = p.id returning * into p;
 end if;
 insert into public.agency_memberships(user_id, agency_id, role, status, student_id) values (p.id, s.agency_id, 'student', 'Active', s.id);
 -- A waiting invitation for this student is now used.
 update public.agency_invitations set status = 'accepted', accepted_at = now() where student_id = s.id and status = 'pending';
 insert into public.portal_audit_log(actor, actor_name, actor_role, action, target_type, target_id, agency_id, detail)
  values (v_uid, coalesce(nullif(s.full_name, ''), v_name), 'student', 'self_enrol_signed_in', 'student', s.id::text, s.agency_id,
   jsonb_build_object('email', v_email, 'linkedExisting', v_linked, 'emailVerified', v_email_verified, 'phoneVerified', v_phone_verified, 'referral', v_ref <> ''));
 return jsonb_build_object('studentId', s.id, 'agencyId', s.agency_id, 'linkedExisting', v_linked);
exception when unique_violation then
 raise exception 'This email or mobile number is already on record. Sign in with it instead, or contact SLIT Administration.' using errcode = '23505';
end $$;
revoke all on function public.portal_self_enrol_complete(jsonb) from public, anon;
grant execute on function public.portal_self_enrol_complete(jsonb) to authenticated;

-- ------------------------------------------------------------------ 7. An agent signs up with Google, Facebook or a phone number
-- Same result as registering from the form (an Inactive business by ABN, waiting for SLIT's review), but the signed-in
-- account is its administrator straight away instead of receiving an invitation; until approved the portal reports
-- pending_review. One business per account.
create function public.abn_checksum_ok(p_abn text) returns boolean
language sql immutable as $fn$
 select p_abn ~ '^\d{11}$' and (
  (substr(p_abn,1,1)::int - 1) * 10 + substr(p_abn,2,1)::int * 1 + substr(p_abn,3,1)::int * 3 + substr(p_abn,4,1)::int * 5
  + substr(p_abn,5,1)::int * 7 + substr(p_abn,6,1)::int * 9 + substr(p_abn,7,1)::int * 11 + substr(p_abn,8,1)::int * 13
  + substr(p_abn,9,1)::int * 15 + substr(p_abn,10,1)::int * 17 + substr(p_abn,11,1)::int * 19) % 89 = 0;
$fn$;

create function public.portal_self_register_agent_complete(p_input jsonb) returns jsonb
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
 raise exception 'This business or email is already registered. Sign in, or contact SLIT Administration.' using errcode = '23505';
end $$;
revoke all on function public.portal_self_register_agent_complete(jsonb) from public, anon;
grant execute on function public.portal_self_register_agent_complete(jsonb) to authenticated;
