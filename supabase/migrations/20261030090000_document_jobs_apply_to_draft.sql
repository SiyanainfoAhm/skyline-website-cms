-- Migration 108: portal document jobs apply their values to the draft (fill empty fields, keep typed values, log conflicts). Additive; local only until released.
-- Single change from migration 103 (20261029100000_health_insurance_extraction_category.sql): the job is inserted with review_only = false, so
-- portal_finish_document_extraction_job calls portal_apply_document_candidates (draft / action_required only; never overwrites typed values).
-- The tenant-bound finish path (portal_finish_tenant_document_job) is deliberately not changed.
-- Rollback (manual): re-run portal_enqueue_document_job from migration 20261029100000 (review_only = true).
begin;

create or replace function public.portal_enqueue_document_job(p_document_id uuid,p_reextract boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d public.enrollment_application_documents; j public.enrollment_document_extraction_jobs;
begin
 select * into d from public.enrollment_application_documents where id=p_document_id for update;
 if auth.uid() is null or not public.portal_can_edit_application(d.application_id) or not d.is_current or
  d.category not in ('Passport','Driving Licence','Visa','English Test','Academic','Health Insurance') or not exists(
  select 1 from public.enrollment_applications a where a.id=d.application_id and a.status in ('draft','action_required')) then
  raise exception 'Editable document not authorized' using errcode='42501'; end if;
 if p_reextract then update public.enrollment_document_extraction_jobs set state='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
  where document_id=d.id and state in ('queued','processing'); end if;
 select * into j from public.enrollment_document_extraction_jobs where document_id=d.id and state in ('queued','processing') limit 1;
 if not found then
  insert into public.enrollment_document_extraction_jobs(document_id,application_id,content_sha256,state,next_attempt_at,review_only)
  values(d.id,d.application_id,d.metadata->>'contentSha256','queued',now(),false) returning * into j;
 end if;
 update public.enrollment_application_documents set metadata=jsonb_set(metadata,'{extraction}',
  coalesce(metadata->'extraction','{}')||jsonb_build_object('status',case when metadata#>>'{extraction,status}'='confirmed' then 'confirmed' else j.state end),true) where id=d.id;
 return jsonb_build_object('id',j.id,'state',j.state,'tenant_id',j.tenant_id);
end; $$;

revoke all on function public.portal_enqueue_document_job(uuid,boolean) from public,anon,authenticated,service_role;

grant execute on function public.portal_enqueue_document_job(uuid,boolean) to authenticated;

commit;
