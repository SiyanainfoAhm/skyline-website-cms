-- Migration 106: footer flags (Acknowledgement of Country band). Additive; local only until released.
-- cms_footer has no suitable column for them, so three are added: a switch (on by default) and the two image URLs (empty by default,
-- in which case the site tries licensed files in public/flags/ and otherwise shows no flags). Existing rows, RLS and the tenant triggers
-- are unchanged. The CMS only sends these columns once the footer holds them, so saving the footer never depends on this migration.
-- The tenant public media bucket did not accept SVG; flag images may be SVG, so image/svg+xml is added to its allowed types (the CMS refuses
-- an SVG that contains script before it is uploaded). cms-media (the legacy site) has no type restriction.
-- Rollback (manual): drop the three columns; remove 'image/svg+xml' from storage.buckets.allowed_mime_types for tenant-public-media.
begin;

alter table public.cms_footer
  add column show_flags boolean not null default true,
  add column aboriginal_flag_url text not null default '' check (length(aboriginal_flag_url) <= 2000),
  add column torres_strait_flag_url text not null default '' check (length(torres_strait_flag_url) <= 2000);

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'image/svg+xml')
where id = 'tenant-public-media' and allowed_mime_types is not null and not ('image/svg+xml' = any(allowed_mime_types));

commit;
