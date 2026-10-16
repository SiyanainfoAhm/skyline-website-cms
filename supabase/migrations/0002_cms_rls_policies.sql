-- =====================================================================
-- Skyline Website CMS — RLS, helpers & storage
-- Project: Skyline Test (dev)  |  Target ref: xcpydisstlvtvcsqnjob
-- Run AFTER 0001_cms_schema.sql. Safe to run only on the CMS project.
-- =====================================================================

-- ------------------------------------------------------------- Helper fns
-- Staff = an Active row in cms_users matching the signed-in user's email.
create or replace function public.cms_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cms_users u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.status = 'Active'
  );
$$;

create or replace function public.cms_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cms_users u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.status = 'Active'
      and u.role = 'Admin'
  );
$$;

-- ------------------------------------------------------------ Enable RLS
alter table public.cms_settings enable row level security;
alter table public.cms_social_links enable row level security;
alter table public.cms_users enable row level security;
alter table public.cms_courses enable row level security;
alter table public.cms_course_sections enable row level security;
alter table public.cms_course_attachments enable row level security;
alter table public.cms_course_links enable row level security;
alter table public.cms_pages enable row level security;
alter table public.cms_forms enable row level security;
alter table public.cms_form_fields enable row level security;
alter table public.cms_documents enable row level security;
alter table public.cms_navigation_items enable row level security;
alter table public.cms_footer enable row level security;
alter table public.cms_seo enable row level security;
alter table public.cms_revisions enable row level security;
alter table public.cms_activity_log enable row level security;

-- ------------------------------------------------- Published content reads
create policy cms_courses_read on public.cms_courses for select using (status = 'Published' or public.cms_is_staff());
create policy cms_courses_write on public.cms_courses for all using (public.cms_is_staff()) with check (public.cms_is_staff());
create policy cms_pages_read on public.cms_pages for select using (status = 'Published' or public.cms_is_staff());
create policy cms_pages_write on public.cms_pages for all using (public.cms_is_staff()) with check (public.cms_is_staff());
create policy cms_forms_read on public.cms_forms for select using (status = 'Published' or public.cms_is_staff());
create policy cms_forms_write on public.cms_forms for all using (public.cms_is_staff()) with check (public.cms_is_staff());
create policy cms_documents_read on public.cms_documents for select using (status = 'Published' or public.cms_is_staff());
create policy cms_documents_write on public.cms_documents for all using (public.cms_is_staff()) with check (public.cms_is_staff());

create policy cms_course_sections_read on public.cms_course_sections for select using (public.cms_is_staff() or exists (select 1 from public.cms_courses c where c.id = course_id and c.status = 'Published'));
create policy cms_course_sections_write on public.cms_course_sections for all using (public.cms_is_staff()) with check (public.cms_is_staff());
create policy cms_course_attachments_read on public.cms_course_attachments for select using (public.cms_is_staff() or exists (select 1 from public.cms_courses c where c.id = course_id and c.status = 'Published'));
create policy cms_course_attachments_write on public.cms_course_attachments for all using (public.cms_is_staff()) with check (public.cms_is_staff());
create policy cms_course_links_read on public.cms_course_links for select using (public.cms_is_staff() or exists (select 1 from public.cms_courses c where c.id = course_id and c.status = 'Published'));
create policy cms_course_links_write on public.cms_course_links for all using (public.cms_is_staff()) with check (public.cms_is_staff());
create policy cms_form_fields_read on public.cms_form_fields for select using (public.cms_is_staff() or exists (select 1 from public.cms_forms f where f.id = form_id and f.status = 'Published'));
create policy cms_form_fields_write on public.cms_form_fields for all using (public.cms_is_staff()) with check (public.cms_is_staff());

-- ----------------------------------------------- Always-public config reads
create policy cms_navigation_read on public.cms_navigation_items for select using (true);
create policy cms_navigation_write on public.cms_navigation_items for all using (public.cms_is_staff()) with check (public.cms_is_staff());
create policy cms_footer_read on public.cms_footer for select using (true);
create policy cms_footer_write on public.cms_footer for all using (public.cms_is_staff()) with check (public.cms_is_staff());
create policy cms_settings_read on public.cms_settings for select using (true);
create policy cms_settings_write on public.cms_settings for all using (public.cms_is_staff()) with check (public.cms_is_staff());
create policy cms_social_read on public.cms_social_links for select using (true);
create policy cms_social_write on public.cms_social_links for all using (public.cms_is_staff()) with check (public.cms_is_staff());
create policy cms_seo_read on public.cms_seo for select using (true);
create policy cms_seo_write on public.cms_seo for all using (public.cms_is_staff()) with check (public.cms_is_staff());

-- ------------------------------------------------------- Staff-only tables
create policy cms_users_read on public.cms_users for select using (public.cms_is_staff());
create policy cms_users_write on public.cms_users for all using (public.cms_is_admin()) with check (public.cms_is_admin());
create policy cms_revisions_read on public.cms_revisions for select using (public.cms_is_staff());
create policy cms_revisions_write on public.cms_revisions for all using (public.cms_is_staff()) with check (public.cms_is_staff());
create policy cms_activity_read on public.cms_activity_log for select using (public.cms_is_staff());
create policy cms_activity_write on public.cms_activity_log for all using (public.cms_is_staff()) with check (public.cms_is_staff());

-- ----------------------------------------------------------------- Storage
insert into storage.buckets (id, name, public) values ('cms-media', 'cms-media', true)
on conflict (id) do nothing;

create policy cms_media_public_read on storage.objects for select using (bucket_id = 'cms-media');
create policy cms_media_staff_write on storage.objects for all using (bucket_id = 'cms-media' and public.cms_is_staff()) with check (bucket_id = 'cms-media' and public.cms_is_staff());