-- Migration 103 follow-up: the passport, birth-place and driving-licence answers are the student's too.
-- Widens is_student_field and moves those answers off the applications that still hold them.
set local lock_timeout='5s';
set local statement_timeout='120s';

create or replace function public.is_student_field(p_key text) returns boolean
language sql immutable parallel safe as $fn$
 select p_key in (
  'passport_copy','title','first_name','middle_name','last_name','dob','gender','mobile','email','confirm_email','email_note',
  'citizenship','nationality','birth_country','place_of_birth','issuing_country','passport_number','passport_expiry',
  'address_type','address_source','address_note','holds_visa',
  'atsi','employment','language_home','language_other','secondary_enrolled','school_level','highest_education','year_completed','prior_ed','disability',
  'has_usi','usi_number','usi_consent','usi_note')
  or p_key like any (array['au\_%','ov\_%','ec\_%','visa\_%','english\_%','academic\_%','usi\_%','passport\_%','licence\_%','birth\_%']);
$fn$;

-- Replay only the applications that still hold one of them, oldest first.
do $do$ declare r record; begin
 for r in select e.id from public.enrollment_applications e
  where exists (select 1 from jsonb_object_keys(coalesce(e.data -> 'values', '{}'::jsonb)) k where public.is_student_field(k))
  order by e.updated_at, e.id loop
  update public.enrollment_applications set data = data where id = r.id;
 end loop;
end $do$;
