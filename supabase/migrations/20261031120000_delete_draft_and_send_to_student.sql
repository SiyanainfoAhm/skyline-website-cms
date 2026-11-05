-- Migration 112: delete a draft application with its documents, and create a draft for a student in one call. Additive; local only until released.
-- Delete is two steps so a storage failure never orphans files: portal_delete_draft_prepare (checks, revokes guest links, cancels extraction
-- jobs, lists the storage objects) -> the Edge Function removes the objects with the service role -> portal_delete_draft_application (re-checks that
-- the documents are unchanged, removes the link-email records, writes one audit row, deletes the application; everything else cascades).
-- The audit row holds the application number and a document count only (application_id is null so the row survives the delete).
-- Also replaces portal_query_applications with one extra defaulted parameter (p_stale_days) and a live_link flag per row; student suggestions can be read and resolved by the agent.
-- Rollback (manual): drop the new functions; re-create portal_query_applications from 20261025160406.
begin;

create function public.portal_delete_draft_prepare(p_application uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.enrollment_applications; v_docs jsonb;
begin
  select * into a from public.enrollment_applications where id = p_application for update;
  if auth.uid() is null or not found or not public.portal_can_edit_application(p_application) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if a.status <> 'draft' then raise exception 'Only a draft can be deleted' using errcode = '55000'; end if;
  if exists (select 1 from public.guest_document_links where application_id = a.id and completed_at is not null) then
    raise exception 'The student has submitted documents; withdraw instead' using errcode = '55000'; end if;
  if exists (select 1 from public.admission_submission_receipts where application_id = a.id) then raise exception 'Only a draft can be deleted' using errcode = '55000'; end if;
  update public.guest_document_links set revoked_at = now() where application_id = a.id and revoked_at is null;
  update public.enrollment_document_extraction_jobs set state = 'cancelled', lease_token = null, lease_expires_at = null, updated_at = now()
    where application_id = a.id and state in ('queued', 'processing');
  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_name, 'path', storage_path)), '[]'::jsonb) into v_docs from public.enrollment_application_documents where application_id = a.id;
  return jsonb_build_object('reference', coalesce(nullif(a.reference, ''), left(a.id::text, 8)), 'documents', v_docs, 'count', jsonb_array_length(v_docs));
end; $$;

create function public.portal_delete_draft_application(p_application uuid, p_expected_documents integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.enrollment_applications; v_count integer; v_ref text; v_name text; v_role text;
begin
  select * into a from public.enrollment_applications where id = p_application for update;
  if auth.uid() is null or not found or not public.portal_can_edit_application(p_application) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if a.status <> 'draft' then raise exception 'Only a draft can be deleted' using errcode = '55000'; end if;
  if exists (select 1 from public.guest_document_links where application_id = a.id and completed_at is not null) then
    raise exception 'The student has submitted documents; withdraw instead' using errcode = '55000'; end if;
  if exists (select 1 from public.admission_submission_receipts where application_id = a.id) then raise exception 'Only a draft can be deleted' using errcode = '55000'; end if;
  select count(*) into v_count from public.enrollment_application_documents where application_id = a.id;
  if v_count is distinct from p_expected_documents then raise exception 'Documents changed while deleting; try again' using errcode = 'PT409'; end if;
  v_ref := coalesce(nullif(a.reference, ''), left(a.id::text, 8));
  -- Link emails (sent, pending or suppressed) and their provider records, then the outbox rows that point at the application.
  delete from public.guest_link_sends where application_id = a.id;
  delete from public.notification_provider_events where delivery_id in (select id from public.notification_deliveries where application_id = a.id);
  delete from public.notification_delivery_attempts where delivery_id in (select id from public.notification_deliveries where application_id = a.id);
  delete from public.notification_deliveries where application_id = a.id;
  delete from public.admission_event_outbox where application_id = a.id;
  select coalesce(nullif(btrim(full_name), ''), 'User') into v_name from public.portal_profiles where auth_user_id = auth.uid();
  v_role := case when public.portal_is_slit_admin() then 'slit_admin' when public.portal_is_agency_admin() then 'agency_admin' else 'agent' end;
  insert into public.portal_audit_log(actor, actor_name, actor_role, action, target_type, target_id, agency_id, application_id, detail, tenant_id)
  values (auth.uid(), coalesce(v_name, 'User'), v_role, 'draft_deleted', 'application', v_ref, a.agency_id, null, jsonb_build_object('reference', v_ref, 'documents', v_count), a.tenant_id);
  delete from public.enrollment_applications where id = a.id;
  return jsonb_build_object('reference', v_ref, 'documents', v_count);
end; $$;

-- Applications this caller can open that already use the email (the "Open existing" prompt): reference, status, the agent's name and the created date only.
create function public.portal_find_student_duplicates(p_email text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'reference', coalesce(nullif(a.reference, ''), left(a.id::text, 8)), 'status', a.status,
      'agentName', coalesce((select p.full_name from public.portal_profiles p where p.id = a.assigned_agent_id), ''), 'createdAt', a.created_at) order by a.updated_at desc)
    from public.enrollment_applications a where lower(btrim(a.student_email)) = lower(btrim(coalesce(p_email, ''))) and public.portal_can_access_application(a.id)), '[]'::jsonb);
end; $$;

-- Document counts for the delete confirmation (only applications the caller may open).
create function public.portal_draft_document_counts(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(a.id::text, (select count(*) from public.enrollment_application_documents d where d.application_id = a.id))
    from public.enrollment_applications a where a.id = any (p_ids[1:50]) and public.portal_can_access_application(a.id)), '{}'::jsonb);
end; $$;

-- Application list: adds "no activity for N days" (p_stale_days > 0). Activity is the later of the last edit and the last time the student's link was used
-- (opening it or uploading through it); a draft with a live unsubmitted student link is never listed as stale, and every row says whether it has one.
drop function public.portal_query_applications(text, text, uuid, uuid, text, text, text, text, integer, integer);

create function public.portal_query_applications(p_search text default '', p_status text default '', p_agency uuid default null, p_agent uuid default null,
  p_course text default '', p_intake text default '', p_sort text default 'updated', p_direction text default 'desc', p_limit integer default 25, p_offset integer default 0,
  p_stale_days integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb; sort_column text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  sort_column := case p_sort when 'reference' then 'reference' when 'student' then 'student_name' when 'agency' then 'agency_name' when 'agent' then 'agent_name' when 'status' then 'status' when 'completion' then 'completion' when 'created' then 'created_at' else 'updated_at' end;
  if p_direction not in ('asc', 'desc') or p_limit not between 1 and 100 or p_offset < 0 or length(p_search) > 200 or p_stale_days not between 0 and 3650 then raise exception 'Invalid page request' using errcode = '22023'; end if;
  execute format($query$
  with filtered as materialized (
    select a.id,a.reference,a.status,a.student_name,a.student_email,a.intake,a.completion,a.agency_id,a.assigned_agent_id,
    a.created_at,a.updated_at,a.submitted_at,a.is_test,coalesce(g.name,'') agency_name,coalesce(p.full_name,'') agent_name,
    (select coalesce(jsonb_agg(jsonb_build_object('courseId',c.course_id,'code',c.course_code,'title',c.course_title,'variant',c.variant)),'[]') from public.enrollment_application_courses c where c.application_id=a.id) courses,
    exists(select 1 from public.guest_document_links l where l.application_id=a.id and l.revoked_at is null and l.completed_at is null and l.expires_at>now()) live_link
    from public.portal_scoped_applications() a left join public.agencies g on g.id=a.agency_id left join public.portal_profiles p on p.id=a.assigned_agent_id
    where ($1='' or position(lower($1) in lower(concat_ws(' ',a.student_name,a.student_email,a.reference)))>0)
    and ($2='' or a.status=$2) and ($3 is null or a.agency_id=$3) and ($4 is null or a.assigned_agent_id=$4)
    and ($5='' or exists(select 1 from public.enrollment_application_courses c where c.application_id=a.id and c.course_code=$5))
    and ($6='' or position(lower($6) in lower(a.intake))>0)
    and ($9=0 or (a.status='draft'
      and greatest(a.updated_at, coalesce((select max(l.last_used_at) from public.guest_document_links l where l.application_id=a.id), a.updated_at)) < now()-make_interval(days=>$9)
      and not exists(select 1 from public.guest_document_links l where l.application_id=a.id and l.revoked_at is null and l.completed_at is null and l.expires_at>now())))
  ), page as (select * from filtered order by %I %s,id asc limit $7 offset $8)
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'))
  $query$, sort_column, p_direction) into result using p_search, p_status, p_agency, p_agent, p_course, p_intake, p_limit, p_offset, p_stale_days;
  return result;
end; $$;

-- Changes the student made to values the agent had already entered. They are suggestions: nothing was overwritten (guest_apply_fields).
create function public.portal_student_suggestions(p_application uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.portal_can_access_application(p_application) then raise exception 'Not authorized' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('field', r.field_identifier, 'current', r.existing_value, 'suggested', r.candidate_value, 'at', r.created_at) order by r.created_at)
    from public.enrollment_document_field_reviews r where r.application_id = p_application and r.state = 'conflict' and r.source->>'kind' = 'student'), '[]'::jsonb);
end; $$;

create function public.portal_resolve_student_suggestion(p_application uuid, p_field text, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a public.enrollment_applications; r public.enrollment_document_field_reviews; d jsonb;
begin
  select * into a from public.enrollment_applications where id = p_application for update;
  if auth.uid() is null or not found or not public.portal_can_edit_application(p_application) or a.status not in ('draft', 'action_required') then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into r from public.enrollment_document_field_reviews where application_id = a.id and field_identifier = p_field and state = 'conflict' and source->>'kind' = 'student' order by created_at desc limit 1;
  if not found then raise exception 'No suggestion to resolve' using errcode = '22023'; end if;
  if p_accept then
    perform set_config('portal.draft_command', a.id::text, true);
    d := jsonb_set(coalesce(a.data, '{}'::jsonb), '{values}', coalesce(a.data->'values', '{}'::jsonb) || jsonb_build_object(p_field, r.candidate_value));
    d := jsonb_set(d, '{fieldProvenance}', coalesce(d->'fieldProvenance', '{}'::jsonb) || jsonb_build_object(p_field, jsonb_build_object('kind', 'student_entered', 'updatedAt', now())));
    update public.enrollment_applications set data = d, updated_at = clock_timestamp() where id = a.id;
  end if;
  update public.enrollment_document_field_reviews set state = case when p_accept then 'confirmed' else 'rejected' end, reviewed_at = now(), final_value = case when p_accept then r.candidate_value else r.existing_value end
    where application_id = a.id and field_identifier = p_field and state = 'conflict' and source->>'kind' = 'student';
end; $$;

-- One call: validate -> draft (contact saved) -> guest link -> queue the student_document_link email (migration 110 gates and limits apply).
-- A failed or suppressed email never undoes the draft or the link; the caller gets the token to copy and an emailError / delivery state.
create function public.portal_send_to_student(p_client_key text, p_email text, p_mobile text, p_name text, p_host text, p_allow_duplicate boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_email, ''))); v_mobile text := regexp_replace(btrim(coalesce(p_mobile, '')), '[\s()-]', '', 'g'); v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_first text; v_last text; v_app record; v_ver bigint; v_values jsonb; v_link jsonb; v_send jsonb; v_error text;
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if v_email = '' or length(v_email) > 254 or v_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' then
    raise exception 'Invalid email address' using errcode = '22023'; end if;
  if v_mobile !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Invalid mobile number' using errcode = '22023'; end if;
  if length(v_name) > 120 or v_name ~ '[\u0000-\u001f<>]' then raise exception 'Invalid name' using errcode = '22023'; end if;
  if not public.guest_rate_hit('create:' || auth.uid()::text, 20, 3600) then raise exception 'Too many applications created. Try again later.' using errcode = '54000'; end if;
  if not coalesce(p_allow_duplicate, false) and exists (select 1 from public.enrollment_applications a where lower(btrim(a.student_email)) = v_email and public.portal_can_access_application(a.id)) then
    raise exception 'An application for this email already exists' using errcode = '23505'; end if;

  select * into v_app from public.portal_create_application(p_client_key, null, null);
  select draft_version into v_ver from public.enrollment_applications where id = v_app.application_id;
  if v_name <> '' then
    v_first := case when position(' ' in v_name) > 0 then regexp_replace(v_name, '\s+\S+$', '') else v_name end;
    v_last := case when position(' ' in v_name) > 0 then substring(v_name from '\S+$') else '' end;
  end if;
  v_values := jsonb_build_object('mobile', v_mobile, 'email', v_email, 'confirm_email', v_email)
    || case when coalesce(v_first, '') <> '' then jsonb_build_object('first_name', v_first) else '{}'::jsonb end
    || case when coalesce(v_last, '') <> '' then jsonb_build_object('last_name', v_last) else '{}'::jsonb end;
  perform public.portal_save_draft_v2(v_app.application_id, v_ver, jsonb_build_object('values', v_values));

  v_link := public.portal_create_guest_link(v_app.application_id, 7);
  begin
    v_send := public.portal_send_guest_link_email((v_link->>'id')::uuid, v_link->>'token', v_email, p_host);
  exception when others then
    v_error := case sqlstate when '54000' then 'rate_limited' when '22023' then 'invalid_address_or_site' else 'failed' end;
  end;
  return jsonb_build_object('applicationId', v_app.application_id, 'reference', v_app.application_reference, 'linkId', v_link->>'id', 'token', v_link->>'token',
    'emailError', v_error, 'delivery', v_send->>'delivery', 'recipient', v_send->>'recipient', 'sentAt', v_send->>'sentAt');
end; $$;

revoke all on function public.portal_delete_draft_prepare(uuid), public.portal_delete_draft_application(uuid, integer), public.portal_find_student_duplicates(text),
  public.portal_send_to_student(text, text, text, text, text, boolean), public.portal_draft_document_counts(uuid[]),
  public.portal_query_applications(text, text, uuid, uuid, text, text, text, text, integer, integer, integer), public.portal_student_suggestions(uuid), public.portal_resolve_student_suggestion(uuid, text, boolean) from public, anon, authenticated, service_role;

grant execute on function public.portal_delete_draft_prepare(uuid), public.portal_delete_draft_application(uuid, integer), public.portal_find_student_duplicates(text),
  public.portal_send_to_student(text, text, text, text, text, boolean), public.portal_draft_document_counts(uuid[]),
  public.portal_query_applications(text, text, uuid, uuid, text, text, text, text, integer, integer, integer), public.portal_student_suggestions(uuid), public.portal_resolve_student_suggestion(uuid, text, boolean) to authenticated;

commit;
