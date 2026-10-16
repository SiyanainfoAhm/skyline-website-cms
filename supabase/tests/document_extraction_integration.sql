-- Run with: npm run test:document-extraction:integration
-- Exercises the database boundary used by both functions and the wizard.
begin;
select plan(17);

insert into public.agencies(id, name, code) values
  ('10000000-0000-0000-0000-000000000001', 'Extraction test A', 'EXT-A'),
  ('10000000-0000-0000-0000-000000000002', 'Extraction test B', 'EXT-B');
insert into public.portal_profiles(id, auth_user_id, full_name, email) values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Agent A', 'a@example.test'),
  ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Agent B', 'b@example.test'),
  ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Unassigned agent', 'c@example.test');
insert into public.agency_memberships(user_id, agency_id, role) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'agent'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'agent');
insert into public.enrollment_applications(id, agency_id, assigned_agent_id, data, status) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '{"values":{"last_name":"Verified"}}', 'draft'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '{}', 'draft');
insert into public.enrollment_application_documents(id, application_id, category, storage_path, filename, metadata) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Passport', '40000000-0000-0000-0000-000000000001/a.pdf', 'a.pdf', '{}'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'Passport', '40000000-0000-0000-0000-000000000001/b.pdf', 'b.pdf', '{}');

set local role service_role;
select is(public.portal_apply_document_candidates('50000000-0000-0000-0000-000000000001', '{"first_name":"Ada","last_name":"Replacement"}'::jsonb)->>'first_name', 'auto_applied', 'an empty form field is populated');
select is((select data #>> '{values,first_name}' from public.enrollment_applications where id = '40000000-0000-0000-0000-000000000001'), 'Ada', 'the populated candidate is persisted');
select is((select data #>> '{values,last_name}' from public.enrollment_applications where id = '40000000-0000-0000-0000-000000000001'), 'Verified', 'a populated/verified field is never overwritten');
select is((select state from public.enrollment_document_field_reviews where field_identifier = 'last_name' order by created_at desc limit 1), 'conflict', 'a protected populated field becomes a conflict');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000001';
select lives_ok($$select public.portal_save_document_review('40000000-0000-0000-0000-000000000001', '{"first_name":"Ada Lovelace"}', '{"first_name":"Manual entry"}', '["first_name"]', '[{"field":"first_name","state":"corrected"}]')$$, 'assigned agent saves a correction and confirmation');
select is((select data #>> '{values,first_name}' from public.enrollment_applications where id = '40000000-0000-0000-0000-000000000001'), 'Ada Lovelace', 'correction persists on reload');
select is((select state from public.enrollment_document_field_reviews where field_identifier = 'first_name' order by audit_revision desc limit 1), 'corrected', 'correction is the latest immutable audit revision');
select is((select count(*)::integer from public.enrollment_document_field_reviews where field_identifier = 'first_name' and state = 'corrected'), 1, 'correction has a durable immutable audit row');

-- The locked review save serialises with a worker candidate.
reset role;
set local role service_role;
select lives_ok($$select public.portal_apply_document_candidates('50000000-0000-0000-0000-000000000002', '{"dob":"2000-01-01"}'::jsonb)$$, 'concurrent worker candidate is accepted safely');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000001';
select lives_ok($$select public.portal_save_document_review('40000000-0000-0000-0000-000000000001', '{"dob":"2000-02-02"}', '{"dob":"Manual entry"}', '["first_name","dob"]', '[{"field":"dob","state":"corrected"}]')$$, 'manual edit serialises with extraction');
select is((select data #>> '{values,dob}' from public.enrollment_applications where id = '40000000-0000-0000-0000-000000000001'), '2000-02-02', 'manual edit is the durable final value');

set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000002';
select is((select count(*) from public.enrollment_document_field_reviews where application_id = '40000000-0000-0000-0000-000000000001')::integer, 0, 'other agency cannot read candidates');
select throws_ok($$select public.portal_save_document_review('40000000-0000-0000-0000-000000000001', '{"dob":"bad"}', '{}', '[]', '[]')$$, '42501', 'not authorised', 'other agency cannot edit candidates');
set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000003';
select is((select count(*) from public.enrollment_document_field_reviews where application_id = '40000000-0000-0000-0000-000000000001')::integer, 0, 'an unassigned agent in the same agency cannot read candidates');
select throws_ok($$select public.portal_save_document_review('40000000-0000-0000-0000-000000000001', '{"dob":"bad"}', '{}', '[]', '[]')$$, '42501', 'not authorised', 'an unassigned agent cannot edit candidates');

reset role;
set local role service_role;
insert into public.enrollment_document_deletion_recovery(document_id, application_id, bucket_name, storage_path, state, last_error)
values ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'enrollment-documents', 'x', 'storage_deleted_row_failed', 'simulated row failure');
select is((select state from public.enrollment_document_deletion_recovery where document_id = '50000000-0000-0000-0000-000000000001'), 'storage_deleted_row_failed', 'partial deletion has a recovery record');
update public.enrollment_application_documents set is_current = false where id = '50000000-0000-0000-0000-000000000002';
select is((public.portal_apply_document_candidates('50000000-0000-0000-0000-000000000002', '{"dob":"2001-01-01"}'::jsonb)->>'stale')::boolean, true, 'deleted or replaced documents reject stale results');

select * from finish();
rollback;
