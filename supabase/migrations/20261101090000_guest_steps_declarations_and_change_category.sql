-- Migration 113: guest document steps. Additive; local only until released. NOT YET APPLIED anywhere.
--  * guest_document_links.declared: the "I don't have this" answers (Visa, English Test, Academic), shown to the agent by portal_guest_link_status.
--  * guest_confirm_document: records that the student confirmed a file ("Yes, continue" or "Use it anyway") in the document's metadata; no read values involved.
--  * guest_declare_missing: records / clears an "I don't have this" answer. Service role only, on a live link.
--  * portal_change_document_category: an agent moves a document that is in category Other to a real category and resets it to queued; the browser then
--    calls the existing portal-document-extract enqueue so the read starts.
-- Rollback (manual): drop the three functions and the column; re-create portal_guest_link_status from migration 109.
begin;

alter table public.guest_document_links add column declared jsonb not null default '{}'::jsonb;

create function public.guest_declare_missing(p_link uuid, p_category text, p_missing boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_category not in ('Visa', 'English Test', 'Academic') then raise exception 'This document cannot be skipped that way' using errcode = '22023'; end if;
  update public.guest_document_links
     set declared = case when p_missing then declared || jsonb_build_object(p_category, now()) else declared - p_category end
   where id = p_link and revoked_at is null and expires_at > now() and completed_at is null;
  if not found then raise exception 'Link is not valid' using errcode = '42501'; end if;
end; $$;

create function public.guest_confirm_document(p_link uuid, p_document uuid, p_used_anyway boolean, p_detected text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.guest_document_links where id = p_link and revoked_at is null and expires_at > now() and completed_at is null) then
    raise exception 'Link is not valid' using errcode = '42501'; end if;
  update public.enrollment_application_documents
     set metadata = metadata || jsonb_build_object('guest', jsonb_build_object('confirmedAt', now(), 'usedAnyway', coalesce(p_used_anyway, false), 'detected', left(coalesce(p_detected, ''), 40)))
   where id = p_document and guest_link_id = p_link and is_current;
  if not found then raise exception 'Document not available' using errcode = '42501'; end if;
end; $$;

-- Same status as migration 109 plus the "I don't have this" answers (category names only).
create or replace function public.portal_guest_link_status(p_application uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.guest_document_links;
begin
  if auth.uid() is null or not public.portal_can_access_application(p_application) then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into l from public.guest_document_links where application_id = p_application order by created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', l.id, 'createdAt', l.created_at, 'expiresAt', l.expires_at, 'sentAt', l.sent_at, 'lastUsedAt', l.last_used_at,
    'completedAt', l.completed_at, 'state', case when l.revoked_at is not null then 'revoked' when l.completed_at is not null then 'completed'
    when l.expires_at <= now() then 'expired' when l.last_used_at is not null then 'opened' else 'active' end,
    'declared', coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(l.declared) k), '[]'::jsonb));
end; $$;

create function public.portal_change_document_category(p_document uuid, p_category text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.enrollment_application_documents;
begin
  select * into d from public.enrollment_application_documents where id = p_document for update;
  if auth.uid() is null or not found or not public.portal_can_edit_application(d.application_id) or not d.is_current
     or not exists (select 1 from public.enrollment_applications a where a.id = d.application_id and a.status in ('draft', 'action_required')) then
    raise exception 'Not authorized' using errcode = '42501'; end if;
  if d.category <> 'Other' or p_category not in ('Passport', 'Driving Licence', 'Visa', 'English Test', 'Academic', 'Health Insurance') then
    raise exception 'Only a document in category Other can be changed to a readable category' using errcode = '22023'; end if;
  update public.enrollment_document_extraction_jobs set state = 'cancelled', lease_token = null, lease_expires_at = null, updated_at = now()
    where document_id = d.id and state in ('queued', 'processing');
  update public.enrollment_application_documents
     set category = p_category,
         metadata = (metadata - 'extraction') || jsonb_build_object('extraction', jsonb_build_object('extracted', '{}'::jsonb, 'confirmed', '{}'::jsonb, 'status', 'queued',
           'source', jsonb_build_object('engine', 'openai-responses', 'parser', 'document-extraction-v1', 'queuedAt', now())))
   where id = d.id;
end; $$;

revoke all on function public.guest_declare_missing(uuid, text, boolean), public.guest_confirm_document(uuid, uuid, boolean, text),
  public.portal_change_document_category(uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.guest_declare_missing(uuid, text, boolean), public.guest_confirm_document(uuid, uuid, boolean, text) to service_role;

grant execute on function public.portal_change_document_category(uuid, text) to authenticated;

commit;
