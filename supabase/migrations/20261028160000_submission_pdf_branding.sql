-- Migration 102: branded submission PDF. Additive; local only until released.
-- Website Settings gain a timezone (default Australia/Sydney) used for the submitted date in the PDF. The lease-checked read the notification
-- worker uses now also returns the application id, the tenant id, the tenant's branding (name, logo, primary colour, timezone) and the
-- application's current documents (category, file name, bucket, path) so the worker can embed the logo and sign document links. Same access rules
-- as before: service role only, only for a delivery that is currently claimed (state sending, matching lease), only for application_submitted.
-- Rollback (manual): restore notification_delivery_submission from migration 93; alter table public.cms_settings drop column timezone.
begin;

alter table public.cms_settings add column if not exists timezone text not null default 'Australia/Sydney'
  check (length(timezone) between 3 and 64 and timezone ~ '^[A-Za-z0-9_+/-]+$');

create or replace function public.notification_delivery_submission(p_id uuid, p_lease uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d public.notification_deliveries; o public.admission_event_outbox; a public.enrollment_applications; v_mode text; v_version integer; v_snapshot jsonb; v_created timestamptz; v_host text; v_site jsonb;
begin
  select * into d from public.notification_deliveries x where x.id = p_id and x.lease_token = p_lease and x.state = 'sending' and x.event = 'application_submitted';
  if not found then return null; end if;
  select * into o from public.admission_event_outbox where id = d.outbox_id;
  select * into a from public.enrollment_applications where id = d.application_id;
  v_mode := coalesce((select s.submission_pdf from public.notification_attachment_settings s where s.tenant_id is not distinct from d.tenant_id), 'attach');
  v_version := coalesce(case when (o.payload->>'version') ~ '^[0-9]{1,9}$' then (o.payload->>'version')::integer end,
    (select max(v.version) from public.enrollment_application_versions v where v.application_id = d.application_id));
  select v.snapshot, v.created_at into v_snapshot, v_created from public.enrollment_application_versions v where v.application_id = d.application_id and v.version = v_version;
  v_host := case when d.tenant_id is null then 'slit.edu.au'
    else (select min(t.hostname) from public.tenant_domains t where t.tenant_id = d.tenant_id and t.verified_at is not null) end;
  select to_jsonb(c) into v_site from public.cms_settings c where c.tenant_id is not distinct from d.tenant_id order by c.id limit 1;
  return jsonb_build_object(
    'mode', v_mode,
    'link', case when v_host is null then '' else 'https://' || v_host || '/agency/applications/' || d.application_id::text end,
    'host', v_host,
    'applicationId', d.application_id,
    'tenantId', d.tenant_id,
    'reference', coalesce(nullif(a.reference, ''), left(a.id::text, 8)),
    'version', coalesce(v_version, 0),
    'institution', coalesce(nullif(v_site->>'name', ''), (select t.name from public.tenants t where t.id = d.tenant_id), 'Skyline Institute of Technology'),
    'submittedAt', v_created,
    'branding', jsonb_build_object('logo', coalesce(v_site->>'logo', ''), 'primaryColor', case when coalesce((v_site->>'theme_configured')::boolean, false) then v_site->>'primary_color' end, 'timezone', v_site->>'timezone'),
    'documents', case when v_mode = 'attach' then coalesce((select jsonb_agg(jsonb_build_object('category', x.category, 'filename', x.filename, 'bucket', x.bucket_name, 'path', x.storage_path) order by x.created_at)
      from public.enrollment_application_documents x where x.application_id = d.application_id and x.is_current), '[]'::jsonb) else '[]'::jsonb end,
    'snapshot', case when v_mode = 'attach' then v_snapshot else null end);
end;
$$;

revoke all on function public.notification_delivery_submission(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.notification_delivery_submission(uuid, uuid) to service_role;

commit;
