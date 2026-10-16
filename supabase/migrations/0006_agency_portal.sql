-- =====================================================================
-- Skyline Agency Portal — 0006
-- Agencies, portal users, and agency/agent-scoped enrolment applications.
--
-- Security model (enforced in the database, not just the UI):
--   * SLIT Admin      — an Active CMS Admin (cms_users.role = 'Admin').
--                       Sees every agency, application and document.
--   * Agency Admin    — agency_memberships.role = 'agency_admin'.
--                       Sees everything belonging to their own agency.
--   * Agent           — agency_memberships.role = 'agent'.
--                       Sees only applications assigned to them, in their agency.
--
-- This migration is additive and does not touch the existing cms_* or
-- frozen student_* tables. Safe to run more than once where guarded.
-- =====================================================================

-- ------------------------------------------------------------- Helper fns
-- These helpers reference portal tables declared below.  Keep body validation
-- disabled only while defining them so a fresh database can create the schema
-- in this migration; validation occurs when they are first invoked after the
-- tables exist.
set check_function_bodies = off;
create or replace function public.portal_profile_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.id from public.portal_profiles p
  where p.auth_user_id = auth.uid() and p.status = 'Active'
  limit 1;
$$;

create or replace function public.portal_agency_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select m.agency_id from public.agency_memberships m
  where m.user_id = public.portal_profile_id() and m.status = 'Active'
  limit 1;
$$;

create or replace function public.portal_is_agency_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.portal_agency_id() is not null;
$$;

create or replace function public.portal_is_agency_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.agency_memberships m
    where m.user_id = public.portal_profile_id()
      and m.status = 'Active' and m.role = 'agency_admin'
  );
$$;

create or replace function public.portal_is_agent()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.agency_memberships m
    where m.user_id = public.portal_profile_id()
      and m.status = 'Active' and m.role = 'agent'
  );
$$;

-- SLIT Admin = an Active CMS Admin. Matched by Auth uid, with an email
-- fallback for legacy CMS rows that predate auth_user_id linking.
create or replace function public.portal_is_slit_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.cms_users u
    where u.status = 'Active' and u.role = 'Admin'
      and (
        u.auth_user_id = auth.uid()
        or lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  );
$$;

-- Can the caller read the given application (used by every child table + storage).
create or replace function public.portal_can_access_application(app_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.enrollment_applications a
    where a.id = app_id and (
      public.portal_is_slit_admin()
      or (
        a.agency_id = public.portal_agency_id()
        and (
          public.portal_is_agency_admin()
          or a.assigned_agent_id = public.portal_profile_id()
        )
      )
    )
  );
$$;

-- Storage path guard: the first path segment must be an application UUID.
create or replace function public.portal_path_app_id(object_name text)
returns uuid
language sql immutable
as $$
  select case
    when (storage.foldername(object_name))[1] ~ '^[0-9a-fA-F-]{36}$'
      then ((storage.foldername(object_name))[1])::uuid
    else null
  end;
$$;

-- ---------------------------------------------------------------- Tables
set check_function_bodies = on;
create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  code text not null,
  registration_number text not null default '',
  business_email text not null default '',
  phone text not null default '',
  address text not null default '',
  country text not null default '',
  primary_contact text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_agencies_code on public.agencies (lower(code));

create table if not exists public.portal_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  full_name text not null default '',
  email text not null default '',
  phone text not null default '',
  job_title text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agency_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.portal_profiles(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  role text not null default 'agent' check (role in ('agency_admin', 'agent')),
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_memberships_agency on public.agency_memberships (agency_id);

create table if not exists public.enrollment_applications (
  id uuid primary key default gen_random_uuid(),
  reference text,
  agency_id uuid not null references public.agencies(id) on delete restrict,
  created_by uuid references public.portal_profiles(id) on delete set null,
  assigned_agent_id uuid references public.portal_profiles(id) on delete set null,
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'under_review', 'action_required', 'offer_issued',
    'offer_accepted', 'coe_issued', 'enrolled', 'rejected', 'withdrawn'
  )),
  student_name text not null default '',
  student_email text not null default '',
  intake text not null default '',
  completion integer not null default 0,
  data jsonb not null default jsonb_object(array[]::text[]),
  submitted_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_applications_reference on public.enrollment_applications (reference) where reference is not null;
create index if not exists idx_applications_agency on public.enrollment_applications (agency_id);
create index if not exists idx_applications_agent on public.enrollment_applications (assigned_agent_id);
create index if not exists idx_applications_status on public.enrollment_applications (status);

create table if not exists public.enrollment_application_courses (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  course_id text not null,
  course_code text not null default '',
  course_title text not null default '',
  variant text not null default '',
  created_at timestamptz not null default now(),
  unique (application_id, course_id, variant)
);

create table if not exists public.enrollment_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  category text not null default 'Other',
  bucket_name text not null default 'enrollment-documents',
  storage_path text not null,
  filename text not null,
  mime_type text,
  file_size bigint,
  uploaded_by uuid references public.portal_profiles(id) on delete set null,
  review_state text not null default 'Pending' check (review_state in ('Pending', 'Accepted', 'Rejected')),
  revision_of uuid references public.enrollment_application_documents(id) on delete set null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_app_docs_application on public.enrollment_application_documents (application_id);

create table if not exists public.enrollment_application_status_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  previous_status text,
  new_status text not null,
  actor uuid,
  actor_name text not null default '',
  actor_role text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_app_history_application on public.enrollment_application_status_history (application_id);

create table if not exists public.enrollment_application_messages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  author uuid,
  author_name text not null default '',
  author_role text not null default '',
  body text not null,
  visibility text not null default 'agency' check (visibility in ('agency', 'internal')),
  created_at timestamptz not null default now()
);

create table if not exists public.enrollment_application_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  request_type text not null default 'correction' check (request_type in ('correction', 'document')),
  title text not null default '',
  detail text not null default '',
  requested_by uuid,
  requested_by_name text not null default '',
  state text not null default 'open' check (state in ('open', 'resolved')),
  response text not null default '',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.enrollment_application_consents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  method text not null default '',
  signed_document_ref text not null default '',
  declaration_version text not null default '',
  recorded_by uuid,
  recorded_by_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.enrollment_application_versions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null default jsonb_object(array[]::text[]),
  created_by uuid,
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.portal_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient uuid not null,
  application_id uuid references public.enrollment_applications(id) on delete cascade,
  reference text not null default '',
  event text not null default '',
  title text not null default '',
  message text not null default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_recipient on public.portal_notifications (recipient, read);

create table if not exists public.portal_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid,
  actor_name text not null default '',
  actor_role text not null default '',
  action text not null default '',
  target_type text not null default '',
  target_id text not null default '',
  agency_id uuid,
  application_id uuid,
  detail jsonb not null default jsonb_object(array[]::text[]),
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_agency on public.portal_audit_log (agency_id);

-- -------------------------------------------- Status history + notify trig
create or replace function public.portal_on_application_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_note text := coalesce(current_setting('portal.status_note', true), '');
  v_name text;
  v_role text;
  v_app_ref text;
begin
  new.updated_at := now();

  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.status is distinct from old.status then
    select coalesce(
             (select p.full_name from public.portal_profiles p where p.auth_user_id = auth.uid() limit 1),
             (select c.name from public.cms_users c where c.auth_user_id = auth.uid() limit 1),
             'System'
           ) into v_name;

    v_role := case
      when public.portal_is_slit_admin() then 'slit_admin'
      when public.portal_is_agency_admin() then 'agency_admin'
      when public.portal_is_agent() then 'agent'
      else 'system'
    end;

    insert into public.enrollment_application_status_history
      (application_id, previous_status, new_status, actor, actor_name, actor_role, note)
    values (new.id, old.status, new.status, auth.uid(), v_name, v_role, v_note);

    -- Notify the assigned agent + the agency's admins.
    v_app_ref := coalesce(new.reference, left(new.id::text, 8));
    insert into public.portal_notifications (recipient, application_id, reference, event, title, message)
    select p.auth_user_id, new.id, v_app_ref, 'status_change',
           'Application ' || v_app_ref || ' is now ' || replace(new.status, '_', ' '),
           'Status changed from ' || replace(old.status, '_', ' ') || ' to ' || replace(new.status, '_', ' ') || '.'
    from public.portal_profiles p
    where p.status = 'Active' and p.auth_user_id is not null
      and (
        p.id = new.assigned_agent_id
        or exists (
          select 1 from public.agency_memberships m
          where m.user_id = p.id and m.agency_id = new.agency_id
            and m.status = 'Active' and m.role = 'agency_admin'
        )
      );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_portal_application_change on public.enrollment_applications;
create trigger trg_portal_application_change
  before insert or update on public.enrollment_applications
  for each row execute function public.portal_on_application_change();

-- ------------------------------------------------------------ Enable RLS
alter table public.agencies enable row level security;
alter table public.portal_profiles enable row level security;
alter table public.agency_memberships enable row level security;
alter table public.enrollment_applications enable row level security;
alter table public.enrollment_application_courses enable row level security;
alter table public.enrollment_application_documents enable row level security;
alter table public.enrollment_application_status_history enable row level security;
alter table public.enrollment_application_messages enable row level security;
alter table public.enrollment_application_requests enable row level security;
alter table public.enrollment_application_consents enable row level security;
alter table public.enrollment_application_versions enable row level security;
alter table public.portal_notifications enable row level security;
alter table public.portal_audit_log enable row level security;

-- --------------------------------------------------------- Policies: agencies
drop policy if exists portal_agencies_read on public.agencies;
create policy portal_agencies_read on public.agencies
  for select using (
    public.portal_is_slit_admin()
    or id = public.portal_agency_id()
    or public.portal_is_agency_member()
  );

drop policy if exists portal_agencies_write on public.agencies;
create policy portal_agencies_write on public.agencies
  for all using (public.portal_is_slit_admin())
  with check (public.portal_is_slit_admin());

-- ---------------------------------------------------- Policies: portal_profiles
drop policy if exists portal_profiles_read on public.portal_profiles;
create policy portal_profiles_read on public.portal_profiles
  for select using (
    public.portal_is_slit_admin()
    or auth_user_id = auth.uid()
    or (
      public.portal_is_agency_admin()
      and id in (select m.user_id from public.agency_memberships m where m.agency_id = public.portal_agency_id())
    )
  );

drop policy if exists portal_profiles_insert on public.portal_profiles;
create policy portal_profiles_insert on public.portal_profiles
  for insert with check (public.portal_is_slit_admin() or auth_user_id = auth.uid());

drop policy if exists portal_profiles_update on public.portal_profiles;
create policy portal_profiles_update on public.portal_profiles
  for update using (public.portal_is_slit_admin() or auth_user_id = auth.uid())
  with check (public.portal_is_slit_admin() or auth_user_id = auth.uid());

-- -------------------------------------------------- Policies: agency_memberships
drop policy if exists portal_memberships_read on public.agency_memberships;
create policy portal_memberships_read on public.agency_memberships
  for select using (
    public.portal_is_slit_admin()
    or user_id = public.portal_profile_id()
    or (public.portal_is_agency_admin() and agency_id = public.portal_agency_id())
  );

-- Membership changes are provisioned by SLIT Admin only (server-side flow).
drop policy if exists portal_memberships_write on public.agency_memberships;
create policy portal_memberships_write on public.agency_memberships
  for all using (public.portal_is_slit_admin())
  with check (public.portal_is_slit_admin());

-- ---------------------------------------------- Policies: enrollment_applications
drop policy if exists portal_applications_read on public.enrollment_applications;
create policy portal_applications_read on public.enrollment_applications
  for select using (
    public.portal_is_slit_admin()
    or (
      agency_id = public.portal_agency_id()
      and (public.portal_is_agency_admin() or assigned_agent_id = public.portal_profile_id())
    )
  );

drop policy if exists portal_applications_insert on public.enrollment_applications;
create policy portal_applications_insert on public.enrollment_applications
  for insert with check (
    public.portal_is_slit_admin()
    or (
      public.portal_is_agency_member()
      and agency_id = public.portal_agency_id()
      and created_by = public.portal_profile_id()
      and status in ('draft', 'submitted')
    )
  );

-- Agency users may only move an application to draft/submitted and agents may not
-- reassign ownership. Admissions-only statuses are reserved for SLIT Admin.
drop policy if exists portal_applications_update on public.enrollment_applications;
create policy portal_applications_update on public.enrollment_applications
  for update using (
    public.portal_is_slit_admin()
    or (
      agency_id = public.portal_agency_id()
      and (public.portal_is_agency_admin() or assigned_agent_id = public.portal_profile_id())
    )
  )
  with check (
    public.portal_is_slit_admin()
    or (
      agency_id = public.portal_agency_id()
      and status in ('draft', 'submitted')
      and (public.portal_is_agency_admin() or assigned_agent_id = public.portal_profile_id())
    )
  );

drop policy if exists portal_applications_delete on public.enrollment_applications;
create policy portal_applications_delete on public.enrollment_applications
  for delete using (
    public.portal_is_slit_admin()
    or (
      agency_id = public.portal_agency_id()
      and status = 'draft'
      and (public.portal_is_agency_admin() or assigned_agent_id = public.portal_profile_id())
    )
  );

-- --------------------------------------------- Policies: child tables (shared)
-- Courses
drop policy if exists portal_app_courses_read on public.enrollment_application_courses;
create policy portal_app_courses_read on public.enrollment_application_courses
  for select using (public.portal_can_access_application(application_id));
drop policy if exists portal_app_courses_write on public.enrollment_application_courses;
create policy portal_app_courses_write on public.enrollment_application_courses
  for all using (public.portal_can_access_application(application_id))
  with check (public.portal_can_access_application(application_id));

-- Documents
drop policy if exists portal_app_docs_read on public.enrollment_application_documents;
create policy portal_app_docs_read on public.enrollment_application_documents
  for select using (public.portal_can_access_application(application_id));
drop policy if exists portal_app_docs_write on public.enrollment_application_documents;
create policy portal_app_docs_write on public.enrollment_application_documents
  for all using (public.portal_can_access_application(application_id))
  with check (public.portal_can_access_application(application_id));

-- Status history
drop policy if exists portal_app_history_read on public.enrollment_application_status_history;
create policy portal_app_history_read on public.enrollment_application_status_history
  for select using (public.portal_can_access_application(application_id));
drop policy if exists portal_app_history_write on public.enrollment_application_status_history;
create policy portal_app_history_write on public.enrollment_application_status_history
  for all using (public.portal_can_access_application(application_id))
  with check (public.portal_can_access_application(application_id));

-- Messages (SLIT-only internal notes hidden from agency users)
drop policy if exists portal_app_messages_read on public.enrollment_application_messages;
create policy portal_app_messages_read on public.enrollment_application_messages
  for select using (
    public.portal_can_access_application(application_id)
    and (visibility <> 'internal' or public.portal_is_slit_admin())
  );
drop policy if exists portal_app_messages_write on public.enrollment_application_messages;
create policy portal_app_messages_write on public.enrollment_application_messages
  for all using (public.portal_can_access_application(application_id))
  with check (public.portal_can_access_application(application_id));

-- Requests
drop policy if exists portal_app_requests_read on public.enrollment_application_requests;
create policy portal_app_requests_read on public.enrollment_application_requests
  for select using (public.portal_can_access_application(application_id));
drop policy if exists portal_app_requests_write on public.enrollment_application_requests;
create policy portal_app_requests_write on public.enrollment_application_requests
  for all using (public.portal_can_access_application(application_id))
  with check (public.portal_can_access_application(application_id));

-- Consents
drop policy if exists portal_app_consents_read on public.enrollment_application_consents;
create policy portal_app_consents_read on public.enrollment_application_consents
  for select using (public.portal_can_access_application(application_id));
drop policy if exists portal_app_consents_write on public.enrollment_application_consents;
create policy portal_app_consents_write on public.enrollment_application_consents
  for all using (public.portal_can_access_application(application_id))
  with check (public.portal_can_access_application(application_id));

-- Versions
drop policy if exists portal_app_versions_read on public.enrollment_application_versions;
create policy portal_app_versions_read on public.enrollment_application_versions
  for select using (public.portal_can_access_application(application_id));
drop policy if exists portal_app_versions_write on public.enrollment_application_versions;
create policy portal_app_versions_write on public.enrollment_application_versions
  for all using (public.portal_can_access_application(application_id))
  with check (public.portal_can_access_application(application_id));

-- Notifications (own inbox only)
drop policy if exists portal_notifications_read on public.portal_notifications;
create policy portal_notifications_read on public.portal_notifications
  for select using (recipient = auth.uid());
drop policy if exists portal_notifications_update on public.portal_notifications;
create policy portal_notifications_update on public.portal_notifications
  for update using (recipient = auth.uid()) with check (recipient = auth.uid());

-- Audit log (SLIT Admin sees all; agency admins see their own agency)
drop policy if exists portal_audit_read on public.portal_audit_log;
create policy portal_audit_read on public.portal_audit_log
  for select using (
    public.portal_is_slit_admin()
    or (public.portal_is_agency_admin() and agency_id = public.portal_agency_id())
  );
drop policy if exists portal_audit_write on public.portal_audit_log;
create policy portal_audit_write on public.portal_audit_log
  for all using (public.portal_is_slit_admin()) with check (public.portal_is_slit_admin());

-- ---------------------------------------------------------------- Storage
insert into storage.buckets (id, name, public)
  values ('enrollment-documents', 'enrollment-documents', false)
  on conflict (id) do nothing;

drop policy if exists portal_docs_obj_read on storage.objects;
create policy portal_docs_obj_read on storage.objects
  for select using (
    bucket_id = 'enrollment-documents'
    and (
      public.portal_is_slit_admin()
      or public.portal_can_access_application(public.portal_path_app_id(name))
    )
  );

drop policy if exists portal_docs_obj_insert on storage.objects;
create policy portal_docs_obj_insert on storage.objects
  for insert with check (
    bucket_id = 'enrollment-documents'
    and public.portal_is_agency_member()
    and public.portal_can_access_application(public.portal_path_app_id(name))
  );

drop policy if exists portal_docs_obj_update on storage.objects;
create policy portal_docs_obj_update on storage.objects
  for update using (
    bucket_id = 'enrollment-documents'
    and (public.portal_is_slit_admin() or public.portal_is_agency_member())
    and public.portal_can_access_application(public.portal_path_app_id(name))
  );

drop policy if exists portal_docs_obj_delete on storage.objects;
create policy portal_docs_obj_delete on storage.objects
  for delete using (
    bucket_id = 'enrollment-documents'
    and (public.portal_is_slit_admin() or public.portal_is_agency_member())
    and public.portal_can_access_application(public.portal_path_app_id(name))
  );

-- ------------------------------- Status RPC (SLIT Admin, with audit + note)
create or replace function public.portal_set_application_status(
  p_application_id uuid,
  p_status text,
  p_note text default ''
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_before text;
begin
  if not public.portal_is_slit_admin() then
    raise exception 'Only SLIT Admin can change admissions status';
  end if;
  if p_status not in (
    'draft','submitted','under_review','action_required','offer_issued',
    'offer_accepted','coe_issued','enrolled','rejected','withdrawn'
  ) then
    raise exception 'Unknown status: %', p_status;
  end if;

  perform set_config('portal.status_note', coalesce(p_note, ''), true);
  select status into v_before from public.enrollment_applications where id = p_application_id;
  update public.enrollment_applications set status = p_status where id = p_application_id;

  insert into public.portal_audit_log (actor, actor_name, actor_role, action, target_type, target_id, application_id, detail)
  values (
    auth.uid(),
    coalesce((select name from public.cms_users where auth_user_id = auth.uid() limit 1), 'SLIT Admin'),
    'slit_admin', 'status_change', 'application', p_application_id::text, p_application_id,
    jsonb_build_object('from', v_before, 'to', p_status, 'note', p_note)
  );
end;
$$;
