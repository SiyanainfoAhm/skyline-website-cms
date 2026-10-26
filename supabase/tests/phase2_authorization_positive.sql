-- Positive preservation + direct mutation boundaries, synthetic and rollback-only.
begin;
select plan(23);
insert into public.agencies(id,name,code) values ('13000000-0000-0000-0000-000000000001','Positive A','P2-POS-A'),('13000000-0000-0000-0000-000000000002','Positive B','P2-POS-B');
insert into public.portal_profiles(id,auth_user_id,full_name,email) values
 ('23000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Positive agent','positive@example.test');
insert into public.agency_memberships(user_id,agency_id,role) values ('23000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001','agent');
insert into public.enrollment_applications(id,agency_id,assigned_agent_id,status,data) values
 ('43000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000001','draft','{}');
-- SQL actor claims are stand-ins; native Auth provisioning is tested separately.
-- The SEC-11 contract requires an explicit UID mapping, never email alone.
insert into public.cms_users(id,name,email,role,status,auth_user_id) values ('phase2-positive-admin','Positive admin','positive-admin@example.test','Admin','Active','33000000-0000-0000-0000-000000000002');
insert into public.portal_notifications(id,recipient,title) values ('63000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Original');
set local role authenticated;
set local request.jwt.claim.sub='33000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.agencies),1,'agent can only read own agency');
select lives_ok($$update public.portal_profiles set phone='123',full_name='Updated' where id='23000000-0000-0000-0000-000000000001'$$,'own contact fields remain editable');
select throws_ok($$update public.portal_profiles set email='forged@example.test' where id='23000000-0000-0000-0000-000000000001'$$,'42501',null,'identity email cannot be changed directly');
select throws_ok($$update public.portal_profiles set auth_user_id='33000000-0000-0000-0000-000000000003' where id='23000000-0000-0000-0000-000000000001'$$,'42501',null,'auth identity cannot be rebound');
select lives_ok($$insert into public.enrollment_application_courses(application_id,course_id) values('43000000-0000-0000-0000-000000000001','positive')$$,'draft course insert preserved');
select lives_ok($$select public.portal_save_document_review('43000000-0000-0000-0000-000000000001','{"first_name":"Ada"}','{}','["first_name"]','[]')$$,'draft manual confirmation preserved');
select lives_ok($$insert into public.enrollment_application_documents(id,application_id,category,storage_path,filename) values('53000000-0000-0000-0000-000000000001','43000000-0000-0000-0000-000000000001','Passport','43000000-0000-0000-0000-000000000001/a.pdf','a.pdf')$$,'draft document registration preserved');
select throws_ok($$update public.enrollment_application_documents set storage_path='43000000-0000-0000-0000-000000000001/b.pdf' where id='53000000-0000-0000-0000-000000000001'$$,'42501',null,'draft locator is immutable too');
select throws_ok($$insert into public.enrollment_application_documents(application_id,category,storage_path,filename) values('43000000-0000-0000-0000-000000000001','Passport','foreign/b.pdf','b.pdf')$$,'42501',null,'foreign prefix insertion denied');
select lives_ok($$insert into public.enrollment_application_messages(application_id,author,body) values('43000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Agency message')$$,'agency public message preserved');
select throws_ok($$insert into public.enrollment_application_messages(application_id,author,body,visibility) values('43000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Forged note','internal')$$,'42501',null,'agency internal-note insertion denied');
select lives_ok($$insert into public.enrollment_application_consents(application_id,method) values('43000000-0000-0000-0000-000000000001','Signed')$$,'draft consent recording preserved');
select lives_ok($$update public.portal_notifications set read=true where id='63000000-0000-0000-0000-000000000001'$$,'notification acknowledgement preserved');
select throws_ok($$update public.portal_notifications set title='Forged' where id='63000000-0000-0000-0000-000000000001'$$,'42501',null,'notification contents cannot be forged');
select lives_ok($$select public.portal_submit_application('43000000-0000-0000-0000-000000000001','{"values":{"first_name":"Ada"},"wizard":{"confirmed":["first_name"]}}')$$,'submission RPC preserved');
select is((select count(*)::int from public.enrollment_application_versions),1,'submission writes one immutable snapshot');
select is((select count(*)::int from public.enrollment_application_status_history),1,'status trigger writes history');
select throws_ok($$select public.portal_save_document_review('43000000-0000-0000-0000-000000000001','{"first_name":"Tamper"}')$$,'42501',null,'submitted manual changes denied');
set local request.jwt.claims='{"email":"positive-admin@example.test"}';
select is(public.portal_is_slit_admin(),false,'matching email cannot grant another UID administrator access');
set local request.jwt.claim.sub='33000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.agencies where id in ('13000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000002')),2,'SLIT admin agency visibility preserved');
select lives_ok($$select public.portal_save_document_review('43000000-0000-0000-0000-000000000001','{"first_name":"Admin correction"}')$$,'SLIT admin review correction preserved');
select lives_ok($$insert into public.enrollment_application_messages(application_id,author,body,visibility) values('43000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','Private','internal')$$,'SLIT admin internal note preserved');
select is((select count(*)::int from public.enrollment_application_messages where visibility='internal' and application_id='43000000-0000-0000-0000-000000000001'),1,'SLIT admin internal-note visibility preserved');
select * from finish();
rollback;
