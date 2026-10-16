-- Align INSERT with the existing private-document read/update/delete policy.
-- It still requires that the object path begins with an application the caller
-- is authorised to access; it grants no cross-agency or arbitrary-bucket write.
-- Rollback: recreate this policy with `portal_is_agency_member()` as the sole
-- role predicate (the prior definition in migration 0006).
drop policy if exists portal_docs_obj_insert on storage.objects;
create policy portal_docs_obj_insert on storage.objects
  for insert with check (
    bucket_id = 'enrollment-documents'
    and (public.portal_is_slit_admin() or public.portal_is_agency_member())
    and public.portal_can_access_application(public.portal_path_app_id(name))
  );
