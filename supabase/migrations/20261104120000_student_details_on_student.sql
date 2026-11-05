-- Student information lives on the student; an application holds only what is about that application.
--
-- * enrollment_students.details: every answer from the student sections of the form (personal details and passport,
--   address, visa and English test, AVETMISS, academic history, USI, emergency contact), plus the typed columns that
--   already existed (name, email, phone, date of birth, passport, nationality). enrollment_students.qualifications: the
--   academic qualifications list.
-- * enrollment_applications.data->'values' keeps only the application's answers (courses, study reason, credit, OSHC,
--   how they heard, checklist, declaration, agent details).
-- * Every save still sends the whole form: a trigger routes the student answers to the student record and strips them
--   from the application, so the wizard, document extraction, guest links and the review screen are unchanged.
-- * Reads merge the two again (public.application_values / application_data in the database; the frontend embeds the
--   student record). Submitting an application freezes the merged form in enrollment_application_versions, as before.
-- Written against the hosted definitions of the functions it replaces (2026-11-04).
set local lock_timeout='5s';
set local statement_timeout='300s';

-- ------------------------------------------------------------------ columns
alter table public.enrollment_students
 add column details jsonb not null default '{}'::jsonb,
 add column qualifications jsonb not null default '[]'::jsonb;
comment on column public.enrollment_students.details is 'The student''s answers to the student sections of the application form (one map keyed by field name).';
comment on column public.enrollment_students.qualifications is 'The student''s academic qualifications list (was data->academicQualifications on each application).';
-- A plain key for the application -> student relation (the composite one stays for the same-agency rule).
alter table public.enrollment_applications add constraint enrollment_applications_student_fk
 foreign key (student_id) references public.enrollment_students(id) on delete restrict;

-- ------------------------------------------------------------------ which answers belong to the student
create function public.is_student_field(p_key text) returns boolean
language sql immutable parallel safe as $fn$
 select p_key in (
  'passport_copy','title','first_name','middle_name','last_name','dob','gender','mobile','email','confirm_email','email_note',
  'citizenship','nationality','birth_country','passport_number','passport_expiry',
  'address_type','address_source','address_note','holds_visa',
  'atsi','employment','language_home','language_other','secondary_enrolled','school_level','highest_education','year_completed','prior_ed','disability',
  'has_usi','usi_number','usi_consent','usi_note')
  or p_key like any (array['au\_%','ov\_%','ec\_%','visa\_%','english\_%','academic\_%','usi\_%','passport\_%']);
$fn$;
create function public.student_values(p_values jsonb) returns jsonb
language sql immutable parallel safe as $fn$
 select coalesce((select jsonb_object_agg(key, value) from jsonb_each(case when jsonb_typeof(p_values) = 'object' then p_values else '{}'::jsonb end) where public.is_student_field(key)), '{}'::jsonb);
$fn$;
create function public.application_only_values(p_values jsonb) returns jsonb
language sql immutable parallel safe as $fn$
 select coalesce((select jsonb_object_agg(key, value) from jsonb_each(case when jsonb_typeof(p_values) = 'object' then p_values else '{}'::jsonb end) where not public.is_student_field(key)), '{}'::jsonb);
$fn$;

-- The form as one map again: the student's answers plus the application's own. Internal: the functions below call these.
create function public.application_values(p_application uuid) returns jsonb
language sql stable security definer set search_path = '' as $fn$
 select coalesce(a.data -> 'values', '{}'::jsonb) || coalesce(s.details, '{}'::jsonb)
 from public.enrollment_applications a left join public.enrollment_students s on s.id = a.student_id where a.id = p_application;
$fn$;
create function public.application_data(p_application uuid) returns jsonb
language sql stable security definer set search_path = '' as $fn$
 select jsonb_set(coalesce(a.data, '{}'::jsonb) || jsonb_build_object('academicQualifications', coalesce(a.data -> 'academicQualifications', s.qualifications, '[]'::jsonb)),
  '{values}', coalesce(a.data -> 'values', '{}'::jsonb) || coalesce(s.details, '{}'::jsonb), true)
 from public.enrollment_applications a left join public.enrollment_students s on s.id = a.student_id where a.id = p_application;
$fn$;
revoke all on function public.application_values(uuid), public.application_data(uuid) from public, anon, authenticated;

-- Writes the student's answers onto the student: the map, the list, and the typed columns that come from them. A typed
-- value that would clash with another student of the business (same passport or email and birth date) is left as it was.
create function public.student_apply_details(p_student uuid, p_values jsonb, p_qualifications jsonb) returns void
language plpgsql security definer set search_path = '' as $fn$
declare d jsonb;
begin
 if p_student is null then return; end if;
 select coalesce(s.details, '{}'::jsonb) || coalesce(p_values, '{}'::jsonb) into d from public.enrollment_students s where s.id = p_student;
 if d is null then return; end if;
 begin
  update public.enrollment_students s set details = d, qualifications = coalesce(p_qualifications, s.qualifications),
   full_name = coalesce(nullif(btrim(concat_ws(' ', d ->> 'first_name', d ->> 'last_name')), ''), s.full_name),
   email = coalesce(nullif(lower(btrim(d ->> 'email')), ''), s.email),
   phone = coalesce(nullif(btrim(d ->> 'mobile'), ''), s.phone),
   date_of_birth = coalesce(public.student_safe_date(d ->> 'dob'), s.date_of_birth),
   passport_number = coalesce(nullif(upper(regexp_replace(coalesce(d ->> 'passport_number', ''), '\s', '', 'g')), ''), s.passport_number),
   nationality = coalesce(nullif(btrim(d ->> 'nationality'), ''), s.nationality)
  where s.id = p_student;
 exception when unique_violation then
  update public.enrollment_students s set details = d, qualifications = coalesce(p_qualifications, s.qualifications) where s.id = p_student;
  raise warning 'Student % identity details not updated: they would match another student of the business', p_student;
 end;
end $fn$;
revoke all on function public.student_apply_details(uuid, jsonb, jsonb) from public, anon, authenticated;

-- Every write of an application's form routes the student answers to the student and keeps the rest.
create function public.application_route_student_fields() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare sv jsonb; quals jsonb;
begin
 if new.student_id is null or new.data is null then return new; end if;
 sv := public.student_values(new.data -> 'values');
 quals := case when jsonb_typeof(new.data -> 'academicQualifications') = 'array' then new.data -> 'academicQualifications' end;
 if sv = '{}'::jsonb and quals is null then return new; end if;
 perform public.student_apply_details(new.student_id, sv, quals);
 new.data := new.data - 'academicQualifications';
 if new.data ? 'values' then new.data := jsonb_set(new.data, '{values}', public.application_only_values(new.data -> 'values'), true); end if;
 return new;
end $fn$;
revoke all on function public.application_route_student_fields() from public, anon, authenticated;
create trigger b_route_student_fields before update of data on public.enrollment_applications
 for each row execute function public.application_route_student_fields();

-- The after trigger now only keeps the student's agent in step; the details are routed above.
create or replace function public.application_sync_student() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare v_agent uuid;
begin
 if new.student_id is null then return new; end if;
 if tg_op = 'INSERT' or new.assigned_agent_id is distinct from old.assigned_agent_id then
  select g.id into v_agent from public.agents g where g.profile_id = new.assigned_agent_id;
  if v_agent is not null then update public.enrollment_students set agent_id = v_agent where id = new.student_id and agent_id is distinct from v_agent; end if;
 end if;
 return new;
end $fn$;
drop trigger if exists zz_application_sync_student on public.enrollment_applications;
create trigger zz_application_sync_student after insert or update of assigned_agent_id on public.enrollment_applications
 for each row execute function public.application_sync_student();

-- ------------------------------------------------------------------ move what is there today
-- Oldest application first, so each student ends up with the answers from their latest application.
do $do$ declare r record; begin
 for r in select id from public.enrollment_applications order by updated_at, id loop
  update public.enrollment_applications set data = data where id = r.id;
 end loop;
end $do$;

-- ------------------------------------------------------------------ readers and writers of the form
create or replace function public.portal_validate_submission(p_application_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $function$
declare a public.enrollment_applications; s jsonb; f jsonb; vals jsonb; field_value jsonb; v_category text; label text;
begin
 select * into a from public.enrollment_applications where id=p_application_id;
 vals:=public.application_values(a.id);
 for s in select value from jsonb_array_elements(public.portal_required_schema()) loop
  if not public.portal_condition_met(s->'showIf',vals) then continue; end if;
  for f in select value from jsonb_array_elements(s->'fields') loop
   if not public.portal_condition_met(f->'showIf',vals) then continue; end if;
   label:=f->>'name';field_value:=vals->label;
   if f->>'type'='file' then
    v_category:=case label when 'passport_copy' then 'Passport' when 'visa_copy' then 'Visa' when 'english_upload' then 'English Test' when 'academic_upload' then 'Academic' end;
    if v_category is null or not exists(select 1 from public.enrollment_application_documents d join storage.objects o on o.bucket_id=d.bucket_name and o.name=d.storage_path
     where d.application_id=a.id and d.category=v_category and d.is_current) then
     raise exception 'Required document missing: %',label using errcode='22023'; end if;
   elsif f->>'type'='checkbox' then
    if jsonb_typeof(field_value) is distinct from 'array' or jsonb_array_length(field_value)=0 then raise exception 'Required selection missing: %',label using errcode='22023'; end if;
    if label='courses_of_interest' then
     if not exists(select 1 from public.enrollment_application_courses where application_id=a.id) then raise exception 'Select an institution course' using errcode='22023'; end if;
    elsif f ? 'options' then
     if exists(select 1 from jsonb_array_elements_text(field_value) v where not (f->'options' ? v)) then raise exception 'Invalid selection: %',label using errcode='22023'; end if;
    end if;
   elsif nullif(btrim(field_value#>>'{}'),'') is null then raise exception 'Required field missing: %',label using errcode='22023';
   elsif f->>'type' in ('select','radio') and f ? 'options' and label<>'agent_agency' and not(f->'options' ? (field_value#>>'{}')) then
    raise exception 'Invalid option: %',label using errcode='22023';
   elsif f->>'type'='date' then
    begin perform (field_value#>>'{}')::date; exception when others then raise exception 'Invalid date: %',label using errcode='22023'; end;
   elsif f->>'type'='email' and (field_value#>>'{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid email: %',label using errcode='22023';
   end if;
  end loop;
 end loop;
 if vals->>'email' is distinct from vals->>'confirm_email' then raise exception 'Email confirmation does not match' using errcode='22023'; end if;
 if a.tenant_id is not null and exists(select 1 from public.enrollment_application_courses c left join public.cms_courses cc on cc.id=c.course_id and cc.tenant_id=a.tenant_id and cc.status='Published'
  where c.application_id=a.id and cc.id is null) then raise exception 'Course is no longer published' using errcode='22023'; end if;
end; $function$;

-- Submitting freezes the merged form (student answers included) as this version's snapshot.
create or replace function public.portal_submit_v2(p_application_id uuid, p_expected_version bigint, p_request_key text, p_consent jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare a public.enrollment_applications; r public.admission_submission_receipts; snap jsonb; v integer; signed_path text;
begin
 select * into a from public.enrollment_applications where id=p_application_id for update;
 if auth.uid() is null or not public.portal_can_access_application(a.id) then raise exception 'Submission not authorized' using errcode='42501'; end if;
 if nullif(btrim(p_request_key),'') is null or length(p_request_key)>200 then raise exception 'Submission request key required' using errcode='22023'; end if;
 select * into r from public.admission_submission_receipts where application_id=a.id and request_key=p_request_key;
 if found then return to_jsonb(r); end if;
 if a.status <> 'draft' then
  select * into r from public.admission_submission_receipts where application_id=a.id order by version desc limit 1;
  if found then return to_jsonb(r); end if;
  raise exception 'Application is not awaiting submission' using errcode='PT409';
 end if;
 perform public.portal_lock_draft(a.id,p_expected_version);
 perform public.portal_validate_submission(a.id);
 if p_consent->'confirmed' is distinct from 'true'::jsonb or p_consent->'authorised' is distinct from 'true'::jsonb
  or coalesce(p_consent->>'method' not in ('electronic','document'),true) or p_consent->>'declarationVersion' is distinct from '1.0' then
  raise exception 'Student consent and agent authorization are required' using errcode='22023'; end if;
 signed_path:=coalesce(p_consent->>'signedDocumentRef','');
 if p_consent->>'method'='document' and not exists(select 1 from public.enrollment_application_documents d join storage.objects o on o.bucket_id=d.bucket_name and o.name=d.storage_path
  where d.application_id=a.id and d.category='Consent' and d.is_current and d.storage_path=signed_path) then
  raise exception 'A signed consent document from this application is required' using errcode='22023'; end if;
 select coalesce(max(version),0)+1 into v from public.enrollment_application_versions where application_id=a.id;
 snap:=public.application_data(a.id)||jsonb_build_object('courses',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.enrollment_application_courses c where application_id=a.id),
  'submission',jsonb_build_object('actor',auth.uid(),'declarationVersion','1.0','consent',p_consent,'draftVersion',a.draft_version));
 perform set_config('portal.status_command',a.id::text,true);
 update public.enrollment_applications set status='submitted',submitted_at=now(),submitted_by=auth.uid(),
  reference=coalesce(nullif(a.reference,''),public.portal_next_application_reference()),version=v where id=a.id returning * into a;
 insert into public.enrollment_application_consents(application_id,method,signed_document_ref,declaration_version,recorded_by_name)
 values(a.id,p_consent->>'method',signed_path,'1.0',coalesce(auth.jwt()->>'email','Authenticated agent'));
 insert into public.enrollment_application_versions(application_id,version,snapshot,created_by,created_by_name)
 values(a.id,v,snap,auth.uid(),coalesce(auth.jwt()->>'email','Authenticated agent'));
 insert into public.admission_submission_receipts(application_id,tenant_id,version,request_key,reference,actor)
 values(a.id,a.tenant_id,v,p_request_key,a.reference,auth.uid()) returning * into r;
 insert into public.admission_event_outbox(receipt_id,application_id,tenant_id,event,payload)
 values(r.id,a.id,a.tenant_id,'application_submitted',jsonb_build_object('receiptId',r.id,'reference',a.reference,'version',v));
 insert into public.portal_audit_log(actor,actor_name,actor_role,action,target_type,target_id,application_id,detail)
 values(auth.uid(),coalesce(auth.jwt()->>'email','Authenticated user'),case when public.portal_is_agency_admin() then 'agency_admin' when public.portal_is_slit_admin() then 'slit_admin' else 'agent' end,
  'application_submitted','application',a.id::text,a.id,jsonb_build_object('receiptId',r.id,'version',v));
 return to_jsonb(r);
end; $function$;

-- Document reads compare against the merged form; what they write is routed by the trigger.
create or replace function public.portal_apply_document_candidates(p_document_id uuid, p_fields jsonb, p_source jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_document record; v_pcat text; v_pcur boolean; v_pat timestamptz; v_data jsonb; v_values jsonb; v_provenance jsonb; v_quals jsonb; v_entry jsonb;
  v_key text; v_value text; v_existing text; v_state text; v_result jsonb := '{}'::jsonb;
  v_prior uuid; v_last text; v_replace boolean; v_dup bigint;
begin
  select d.id, d.application_id, d.category, d.created_at into v_document
  from public.enrollment_application_documents d join public.enrollment_applications a on a.id = d.application_id
  where d.id = p_document_id and d.is_current and a.status in ('draft','action_required') for update of d, a;
  if not found then return jsonb_build_object('stale', true); end if;
  select data into v_data from public.enrollment_applications where id = v_document.application_id for update;
  v_data := public.application_data(v_document.application_id);
  v_values := coalesce(v_data->'values', '{}'::jsonb); v_provenance := coalesce(v_data->'fieldProvenance', '{}'::jsonb);
  for v_key, v_value in select key, value #>> '{}' from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
    if nullif(btrim(v_value), '') is null then continue; end if;
    v_existing := nullif(btrim(v_values->>v_key), '');
    if v_existing is null then
      v_values := jsonb_set(v_values, array[v_key], to_jsonb(v_value), true);
      v_provenance := jsonb_set(v_provenance, array[v_key], jsonb_build_object('kind','ai_unverified','documentId',p_document_id,'updatedAt',now()), true);
      v_state := 'auto_applied';
    elsif lower(v_existing) = lower(v_value) then v_state := 'corroborated';
    elsif v_key like 'academic\_%' then continue; -- further qualifications go to the list below
    else
      v_replace := false;
      if v_provenance->v_key->>'kind' = 'ai_unverified' and v_provenance->v_key->>'documentId' ~* '^[0-9a-f-]{36}$' then
        v_prior := (v_provenance->v_key->>'documentId')::uuid;
        if v_prior <> p_document_id then
          -- Unedited means the form still holds exactly what the last extraction wrote.
          select r.final_value into v_last from public.enrollment_document_field_reviews r
          where r.application_id = v_document.application_id and r.field_identifier = v_key and r.state = 'auto_applied'
          order by r.created_at desc, r.audit_revision desc limit 1;
          if v_last is not null and lower(btrim(v_last)) = lower(v_existing) then
            select d.category, d.is_current, d.created_at into v_pcat, v_pcur, v_pat from public.enrollment_application_documents d where d.id = v_prior;
            v_replace := v_pcur is null or not v_pcur
              or (v_pcat = v_document.category and v_pat <= v_document.created_at);
          end if;
        end if;
      end if;
      if v_replace then
        v_values := jsonb_set(v_values, array[v_key], to_jsonb(v_value), true);
        v_provenance := jsonb_set(v_provenance, array[v_key], jsonb_build_object('kind','ai_unverified','documentId',p_document_id,'updatedAt',now()), true);
        v_state := 'auto_applied';
      else v_state := 'conflict'; end if;
    end if;
    insert into public.enrollment_document_field_reviews(application_id, document_id, field_identifier, candidate_value, existing_value, final_value, state, source)
    values (v_document.application_id, p_document_id, v_key, v_value, v_existing, case when v_state in ('auto_applied') then v_value else v_existing end, v_state, p_source);
    v_result := jsonb_set(v_result, array[v_key], to_jsonb(v_state), true);
  end loop;

  v_data := jsonb_set(jsonb_set(v_data, '{values}', v_values, true), '{fieldProvenance}', v_provenance, true);

  if v_document.category = 'Academic' then
    v_quals := public.portal_strip_document_qualifications(v_data->'academicQualifications', p_document_id);
    v_entry := jsonb_strip_nulls(jsonb_build_object(
      'institution', nullif(btrim(p_fields->>'academic_institution'), ''), 'qualification', nullif(btrim(p_fields->>'academic_qualification'), ''),
      'program', nullif(btrim(p_fields->>'academic_program'), ''), 'year', nullif(btrim(p_fields->>'academic_year'), ''),
      'result', nullif(btrim(p_fields->>'academic_result'), '')));
    if v_entry ?| array['institution','qualification','program'] then
      select t.ord into v_dup from jsonb_array_elements(v_quals) with ordinality as t(e, ord)
      where lower(coalesce(t.e->>'institution','')) = lower(coalesce(v_entry->>'institution',''))
        and lower(coalesce(t.e->>'qualification','')) = lower(coalesce(v_entry->>'qualification',''))
        and lower(coalesce(t.e->>'program','')) = lower(coalesce(v_entry->>'program',''))
        and lower(coalesce(t.e->>'year','')) = lower(coalesce(v_entry->>'year',''))
        and lower(coalesce(t.e->>'result','')) = lower(coalesce(v_entry->>'result',''))
      limit 1;
      if v_dup is null then
        v_quals := v_quals || jsonb_build_array(v_entry || jsonb_build_object('documentIds', jsonb_build_array(p_document_id)));
      elsif jsonb_typeof(v_quals->(v_dup::int - 1)->'documentIds') = 'array' then
        v_quals := jsonb_set(v_quals, array[(v_dup - 1)::text, 'documentIds'], (v_quals->(v_dup::int - 1)->'documentIds') || to_jsonb(p_document_id::text));
      end if;
    end if;
    v_data := jsonb_set(v_data, '{academicQualifications}', v_quals, true);
  end if;

  update public.enrollment_applications set data = v_data, updated_at = now() where id = v_document.application_id;
  return v_result;
end;
$function$;

create or replace function public.guest_apply_fields(p_link uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare l public.guest_document_links; v_data jsonb; v_values jsonb; v_prov jsonb; v_key text; v_value text; v_existing text; v_state text; v_result jsonb := '{}'::jsonb;
begin
  select * into l from public.guest_document_links where id = p_link and revoked_at is null and expires_at > now() and completed_at is null;
  if l.id is null then raise exception 'Link is not valid' using errcode = '42501'; end if;
  select data into v_data from public.enrollment_applications where id = l.application_id and status in ('draft','action_required') for update;
  if not found then raise exception 'Link is not valid' using errcode = '42501'; end if;
  v_data := public.application_data(l.application_id);
  v_values := coalesce(v_data->'values','{}'::jsonb); v_prov := coalesce(v_data->'fieldProvenance','{}'::jsonb);
  for v_key, v_value in select key, left(btrim(value #>> '{}'), 500) from jsonb_each(coalesce(p_fields,'{}'::jsonb)) loop
    if nullif(v_value,'') is null then continue; end if;
    v_existing := nullif(btrim(v_values->>v_key),'');
    if v_existing is null then
      v_values := jsonb_set(v_values, array[v_key], to_jsonb(v_value), true);
      v_prov := jsonb_set(v_prov, array[v_key], jsonb_build_object('kind','student_entered','linkId',l.id,'updatedAt',now()), true);
      v_state := 'auto_applied';
    elsif lower(v_existing) = lower(v_value) then v_state := 'corroborated';
    else v_state := 'conflict'; end if;
    if v_state <> 'corroborated' then
      insert into public.enrollment_document_field_reviews(application_id, document_id, field_identifier, candidate_value, existing_value, final_value, state, source)
      values (l.application_id, null, v_key, v_value, v_existing, case when v_state = 'auto_applied' then v_value else v_existing end, v_state, jsonb_build_object('kind','student','linkId',l.id));
    end if;
    v_result := jsonb_set(v_result, array[v_key], to_jsonb(v_state), true);
  end loop;
  update public.enrollment_applications set data = jsonb_set(jsonb_set(v_data,'{values}',v_values,true),'{fieldProvenance}',v_prov,true), updated_at = now() where id = l.application_id;
  return v_result;
end; $function$;

create or replace function public.portal_save_document_review(p_application_id uuid, p_values jsonb, p_provenance jsonb default '{}'::jsonb, p_confirmed jsonb default '[]'::jsonb, p_resolutions jsonb default '[]'::jsonb, p_wizard jsonb default '{}'::jsonb, p_student_name text default null::text) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_data jsonb; v_values jsonb; v_wizard jsonb; v_provenance jsonb; v_field text; v_value text;
  v_resolution jsonb; v_document_id uuid; v_candidate text; v_state text;
begin
  if auth.uid() is null or not public.portal_can_access_application(p_application_id) then raise exception 'not authorised' using errcode = '42501'; end if;
  select data into v_data from public.enrollment_applications where id = p_application_id for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if not public.portal_can_edit_application(p_application_id) then raise exception 'not authorised' using errcode='42501'; end if;
  v_data := public.application_data(p_application_id);
  -- Validate every document parent before accepting any field changes.
  for v_resolution in select value from jsonb_array_elements(coalesce(p_resolutions,'[]'::jsonb)) loop
    v_document_id := nullif(v_resolution->>'documentId','')::uuid;
    if v_document_id is not null and not exists(select 1 from public.enrollment_application_documents
       where id=v_document_id and application_id=p_application_id and is_current) then
      raise exception 'document does not belong to application' using errcode='42501';
    end if;
  end loop;
  v_values := coalesce(v_data->'values', '{}'::jsonb); v_wizard := coalesce(v_data->'wizard', '{}'::jsonb) || coalesce(p_wizard, '{}'::jsonb); v_provenance := coalesce(v_wizard->'provenance', '{}'::jsonb) || coalesce(p_provenance, '{}'::jsonb);
  for v_field, v_value in select key, value #>> '{}' from jsonb_each(coalesce(p_values, '{}'::jsonb)) loop v_values := jsonb_set(v_values, array[v_field], to_jsonb(coalesce(v_value, '')), true); end loop;
  v_wizard := jsonb_set(v_wizard, '{provenance}', v_provenance, true); v_wizard := jsonb_set(v_wizard, '{confirmed}', coalesce(p_confirmed, '[]'::jsonb), true); v_wizard := jsonb_set(v_wizard, '{updatedAt}', to_jsonb(now()), true);
  update public.enrollment_applications set data = jsonb_set(jsonb_set(v_data, '{values}', v_values, true), '{wizard}', v_wizard, true), student_name = coalesce(p_student_name, student_name), updated_at = now() where id = p_application_id;
  for v_resolution in select value from jsonb_array_elements(coalesce(p_resolutions, '[]'::jsonb)) loop
    v_field := nullif(v_resolution->>'field', ''); if v_field is null then continue; end if;
    v_document_id := nullif(v_resolution->>'documentId', '')::uuid; v_candidate := nullif(v_resolution->>'candidateValue', ''); v_state := case when v_resolution->>'state' in ('confirmed','corrected','rejected') then v_resolution->>'state' else 'corrected' end;
    insert into public.enrollment_document_field_reviews(application_id, document_id, field_identifier, candidate_value, existing_value, final_value, state, source, reviewed_by, reviewed_at)
    values (p_application_id, v_document_id, v_field, v_candidate, null, v_values->>v_field, v_state, jsonb_build_object('kind', coalesce(v_provenance->>v_field, 'Manual entry')), public.portal_profile_id(), now());
  end loop;
  return jsonb_build_object('ok', true, 'values', v_values, 'wizard', v_wizard);
end;
$function$;

create or replace function public.portal_resolve_student_suggestion(p_application uuid, p_field text, p_accept boolean) returns void
language plpgsql security definer set search_path to 'public' as $function$
declare a public.enrollment_applications; r public.enrollment_document_field_reviews; d jsonb;
begin
  select * into a from public.enrollment_applications where id = p_application for update;
  if auth.uid() is null or not found or not public.portal_can_edit_application(p_application) or a.status not in ('draft', 'action_required') then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into r from public.enrollment_document_field_reviews where application_id = a.id and field_identifier = p_field and state = 'conflict' and source->>'kind' = 'student' order by created_at desc limit 1;
  if not found then raise exception 'No suggestion to resolve' using errcode = '22023'; end if;
  if p_accept then
    perform set_config('portal.draft_command', a.id::text, true);
    d := public.application_data(a.id);
    d := jsonb_set(d, '{values}', coalesce(d->'values', '{}'::jsonb) || jsonb_build_object(p_field, r.candidate_value));
    d := jsonb_set(d, '{fieldProvenance}', coalesce(d->'fieldProvenance', '{}'::jsonb) || jsonb_build_object(p_field, jsonb_build_object('kind', 'student_entered', 'updatedAt', now())));
    update public.enrollment_applications set data = d, updated_at = clock_timestamp() where id = a.id;
  end if;
  update public.enrollment_document_field_reviews set state = case when p_accept then 'confirmed' else 'rejected' end, reviewed_at = now(), final_value = case when p_accept then r.candidate_value else r.existing_value end
    where application_id = a.id and field_identifier = p_field and state = 'conflict' and source->>'kind' = 'student';
end; $function$;

create or replace function public.portal_finish_document_extraction_job(p_job uuid, p_lease uuid, p_extraction jsonb, p_response_id text, p_usage jsonb) returns boolean
language plpgsql security definer set search_path to 'public' as $function$
declare v_job public.enrollment_document_extraction_jobs; v_doc public.enrollment_application_documents;
 v_extraction jsonb; v_status text; candidate record; current_values jsonb;
begin
 select * into v_job from public.enrollment_document_extraction_jobs where id=p_job for update;
 if not found or v_job.tenant_id is not null or v_job.state<>'processing' or v_job.lease_token is distinct from p_lease or p_lease is null
   or v_job.lease_expires_at is null or v_job.lease_expires_at<=clock_timestamp() then return false; end if;
 -- Match manual-review lock ordering: application before document.
 select status into v_status from public.enrollment_applications where id=v_job.application_id for update;
 select * into v_doc from public.enrollment_application_documents where id=v_job.document_id for update;
 if not found or not v_doc.is_current or v_doc.application_id<>v_job.application_id then return false; end if;
 if jsonb_typeof(p_extraction->'extracted') is distinct from 'object' then raise exception 'invalid extraction fields'; end if;
 v_extraction:=coalesce(v_doc.metadata->'extraction','{}'::jsonb) || (p_extraction-'confirmed');
 v_extraction:=jsonb_set(v_extraction,'{confirmed}',coalesce(v_doc.metadata#>'{extraction,confirmed}','{}'::jsonb),true);
 if v_doc.metadata#>>'{extraction,status}'='confirmed' then
   v_extraction:=jsonb_set(v_extraction,'{status}','"confirmed"'::jsonb,true);
 end if;
 update public.enrollment_application_documents set metadata=v_doc.metadata || jsonb_build_object(
   'extraction',v_extraction,'extractedFields',(select coalesce(jsonb_agg(key),'[]'::jsonb) from jsonb_object_keys(p_extraction->'extracted') key))
 where id=v_doc.id;
 if v_status in ('draft','action_required') then
   if v_job.review_only then
    current_values:=public.application_values(v_job.application_id);
    for candidate in select key,value#>>'{}' val from jsonb_each(p_extraction->'extracted') loop
     insert into public.enrollment_document_field_reviews(application_id,document_id,field_identifier,candidate_value,existing_value,final_value,state,source)
     values(v_doc.application_id,v_doc.id,candidate.key,candidate.val,current_values->>candidate.key,current_values->>candidate.key,
      case when lower(coalesce(current_values->>candidate.key,''))=lower(candidate.val) then 'corroborated' else 'conflict' end,coalesce(p_extraction->'source','{}'));
    end loop;
   else perform public.portal_apply_document_candidates(v_doc.id,p_extraction->'extracted',coalesce(p_extraction->'source','{}'::jsonb)); end if;
 end if;
 update public.enrollment_document_extraction_jobs set state='succeeded',lease_expires_at=null,lease_token=null,
   provider_response_id=p_response_id,usage=coalesce(p_usage,'{}'::jsonb),completed_at=now(),updated_at=now()
 where id=v_job.id;
 insert into public.enrollment_document_extraction_attempts(job_id,attempt_number,state,provider_response_id,usage,completed_at)
 values(v_job.id,v_job.attempt_count,'succeeded',p_response_id,coalesce(p_usage,'{}'::jsonb),now());
 return true;
end;
$function$;

create or replace function public.portal_finish_tenant_document_job(p_tenant uuid, p_job uuid, p_lease uuid, p_extraction jsonb, p_response_id text, p_usage jsonb) returns boolean
language plpgsql security definer set search_path to 'public' as $function$
declare v_job public.enrollment_document_extraction_jobs; v_doc public.enrollment_application_documents;
 v_extraction jsonb; v_status text; candidate record; current_values jsonb;
begin
 select * into v_job from public.enrollment_document_extraction_jobs where id=p_job for update;
 if not found or (p_tenant is null or v_job.tenant_id is distinct from p_tenant or not exists(select 1 from public.tenants where id=p_tenant and status='active')) or v_job.state<>'processing' or v_job.lease_token is distinct from p_lease or p_lease is null
   or v_job.lease_expires_at is null or v_job.lease_expires_at<=clock_timestamp() then return false; end if;
 -- Match manual-review lock ordering: application before document.
 select status into v_status from public.enrollment_applications where id=v_job.application_id for update;
 select * into v_doc from public.enrollment_application_documents where id=v_job.document_id for update;
 if not found or not v_doc.is_current or v_doc.application_id<>v_job.application_id or v_doc.tenant_id is distinct from p_tenant or not exists(select 1 from public.enrollment_applications where id=v_job.application_id and tenant_id=p_tenant) then return false; end if;
 if jsonb_typeof(p_extraction->'extracted') is distinct from 'object' then raise exception 'invalid extraction fields'; end if;
 v_extraction:=coalesce(v_doc.metadata->'extraction','{}'::jsonb) || (p_extraction-'confirmed');
 v_extraction:=jsonb_set(v_extraction,'{confirmed}',coalesce(v_doc.metadata#>'{extraction,confirmed}','{}'::jsonb),true);
 if v_doc.metadata#>>'{extraction,status}'='confirmed' then
   v_extraction:=jsonb_set(v_extraction,'{status}','"confirmed"'::jsonb,true);
 end if;
 update public.enrollment_application_documents set metadata=v_doc.metadata || jsonb_build_object(
   'extraction',v_extraction,'extractedFields',(select coalesce(jsonb_agg(key),'[]'::jsonb) from jsonb_object_keys(p_extraction->'extracted') key))
 where id=v_doc.id;
 if v_status in ('draft','action_required') then
   current_values:=public.application_values(v_job.application_id);
   for candidate in select key,value#>>'{}' val from jsonb_each(p_extraction->'extracted') loop
    insert into public.enrollment_document_field_reviews(application_id,document_id,field_identifier,candidate_value,existing_value,final_value,state,source)
    values(v_doc.application_id,v_doc.id,candidate.key,candidate.val,current_values->>candidate.key,current_values->>candidate.key,
     case when lower(coalesce(current_values->>candidate.key,''))=lower(candidate.val) then 'corroborated' else 'conflict' end,coalesce(p_extraction->'source','{}'));
   end loop;
 end if;
 update public.enrollment_document_extraction_jobs set state='succeeded',lease_expires_at=null,lease_token=null,
   provider_response_id=p_response_id,usage=coalesce(p_usage,'{}'::jsonb),completed_at=now(),updated_at=now()
 where id=v_job.id;
 insert into public.enrollment_document_extraction_attempts(job_id,attempt_number,state,provider_response_id,usage,completed_at)
 values(v_job.id,v_job.attempt_count,'succeeded',p_response_id,coalesce(p_usage,'{}'::jsonb),now());
 return true;
end;
$function$;

-- A student added from the Add student / New application step starts their record's answers from what was typed.
create or replace function public.portal_student_save(p_student uuid, p_agent uuid, p_full_name text, p_email text, p_phone text,
 p_date_of_birth date default null, p_passport text default '', p_nationality text default '') returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare g public.agents; s public.enrollment_students; v_reused boolean := false; seed jsonb;
 v_name text := btrim(coalesce(p_full_name, '')); v_email text := lower(btrim(coalesce(p_email, ''))); v_phone text := btrim(coalesce(p_phone, ''));
 v_passport text := upper(regexp_replace(coalesce(p_passport, ''), '\s', '', 'g')); v_tenant uuid := public.tenant_current();
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
 select * into g from public.agents where id = p_agent;
 if not found then raise exception 'Agent not found' using errcode = 'P0002'; end if;
 if not public.portal_is_slit_admin() then
  if g.business_id is distinct from public.portal_agency_id() then raise exception 'This agent belongs to another business' using errcode = '42501'; end if;
  if not public.portal_is_agency_admin() and g.profile_id is distinct from public.portal_profile_id() then
   raise exception 'Agents can add only their own students' using errcode = '42501'; end if;
 end if;
 if v_email <> '' and (length(v_email) > 254 or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$') then raise exception 'Enter a valid email address' using errcode = '22023'; end if;
 if length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then raise exception 'Enter a valid name' using errcode = '22023'; end if;
 if length(v_phone) > 40 or length(v_passport) > 40 then raise exception 'Enter a valid phone number and passport number' using errcode = '22023'; end if;
 if p_student is not null then
  select * into s from public.enrollment_students where id = p_student for update;
  if not found then raise exception 'Student not found' using errcode = 'P0002'; end if;
  if s.agency_id <> g.business_id then raise exception 'This student belongs to another business' using errcode = '23514'; end if;
 else
  if v_passport <> '' and p_date_of_birth is not null then
   select * into s from public.enrollment_students where agency_id = g.business_id and passport_number = v_passport and date_of_birth = p_date_of_birth for update;
  end if;
  if s.id is null and v_email <> '' and p_date_of_birth is not null then
   select * into s from public.enrollment_students where agency_id = g.business_id and lower(coalesce(email, '')) = v_email and date_of_birth = p_date_of_birth for update;
  end if;
  v_reused := s.id is not null;
 end if;
 if s.id is null then
  if v_name = '' then raise exception 'Enter the student''s name' using errcode = '22023'; end if;
  insert into public.enrollment_students(agency_id, tenant_id, agent_id, full_name, email, phone, date_of_birth, passport_number, nationality, created_by)
  values (g.business_id, v_tenant, g.id, v_name, nullif(v_email, ''), nullif(v_phone, ''), p_date_of_birth, v_passport, btrim(coalesce(p_nationality, '')), public.portal_profile_id())
  returning * into s;
 else
  update public.enrollment_students set agent_id = g.id,
   full_name = coalesce(nullif(v_name, ''), full_name), email = coalesce(nullif(v_email, ''), email), phone = coalesce(nullif(v_phone, ''), phone),
   date_of_birth = coalesce(p_date_of_birth, date_of_birth), passport_number = coalesce(nullif(v_passport, ''), passport_number),
   nationality = coalesce(nullif(btrim(coalesce(p_nationality, '')), ''), nationality)
  where id = s.id returning * into s;
 end if;
 -- The typed details become the first answers on the form; a name is only split when the form has none yet.
 seed := jsonb_strip_nulls(jsonb_build_object('email', nullif(v_email, ''), 'confirm_email', nullif(v_email, ''), 'mobile', nullif(v_phone, ''),
  'dob', case when p_date_of_birth is null then null else to_char(p_date_of_birth, 'YYYY-MM-DD') end,
  'passport_number', nullif(v_passport, ''), 'nationality', nullif(btrim(coalesce(p_nationality, '')), '')));
 if v_name <> '' and not (coalesce(s.details, '{}'::jsonb) ? 'first_name') then
  seed := seed || jsonb_build_object('first_name', case when position(' ' in v_name) > 0 then regexp_replace(v_name, '\s+\S+$', '') else v_name end,
   'last_name', case when position(' ' in v_name) > 0 then substring(v_name from '\S+$') else '' end);
 end if;
 update public.enrollment_students set details = coalesce(details, '{}'::jsonb) || seed where id = s.id;
 return jsonb_build_object('id', s.id, 'name', s.full_name, 'email', coalesce(s.email, ''), 'phone', coalesce(s.phone, ''), 'businessId', s.agency_id, 'agentId', s.agent_id, 'reused', v_reused);
exception when unique_violation then
 raise exception 'Another student of this business already has this passport number or email with the same date of birth' using errcode = '23505';
end $fn$;
