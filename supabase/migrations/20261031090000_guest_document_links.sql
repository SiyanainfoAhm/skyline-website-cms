-- Migration 109: private guest links for student document submission. Additive; local only until released.
-- Only a SHA-256 hash of a 32-byte random token is stored. Agents create / revoke / read status through RPCs gated by portal_can_edit_application;
-- the guest Edge Function (service role) resolves a token through guest_link_resolve and then acts on that one application only.
-- Rollback (manual): drop the functions, the two tables and enrollment_application_documents.guest_link_id.
begin;

create table public.guest_document_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz
);

create index guest_document_links_application_idx on public.guest_document_links(application_id, created_at desc);

create table public.guest_link_consents (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.guest_document_links(id) on delete cascade,
  consent_version text not null check (length(consent_version) between 1 and 40),
  consented_at timestamptz not null default now()
);

create table public.guest_link_hits (
  bucket text not null,          -- 'link:<uuid>' or 'ip:<sha256 of ip>'
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (bucket, window_start)
);

alter table public.enrollment_application_documents add column guest_link_id uuid references public.guest_document_links(id) on delete set null;

alter table public.guest_document_links enable row level security;

alter table public.guest_link_consents enable row level security;

alter table public.guest_link_hits enable row level security;

revoke all on public.guest_document_links, public.guest_link_consents, public.guest_link_hits from public, anon, authenticated, service_role;

grant select, insert, update on public.guest_document_links, public.guest_link_consents, public.guest_link_hits to service_role;

grant delete on public.guest_link_hits to service_role;

-- Agent / admin: create. Returns the plain token ONCE; only its hash is kept. Any earlier live link for the application is revoked (resend = new link).
create function public.portal_create_guest_link(p_application uuid, p_days integer default 7) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a public.enrollment_applications; v_raw bytea := extensions.gen_random_bytes(32); v_token text; v_id uuid;
begin
  select * into a from public.enrollment_applications where id = p_application;
  if auth.uid() is null or not found or not public.portal_can_edit_application(p_application) or a.status not in ('draft', 'action_required') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.guest_document_links set revoked_at = now() where application_id = p_application and revoked_at is null;
  v_token := translate(encode(v_raw, 'base64'), '+/=', '-_');
  insert into public.guest_document_links(tenant_id, application_id, token_hash, expires_at, created_by)
  values (a.tenant_id, p_application, extensions.digest(v_raw, 'sha256'), now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30))), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end; $$;

create function public.portal_revoke_guest_link(p_application uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.portal_can_edit_application(p_application) then raise exception 'Not authorized' using errcode = '42501'; end if;
  update public.guest_document_links set revoked_at = now() where application_id = p_application and revoked_at is null;
end; $$;

-- Agent / admin: latest link status for the application card (never returns the hash or token).
create function public.portal_guest_link_status(p_application uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.guest_document_links;
begin
  if auth.uid() is null or not public.portal_can_access_application(p_application) then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into l from public.guest_document_links where application_id = p_application order by created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', l.id, 'createdAt', l.created_at, 'expiresAt', l.expires_at, 'sentAt', l.sent_at, 'lastUsedAt', l.last_used_at,
    'completedAt', l.completed_at, 'state', case when l.revoked_at is not null then 'revoked' when l.completed_at is not null then 'completed'
    when l.expires_at <= now() then 'expired' when l.last_used_at is not null then 'opened' else 'active' end);
end; $$;

-- Guest function only (service role): resolve a token hash to its one application. Null when unknown, expired or revoked (callers answer identically).
create function public.guest_link_resolve(p_hash bytea) returns table (link_id uuid, application_id uuid, tenant_id uuid, completed boolean)
language sql security definer set search_path = public as $$
  with hit as (
    update public.guest_document_links set last_used_at = now()
    where token_hash = p_hash and revoked_at is null and expires_at > now() returning id, application_id, tenant_id, completed_at)
  select h.id, h.application_id, h.tenant_id, h.completed_at is not null from hit h
  where exists (select 1 from public.enrollment_applications a where a.id = h.application_id and a.status in ('draft', 'action_required'));
$$;

-- Fixed-window rate limit, shared by token and IP buckets. True = allowed.
create function public.guest_rate_hit(p_bucket text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); v_hits integer;
begin
  delete from public.guest_link_hits where window_start < now() - interval '1 day';
  insert into public.guest_link_hits(bucket, window_start) values (p_bucket, v_start)
  on conflict (bucket, window_start) do update set hits = public.guest_link_hits.hits + 1 returning hits into v_hits;
  return v_hits <= p_limit;
end; $$;

revoke all on function public.portal_create_guest_link(uuid, integer), public.portal_revoke_guest_link(uuid), public.portal_guest_link_status(uuid),
  public.guest_link_resolve(bytea), public.guest_rate_hit(text, integer, integer) from public, anon, authenticated, service_role;

grant execute on function public.portal_create_guest_link(uuid, integer), public.portal_revoke_guest_link(uuid), public.portal_guest_link_status(uuid) to authenticated;

grant execute on function public.guest_link_resolve(bytea), public.guest_rate_hit(text, integer, integer) to service_role;

commit;
