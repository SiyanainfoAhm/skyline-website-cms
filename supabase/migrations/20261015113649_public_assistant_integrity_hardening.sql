-- Atomic generation admission and idempotent settlement.
create table public.public_assistant_generation_requests (
  request_id uuid primary key,
  lease_token uuid not null unique,
  period_start date not null,
  settled_at timestamptz,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.public_assistant_generation_requests enable row level security;
revoke all on public.public_assistant_generation_requests from public, anon, authenticated;

create or replace function public.public_assistant_take_generation_slot(p_daily_limit integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare t uuid:=gen_random_uuid(); s text; b integer;
begin
  -- Lock an actual free slot first. A denied concurrency request never touches
  -- the daily budget.
  select slot into s from public.public_assistant_generation_slots
   where lease_expires_at is null or lease_expires_at < clock_timestamp()
   order by slot for update skip locked limit 1;
  if s is null then return null; end if;
  insert into public.public_assistant_generation_budgets(period_start,requests)
    values(current_date,0) on conflict(period_start) do nothing;
  select requests into b from public.public_assistant_generation_budgets
    where period_start=current_date for update;
  if b >= p_daily_limit then return null; end if;
  update public.public_assistant_generation_budgets set requests=requests+1,updated_at=clock_timestamp()
    where period_start=current_date;
  update public.public_assistant_generation_slots set lease_token=t,lease_expires_at=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() where slot=s;
  insert into public.public_assistant_generation_requests(request_id,lease_token,period_start) values(t,t,current_date);
  return t;
end; $$;

create or replace function public.public_assistant_release_generation_slot(p_lease uuid,p_input_tokens integer default 0,p_output_tokens integer default 0)
returns boolean language plpgsql security definer set search_path=public as $$
declare d date;
begin
  update public.public_assistant_generation_requests
     set settled_at=clock_timestamp(),input_tokens=p_input_tokens,output_tokens=p_output_tokens
   where lease_token=p_lease and settled_at is null
   returning period_start into d;
  if not found then return false; end if;
  update public.public_assistant_generation_slots set lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where lease_token=p_lease;
  update public.public_assistant_generation_budgets set input_tokens=input_tokens+p_input_tokens,output_tokens=output_tokens+p_output_tokens,updated_at=clock_timestamp() where period_start=d;
  return true;
end; $$;

-- A completed worker may activate only the still-current published CMS record.
create or replace function public.public_assistant_finish_index_job(p_job uuid,p_lease uuid,p_source uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare j public.public_assistant_index_jobs; ok boolean:=false; current_version text;
begin
  select * into j from public.public_assistant_index_jobs
   where id=p_job and state='processing' and lease_token=p_lease and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  if not exists(select 1 from public.public_assistant_sources s where s.id=p_source and s.source_type=j.source_type and s.source_key=j.source_key and s.source_version=j.source_version and s.publication_status='staged') then return false; end if;
  if j.source_type='course' then
    select coalesce(updated_at::text,md5(to_jsonb(c)::text)), status='Published' into current_version,ok from public.cms_courses c where id=j.source_key;
  elsif j.source_type='page' then
    select coalesce(updated_at::text,md5(to_jsonb(p)::text)), status='Published' into current_version,ok from public.cms_pages p where id=j.source_key;
  elsif j.source_type='document' then
    select coalesce(updated_at::text,md5(to_jsonb(d)::text)), status='Published' and assistant_publication_approved into current_version,ok from public.cms_documents d where id=j.source_key;
  else return false;
  end if;
  if not coalesce(ok,false) or current_version is distinct from j.source_version then return false; end if;
  update public.public_assistant_sources set publication_status='unpublished',updated_at=clock_timestamp() where source_type=j.source_type and source_key=j.source_key and publication_status='published';
  update public.public_assistant_sources set publication_status='published',effective_at=clock_timestamp(),indexed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_source;
  update public.public_assistant_index_jobs set state='succeeded',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=p_job;
  delete from public.public_assistant_answer_cache;
  return true;
end; $$;

-- API access is gated twice: table privileges plus RLS policies.
grant select on public.public_assistant_faqs to authenticated;
grant select on public.public_assistant_document_text, public.public_assistant_document_pages, public.public_assistant_document_corrections to authenticated;
-- A monotonically allocated audit revision supplies a total ordering when the
-- caller needs the latest review; timestamps remain informational only.
alter table public.enrollment_document_field_reviews
  add column audit_revision bigint generated always as identity;
create unique index enrollment_document_field_reviews_audit_revision
  on public.enrollment_document_field_reviews(audit_revision);
