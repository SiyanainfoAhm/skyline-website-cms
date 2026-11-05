-- Migration 114: a draft can always be deleted with everything tied to it, including after the student finished the guest link. Additive; local only.
-- Replaces portal_delete_draft_prepare and portal_delete_draft_application from migration 112 (which is left untouched):
--   * the "student has submitted documents" refusal is gone; only status 'draft' (and no submission receipt) can be deleted;
--   * another agent's draft is still refused as not authorised (checked before the status, so a submitted record says why but a stranger learns nothing);
--   * a non-draft says: "Only drafts can be deleted. Submitted applications are kept as records.";
--   * prepare also returns each document's filename, so a failed file removal can name the files;
--   * earlier audit rows that point at the application (document views, admin access) are kept and unlinked, because their foreign key would block the delete;
--   * the audit row for the deletion is unchanged: actor, time, application number, document count; no personal data, no file names.
-- portal_draft_delete_info feeds the confirm dialog: per application the number, the document count and how many documents the student uploaded.
-- Rollback (manual): re-run the two functions from migration 112; drop portal_draft_delete_info.
begin;

create or replace function public.portal_delete_draft_prepare(p_application uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.enrollment_applications; v_docs jsonb;
begin
  select * into a from public.enrollment_applications where id = p_application for update;
  if auth.uid() is null or not found or not public.portal_can_access_application(p_application) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if a.status <> 'draft' or exists (select 1 from public.admission_submission_receipts where application_id = a.id) then
    raise exception 'Only drafts can be deleted. Submitted applications are kept as records.' using errcode = '55000'; end if;
  if not public.portal_can_edit_application(p_application) then raise exception 'Not authorized' using errcode = '42501'; end if;
  update public.guest_document_links set revoked_at = now() where application_id = a.id and revoked_at is null;
  update public.enrollment_document_extraction_jobs set state = 'cancelled', lease_token = null, lease_expires_at = null, updated_at = now()
    where application_id = a.id and state in ('queued', 'processing');
  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_name, 'path', storage_path, 'filename', filename)), '[]'::jsonb) into v_docs from public.enrollment_application_documents where application_id = a.id;
  return jsonb_build_object('reference', coalesce(nullif(a.reference, ''), left(a.id::text, 8)), 'documents', v_docs, 'count', jsonb_array_length(v_docs));
end; $$;

create or replace function public.portal_delete_draft_application(p_application uuid, p_expected_documents integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.enrollment_applications; v_count integer; v_ref text; v_name text; v_role text;
begin
  select * into a from public.enrollment_applications where id = p_application for update;
  if auth.uid() is null or not found or not public.portal_can_access_application(p_application) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if a.status <> 'draft' or exists (select 1 from public.admission_submission_receipts where application_id = a.id) then
    raise exception 'Only drafts can be deleted. Submitted applications are kept as records.' using errcode = '55000'; end if;
  if not public.portal_can_edit_application(p_application) then raise exception 'Not authorized' using errcode = '42501'; end if;
  select count(*) into v_count from public.enrollment_application_documents where application_id = a.id;
  if v_count is distinct from p_expected_documents then raise exception 'Documents changed while deleting; try again' using errcode = 'PT409'; end if;
  v_ref := coalesce(nullif(a.reference, ''), left(a.id::text, 8));
  -- Link emails (sent, pending or suppressed) and their provider records, then the outbox rows that point at the application.
  delete from public.guest_link_sends where application_id = a.id;
  delete from public.notification_provider_events where delivery_id in (select id from public.notification_deliveries where application_id = a.id);
  delete from public.notification_delivery_attempts where delivery_id in (select id from public.notification_deliveries where application_id = a.id);
  delete from public.notification_deliveries where application_id = a.id;
  delete from public.admission_event_outbox where application_id = a.id;
  -- Earlier audit entries about this application stay as history; only their link to the (now deleted) row is cut.
  update public.portal_audit_log set application_id = null where application_id = a.id;
  select coalesce(nullif(btrim(full_name), ''), 'User') into v_name from public.portal_profiles where auth_user_id = auth.uid();
  v_role := case when public.portal_is_slit_admin() then 'slit_admin' when public.portal_is_agency_admin() then 'agency_admin' else 'agent' end;
  insert into public.portal_audit_log(actor, actor_name, actor_role, action, target_type, target_id, agency_id, application_id, detail, tenant_id)
  values (auth.uid(), coalesce(v_name, 'User'), v_role, 'draft_deleted', 'application', v_ref, a.agency_id, null, jsonb_build_object('reference', v_ref, 'documents', v_count), a.tenant_id);
  -- Documents, field reviews (suggestions), extraction jobs, guest links and consents, notifications, messages, requests, versions and history cascade.
  delete from public.enrollment_applications where id = a.id;
  return jsonb_build_object('reference', v_ref, 'documents', v_count);
end; $$;

create function public.portal_draft_delete_info(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(a.id::text, jsonb_build_object(
      'reference', coalesce(nullif(a.reference, ''), left(a.id::text, 8)),
      'documents', (select count(*) from public.enrollment_application_documents d where d.application_id = a.id),
      'studentDocuments', (select count(*) from public.enrollment_application_documents d where d.application_id = a.id and d.guest_link_id is not null)))
    from public.enrollment_applications a where a.id = any (p_ids[1:50]) and public.portal_can_access_application(a.id)), '{}'::jsonb);
end; $$;

revoke all on function public.portal_draft_delete_info(uuid[]) from public, anon, authenticated, service_role;

grant execute on function public.portal_draft_delete_info(uuid[]) to authenticated;

commit;
