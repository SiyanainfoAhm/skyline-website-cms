-- CMS sidebar for the Businesses, Agents and Students pages. Apply together with the frontend
-- release that has those routes: before it, these links lead to pages the site does not have.
-- Agencies becomes a group. The ALTER holds the configuration table lock until commit.
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.admin_menu_items disable trigger protect_admin_menu;
update public.admin_menu_items set route = null where id = 'agencies';
insert into public.admin_menu_items(id, parent_id, label, route, icon_key, sort_order, is_enabled, permission_key, permission_scope, is_system) values
 ('agency_businesses', 'agencies', 'Businesses', '/admin/businesses', 'agencies', 10, true, 'cms.admin', 'current', true),
 ('agency_agents', 'agencies', 'Agents', '/admin/agents', 'users', 20, true, 'cms.admin', 'current', true),
 ('agency_students', 'agencies', 'Students', '/admin/students', 'students', 30, true, 'cms.admin', 'current', true)
on conflict (id) do update set parent_id = excluded.parent_id, label = excluded.label, route = excluded.route, is_enabled = true;
alter table public.admin_menu_items enable trigger protect_admin_menu;
