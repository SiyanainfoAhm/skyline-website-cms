-- CMS file objects: additive metadata on the existing attachment/document rows.
-- Apply after 0005. Object keys are intentionally unique and never inferred from URLs.

alter table public.cms_course_attachments
  add column if not exists original_file_name text,
  add column if not exists storage_file_name text,
  add column if not exists bucket_name text,
  add column if not exists storage_path text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint,
  add column if not exists created_at timestamptz not null default now();

alter table public.cms_documents
  add column if not exists original_file_name text,
  add column if not exists storage_file_name text,
  add column if not exists bucket_name text,
  add column if not exists storage_path text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint,
  add column if not exists created_at timestamptz not null default now();

alter table public.cms_course_attachments
  drop constraint if exists cms_course_attachments_bucket_name_check,
  add constraint cms_course_attachments_bucket_name_check check (bucket_name is null or bucket_name = 'cms-media');
alter table public.cms_documents
  drop constraint if exists cms_documents_bucket_name_check,
  add constraint cms_documents_bucket_name_check check (bucket_name is null or bucket_name = 'cms-media');

create index if not exists idx_cms_course_attachments_storage_path
  on public.cms_course_attachments (bucket_name, storage_path) where storage_path is not null;
create index if not exists idx_cms_documents_storage_path
  on public.cms_documents (bucket_name, storage_path) where storage_path is not null;
