-- Audit writes can occur multiple times in one transaction. `now()` is
-- transaction-stable, so a review can tie with an earlier automatic candidate
-- and make chronological reads nondeterministic. Record the actual write time.
alter table public.enrollment_document_field_reviews
  alter column created_at set default clock_timestamp();
