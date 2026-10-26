-- Desired security assertions. Intentionally red until P02-03/04 fixes.
-- Synthetic SQL actor simulation; every write is rolled back.
begin;
select plan(11);
insert into public.agencies(id,name,code) values
 ('12000000-0000-0000-0000-000000000001','Security A','P2-SEC-A'),
 ('12000000-0000-0000-0000-000000000002','Security B','P2-SEC-B');
insert into public.portal_profiles(id,auth_user_id,full_name,email) values
 ('22000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','Security agent','security@example.test');
insert into public.agency_memberships(user_id,agency_id,role) values
 ('22000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','agent');
insert into public.enrollment_applications(id,agency_id,assigned_agent_id,status,data) values
 ('42000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','submitted','{"values":{"first_name":"Confirmed"}}'),
 ('42000000-0000-0000-0000-000000000002','12000000-0000-0000-0000-000000000002',null,'draft','{}');
insert into public.enrollment_application_messages(application_id,body,visibility) values
 ('42000000-0000-0000-0000-000000000001','Private staff note','internal'),
 ('42000000-0000-0000-0000-000000000001','Agency message','agency');
insert into public.enrollment_application_documents(id,application_id,category,storage_path,filename) values
 ('52000000-0000-0000-0000-000000000001','42000000-0000-0000-0000-000000000001','Passport','42000000-0000-0000-0000-000000000001/own.pdf','own.pdf'),
 ('52000000-0000-0000-0000-000000000002','42000000-0000-0000-0000-000000000002','Passport','42000000-0000-0000-0000-000000000002/foreign.pdf','foreign.pdf');
set local role authenticated;
set local request.jwt.claim.sub='32000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.enrollment_application_messages where visibility='agency'),1,'agent retains public agency messages');
select is((select count(*)::int from public.enrollment_applications where id='42000000-0000-0000-0000-000000000002'),0,'agent cannot read foreign agency application');
select is((select count(*)::int from public.enrollment_application_messages where visibility='internal'),0,'SEC-01 internal notes are hidden');
with changed as (update public.enrollment_application_documents set storage_path='42000000-0000-0000-0000-000000000002/foreign.pdf' where id='52000000-0000-0000-0000-000000000001' returning id)
select is((select count(*)::int from changed),0,'SEC-02 document locator cannot be substituted');
select throws_ok($$insert into public.enrollment_application_courses(application_id,course_id) values ('42000000-0000-0000-0000-000000000001','forged')$$,'42501',null,'SEC-04 submitted course changes denied');
select throws_ok($$insert into public.enrollment_application_versions(application_id,version,snapshot) values ('42000000-0000-0000-0000-000000000001',999,'{}')$$,'42501',null,'SEC-12 snapshot forgery denied');
select throws_ok($$insert into public.enrollment_application_status_history(application_id,new_status,actor_name) values ('42000000-0000-0000-0000-000000000001','enrolled','Forged admin')$$,'42501',null,'SEC-12 history forgery denied');
select throws_ok($$select public.portal_save_document_review('42000000-0000-0000-0000-000000000001','{"first_name":"Changed"}','{}','[]','[]')$$,'42501',null,'SEC-03 submitted review changes denied');
-- Separate parent-link case on editable draft, so status cannot mask the issue.
reset role;
update public.enrollment_applications set status='draft' where id='42000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.portal_save_document_review('42000000-0000-0000-0000-000000000001','{}','{}','[]','[{"field":"first_name","documentId":"52000000-0000-0000-0000-000000000002","state":"confirmed"}]')$$,'42501',null,'SEC-03 foreign-document review linkage denied');
reset role;
update public.agencies set status='Inactive' where id='12000000-0000-0000-0000-000000000001';
set local role authenticated;
select is((select count(*)::int from public.enrollment_applications where id='42000000-0000-0000-0000-000000000001'),0,'SEC-05 inactive agency loses application access');
reset role;
update public.portal_profiles set status='Inactive' where id='22000000-0000-0000-0000-000000000001';
set local role authenticated;
with changed as (update public.portal_profiles set status='Active' where id='22000000-0000-0000-0000-000000000001' returning id)
select is((select count(*)::int from changed),0,'SEC-05 self-reactivation denied');
select * from finish();
rollback;
