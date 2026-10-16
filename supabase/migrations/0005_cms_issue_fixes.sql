-- =====================================================================
-- Skyline Website CMS — 8-issue fix migration (additive only)
-- Run AFTER 0004. Safe to run more than once (all statements guarded).
-- =====================================================================

-- ---------------------------------------------------------------- Issue 2
-- Units of competency — structured rows (code / name / core-elective),
-- distinct from free-text course sections.
create table if not exists public.cms_course_units (
  id text primary key,
  course_id text not null,
  code text not null default '',
  name text not null default '',
  category text not null default 'Core',
  sort integer not null default 0
);

create index if not exists idx_cms_course_units_course on public.cms_course_units (course_id, sort);

alter table public.cms_course_units enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'cms_course_units' and policyname = 'cms_course_units_read') then
    create policy cms_course_units_read on public.cms_course_units
      for select using (
        public.cms_is_staff()
        or exists (select 1 from public.cms_courses c where c.id = course_id and c.status = 'Published')
      );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'cms_course_units' and policyname = 'cms_course_units_write') then
    create policy cms_course_units_write on public.cms_course_units
      for all using (public.cms_is_staff()) with check (public.cms_is_staff());
  end if;
end $$;

-- ---------------------------------------------------------------- Issue 7
-- Per field-type configuration (default, placeholder, char limits,
-- min/max/step, allowed file types, max size). Nullable, filled by the app.
alter table public.cms_form_fields add column if not exists config jsonb;

-- ---------------------------------------------------------------- Issue 8
-- Explicit social icon + enabled flag so the public site renders the exact
-- platform icon chosen by the admin and can hide disabled profiles.
alter table public.cms_social_links add column if not exists icon text not null default '';
alter table public.cms_social_links add column if not exists visible boolean not null default true;

-- ---------------------------------------------------------------- Issue 1
-- CMS-managed homepage imagery (hero slideshow + about image).
alter table public.cms_settings add column if not exists home_hero_images jsonb not null default '[]'::jsonb;
alter table public.cms_settings add column if not exists home_about_image text not null default '';