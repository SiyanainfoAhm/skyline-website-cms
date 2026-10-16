-- These SECURITY DEFINER functions are internal trigger handlers. Triggers
-- execute them as the table owner; no API role needs direct EXECUTE access.
revoke all on function public.public_assistant_queue_cms_source() from public, anon, authenticated;
revoke all on function public.public_assistant_invalidate_faq_cache() from public, anon, authenticated;
