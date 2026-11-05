-- One backend catalogue of statuses, used by every filter, tab and status dropdown: applications (in workflow order),
-- businesses and agents. The screens read it instead of carrying their own lists.
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.portal_status_catalog() returns jsonb
language sql stable security definer set search_path = public as $fn$
 select jsonb_build_object(
  'application', public.portal_application_statuses(),
  'business', jsonb_build_array(
   jsonb_build_object('value','Active','label','Active'),
   jsonb_build_object('value','Inactive','label','Inactive')),
  'agent', jsonb_build_array(
   jsonb_build_object('value','Active','label','Active','note','Approved and signed in'),
   jsonb_build_object('value','Invited','label','Invited','note','Approved, invitation not accepted yet'),
   jsonb_build_object('value','Inactive','label','Inactive','note','Cannot sign in')));
$fn$;
revoke all on function public.portal_status_catalog() from public, anon;
grant execute on function public.portal_status_catalog() to authenticated;
