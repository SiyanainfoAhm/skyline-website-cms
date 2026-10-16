-- Durable, per-document extraction work.  This is intentionally additive: the
-- document row remains the lifecycle authority and legacy metadata is retained.
create table if not exists public.enrollment_document_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.enrollment_application_documents(id) on delete cascade,
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  content_sha256 text,
  schema_version text not null default 'document-extraction-v1',
  configuration_version text not null default 'openai-responses-v1',
  state text not null default 'queued' check (state in ('queued','processing','succeeded','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  last_error_code text,
  last_error text,
  provider_response_id text,
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists enrollment_document_extraction_jobs_active_document
  on public.enrollment_document_extraction_jobs(document_id)
  where state in ('queued','processing');
create index if not exists enrollment_document_extraction_jobs_ready
  on public.enrollment_document_extraction_jobs(state, next_attempt_at);

create table if not exists public.enrollment_document_extraction_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.enrollment_document_extraction_jobs(id) on delete cascade,
  attempt_number integer not null,
  state text not null check (state in ('started','succeeded','failed')),
  error_code text,
  error text,
  provider_response_id text,
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(job_id, attempt_number)
);

alter table public.enrollment_document_extraction_jobs enable row level security;
alter table public.enrollment_document_extraction_attempts enable row level security;

-- End users can see only job state for documents that their existing document
-- policy already authorises. They cannot create/complete jobs or provider usage.
create policy extraction_jobs_read on public.enrollment_document_extraction_jobs
  for select to authenticated using (public.portal_can_access_application(application_id));
create policy extraction_attempts_read on public.enrollment_document_extraction_attempts
  for select to authenticated using (exists (
    select 1 from public.enrollment_document_extraction_jobs j
    where j.id = job_id and public.portal_can_access_application(j.application_id)
  ));

-- Atomically claims one due job; only the worker service role is granted access.
create or replace function public.portal_claim_document_extraction_job()
returns setof public.enrollment_document_extraction_jobs
language plpgsql security definer set search_path = public
as $$
begin
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
