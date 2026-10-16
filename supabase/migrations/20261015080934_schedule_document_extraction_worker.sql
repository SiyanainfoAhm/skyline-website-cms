-- Schedules the existing portal-document-extract worker. The worker secret is
-- resolved only at execution time from Supabase Vault; no secret is stored in
-- this migration, cron command text, frontend, or application data.
begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- A single dispatcher invocation processes at most one queue job. This gives
-- the existing FOR UPDATE SKIP LOCKED claim/lease mechanism sole ownership of
-- concurrency and deliberately limits OpenAI work to one document per minute.
-- It returns NULL until the operator provisions the Vault secret, avoiding
-- unauthenticated requests and scheduler-error noise during configuration.
create or replace function public.portal_dispatch_document_extraction_worker()
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
  where name = 'DOCUMENT_EXTRACTION_WORKER_SECRET'
  limit 1;

  if nullif(v_worker_secret, '') is null then
    return null;
  end if;

  return net.http_post(
    url := 'https://xcpydisstlvtvcsqnjob.supabase.co/functions/v1/portal-document-extract',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', v_worker_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function public.portal_dispatch_document_extraction_worker() from public, anon, authenticated;
grant execute on function public.portal_dispatch_document_extraction_worker() to postgres;

-- Re-running this migration/update replaces the named job rather than creating
-- duplicate schedulers. pg_cron runs the command as the migration owner.
select cron.schedule(
  'portal-document-extraction-worker',
  '* * * * *',
  'select public.portal_dispatch_document_extraction_worker();'
);

-- Operational monitoring: queue depth, terminal failures, and latency. RLS
-- still scopes the underlying job rows, while the explicit admin check prevents
-- agents from using aggregate counts to infer other applications' activity.
create or replace function public.portal_document_extraction_metrics()
returns table (
  state text,
  job_count bigint,
  oldest_queued_at timestamptz,
  average_processing_latency interval
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.portal_is_slit_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
  select
    j.state,
    count(*)::bigint,
    min(j.created_at) filter (where j.state = 'queued'),
    avg(j.completed_at - j.started_at) filter (where j.started_at is not null and j.completed_at is not null)
  from public.enrollment_document_extraction_jobs j
  group by j.state
  order by j.state;
end;
$$;
revoke all on function public.portal_document_extraction_metrics() from public, anon;
grant execute on function public.portal_document_extraction_metrics() to authenticated;

commit;
