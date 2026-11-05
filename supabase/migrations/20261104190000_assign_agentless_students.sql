-- One-off: every student without an agent gets one from their own business: the active agency admin, else an active
-- agent, else any agent of the business (oldest first). A business with no agents at all leaves its student unassigned.
-- Applications are not changed; the lists show the student's agent when no portal agent is assigned.
set local lock_timeout='5s';
set local statement_timeout='60s';

update public.enrollment_students s set agent_id = (
 select g.id from public.agents g
 where g.business_id = s.agency_id
 order by (g.role = 'agency_admin' and g.status = 'Active') desc, (g.status = 'Active') desc, (g.role = 'agency_admin') desc, g.created_at, g.id
 limit 1)
where s.agent_id is null
 and exists (select 1 from public.agents g where g.business_id = s.agency_id);
