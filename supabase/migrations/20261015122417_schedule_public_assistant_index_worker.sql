-- The worker secret is stored separately in Vault under the same name as the
-- Edge Function secret. It never appears in this migration or cron command.
begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.public_assistant_dispatch_index_worker()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_worker_secret text;
begin
  select decrypted_secret into v_worker_secret
  from vault.decrypted_secrets
  where name = 'PUBLIC_ASSISTANT_WORKER_SECRET'
  limit 1;

  if nullif(v_worker_secret, '') is null then
    return null;
  end if;

  return net.http_post(
    url := 'https://xcpydisstlvtvcsqnjob.supabase.co/functions/v1/public-assistant-index',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', v_worker_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.public_assistant_dispatch_index_worker() from public, anon, authenticated;
grant execute on function public.public_assistant_dispatch_index_worker() to postgres;

-- Replace an existing schedule by name so exactly one authenticated worker
-- claims at most one job per minute.
select cron.unschedule(jobid)
from cron.job
where jobname = 'public-assistant-index-worker';

select cron.schedule(
  'public-assistant-index-worker',
  '* * * * *',
  'select public.public_assistant_dispatch_index_worker();'
);

-- Initial indexing only includes published public courses/pages and documents
-- explicitly approved for assistant publication.
insert into public.public_assistant_index_jobs(source_type, source_key, source_version)
select 'course', id, md5(to_jsonb(c)::text)
from public.cms_courses c
where status = 'Published'
on conflict (source_type, source_key, source_version) do update
set state = 'queued', next_attempt_at = clock_timestamp(), error_code = null, error = null, updated_at = clock_timestamp();

insert into public.public_assistant_index_jobs(source_type, source_key, source_version)
select 'page', id, md5(to_jsonb(p)::text)
from public.cms_pages p
where status = 'Published'
on conflict (source_type, source_key, source_version) do update
set state = 'queued', next_attempt_at = clock_timestamp(), error_code = null, error = null, updated_at = clock_timestamp();

insert into public.public_assistant_index_jobs(source_type, source_key, source_version)
select 'document', id, md5(to_jsonb(d)::text)
from public.cms_documents d
where status = 'Published' and assistant_publication_approved
on conflict (source_type, source_key, source_version) do update
set state = 'queued', next_attempt_at = clock_timestamp(), error_code = null, error = null, updated_at = clock_timestamp();

commit;
