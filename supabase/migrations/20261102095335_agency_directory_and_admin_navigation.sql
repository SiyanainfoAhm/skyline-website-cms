-- One business per normalized name/country, regardless of how many registered
-- contacts the external importer finds. Do not copy the registry into portal
-- accounts, change imported statuses, or grant imported businesses portal access.
-- The import table already exists hosted; capture its shape for clean local replay.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
 if to_regclass('public.omara_agents') is null then
  create table public.omara_agents (
   id uuid primary key default gen_random_uuid(),marn text not null unique check(btrim(marn)<>''),
   first_name text,family_name text,full_name text not null check(btrim(full_name)<>''),business_name text,
   registration_status text not null default 'Registered',country text not null default 'Australia',
   state text,suburb text,postcode text,business_address text,phone text,email text,website text,
   registration_start_date date,omara_contact_id text,source_url text,source_last_checked_at timestamptz,
   last_seen_at timestamptz,last_synced_at timestamptz not null default now(),is_active boolean not null default true,
   created_at timestamptz not null default now(),updated_at timestamptz not null default now()
  );
  alter table public.omara_agents enable row level security;
  revoke all on public.omara_agents from public,anon,authenticated;
  grant select on public.omara_agents to authenticated;
  grant select,insert,update,delete on public.omara_agents to service_role;
  create policy admin_directory_read on public.omara_agents for select to authenticated using(public.portal_is_slit_admin());
 end if;
end $$;
create function public.agency_directory_key(p_name text,p_country text) returns text
language sql immutable parallel safe set search_path=public as $$
 select md5(lower(regexp_replace(btrim(coalesce(p_name,'')),'\s+',' ','g'))||'|'||lower(btrim(coalesce(p_country,''))));
$$;
revoke all on function public.agency_directory_key(text,text) from public,anon;
grant execute on function public.agency_directory_key(text,text) to authenticated,service_role;

alter table public.agencies add column directory_key text generated always as
 (public.agency_directory_key(name,country)) stored;
create unique index agencies_directory_business_unique on public.agencies(directory_key);
create index omara_business_lookup on public.omara_agents
 (public.agency_directory_key(coalesce(nullif(btrim(business_name),''),nullif(btrim(full_name),''),'Registered agent '||marn),country));

create function public.admin_agency_directory(p_search text default '',p_status text default '',p_limit integer default 25,p_offset integer default 0,p_key text default null)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.portal_is_slit_admin() then
  raise exception 'Agency administration required' using errcode='42501';
 end if;
 if public.tenant_request_domain() is not null and public.tenant_current() is null then
  raise exception 'Unknown institution' using errcode='42501';
 end if;
 if coalesce(p_status,'') not in ('','Active','Inactive') then raise exception 'Invalid agency status' using errcode='22023'; end if;
 with registered as (
  select distinct on (public.agency_directory_key(coalesce(nullif(btrim(o.business_name),''),nullif(btrim(o.full_name),''),'Registered agent '||o.marn),o.country))
   public.agency_directory_key(coalesce(nullif(btrim(o.business_name),''),nullif(btrim(o.full_name),''),'Registered agent '||o.marn),o.country) as directory_key,
   coalesce(nullif(btrim(o.business_name),''),nullif(btrim(o.full_name),''),'Registered agent '||o.marn) as name,
   coalesce(o.country,'') as country,coalesce(o.business_address,'') as address,coalesce(o.phone,'') as phone,
   coalesce(o.email,'') as business_email,coalesce(o.full_name,'') as primary_contact,o.is_active,o.marn,o.created_at
  from public.omara_agents o
  order by public.agency_directory_key(coalesce(nullif(btrim(o.business_name),''),nullif(btrim(o.full_name),''),'Registered agent '||o.marn),o.country),
   o.is_active desc,(nullif(btrim(o.email),'') is not null) desc,(nullif(btrim(o.phone),'') is not null) desc,
   (nullif(btrim(o.business_address),'') is not null) desc,o.last_synced_at desc nulls last,o.id
 ), local_agencies as (
  select a.* from public.agencies a
  where case when public.tenant_request_domain() is null then public.tenant_scope(null)
   else exists(select 1 from public.agency_tenants t where t.agency_id=a.id and t.tenant_id=public.tenant_current() and t.active) end
 ), directory as (
  select a.id::text as id,a.id::text as existing_agency_id,a.directory_key,a.name,a.code,a.registration_number,
   a.business_email,a.phone,a.address,a.country,a.primary_contact,
   case when a.status='Active' then 'Active' else 'Inactive' end as status,a.is_permanent,a.created_at,
   (select count(*) from public.agency_memberships m where m.agency_id=a.id and m.role='agent') as agent_count,
   (select count(*) from public.enrollment_applications e where e.agency_id=a.id) as application_count,
   'portal'::text as source,''::text as marn
  from local_agencies a
  union all
  select 'directory:'||r.directory_key,null,r.directory_key,r.name,'OMARA-'||upper(left(r.directory_key,8)),''::text,
   r.business_email,r.phone,r.address,r.country,r.primary_contact,
   case when r.is_active then 'Active' else 'Inactive' end,false,r.created_at,0,0,'directory',r.marn
  from registered r where not exists(select 1 from local_agencies a where a.directory_key=r.directory_key)
 ), filtered as (
  select * from directory d where
   (coalesce(p_key,'')='' or d.directory_key=p_key) and
   (coalesce(p_status,'')='' or d.status=p_status) and
   (coalesce(btrim(p_search),'')='' or strpos(lower(concat_ws(' ',d.name,d.code,d.business_email,d.primary_contact)),lower(left(btrim(p_search),200)))>0)
 ), page as (
  select * from filtered order by case when status='Active' then 0 else 1 end,lower(name),id
  limit least(greatest(coalesce(p_limit,25),1),100) offset least(greatest(coalesce(p_offset,0),0),1000000)
 )
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(p) order by case when p.status='Active' then 0 else 1 end,lower(p.name),p.id) from page p),'[]'::jsonb)) into result;
 return result;
end; $$;
revoke all on function public.admin_agency_directory(text,text,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_agency_directory(text,text,integer,integer,text) to authenticated;

-- A reviewed migration changes a system destination. Browser roles have no
-- writes, and the ALTER holds the configuration table lock until commit.
alter table public.admin_menu_items disable trigger protect_admin_menu;
update public.admin_menu_items set label='Agencies',route='/admin/agencies' where id='agencies';
update public.admin_menu_items set is_enabled=false where id in ('agent_users','agency_directory');
alter table public.admin_menu_items enable trigger protect_admin_menu;
