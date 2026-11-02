-- Migration 104: Credit Evidence documents (RPL / credit transfer supporting files). Additive; local only until released.
-- The category needs no new table, column or policy: enrollment_application_documents.category is free text, uploads, deletes and the
-- Documents list already work for any category, and Credit Evidence is storage only (the extraction whitelist in portal_enqueue_document_job
-- is deliberately left alone, so no extraction job can be queued for it). The one database change is the lease-checked read the notification
-- worker uses for the submission PDF: its list of documents (filename and signed link) now leaves Credit Evidence out unless the submitted
-- application answered RPL / credit transfer with Yes. Files stay stored and visible in the portal when the answer is No.
-- Rollback (manual): restore notification_delivery_submission from migration 102 (20261028160000_submission_pdf_branding.sql).
begin;

create or replace function public.notification_delivery_submission(p_id uuid, p_lease uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d public.notification_deliveries; o public.admission_event_outbox; a public.enrollment_applications; v_mode text; v_version integer; v_snapshot jsonb; v_created timestamptz; v_host text; v_site jsonb; v_kind text;
begin
  select * into d from public.notification_deliveries x where x.id = p_id and x.lease_token = p_lease and x.state = 'sending' and x.event = 'application_submitted';
  if not found then return null; end if;
  select * into o from public.admission_event_outbox where id = d.outbox_id;
  select * into a from public.enrollment_applications where id = d.application_id;
  -- Who this copy is for: portal users have recipient_user; otherwise the address is the student's (case-insensitive, trimmed) or an internal one.
  v_kind := case when d.recipient_user is not null then 'portal'
    when nullif(lower(btrim(coalesce(a.student_email, ''))), '') is not null and lower(btrim(d.recipient_email)) = lower(btrim(a.student_email)) then 'student'
    else 'internal' end;
  v_mode := coalesce((select s.submission_pdf from public.notification_attachment_settings s where s.tenant_id is not distinct from d.tenant_id), 'attach');
  v_version := coalesce(case when (o.payload->>'version') ~ '^[0-9]{1,9}$' then (o.payload->>'version')::integer end,
    (select max(v.version) from public.enrollment_application_versions v where v.application_id = d.application_id));
  select v.snapshot, v.created_at into v_snapshot, v_created from public.enrollment_application_versions v where v.application_id = d.application_id and v.version = v_version;
  v_host := case when d.tenant_id is null then 'slit.edu.au'
    else (select min(t.hostname) from public.tenant_domains t where t.tenant_id = d.tenant_id and t.verified_at is not null) end;
  select to_jsonb(c) into v_site from public.cms_settings c where c.tenant_id is not distinct from d.tenant_id order by c.id limit 1;
  return jsonb_build_object(
    'mode', v_mode,
    -- By recipient: portal users open the agency portal, internal addresses (CMS staff) open the CMS, the student gets no link.
    'link', case when v_host is null or v_kind = 'student' then '' else 'https://' || v_host || case when v_kind = 'portal' then '/agency/applications/' else '/admin/applications/' end || d.application_id::text end,
    'recipientKind', v_kind,
    'host', v_host,
    'applicationId', d.application_id,
    'tenantId', d.tenant_id,
    'reference', coalesce(nullif(a.reference, ''), left(a.id::text, 8)),
    'version', coalesce(v_version, 0),
    'institution', coalesce(nullif(v_site->>'name', ''), (select t.name from public.tenants t where t.id = d.tenant_id), 'Skyline Institute of Technology'),
    'submittedAt', v_created,
    'branding', jsonb_build_object('logo', coalesce(v_site->>'logo', ''), 'primaryColor', case when coalesce((v_site->>'theme_configured')::boolean, false) then v_site->>'primary_color' end, 'timezone', v_site->>'timezone'),
    'documents', case when v_mode = 'attach' then coalesce((select jsonb_agg(jsonb_build_object('category', x.category, 'filename', x.filename, 'bucket', case when v_kind = 'student' then '' else x.bucket_name end, 'path', case when v_kind = 'student' then '' else x.storage_path end) order by x.created_at)
      from public.enrollment_application_documents x where x.application_id = d.application_id and x.is_current
        and (x.category <> 'Credit Evidence' or coalesce(v_snapshot->'values'->>'rpl', '') = 'Yes')), '[]'::jsonb) else '[]'::jsonb end,
    'snapshot', case when v_mode = 'attach' then v_snapshot else null end);
end;
$$;

revoke all on function public.notification_delivery_submission(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.notification_delivery_submission(uuid, uuid) to service_role;

commit;
