-- Preserve the existing durable queue, but cap normal immediate dispatch to
-- one active OpenAI extraction. An advisory transaction lock serialises the
-- count-and-claim decision; the existing SKIP LOCKED query remains responsible
-- for row ownership and stale lease recovery.
begin;

create or replace function public.portal_claim_document_extraction_job()
returns setof public.enrollment_document_extraction_jobs
language plpgsql security definer set search_path = public
as $$
begin
  if not pg_try_advisory_xact_lock(9341, 20261015) then
    return;
  end if;

  if exists (
    select 1
    from public.enrollment_document_extraction_jobs
    where state = 'processing'
      and (lease_expires_at is null or lease_expires_at >= now())
  ) then
    return;
  end if;

  return query
  with candidate as (
    select id from public.enrollment_document_extraction_jobs
    where (state = 'queued' and next_attempt_at <= now())
       or (state = 'processing' and lease_expires_at < now())
    order by next_attempt_at, created_at
    for update skip locked limit 1
  )
  update public.enrollment_document_extraction_jobs j
  set state = 'processing', attempt_count = j.attempt_count + 1,
      started_at = now(), updated_at = now(), lease_expires_at = now() + interval '4 minutes'
  from candidate where j.id = candidate.id
  returning j.*;
end;
$$;
revoke all on function public.portal_claim_document_extraction_job() from public, anon, authenticated;
grant execute on function public.portal_claim_document_extraction_job() to service_role;

commit;
