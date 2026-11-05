create table if not exists public.australian_course_catalogue (
  id uuid primary key default gen_random_uuid(),
  course_code text not null,
  course_name text not null,
  course_type text not null check (course_type in ('QUALIFICATION','ACCREDITED_COURSE')),
  aqf_level text,
  training_package_code text,
  training_package_name text,
  national_status text not null default 'CURRENT',
  release_number text,
  description text,
  entry_requirements text,
  packaging_rules text,
  total_units integer,
  core_units_count integer,
  elective_units_count integer,
  supersedes_code text,
  superseded_by_code text,
  source text not null default 'training.gov.au',
  source_url text,
  source_updated_at timestamptz,
  last_synced_at timestamptz not null default now(),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint australian_course_catalogue_code_unique unique (course_code)
);

create index if not exists australian_course_catalogue_name_idx
  on public.australian_course_catalogue using gin (to_tsvector('english', course_name));
create index if not exists australian_course_catalogue_code_idx
  on public.australian_course_catalogue (course_code);
create index if not exists australian_course_catalogue_status_idx
  on public.australian_course_catalogue (national_status, is_active);
create index if not exists australian_course_catalogue_type_idx
  on public.australian_course_catalogue (course_type);

alter table public.australian_course_catalogue enable row level security;

drop policy if exists "Authenticated users can read Australian course catalogue" on public.australian_course_catalogue;
create policy "Authenticated users can read Australian course catalogue"
  on public.australian_course_catalogue
  for select
  to authenticated
  using (true);

grant select on public.australian_course_catalogue to authenticated;

comment on table public.australian_course_catalogue is 'Master Australian nationally recognised course catalogue synced from training.gov.au; is_active is Skyline-specific activation state.';
comment on column public.australian_course_catalogue.national_status is 'Status from the national register, separate from Skyline is_active.';
