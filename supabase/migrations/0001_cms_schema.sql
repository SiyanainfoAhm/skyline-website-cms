-- =====================================================================
-- Skyline Website CMS — Core Schema
-- Project: Skyline Test (dev)  |  Target ref: xcpydisstlvtvcsqnjob
-- All tables use the cms_ prefix. Nothing here touches student-management
-- tables (skyline_* / ax_*). Safe to run on the CMS project only.
-- =====================================================================

-- ------------------------------------------------------------------ Settings
create table if not exists public.cms_settings (
  id smallint primary key default 1 check (id = 1),
  name text not null default '',
  short_name text not null default '',
  logo text not null default '',
  favicon text not null default '',
  phone text not null default '',
  email text not null default '',
  admissions_email text not null default '',
  address text not null default '',
  rto text not null default '',
  cricos text not null default '',
  sign_in_url text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.cms_social_links (
  id text primary key,
  settings_id smallint not null default 1 references public.cms_settings(id) on delete cascade,
  label text not null default '',
  href text not null default '',
  sort integer not null default 0
);

-- --------------------------------------------------------------------- Users
create table if not exists public.cms_users (
  id text primary key,
  name text not null default '',
  email text not null unique,
  role text not null default 'Editor' check (role in ('Admin', 'Editor')),
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  last_login text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------- Courses
create table if not exists public.cms_courses (
  id text primary key,
  slug text not null unique,
  code text not null default '',
  cricos text not null default '',
  name text not null default '',
  category text not null default '',
  training_package text not null default '',
  duration text not null default '',
  mode text not null default '',
  short_description text not null default '',
  full_description text not null default '',
  entry_requirements text not null default '',
  career text not null default '',
  fees text not null default '',
  image text not null default '',
  status text not null default 'Draft' check (status in ('Published', 'Draft')),
  display_order integer not null default 0,
  featured boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.cms_course_sections (
  id text primary key,
  course_id text not null references public.cms_courses(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  sort integer not null default 0
);

create table if not exists public.cms_course_attachments (
  id text primary key,
  course_id text not null references public.cms_courses(id) on delete cascade,
  name text not null default '',
  url text not null default '',
  sort integer not null default 0
);

create table if not exists public.cms_course_links (
  id text primary key,
  course_id text not null references public.cms_courses(id) on delete cascade,
  label text not null default '',
  url text not null default '',
  external boolean not null default false,
  sort integer not null default 0
);

-- --------------------------------------------------------------------- Pages
create table if not exists public.cms_pages (
  id text primary key,
  name text not null default '',
  slug text not null unique,
  title text not null default '',
  body text not null default '',
  in_nav boolean not null default false,
  seo_title text not null default '',
  seo_description text not null default '',
  status text not null default 'Draft' check (status in ('Published', 'Draft')),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- --------------------------------------------------------------------- Forms
create table if not exists public.cms_forms (
  id text primary key,
  name text not null default '',
  description text not null default '',
  status text not null default 'Draft' check (status in ('Published', 'Draft')),
  updated_at timestamptz not null default now()
);

create table if not exists public.cms_form_fields (
  id text primary key,
  form_id text not null references public.cms_forms(id) on delete cascade,
  label text not null default '',
  type text not null default 'Text',
  required boolean not null default false,
  help text not null default '',
  options jsonb not null default '[]'::jsonb,
  visible boolean not null default true,
  sort integer not null default 0
);

-- ----------------------------------------------------------------- Documents
create table if not exists public.cms_documents (
  id text primary key,
  name text not null default '',
  category text not null default '',
  description text not null default '',
  file_name text not null default '',
  url text not null default '',
  size_label text not null default '',
  docs_count integer not null default 1,
  status text not null default 'Draft' check (status in ('Published', 'Draft')),
  display_order integer not null default 0
);

-- ---------------------------------------------------------------- Navigation
create table if not exists public.cms_navigation_items (
  id text primary key,
  parent_id text references public.cms_navigation_items(id) on delete cascade,
  label text not null default '',
  to_path text not null default '',
  external boolean not null default false,
  visible boolean not null default true,
  sort integer not null default 0
);

-- -------------------------------------------------------------------- Footer
create table if not exists public.cms_footer (
  id smallint primary key default 1 check (id = 1),
  about text not null default '',
  quick_links_title text not null default 'Quick Links',
  student_links_title text not null default 'Student Links',
  acknowledgement text not null default '',
  copyright text not null default '',
  show_acknowledgement boolean not null default true
);

-- ----------------------------------------------------------------------- SEO
create table if not exists public.cms_seo (
  id text primary key,
  page text not null default '',
  path text not null default '',
  title text not null default '',
  description text not null default '',
  keywords text not null default ''
);

-- ---------------------------------------------------------------- Revisions
create table if not exists public.cms_revisions (
  id text primary key,
  entity text not null,
  entity_id text not null,
  title text not null default '',
  action text not null default '',
  status text not null default 'Draft',
  "by" text,
  at timestamptz not null default now(),
  snapshot jsonb
);

-- -------------------------------------------------------------- Activity log
create table if not exists public.cms_activity_log (
  id text primary key,
  "user" text,
  action text not null default '',
  item text not null default '',
  area text not null default '',
  at timestamptz not null default now()
);

-- ------------------------------------------------------------------ Indexes
create index if not exists idx_cms_courses_status on public.cms_courses (status);
create index if not exists idx_cms_courses_order on public.cms_courses (display_order);
create index if not exists idx_cms_courses_featured on public.cms_courses (featured);
create index if not exists idx_cms_course_sections_course on public.cms_course_sections (course_id, sort);
create index if not exists idx_cms_course_attachments_course on public.cms_course_attachments (course_id, sort);
create index if not exists idx_cms_course_links_course on public.cms_course_links (course_id, sort);
create index if not exists idx_cms_pages_status on public.cms_pages (status);
create index if not exists idx_cms_form_fields_form on public.cms_form_fields (form_id, sort);
create index if not exists idx_cms_documents_category on public.cms_documents (category, display_order);
create index if not exists idx_cms_navigation_parent on public.cms_navigation_items (parent_id, sort);
create index if not exists idx_cms_revisions_entity on public.cms_revisions (entity, entity_id);
create index if not exists idx_cms_activity_at on public.cms_activity_log (at desc);