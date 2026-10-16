-- Field-level candidate/audit records. Existing application `data.values` stays
-- authoritative; this table makes every AI suggestion and review durable.
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
create index if not exists enrollment_document_field_reviews_application on public.enrollment_document_field_reviews(application_id, field_identifier, created_at desc);
alter table public.enrollment_document_field_reviews enable row level security;
create policy document_field_reviews_read on public.enrollment_document_field_reviews
  for select to authenticated using (public.portal_can_access_application(application_id));

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
create policy document_deletion_recovery_read on public.enrollment_document_deletion_recovery
  for select to authenticated using (public.portal_can_access_application(application_id));

-- Called only by the service-role worker after a document's version has been
-- rechecked. Locks the application row so concurrent extraction results cannot
-- overwrite one another. Existing populated values are never changed.
create or replace function public.portal_apply_document_candidates(p_document_id uuid, p_fields jsonb, p_source jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_document record;
  v_data jsonb;
  v_values jsonb;
  v_provenance jsonb;
  v_key text;
  v_value text;
  v_existing text;
  v_state text;
  v_result jsonb := '{}'::jsonb;
begin
  select d.id, d.application_id into v_document
  from public.enrollment_application_documents d
  join public.enrollment_applications a on a.id = d.application_id
  where d.id = p_document_id and d.is_current and a.status in ('draft','action_required')
  for update of d, a;
  if not found then return jsonb_build_object('stale', true); end if;

  select data into v_data from public.enrollment_applications where id = v_document.application_id for update;
  v_values := coalesce(v_data->'values', '{}'::jsonb);
  v_provenance := coalesce(v_data->'fieldProvenance', '{}'::jsonb);
  for v_key, v_value in select key, value #>> '{}' from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
    if nullif(btrim(v_value), '') is null then continue; end if;
    v_existing := nullif(btrim(v_values->>v_key), '');
    if v_existing is null then
      v_values := jsonb_set(v_values, array[v_key], to_jsonb(v_value), true);
      v_provenance := jsonb_set(v_provenance, array[v_key], jsonb_build_object('kind','ai_unverified','documentId',p_document_id,'updatedAt',now()), true);
      v_state := 'auto_applied';
    elsif lower(v_existing) = lower(v_value) then
      v_state := 'corroborated';
    else
      v_state := 'conflict';
    end if;
    insert into public.enrollment_document_field_reviews(application_id, document_id, field_identifier, candidate_value, existing_value, final_value, state, source)
      values (v_document.application_id, p_document_id, v_key, v_value, v_existing, case when v_state = 'auto_applied' then v_value else v_existing end, v_state, p_source);
    v_result := jsonb_set(v_result, array[v_key], to_jsonb(v_state), true);
  end loop;
  update public.enrollment_applications set data = jsonb_set(jsonb_set(v_data, '{values}', v_values, true), '{fieldProvenance}', v_provenance, true), updated_at = now()
  where id = v_document.application_id;
  return v_result;
end;
$$;
revoke all on function public.portal_apply_document_candidates(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.portal_apply_document_candidates(uuid, jsonb, jsonb) to service_role;

-- Agent review is deliberately mediated by one locked, authorised RPC instead
-- of browser read/modify/write updates. This prevents a late extraction from
-- clobbering a manual correction and records each confirmation or correction.
create or replace function public.portal_save_document_review(
  p_application_id uuid,
  p_values jsonb,
  p_provenance jsonb default '{}'::jsonb,
  p_confirmed jsonb default '[]'::jsonb,
  p_resolutions jsonb default '[]'::jsonb,
  p_wizard jsonb default '{}'::jsonb,
  p_student_name text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_data jsonb;
  v_values jsonb;
  v_wizard jsonb;
  v_provenance jsonb;
  v_field text;
  v_value text;
  v_resolution jsonb;
  v_document_id uuid;
  v_candidate text;
  v_state text;
begin
  if auth.uid() is null or not public.portal_can_access_application(p_application_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select data into v_data from public.enrollment_applications where id = p_application_id for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  v_values := coalesce(v_data->'values', '{}'::jsonb);
  v_wizard := coalesce(v_data->'wizard', '{}'::jsonb) || coalesce(p_wizard, '{}'::jsonb);
  v_provenance := coalesce(v_wizard->'provenance', '{}'::jsonb) || coalesce(p_provenance, '{}'::jsonb);
  for v_field, v_value in select key, value #>> '{}' from jsonb_each(coalesce(p_values, '{}'::jsonb)) loop
    v_values := jsonb_set(v_values, array[v_field], to_jsonb(coalesce(v_value, '')), true);
  end loop;
  v_wizard := jsonb_set(v_wizard, '{provenance}', v_provenance, true);
  v_wizard := jsonb_set(v_wizard, '{confirmed}', coalesce(p_confirmed, '[]'::jsonb), true);
  v_wizard := jsonb_set(v_wizard, '{updatedAt}', to_jsonb(now()), true);
  update public.enrollment_applications
    set data = jsonb_set(jsonb_set(v_data, '{values}', v_values, true), '{wizard}', v_wizard, true),
        student_name = coalesce(p_student_name, student_name), updated_at = now()
    where id = p_application_id;
  for v_resolution in select value from jsonb_array_elements(coalesce(p_resolutions, '[]'::jsonb)) loop
    v_field := nullif(v_resolution->>'field', '');
    if v_field is null then continue; end if;
    v_document_id := nullif(v_resolution->>'documentId', '')::uuid;
    v_candidate := nullif(v_resolution->>'candidateValue', '');
    v_state := case when v_resolution->>'state' in ('confirmed','corrected','rejected') then v_resolution->>'state' else 'corrected' end;
    insert into public.enrollment_document_field_reviews(application_id, document_id, field_identifier, candidate_value, existing_value, final_value, state, source, reviewed_by, reviewed_at)
    values (p_application_id, v_document_id, v_field, v_candidate, null, v_values->>v_field, v_state,
      jsonb_build_object('kind', coalesce(v_provenance->>v_field, 'Manual entry')), public.portal_profile_id(), now());
  end loop;
  return jsonb_build_object('ok', true, 'values', v_values, 'wizard', v_wizard);
end;
$$;
revoke all on function public.portal_save_document_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.portal_save_document_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) to authenticated;
grant select on public.enrollment_document_field_reviews to authenticated;
