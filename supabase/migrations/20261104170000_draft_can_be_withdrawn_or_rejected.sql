-- A SLIT administrator can close a draft from the status dropdown: Draft -> Withdrawn or Rejected. Submitting still
-- happens only from the form (validation, consent, frozen copy, receipt), so Draft -> Submitted stays out of this list.
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.portal_legacy_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable set search_path = public as $fn$
  select case p_from
    when 'draft' then p_to in ('withdrawn','rejected')
    when 'submitted' then p_to in ('action_required','offer_accepted','rejected','withdrawn')
    when 'action_required' then p_to in ('submitted','offer_accepted','rejected','withdrawn')
    when 'offer_accepted' then p_to in ('coe_issued','rejected','withdrawn')
    when 'coe_issued' then p_to in ('enrolled','withdrawn')
    -- Legacy rows (no longer selectable) can only move forward.
    when 'under_review' then p_to in ('action_required','offer_accepted','rejected','withdrawn')
    when 'offer_issued' then p_to in ('offer_accepted','rejected','withdrawn')
    else false end;
$fn$;

-- An institution's own workflow keeps its transitions; a draft may additionally be withdrawn or rejected.
create or replace function public.portal_pinned_transition_allowed(p_config jsonb, p_from text, p_to text, p_caller_role text, p_platform boolean) returns boolean
language sql immutable set search_path = public as $fn$
  select (p_from = 'draft' and p_to in ('withdrawn','rejected'))
   or (p_from <> 'draft' and exists (
    select 1 from jsonb_array_elements(p_config->'transitions') t
    where t->>'from' = p_from and t->>'to' = p_to
      and (not (t ? 'roles') or p_platform or (p_caller_role is not null and t->'roles' ? p_caller_role))));
$fn$;
