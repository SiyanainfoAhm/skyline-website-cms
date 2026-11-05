
-- Additive business / agent / student relationships. Existing application API columns remain.
CREATE TABLE public.businesses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
 directory_name_key text UNIQUE,
 identity_status text NOT NULL DEFAULT 'unverified'
   CHECK (identity_status IN ('directory_candidate','unverified','verified','archived')),
 registration_country text,
 registration_type text,
 registration_number text,
 verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((registration_country IS NULL AND registration_type IS NULL AND registration_number IS NULL)
 OR (nullif(btrim(registration_country),'') IS NOT NULL AND nullif(btrim(registration_type),'') IS NOT NULL AND nullif(btrim(registration_number),'') IS NOT NULL)),
 CHECK (identity_status <> 'verified' OR (registration_number IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE UNIQUE INDEX businesses_registration_identity ON public.businesses
 (upper(btrim(registration_country)),lower(btrim(registration_type)),upper(regexp_replace(registration_number,'\s','','g')))
 WHERE registration_number IS NOT NULL;
CREATE INDEX businesses_display_name_trgm ON public.businesses USING gin(display_name gin_trgm_ops);
COMMENT ON TABLE public.businesses IS 'Canonical business IDs. OMARA name groups are directory candidates, not verified legal entities. Verify legal identifiers before onboarding/merging. Private business contacts remain in agencies.';
COMMENT ON COLUMN public.businesses.directory_name_key IS 'Source grouping key only; never proof of legal identity.';
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.businesses FROM anon,authenticated;
GRANT SELECT ON public.businesses TO authenticated;
GRANT ALL ON public.businesses TO service_role;
CREATE POLICY businesses_directory_read ON public.businesses FOR SELECT TO authenticated USING (true);
GRANT INSERT ON public.businesses TO authenticated;
CREATE POLICY businesses_admin_create_unverified ON public.businesses FOR INSERT TO authenticated
 WITH CHECK(public.portal_is_slit_admin() AND identity_status='unverified' AND directory_name_key IS NULL
 AND registration_country IS NULL AND registration_type IS NULL AND registration_number IS NULL AND verified_at IS NULL);

CREATE TABLE public.business_agent_affiliations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
 omara_agent_id uuid NOT NULL REFERENCES public.omara_agents(id) ON DELETE RESTRICT,
 source text NOT NULL DEFAULT 'omara' CHECK(source IN ('omara','verified_onboarding')),
 relationship_status text NOT NULL DEFAULT 'directory_reported' CHECK(relationship_status IN ('directory_reported','verified','ended')),
 first_seen_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 CHECK (ended_at IS NULL OR ended_at >= first_seen_at),
 CHECK ((relationship_status='ended') = (ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX business_agent_current_pair ON public.business_agent_affiliations(business_id,omara_agent_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX business_agent_current_omara ON public.business_agent_affiliations(omara_agent_id) WHERE source='omara' AND ended_at IS NULL;
CREATE INDEX business_agent_omara_history ON public.business_agent_affiliations(omara_agent_id,first_seen_at);
ALTER TABLE public.business_agent_affiliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_agent_affiliations FROM anon,authenticated;
GRANT SELECT ON public.business_agent_affiliations TO authenticated;
GRANT ALL ON public.business_agent_affiliations TO service_role;
CREATE POLICY business_affiliations_directory_read ON public.business_agent_affiliations FOR SELECT TO authenticated USING (true);
COMMENT ON TABLE public.business_agent_affiliations IS 'Public directory relationships only, not login permissions. End relationships instead of deleting history. Agents may have more than one verified business affiliation.';

INSERT INTO public.businesses(display_name,directory_name_key,identity_status)
 SELECT min(btrim(business_name)),lower(btrim(business_name)),'directory_candidate'
 FROM public.omara_agents WHERE nullif(btrim(business_name),'') IS NOT NULL
 GROUP BY lower(btrim(business_name));
INSERT INTO public.business_agent_affiliations(business_id,omara_agent_id,first_seen_at,last_seen_at)
 SELECT b.id,a.id,coalesce(a.last_seen_at,now()),coalesce(a.last_seen_at,now())
 FROM public.omara_agents a JOIN public.businesses b ON b.directory_name_key=lower(btrim(a.business_name));

CREATE FUNCTION public.omara_attach_directory_business() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE k text; bid uuid;
BEGIN
 k:=nullif(lower(btrim(NEW.business_name)),'');
 IF k IS NULL THEN RETURN NEW; END IF;
 INSERT INTO public.businesses(display_name,directory_name_key,identity_status)
 VALUES(btrim(NEW.business_name),k,'directory_candidate')
 ON CONFLICT(directory_name_key) DO NOTHING;
 SELECT id INTO bid FROM public.businesses WHERE directory_name_key=k;
 INSERT INTO public.business_agent_affiliations(business_id,omara_agent_id,first_seen_at,last_seen_at)
 VALUES(bid,NEW.id,coalesce(NEW.last_seen_at,now()),coalesce(NEW.last_seen_at,now()))
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.omara_attach_directory_business() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER omara_directory_business_after_insert AFTER INSERT ON public.omara_agents
 FOR EACH ROW EXECUTE FUNCTION public.omara_attach_directory_business();

ALTER TABLE public.agencies ADD COLUMN business_id uuid REFERENCES public.businesses(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX agencies_business_identity ON public.agencies(business_id) WHERE business_id IS NOT NULL;
DO $fn$
DECLARE a record; bid uuid;
BEGIN
 FOR a IN SELECT id,name FROM public.agencies ORDER BY id LOOP
  INSERT INTO public.businesses(display_name,identity_status)
  VALUES(coalesce(nullif(btrim(a.name),''),'Unnamed onboarded business'),'unverified')
  RETURNING id INTO bid;
  UPDATE public.agencies SET business_id=bid WHERE id=a.id;
 END LOOP;
END $fn$;
COMMENT ON COLUMN public.agencies.business_id IS 'Business master for this onboarded agency account. Verify a directory candidate before linking it. One agency account per business; institution links remain in agency_tenants.';
-- Keep existing agency creation compatible while ensuring every onboarded agency has a master ID.
CREATE FUNCTION public.agency_ensure_business_identity() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF NEW.business_id IS NULL THEN
  INSERT INTO public.businesses(display_name,identity_status)
   VALUES(coalesce(nullif(btrim(NEW.name),''),'Unnamed onboarded business'),'unverified')
   RETURNING id INTO NEW.business_id;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.agency_ensure_business_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER agency_business_identity_before_write BEFORE INSERT OR UPDATE OF business_id ON public.agencies
 FOR EACH ROW EXECUTE FUNCTION public.agency_ensure_business_identity();
ALTER TABLE public.agencies ALTER COLUMN business_id SET NOT NULL;

CREATE TABLE public.agent_directory_links (
 profile_id uuid PRIMARY KEY REFERENCES public.portal_profiles(id) ON DELETE RESTRICT,
 omara_agent_id uuid NOT NULL UNIQUE REFERENCES public.omara_agents(id) ON DELETE RESTRICT,
 verified_at timestamptz NOT NULL DEFAULT now(),
 verification_evidence text NOT NULL CHECK(length(btrim(verification_evidence))>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_directory_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_directory_links FROM anon,authenticated;
GRANT SELECT ON public.agent_directory_links TO authenticated;
GRANT ALL ON public.agent_directory_links TO service_role;
CREATE POLICY agent_directory_links_read ON public.agent_directory_links FOR SELECT TO authenticated
 USING(profile_id=public.portal_profile_id() OR
   EXISTS(SELECT 1 FROM public.agency_memberships m WHERE m.user_id=profile_id AND public.portal_is_slit_admin()));
COMMENT ON TABLE public.agent_directory_links IS 'Verified link from a portal login profile to an OMARA person. Server-managed; users cannot claim a MARN to gain access. No guessed name matches are backfilled.';

-- Enforce that the assigned portal agent belongs to the application's agency.
ALTER TABLE public.enrollment_applications ADD CONSTRAINT application_assigned_agent_membership
 FOREIGN KEY(assigned_agent_id,agency_id) REFERENCES public.agency_memberships(user_id,agency_id)
 DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX application_agent_agency_idx ON public.enrollment_applications(assigned_agent_id,agency_id);

CREATE TABLE public.enrollment_students (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE RESTRICT,
 tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
 student_profile_id uuid REFERENCES public.student_profiles(id) ON DELETE RESTRICT,
 full_name text NOT NULL DEFAULT '',
 email text,
 phone text,
 date_of_birth date,
 created_by uuid REFERENCES public.portal_profiles(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,agency_id),
 FOREIGN KEY(agency_id,tenant_id) REFERENCES public.agency_tenants(agency_id,tenant_id)
);
CREATE INDEX enrollment_students_agency_tenant_idx ON public.enrollment_students(agency_id,tenant_id);
CREATE INDEX enrollment_students_tenant_idx ON public.enrollment_students(tenant_id);
CREATE INDEX enrollment_students_profile_idx ON public.enrollment_students(student_profile_id);
CREATE INDEX enrollment_students_creator_idx ON public.enrollment_students(created_by);
ALTER TABLE public.enrollment_students ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enrollment_students FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.enrollment_students TO authenticated;
GRANT ALL ON public.enrollment_students TO service_role;
ALTER TABLE public.enrollment_applications ADD COLUMN student_id uuid;
ALTER TABLE public.enrollment_applications ADD CONSTRAINT application_student_same_agency
 FOREIGN KEY(student_id,agency_id) REFERENCES public.enrollment_students(id,agency_id) ON DELETE RESTRICT;
CREATE INDEX enrollment_applications_student_agency_idx ON public.enrollment_applications(student_id,agency_id);
CREATE POLICY enrollment_students_read ON public.enrollment_students FOR SELECT TO authenticated
 USING(public.tenant_scope(tenant_id) AND (
 public.portal_is_slit_admin() OR
 (agency_id=public.portal_agency_id() AND created_by=public.portal_profile_id() AND
 (tenant_id IS NULL OR public.tenant_agency_access(tenant_id,agency_id))) OR
 (agency_id=public.portal_agency_id() AND public.portal_is_agency_admin() AND
  (tenant_id IS NULL OR public.tenant_agency_access(tenant_id,agency_id))) OR
 EXISTS(SELECT 1 FROM public.enrollment_applications a WHERE a.student_id=enrollment_students.id AND public.portal_can_access_application(a.id))
 ));
CREATE POLICY enrollment_students_insert ON public.enrollment_students FOR INSERT TO authenticated
 WITH CHECK(public.tenant_scope(tenant_id) AND (
 public.portal_is_slit_admin() OR
 (agency_id=public.portal_agency_id() AND public.portal_is_agency_member() AND
  created_by=public.portal_profile_id() AND
  (tenant_id IS NULL OR public.tenant_agency_access(tenant_id,agency_id)))
 ));
CREATE POLICY enrollment_students_update ON public.enrollment_students FOR UPDATE TO authenticated
 USING(public.tenant_scope(tenant_id) AND (public.portal_is_slit_admin() OR
 (agency_id=public.portal_agency_id() AND public.portal_is_agency_admin() AND
 (tenant_id IS NULL OR public.tenant_agency_access(tenant_id,agency_id)))))
 WITH CHECK(public.tenant_scope(tenant_id) AND (public.portal_is_slit_admin() OR
 (agency_id=public.portal_agency_id() AND public.portal_is_agency_admin() AND
 (tenant_id IS NULL OR public.tenant_agency_access(tenant_id,agency_id)))));
COMMENT ON TABLE public.enrollment_students IS 'Agency/institution-scoped CRM student identity, including students without logins. student_profiles remains the self-service login profile. Reuse student_id for further applications; do not merge people by email/name alone.';
COMMENT ON COLUMN public.enrollment_applications.student_id IS 'CRM student identity. Required CRM student identity. Legacy inserts are automatically given a new student ID; submit an existing student_id to reuse the same learner. student_name/email/data remain application snapshots.';

CREATE FUNCTION public.application_verify_student_scope() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE s record;
BEGIN
 IF TG_OP='INSERT' AND NEW.student_id IS NULL THEN
  INSERT INTO public.enrollment_students(agency_id,tenant_id,full_name,email,created_by)
  VALUES(NEW.agency_id,NEW.tenant_id,NEW.student_name,nullif(NEW.student_email,''),NEW.created_by)
  RETURNING id INTO NEW.student_id;
 END IF;
 IF NEW.student_id IS NOT NULL THEN
  SELECT agency_id,tenant_id INTO s FROM public.enrollment_students WHERE id=NEW.student_id;
  IF NOT FOUND OR s.agency_id IS DISTINCT FROM NEW.agency_id OR s.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
   RAISE EXCEPTION 'Student identity must belong to the same agency and institution' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.application_verify_student_scope() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER z_student_identity_scope BEFORE INSERT OR UPDATE OF student_id,agency_id,tenant_id ON public.enrollment_applications
 FOR EACH ROW EXECUTE FUNCTION public.application_verify_student_scope();

-- Preserve each existing application's identity independently; do not guess student merges.
DO $fn$
DECLARE a record; sid uuid;
BEGIN
 FOR a IN SELECT id,agency_id,tenant_id,student_name,student_email,created_by FROM public.enrollment_applications WHERE student_id IS NULL LOOP
  INSERT INTO public.enrollment_students(agency_id,tenant_id,full_name,email,created_by)
   VALUES(a.agency_id,a.tenant_id,a.student_name,nullif(a.student_email,''),a.created_by)
   RETURNING id INTO sid;
  UPDATE public.enrollment_applications SET student_id=sid WHERE id=a.id;
 END LOOP;
END $fn$;

ALTER TABLE public.enrollment_applications ALTER COLUMN student_id SET NOT NULL;
CREATE FUNCTION public.business_student_touch_updated_at() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF TG_TABLE_NAME='enrollment_students' THEN
  IF NEW.agency_id IS DISTINCT FROM OLD.agency_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
   RAISE EXCEPTION 'A student identity cannot be moved between agencies or institutions' USING ERRCODE='23514';
  END IF;
 END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.business_student_touch_updated_at() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER businesses_touch_updated BEFORE UPDATE ON public.businesses
 FOR EACH ROW EXECUTE FUNCTION public.business_student_touch_updated_at();
CREATE TRIGGER enrollment_students_scope_and_updated BEFORE UPDATE ON public.enrollment_students
 FOR EACH ROW EXECUTE FUNCTION public.business_student_touch_updated_at();

