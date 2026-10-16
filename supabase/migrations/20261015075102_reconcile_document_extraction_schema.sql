-- Reconciles the extraction schema with a production project whose portal
-- tables were created outside this repository's duplicate 0006/0007 history.
--
-- Preconditions are asserted before any DDL. This migration is additive:
-- it neither changes application rows nor deletes Storage objects/documents.
begin;

do $$
begin
  if to_regclass('public.enrollment_applications') is null
    or to_regclass('public.enrollment_application_documents') is null
    or to_regclass('public.portal_profiles') is null
    or to_regprocedure('public.portal_can_access_application(uuid)') is null
    or to_regprocedure('public.portal_profile_id()') is null then
    raise exception 'Portal prerequisites are missing; do not apply extraction schema';
  end if;
end;
$$;

-- 0009/0010 were already represented by the production document metadata
-- column. Keep this idempotent so a partially-provisioned environment is safe.
alter table public.enrollment_application_documents
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists idx_app_docs_content_digest
  on public.enrollment_application_documents
  (application_id, category, (metadata ->> 'contentSha256'))
  where metadata ? 'contentSha256';
create index if not exists idx_app_docs_id_application
  on public.enrollment_application_documents (id, application_id);

-- 0012: durable work queue and per-attempt audit trail.
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
drop policy if exists extraction_jobs_read on public.enrollment_document_extraction_jobs;
create policy extraction_jobs_read on public.enrollment_document_extraction_jobs
  for select to authenticated using (public.portal_can_access_application(application_id));
drop policy if exists extraction_attempts_read on public.enrollment_document_extraction_attempts;
create policy extraction_attempts_read on public.enrollment_document_extraction_attempts
  for select to authenticated using (exists (
    select 1 from public.enrollment_document_extraction_jobs j
    where j.id = job_id and public.portal_can_access_application(j.application_id)
  ));
grant select on public.enrollment_document_extraction_jobs, public.enrollment_document_extraction_attempts to authenticated;

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

-- 0013: review/audit data and the safe candidate-merge/review RPCs.
create table if not exists public.enrollment_document_field_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  document_id uuid references public.enrollment_application_documents(id) on delete set null,
  field_identifier text not null,
  candidate_value text,
  existing_value text,
  final_value text,
  state text not null check (state in ('auto_applied','corroborated','conflict','confirmed','corrected','rejected','stale')),
  source jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.portal_profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists enrollment_document_field_reviews_application
  on public.enrollment_document_field_reviews(application_id, field_identifier, created_at desc);
alter table public.enrollment_document_field_reviews enable row level security;
drop policy if exists document_field_reviews_read on public.enrollment_document_field_reviews;
create policy document_field_reviews_read on public.enrollment_document_field_reviews
  for select to authenticated using (public.portal_can_access_application(application_id));
grant select on public.enrollment_document_field_reviews to authenticated;

create table if not exists public.enrollment_document_deletion_recovery (
  document_id uuid primary key,
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  bucket_name text not null,
  storage_path text not null,
  state text not null check (state in ('storage_failed','storage_deleted_row_failed')),
  last_error text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.enrollment_document_deletion_recovery enable row level security;
drop policy if exists document_deletion_recovery_read on public.enrollment_document_deletion_recovery;
create policy document_deletion_recovery_read on public.enrollment_document_deletion_recovery
  for select to authenticated using (public.portal_can_access_application(application_id));
grant select on public.enrollment_document_deletion_recovery to authenticated;

create or replace function public.portal_apply_document_candidates(p_document_id uuid, p_fields jsonb, p_source jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_document record; v_data jsonb; v_values jsonb; v_provenance jsonb;
  v_key text; v_value text; v_existing text; v_state text; v_result jsonb := '{}'::jsonb;
begin
  select d.id, d.application_id into v_document
  from public.enrollment_application_documents d join public.enrollment_applications a on a.id = d.application_id
  where d.id = p_document_id and d.is_current and a.status in ('draft','action_required') for update of d, a;
  if not found then return jsonb_build_object('stale', true); end if;
  select data into v_data from public.enrollment_applications where id = v_document.application_id for update;
  v_values := coalesce(v_data->'values', '{}'::jsonb); v_provenance := coalesce(v_data->'fieldProvenance', '{}'::jsonb);
  for v_key, v_value in select key, value #>> '{}' from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
    if nullif(btrim(v_value), '') is null then continue; end if;
    v_existing := nullif(btrim(v_values->>v_key), '');
    if v_existing is null then
      v_values := jsonb_set(v_values, array[v_key], to_jsonb(v_value), true);
      v_provenance := jsonb_set(v_provenance, array[v_key], jsonb_build_object('kind','ai_unverified','documentId',p_document_id,'updatedAt',now()), true);
      v_state := 'auto_applied';
    elsif lower(v_existing) = lower(v_value) then v_state := 'corroborated';
    else v_state := 'conflict'; end if;
    insert into public.enrollment_document_field_reviews(application_id, document_id, field_identifier, candidate_value, existing_value, final_value, state, source)
    values (v_document.application_id, p_document_id, v_key, v_value, v_existing, case when v_state = 'auto_applied' then v_value else v_existing end, v_state, p_source);
    v_result := jsonb_set(v_result, array[v_key], to_jsonb(v_state), true);
  end loop;
  update public.enrollment_applications set data = jsonb_set(jsonb_set(v_data, '{values}', v_values, true), '{fieldProvenance}', v_provenance, true), updated_at = now() where id = v_document.application_id;
  return v_result;
end;
$$;
revoke all on function public.portal_apply_document_candidates(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.portal_apply_document_candidates(uuid, jsonb, jsonb) to service_role;

create or replace function public.portal_save_document_review(p_application_id uuid, p_values jsonb, p_provenance jsonb default '{}'::jsonb, p_confirmed jsonb default '[]'::jsonb, p_resolutions jsonb default '[]'::jsonb, p_wizard jsonb default '{}'::jsonb, p_student_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_data jsonb; v_values jsonb; v_wizard jsonb; v_provenance jsonb; v_field text; v_value text;
  v_resolution jsonb; v_document_id uuid; v_candidate text; v_state text;
begin
  if auth.uid() is null or not public.portal_can_access_application(p_application_id) then raise exception 'not authorised' using errcode = '42501'; end if;
  select data into v_data from public.enrollment_applications where id = p_application_id for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
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
$$;
revoke all on function public.portal_save_document_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.portal_save_document_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) to authenticated;

commit;
