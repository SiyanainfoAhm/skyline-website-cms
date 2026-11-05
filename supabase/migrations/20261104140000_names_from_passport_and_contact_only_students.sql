-- 1. The student's name (title, given, middle, surname) comes only from the passport. Another document (licence, visa,
--    English test, transcript) never fills it, and a passport read replaces a name that did not come from a passport.
--    A driving licence fills only its own fields and the Australian address.
-- 2. A new student needs only an email and a mobile; the name is read from the passport. A student of the business
--    with the same email or mobile is that student (no second record, details not collected again).
-- 3. Names already filled from a non-passport document are reset from the passport read on file, if any.
set local lock_timeout='5s';
set local statement_timeout='120s';

create function public.is_name_field(p_key text) returns boolean
language sql immutable parallel safe as $fn$ select p_key in ('title','first_name','middle_name','last_name'); $fn$;

-- What a document of a category may fill. Everything not listed keeps today's behaviour.
create function public.document_may_fill(p_category text, p_key text) returns boolean
language sql immutable parallel safe as $fn$
 select case
  when public.is_name_field(p_key) then p_category = 'Passport'
  when p_category = 'Driving Licence' then p_key like any (array['licence\_%','au\_%','address\_%'])
  else true end;
$fn$;

create or replace function public.portal_apply_document_candidates(p_document_id uuid, p_fields jsonb, p_source jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_document record; v_pcat text; v_pcur boolean; v_pat timestamptz; v_data jsonb; v_values jsonb; v_provenance jsonb; v_quals jsonb; v_entry jsonb;
  v_key text; v_value text; v_existing text; v_state text; v_result jsonb := '{}'::jsonb;
  v_prior uuid; v_last text; v_replace boolean; v_dup bigint; v_prior_cat text;
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
    if not public.document_may_fill(v_document.category, v_key) then continue; end if;
    v_existing := nullif(btrim(v_values->>v_key), '');
    if v_existing is null then
      v_values := jsonb_set(v_values, array[v_key], to_jsonb(v_value), true);
      v_provenance := jsonb_set(v_provenance, array[v_key], jsonb_build_object('kind','ai_unverified','documentId',p_document_id,'updatedAt',now()), true);
      v_state := 'auto_applied';
    elsif lower(v_existing) = lower(v_value) then v_state := 'corroborated';
    elsif v_key like 'academic\_%' then continue; -- further qualifications go to the list below
    else
      v_replace := false;
      if public.is_name_field(v_key) then
        -- The passport is the source of the name: it replaces a name typed earlier or read from another document,
        -- but not one a person corrected by hand.
        v_prior_cat := null;
        if v_provenance->v_key->>'documentId' ~* '^[0-9a-f-]{36}$' then
          select d.category into v_prior_cat from public.enrollment_application_documents d where d.id = (v_provenance->v_key->>'documentId')::uuid;
        end if;
        v_replace := (coalesce(v_provenance->v_key->>'kind', '') not in ('manual','manual_entry','agent_edited','edited') and coalesce(v_prior_cat, '') <> 'Passport')
          or (v_prior_cat = 'Passport' and v_provenance->v_key->>'kind' = 'ai_unverified');
      elsif v_provenance->v_key->>'kind' = 'ai_unverified' and v_provenance->v_key->>'documentId' ~* '^[0-9a-f-]{36}$' then
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

  -- A passport without a middle name clears one that another document put there.
  if v_document.category = 'Passport' and nullif(btrim(coalesce(p_fields->>'middle_name', '')), '') is null and nullif(btrim(coalesce(p_fields->>'first_name', '')), '') is not null
     and v_provenance->'middle_name'->>'documentId' ~* '^[0-9a-f-]{36}$'
     and exists (select 1 from public.enrollment_application_documents d where d.id = (v_provenance->'middle_name'->>'documentId')::uuid and d.category <> 'Passport') then
    v_values := v_values - 'middle_name'; v_provenance := v_provenance - 'middle_name';
    update public.enrollment_students s set details = s.details - 'middle_name'
     where s.id = (select student_id from public.enrollment_applications where id = v_document.application_id);
  end if;

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

-- A new student: email and mobile are enough. Same email, mobile or passport within the business is the same student.
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
  if v_email = '' or v_phone = '' then raise exception 'Enter the student''s email and mobile' using errcode = '22023'; end if;
  select * into s from public.enrollment_students x where x.agency_id = g.business_id
   and (lower(coalesce(x.email, '')) = v_email or coalesce(x.phone, '') = v_phone or (v_passport <> '' and x.passport_number = v_passport))
   order by (lower(coalesce(x.email, '')) = v_email) desc, x.updated_at desc limit 1 for update;
  v_reused := s.id is not null;
 end if;
 if s.id is null then
  insert into public.enrollment_students(agency_id, tenant_id, agent_id, full_name, email, phone, date_of_birth, passport_number, nationality, created_by)
  values (g.business_id, v_tenant, g.id, v_name, nullif(v_email, ''), nullif(v_phone, ''), p_date_of_birth, v_passport, btrim(coalesce(p_nationality, '')), public.portal_profile_id())
  returning * into s;
  -- Contact details start the form; the name and everything else come from the passport.
  seed := jsonb_strip_nulls(jsonb_build_object('email', nullif(v_email, ''), 'confirm_email', nullif(v_email, ''), 'mobile', nullif(v_phone, '')));
  update public.enrollment_students set details = coalesce(details, '{}'::jsonb) || seed where id = s.id;
 end if;
 -- An existing student is used as they are: nothing typed here overwrites their record.
 return jsonb_build_object('id', s.id, 'name', s.full_name, 'email', coalesce(s.email, ''), 'phone', coalesce(s.phone, ''), 'businessId', s.agency_id, 'agentId', s.agent_id, 'reused', v_reused);
exception when unique_violation then
 raise exception 'Another student of this business already has this passport number or email with the same date of birth' using errcode = '23505';
end $fn$;

-- Existing names: where a passport read is on file, the student's name is reset to it (a middle name that the
-- passport does not have is removed); the title is kept when the passport read has none.
do $do$ declare r record; ex jsonb; d jsonb; begin
 for r in
  select distinct on (e.student_id) e.student_id, doc.metadata #> '{extraction,extracted}' as extracted
  from public.enrollment_application_documents doc join public.enrollment_applications e on e.id = doc.application_id
  where doc.category = 'Passport' and doc.is_current and e.student_id is not null
   and jsonb_typeof(doc.metadata #> '{extraction,extracted}') = 'object'
   and nullif(btrim(coalesce(doc.metadata #>> '{extraction,extracted,first_name}', '')), '') is not null
  order by e.student_id, doc.created_at desc
 loop
  ex := r.extracted;
  select details into d from public.enrollment_students where id = r.student_id;
  d := (d - 'middle_name') || jsonb_strip_nulls(jsonb_build_object(
   'title', nullif(btrim(coalesce(ex->>'title', '')), ''),
   'first_name', nullif(btrim(coalesce(ex->>'first_name', '')), ''),
   'middle_name', nullif(btrim(coalesce(ex->>'middle_name', '')), ''),
   'last_name', nullif(btrim(coalesce(ex->>'last_name', '')), '')));
  update public.enrollment_students set details = d,
   full_name = coalesce(nullif(btrim(concat_ws(' ', d ->> 'first_name', d ->> 'last_name')), ''), full_name)
  where id = r.student_id;
 end loop;
end $do$;
