-- Deleting a student deletes every application of theirs, whatever its status (owner's decision, 2026-11-04), with
-- everything attached: documents, courses, versions, consents, history, messages, requests, field reviews, extraction
-- jobs, student links, receipts, the event and email queue. Audit-log entries are kept with the application link cleared.
-- * An application with an issued CoE / VoE document or a registration record is not deleted: the student is then not
--   deleted either (disable them instead). Those are enrolment records.
-- * Uploaded files: the screen removes draft files through the document-delete function first; files of submitted
--   applications (which that function keeps) are queued in storage_cleanup_queue for the server to remove.
set local lock_timeout='5s';
set local statement_timeout='120s';

create table public.storage_cleanup_queue (
 id bigserial primary key,
 bucket_name text not null,
 storage_path text not null,
 reason text not null default '',
 requested_at timestamptz not null default now(),
 requested_by uuid,
 done_at timestamptz
);
comment on table public.storage_cleanup_queue is 'Files whose records were deleted (e.g. with a deleted student) and that the server still has to remove from storage.';
alter table public.storage_cleanup_queue enable row level security;
revoke all on public.storage_cleanup_queue from public, anon, authenticated;
grant all on public.storage_cleanup_queue to service_role;
grant usage, select on sequence public.storage_cleanup_queue_id_seq to service_role;

-- The disabled-student lock lets the delete itself through (a document's delete can touch the application it belongs to).
create or replace function public.application_student_disabled_guard() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
 if new.student_id is not null and current_setting('skyline.deleting_student', true) is distinct from new.student_id::text
  and exists (select 1 from public.enrollment_students s where s.id = new.student_id and s.status <> 'Active') then
  raise exception 'This student is disabled, so their applications are locked' using errcode = '42501';
 end if;
 return new;
end $fn$;

drop function if exists public.admin_student_delete(uuid);
create function public.admin_student_delete(p_student uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare s public.enrollment_students; app record; v_apps integer := 0; v_files integer := 0;
begin
 perform public.admin_business_require();
 select * into s from public.enrollment_students where id = p_student for update;
 if not found then raise exception 'Student not found' using errcode = 'P0002'; end if;
 if exists (select 1 from public.enrollment_applications e where e.student_id = s.id
   and (exists (select 1 from public.enrollment_coe_documents c where c.application_id = e.id)
     or exists (select 1 from public.enrollment_registrations r where r.application_id = e.id))) then
  raise exception 'This student has an issued CoE / VoE or a registration, which are kept as enrolment records. Disable the student instead.' using errcode = '23514';
 end if;
 perform set_config('skyline.deleting_student', s.id::text, true);
 for app in select e.id, e.reference from public.enrollment_applications e where e.student_id = s.id for update loop
  -- Files still in storage go to the cleanup queue.
  insert into public.storage_cleanup_queue(bucket_name, storage_path, reason, requested_by)
  select d.bucket_name, d.storage_path, 'student deleted: ' || coalesce(app.reference, app.id::text), auth.uid()
  from public.enrollment_application_documents d where d.application_id = app.id and coalesce(d.storage_path, '') <> '';
  get diagnostics v_files = row_count;
  -- Delivery records, the event queue and receipts point at the application without cascading.
  delete from public.notification_provider_events where delivery_id in (select id from public.notification_deliveries where application_id = app.id);
  delete from public.notification_delivery_attempts where delivery_id in (select id from public.notification_deliveries where application_id = app.id);
  delete from public.notification_deliveries where application_id = app.id;
  delete from public.guest_link_sends where application_id = app.id;
  delete from public.notification_deliveries where outbox_id in (select id from public.admission_event_outbox where application_id = app.id);
  delete from public.admission_event_outbox where application_id = app.id;
  delete from public.admission_submission_receipts where application_id = app.id;
  -- Audit entries stay, no longer linked to the deleted application.
  update public.portal_audit_log set application_id = null where application_id = app.id;
  -- Course rows only change under the draft command; the rest cascades with the application.
  perform set_config('portal.draft_command', app.id::text, true);
  delete from public.enrollment_application_documents where application_id = app.id;
  delete from public.enrollment_applications where id = app.id;
  v_apps := v_apps + 1;
 end loop;
 perform set_config('portal.draft_command', '', true);
 delete from public.enrollment_students where id = s.id;
 perform set_config('skyline.deleting_student', '', true);
 perform public.admin_business_audit('student_deleted', s.agency_id, s.agency_id,
  jsonb_build_object('student', s.id, 'name', s.full_name, 'email', s.email, 'applicationsDeleted', v_apps));
 return jsonb_build_object('studentId', s.id, 'deleted', true, 'applicationsDeleted', v_apps,
  'filesQueued', (select count(*) from public.storage_cleanup_queue q where q.reason like 'student deleted:%' and q.done_at is null and q.requested_at >= now() - interval '1 minute'));
end $fn$;
revoke all on function public.admin_student_delete(uuid) from public, anon;
grant execute on function public.admin_student_delete(uuid) to authenticated;
