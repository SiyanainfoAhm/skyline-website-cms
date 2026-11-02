-- Migration 111: operations the guest-documents Edge Function (service role) performs for ONE guest link. Additive; local only until released.
-- Each function re-checks that the link is live (not revoked, not expired) and that the target belongs to the link's application, so a leaked
-- document id from another application is inert. None is callable by anon or authenticated users.
-- Rollback (manual): drop the three functions.
begin;

-- Same job as portal_enqueue_document_job (migration 108) without an agent session; review_only = false, so values merge into the draft.
create function public.guest_enqueue_document_job(p_link uuid, p_document uuid, p_reextract boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.guest_document_links; d public.enrollment_application_documents; j public.enrollment_document_extraction_jobs;
begin
  select * into l from public.guest_document_links where id = p_link and revoked_at is null and expires_at > now() and completed_at is null;
  select * into d from public.enrollment_application_documents where id = p_document and application_id = l.application_id for update;
  if l.id is null or d.id is null or d.guest_link_id is distinct from l.id or not d.is_current
     or d.category not in ('Passport','Driving Licence','Visa','English Test','Academic','Health Insurance')
     or not exists (select 1 from public.enrollment_applications a where a.id = d.application_id and a.status in ('draft','action_required')) then
    raise exception 'Document not available' using errcode = '42501'; end if;
  if p_reextract then update public.enrollment_document_extraction_jobs set state='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
    where document_id = d.id and state in ('queued','processing'); end if;
  select * into j from public.enrollment_document_extraction_jobs where document_id = d.id and state in ('queued','processing') limit 1;
  if not found then
    insert into public.enrollment_document_extraction_jobs(document_id,application_id,content_sha256,state,next_attempt_at,review_only)
    values (d.id,d.application_id,d.metadata->>'contentSha256','queued',now(),false) returning * into j;
  end if;
  update public.enrollment_application_documents set metadata = jsonb_set(metadata,'{extraction}',
    coalesce(metadata->'extraction','{}') || jsonb_build_object('status', j.state), true) where id = d.id;
  return jsonb_build_object('id', j.id, 'state', j.state, 'tenant_id', j.tenant_id);
end; $$;

-- Student edits: fill only EMPTY fields (provenance 'student_entered'); a differing existing value is never overwritten and is logged as a
-- 'conflict' suggestion for the agent, exactly as document candidates are. p_fields is limited to the extraction field names by the caller.
create function public.guest_apply_fields(p_link uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.guest_document_links; v_data jsonb; v_values jsonb; v_prov jsonb; v_key text; v_value text; v_existing text; v_state text; v_result jsonb := '{}'::jsonb;
begin
  select * into l from public.guest_document_links where id = p_link and revoked_at is null and expires_at > now() and completed_at is null;
  if l.id is null then raise exception 'Link is not valid' using errcode = '42501'; end if;
  select data into v_data from public.enrollment_applications where id = l.application_id and status in ('draft','action_required') for update;
  if not found then raise exception 'Link is not valid' using errcode = '42501'; end if;
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
end; $$;

-- Student finished: close the link to further changes and notify the assigned agent (or, if none, the agent who made the link) in the portal.
create function public.guest_complete(p_link uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.guest_document_links; a public.enrollment_applications; v_ref text; v_to uuid;
begin
  update public.guest_document_links set completed_at = now() where id = p_link and revoked_at is null and expires_at > now() and completed_at is null returning * into l;
  if l.id is null then raise exception 'Link is not valid' using errcode = '42501'; end if;
  select * into a from public.enrollment_applications where id = l.application_id;
  v_ref := coalesce(nullif(a.reference,''), left(a.id::text,8));
  select p.auth_user_id into v_to from public.portal_profiles p where p.id = a.assigned_agent_id and p.status = 'Active';
  v_to := coalesce(v_to, l.created_by);
  insert into public.portal_notifications(recipient, application_id, reference, event, title, message)
  values (v_to, a.id, v_ref, 'student_documents_submitted', 'Student finished adding documents for ' || v_ref, 'The student finished adding documents through the private link. Review them in the Documents tab.');
end; $$;

revoke all on function public.guest_enqueue_document_job(uuid, uuid, boolean), public.guest_apply_fields(uuid, jsonb), public.guest_complete(uuid) from public, anon, authenticated, service_role;

grant execute on function public.guest_enqueue_document_job(uuid, uuid, boolean), public.guest_apply_fields(uuid, jsonb), public.guest_complete(uuid) to service_role;

commit;
