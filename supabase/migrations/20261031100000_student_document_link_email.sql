-- Migration 110: email the guest document link to the student. Additive; local only until released. Requires migration 109.
-- One new outbox event, 'student_document_link'. notification_enqueue_deliveries (trigger on admission_event_outbox) returns early for any event
-- it does not know, so existing events are untouched; this RPC writes the delivery itself with recipient_user NULL (the recipient_email path
-- from migration 20261027060000). It applies the same gates as existing events: tenant activation (pending vs suppressed), the approved
-- sender, and the delivery worker. Event settings (admin recipients, notifyStudent) are not read.
-- The outbox payload carries only the send id (no token, address or name). The delivery body holds the link, so the token sits in
-- notification_deliveries (service_role only) until the link expires; the token is useless after expiry or revocation.
-- Rollback (manual): drop function portal_send_guest_link_email, table guest_link_sends, column guest_document_links.sent_to_email.
begin;

alter table public.guest_document_links add column sent_to_email text;

-- One row per send. channel is open to a later 'whatsapp' by widening the check; only 'email' exists now.
create table public.guest_link_sends (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.guest_document_links(id) on delete cascade,
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  tenant_id uuid,
  channel text not null check (channel in ('email')),
  recipient text not null check (length(recipient) <= 254),
  sent_by uuid not null,
  sent_at timestamptz not null default now(),
  outbox_id uuid references public.admission_event_outbox(id)
);

create index guest_link_sends_application_idx on public.guest_link_sends(application_id, sent_at desc);

create index guest_link_sends_agent_idx on public.guest_link_sends(sent_by, sent_at desc);

alter table public.guest_link_sends enable row level security;

revoke all on public.guest_link_sends from public, anon, authenticated, service_role;

grant select on public.guest_link_sends to service_role;

-- p_link / p_token come from portal_create_guest_link (migration 109); the token must match the stored hash. p_host must be a verified
-- domain of the application's tenant, so an agent cannot point the email at another site.
create function public.portal_send_guest_link_email(p_link uuid, p_token text, p_email text, p_host text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.guest_document_links; a public.enrollment_applications; v_email text := lower(btrim(coalesce(p_email, '')));
  v_agent text; v_tenant text; v_tz text; v_cfg jsonb; v_cfg_id uuid; v_sender jsonb; v_active boolean; v_outbox uuid; v_send uuid;
  v_subject text; v_body text; v_url text; v_state text; v_reason text;
begin
  select * into l from public.guest_document_links where id = p_link;
  if auth.uid() is null or not found then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into a from public.enrollment_applications where id = l.application_id;
  if not public.portal_can_edit_application(l.application_id) or a.status not in ('draft', 'action_required') then raise exception 'Not authorized' using errcode = '42501'; end if;
  if l.revoked_at is not null or l.expires_at <= now() or l.created_by <> auth.uid()
     or l.token_hash is distinct from extensions.digest(decode(translate(coalesce(p_token, ''), '-_', '+/') || repeat('=', (4 - length(coalesce(p_token, '')) % 4) % 4), 'base64'), 'sha256') then
    raise exception 'Link is not valid' using errcode = '22023'; end if;
  if v_email = '' or length(v_email) > 254 or v_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' then
    raise exception 'Invalid email address' using errcode = '22023'; end if;
  if not exists (select 1 from public.tenant_domains d where d.hostname = lower(coalesce(p_host, '')) and d.tenant_id is not distinct from a.tenant_id and d.verified_at is not null) then
    raise exception 'Unknown site address' using errcode = '22023'; end if;

  -- Serialise per application and per agent so concurrent clicks cannot exceed the limits.
  perform pg_advisory_xact_lock(hashtext('guest_send_app:' || a.id::text));
  perform pg_advisory_xact_lock(hashtext('guest_send_agent:' || auth.uid()::text));
  if (select count(*) from public.guest_link_sends where application_id = a.id and sent_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.guest_link_sends where sent_by = auth.uid() and sent_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many sends. Try again later.' using errcode = '54000'; end if;

  select coalesce(nullif(btrim(p.full_name), ''), 'Your agent') into v_agent from public.portal_profiles p where p.auth_user_id = auth.uid();
  select coalesce((select name from public.tenants where id = a.tenant_id), 'Skyline') into v_tenant;
  select coalesce((select s.timezone from public.cms_settings s where s.tenant_id is not distinct from a.tenant_id limit 1), 'Australia/Sydney') into v_tz;
  v_url := 'https://' || lower(p_host) || '/documents/' || p_token;
  v_subject := 'Please upload your documents for ' || v_tenant;
  -- No document names, no personal data, no attachments: tenant, link, expiry, agent name, ignore line.
  v_body := v_tenant || E' has asked you to upload your documents.\n\nUse this private link:\n' || v_url ||
    E'\n\nThe link expires on ' || to_char(l.expires_at at time zone v_tz, 'DD Mon YYYY') || E'.\n\nSent by ' || v_agent ||
    E'.\n\nDidn''t expect this? You can ignore this email; nothing happens unless you open the link.';

  select id, config into v_cfg_id, v_cfg from public.tenant_config_versions where tenant_id = a.tenant_id and kind = 'notifications' and state = 'published';
  v_sender := case when v_cfg->'sender' is not null and public.notification_sender_allowed(a.tenant_id, v_cfg->'sender'->>'email') then v_cfg->'sender' else null end;
  v_active := exists (select 1 from public.notification_activation act where act.revoked_at is null and act.tenant_id is not distinct from a.tenant_id);
  v_state := case when v_active then 'pending' else 'suppressed' end;
  v_reason := case when v_active then null else 'legacy_scope_not_activated' end;

  v_send := gen_random_uuid();
  insert into public.admission_event_outbox(application_id, tenant_id, event, payload)
  values (a.id, a.tenant_id, 'student_document_link', jsonb_build_object('sendId', v_send)) returning id into v_outbox;
  insert into public.notification_deliveries(outbox_id, tenant_id, application_id, recipient_user, recipient_email, event, template_source, template_version_id, sender, subject, body, state, state_reason, created_at)
  values (v_outbox, a.tenant_id, a.id, null, v_email, 'student_document_link', case when v_cfg is null then 'default' else 'published' end, v_cfg_id, v_sender, v_subject, v_body, v_state, v_reason, clock_timestamp());
  insert into public.guest_link_sends(id, link_id, application_id, tenant_id, channel, recipient, sent_by, outbox_id)
  values (v_send, l.id, a.id, a.tenant_id, 'email', v_email, auth.uid(), v_outbox);
  update public.guest_document_links set sent_to_email = v_email, sent_at = now() where id = l.id;
  return jsonb_build_object('sentAt', now(), 'recipient', regexp_replace(v_email, '^(.).*(@.*)$', '\1***\2'), 'delivery', v_state);
end; $$;

-- Last send for the application card: masked address and time only.
create function public.portal_guest_link_last_send(p_application uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.guest_link_sends;
begin
  if auth.uid() is null or not public.portal_can_access_application(p_application) then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into s from public.guest_link_sends where application_id = p_application order by sent_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('channel', s.channel, 'sentAt', s.sent_at, 'recipient', regexp_replace(s.recipient, '^(.).*(@.*)$', '\1***\2'));
end; $$;

revoke all on function public.portal_send_guest_link_email(uuid, text, text, text), public.portal_guest_link_last_send(uuid) from public, anon, authenticated, service_role;

grant execute on function public.portal_send_guest_link_email(uuid, text, text, text), public.portal_guest_link_last_send(uuid) to authenticated;

commit;
