-- cms_documents predates updated_at. Its immutable record hash is therefore
-- the queue/activation version used to reject changed, unpublished or deleted
-- document work.
create or replace function public.public_assistant_queue_cms_source()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_type text:=tg_argv[0]; v_key text; v_version text;
begin
  v_key:=case when tg_op='DELETE' then old.id else new.id end;
  delete from public.public_assistant_answer_cache where cache_key is not null;
  if tg_op='DELETE' then
    update public.public_assistant_sources set publication_status='unpublished',updated_at=clock_timestamp() where source_type=v_type and source_key=v_key and publication_status='published';
    return old;
  end if;
  if coalesce(new.status,'Draft')<>'Published' then
    update public.public_assistant_sources set publication_status='unpublished',updated_at=clock_timestamp() where source_type=v_type and source_key=v_key and publication_status='published';
    return new;
  end if;
  v_version:=md5(to_jsonb(new)::text);
  insert into public.public_assistant_index_jobs(source_type,source_key,source_version) values(v_type,v_key,v_version)
    on conflict(source_type,source_key,source_version) do update set state='queued',next_attempt_at=clock_timestamp(),error_code=null,error=null,updated_at=clock_timestamp();
  return new;
end; $$;

create or replace function public.public_assistant_finish_index_job(p_job uuid,p_lease uuid,p_source uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare j public.public_assistant_index_jobs; ok boolean:=false; current_version text;
begin
  select * into j from public.public_assistant_index_jobs where id=p_job and state='processing' and lease_token=p_lease and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  if not exists(select 1 from public.public_assistant_sources s where s.id=p_source and s.source_type=j.source_type and s.source_key=j.source_key and s.source_version=j.source_version and s.publication_status='staged') then return false; end if;
  if j.source_type='course' then
    select md5(to_jsonb(c)::text),status='Published' into current_version,ok from public.cms_courses c where id=j.source_key;
  elsif j.source_type='page' then
    select md5(to_jsonb(p)::text),status='Published' into current_version,ok from public.cms_pages p where id=j.source_key;
  elsif j.source_type='document' then
    select md5(to_jsonb(d)::text),status='Published' and assistant_publication_approved into current_version,ok from public.cms_documents d where id=j.source_key;
  else return false;
  end if;
  if not coalesce(ok,false) or current_version is distinct from j.source_version then return false; end if;
  update public.public_assistant_sources set publication_status='unpublished',updated_at=clock_timestamp() where source_type=j.source_type and source_key=j.source_key and publication_status='published';
  update public.public_assistant_sources set publication_status='published',effective_at=clock_timestamp(),indexed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_source;
  update public.public_assistant_index_jobs set state='succeeded',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=p_job;
  delete from public.public_assistant_answer_cache where cache_key is not null;
  return true;
end; $$;
