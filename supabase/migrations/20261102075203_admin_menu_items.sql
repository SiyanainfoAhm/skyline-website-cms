-- Shared admin navigation definitions, NOT public website navigation or tenant
-- content. Every read is authorized against the current verified tenant scope.
-- Browser users cannot edit this shared configuration; backend service only.
create table public.admin_menu_items (
 id text primary key check (id ~ '^[a-z][a-z0-9_]{0,79}$'),
 parent_id text references public.admin_menu_items(id) on delete restrict,
 label text not null check (length(trim(label)) between 1 and 100),
 route text check (route is null or route ~ '^/(admin|agency)(/[a-z0-9-]+)*$' or route = '/'),
 icon_key text not null default 'folder' check (icon_key ~ '^[a-z][a-z0-9_]{0,39}$'),
 sort_order integer not null default 0,
 is_enabled boolean not null default true,
 permission_key text not null check (permission_key in ('cms.read','cms.admin','applications.review')),
 permission_scope text not null default 'current' check (permission_scope in ('current','legacy','tenant')),
 is_system boolean not null default false,
 open_in_new_tab boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (parent_id is distinct from id)
);
create index admin_menu_parent_order on public.admin_menu_items(parent_id, sort_order, id);
alter table public.admin_menu_items enable row level security;
revoke all on public.admin_menu_items from public, anon, authenticated, service_role;
grant select on public.admin_menu_items to authenticated;
grant select, insert, update, delete on public.admin_menu_items to service_role;

create function public.admin_menu_authorized(p_permission text, p_scope text) returns boolean
language sql stable security invoker set search_path = public as $$
 select coalesce(auth.uid() is not null and
   case when public.tenant_request_domain() is not null then
     p_scope in ('current','tenant') and public.tenant_current() is not null and
     case p_permission
       when 'cms.read' then public.tenant_has_role(public.tenant_current(),array['tenant_admin','editor'])
       when 'cms.admin' then public.tenant_has_role(public.tenant_current(),array['tenant_admin'])
       when 'applications.review' then public.portal_is_slit_admin()
       else false end
   else p_scope in ('current','legacy') and public.tenant_scope(null) and
     case p_permission
       when 'cms.read' then public.cms_is_staff()
       when 'cms.admin' then public.cms_is_admin()
       when 'applications.review' then public.portal_is_slit_admin()
       else false end
   end, false);
$$;
revoke all on function public.admin_menu_authorized(text,text) from public, anon, authenticated, service_role;
grant execute on function public.admin_menu_authorized(text,text) to authenticated;
create policy admin_menu_authorized_read on public.admin_menu_items for select to authenticated
using (is_enabled and public.admin_menu_authorized(permission_key, permission_scope));

-- Serialize configuration writes so concurrent reparenting cannot create cycles.
-- System labels/order/icons remain configurable; identity, access and destinations
-- require a reviewed forward migration instead of an ordinary backend edit.
create function public.admin_menu_protect() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
 perform pg_advisory_xact_lock(734621085);
 if tg_op = 'DELETE' then
   if old.is_system then raise exception 'System menu item is protected' using errcode='23514'; end if;
   return old;
 end if;
 if tg_op = 'UPDATE' and old.is_system and
   (new.id,new.route,new.permission_key,new.permission_scope,new.is_system)
   is distinct from (old.id,old.route,old.permission_key,old.permission_scope,old.is_system) then
   raise exception 'System menu identity and access are protected' using errcode='23514';
 end if;
 if tg_op = 'UPDATE' and new.id is distinct from old.id then
   raise exception 'Menu identity is immutable' using errcode='23514';
 end if;
 if new.parent_id is not null and exists (
   with recursive ancestors as (
     select id,parent_id from public.admin_menu_items where id=new.parent_id
     union
     select m.id,m.parent_id from public.admin_menu_items m join ancestors a on m.id=a.parent_id
   ) select 1 from ancestors where id=new.id
 ) then raise exception 'Menu hierarchy cycle' using errcode='23514'; end if;
 new.updated_at := now();
 return new;
end; $$;
revoke all on function public.admin_menu_protect() from public, anon, authenticated, service_role;

insert into public.admin_menu_items(id,parent_id,label,route,icon_key,sort_order,is_enabled,permission_key,permission_scope,is_system) values
 ('dashboard',null,'Dashboard','/admin','dashboard',0,true,'cms.read','current',true),
 ('admissions',null,'Admissions',null,'admissions',10,true,'applications.review','current',true),
 ('students',null,'Students',null,'students',20,false,'applications.review','current',true),
 ('courses',null,'Courses',null,'courses',30,true,'cms.read','current',true),
 ('agencies',null,'Agencies & Agents',null,'agencies',40,true,'applications.review','current',true),
 ('website',null,'Website',null,'website',50,true,'cms.read','current',true),
 ('communications',null,'Communications',null,'communications',60,true,'applications.review','current',true),
 ('automation',null,'AI & Automation',null,'knowledge',70,true,'cms.admin','legacy',true),
 ('administration',null,'Administration',null,'settings',80,true,'cms.admin','current',true),
 ('audit',null,'Audit & Activity',null,'activity',90,true,'cms.read','current',true),
 ('public_website',null,'View Public Website','/','external',100,true,'cms.read','current',true),
 ('applications','admissions','Applications','/agency/all-applications','admissions',10,true,'applications.review','current',true),
 ('registrations','admissions','Registrations','/agency/registrations','documents',20,true,'applications.review','current',true),
 ('course_catalogue','courses','Course Catalogue','/admin/courses','courses',10,true,'cms.read','current',true),
 ('agency_directory','agencies','Agencies','/agency/agencies','agencies',10,true,'applications.review','current',true),
 ('agent_users','agencies','Agents & Portal Users','/agency/users','users',20,true,'applications.review','current',true),
 ('pages','website','Pages','/admin/pages','pages',10,true,'cms.read','current',true),
 ('navigation','website','Header & Navigation','/admin/navigation','navigation',20,true,'cms.read','current',true),
 ('footer','website','Footer','/admin/footer','footer',30,true,'cms.read','current',true),
 ('forms','website','Forms','/admin/forms','forms',40,true,'cms.read','current',true),
 ('documents','website','Documents & Policies','/admin/documents','documents',50,true,'cms.read','current',true),
 ('contact','website','Contact','/admin/contact','contact',60,true,'cms.read','current',true),
 ('seo','website','SEO','/admin/seo','seo',70,true,'cms.read','current',true),
 ('media','website','Media Library',null,'documents',80,false,'cms.read','current',true),
 ('settings','website','Website Settings','/admin/settings','settings',90,true,'cms.read','current',true),
 ('social','website','Social Links','/admin/settings','external',100,true,'cms.read','current',true),
 ('notifications','communications','Notifications','/agency/notifications','communications',10,true,'applications.review','current',true),
 ('knowledge','automation','Assistant Knowledge','/admin/knowledge','knowledge',10,true,'cms.admin','legacy',true),
 ('extraction','automation','Document Extraction','/admin/knowledge/documents','extraction',20,true,'cms.admin','legacy',true),
 ('users','administration','Users & Permissions','/admin/users','users',10,true,'cms.admin','legacy',true),
 ('institution','administration','Institution','/admin/institution','institution',20,true,'cms.admin','tenant',true),
 ('activity','audit','Activity Log','/admin/activity','activity',10,true,'cms.read','current',true),
 ('portal_audit','audit','Admissions Audit','/agency/audit-log','activity',20,true,'applications.review','current',true);

create trigger protect_admin_menu before insert or update or delete on public.admin_menu_items
for each row execute function public.admin_menu_protect();
