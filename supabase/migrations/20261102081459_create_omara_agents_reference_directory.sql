create extension if not exists pg_trgm with schema extensions;

create table public.omara_agents (
  id uuid primary key default gen_random_uuid(),
  marn text not null unique,
  first_name text,
  family_name text,
  full_name text not null,
  business_name text,
  registration_status text not null default 'Registered',
  country text not null default 'Australia',
  state text,
  suburb text,
  postcode text,
  business_address text,
  phone text,
  email text,
  website text,
  registration_start_date date,
  omara_contact_id text,
  source_url text,
  source_last_checked_at timestamptz,
  last_seen_at timestamptz,
  last_synced_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint omara_agents_marn_not_blank check (btrim(marn) <> ''),
  constraint omara_agents_full_name_not_blank check (btrim(full_name) <> '')
);

create index omara_agents_full_name_trgm_idx
  on public.omara_agents using gin (full_name extensions.gin_trgm_ops);

create index omara_agents_business_name_trgm_idx
  on public.omara_agents using gin (business_name extensions.gin_trgm_ops);

create index omara_agents_marn_trgm_idx
  on public.omara_agents using gin (marn extensions.gin_trgm_ops);

create index omara_agents_active_status_idx
  on public.omara_agents (is_active, registration_status);

alter table public.omara_agents enable row level security;

grant select on table public.omara_agents to authenticated;
grant all on table public.omara_agents to service_role;

create policy "Authenticated users can search OMARA directory"
  on public.omara_agents
  for select
  to authenticated
  using (true);

comment on table public.omara_agents is 'Local reference/cache of publicly available OMARA migration-agent directory records for CRM lookup and verification; not the Skyline agencies/customer table.';
