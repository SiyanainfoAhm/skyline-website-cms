import { normalizeAbn, validateAbn, type AgencyAbnDetails } from "../../../supabase/functions/_shared/validation/abn";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Card, Field, PageHeader, TextInput } from "@/pages/admin/components/ui";
import AgencyForm from "@/pages/admin/components/AgencyForm";
import AgencyNameSearch from './components/AgencyNameSearch';
import { useToast } from "@/pages/admin/components/toastContext";
import { EMPTY_AGENCY_FORM, directoryAgencyToForm, suggestAgencyCode, validateAgencyForm, validateFirstPerson, type AgencyFormErrors, type AgencyFormState } from "@/pages/admin/lib/agencyForm";
import { createAgencyRecord, invokePortalUsers, logAgencyChange, queryAgencyDirectory, setAgencyStatus, type DirectoryAgency } from "@/pages/agency/lib/portalData";
import { portalPasswordResetUrl } from "@/pages/agency/lib/portalAuthContext";

/** Agencies > Add agency, inside the CMS. */
export default function AgencyNewPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const directoryKey = params.get('directory') ?? '';
  const { push } = useToast();
  const [form, setForm] = useState<AgencyFormState>(EMPTY_AGENCY_FORM);
  const [person, setPerson] = useState({ name: "", email: "" });
  const [errors, setErrors] = useState<AgencyFormErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<DirectoryAgency | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const selectAgency = (agency: DirectoryAgency) => { setSelected(agency); setForm(directoryAgencyToForm(agency)); setErrors({}); setFormError(''); };
  useEffect(() => {
    if (!directoryKey) return;
    let cancelled = false;
    setLookupLoading(true);
    queryAgencyDirectory({ key: directoryKey, limit: 1, offset: 0 })
      .then(result => { if (!cancelled) { if (result.rows[0]) selectAgency(result.rows[0]); else setFormError('This directory agency is no longer available. Search by name instead.'); } })
      .catch(() => { if (!cancelled) setFormError('We could not load this agency. Please search by name again.'); })
      .finally(() => { if (!cancelled) setLookupLoading(false); });
    return () => { cancelled = true; };
  }, [directoryKey]);

  const [abnDetails, setAbnDetails] = useState<AgencyAbnDetails | null>(null);
  const [abnLoading, setAbnLoading] = useState(false);
  const [abnError, setAbnError] = useState("");
  const [abnRetry, setAbnRetry] = useState(0);
  const abnAutofill = useRef<Partial<AgencyFormState>>({});
  const currentAbn = normalizeAbn(form.registrationNumber);
  const suffix = useRef(Math.floor(100 + Math.random() * 900));
  // The code follows the name until the administrator edits it.
  const patch = (next: Partial<AgencyFormState>) =>
    setForm((prev) => {
      const merged = { ...prev, ...next };
      if (next.name !== undefined && (!prev.code || prev.code === suggestAgencyCode(prev.name, suffix.current))) merged.code = next.name.trim() ? suggestAgencyCode(next.name, suffix.current) : "";
      return merged;
    });

  useEffect(() => {
    setAbnDetails(null); setAbnError(""); setAbnLoading(false);
    if (selected || validateAbn(currentAbn)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAbnLoading(true);
      invokePortalUsers({ action: "lookup_agency_abn", abn: currentAbn })
        .then(result => {
          if (cancelled) return;
          const business = result.business as AgencyAbnDetails;
          if (!business || business.abn !== currentAbn || !business.legalName) throw new Error("The lookup returned an unexpected business. Try again.");
          setAbnDetails(business);
          const previousAuto = abnAutofill.current;
          abnAutofill.current = { name: business.legalName, address: [business.state, business.postcode].filter(Boolean).join(" "), country: "Australia" };
          setForm(prev => {
            if (normalizeAbn(prev.registrationNumber) !== business.abn) return prev;
            const next = { ...prev };
            if (!prev.name.trim() || prev.name === previousAuto.name) {
              next.name = business.legalName;
              if (!prev.code || prev.code === suggestAgencyCode(prev.name, suffix.current)) next.code = suggestAgencyCode(next.name, suffix.current);
            }
            if (!prev.address.trim() || prev.address === previousAuto.address) {
              next.address = [business.state, business.postcode].filter(Boolean).join(" ");
            }
            if (!prev.country.trim() || prev.country === "Australia" || prev.country === previousAuto.country) {
              next.country = "Australia";
            }
            return next;
          });
          setErrors(prev => ({ ...prev, registrationNumber: undefined }));
        })
        .catch(error => { if (!cancelled) setAbnError(error instanceof Error ? error.message : "ABN Lookup is unavailable. Try again."); })
        .finally(() => { if (!cancelled) setAbnLoading(false); });
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [currentAbn, selected, abnRetry]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lookupLoading || saving) return;
    if (selected?.existingAgencyId) { navigate(`/admin/agencies/${selected.existingAgencyId}`); return; }
    // A business from the OMARA register already has a record: activating it there creates its workspace without a duplicate.
    if (selected?.source === 'directory') { navigate(`/admin/businesses?q=${encodeURIComponent(selected.name)}`); return; }
    setFormError("");
    const checked = validateAgencyForm(form, true);
    if (!checked.errors.registrationNumber && abnDetails?.abn !== currentAbn) checked.errors.registrationNumber = "Look up this ABN successfully before creating the business.";
    const first = validateFirstPerson(person.name, person.email);
    setErrors({ ...checked.errors, firstName: first.name, firstEmail: first.email });
    if (Object.keys(checked.errors).length > 0 || first.name || first.email) return;
    const agency = {
      name: form.name.trim(), code: form.code.trim(), registrationNumber: currentAbn, businessEmail: form.businessEmail.trim(),
      phone: checked.phone, address: form.address.trim(), country: form.country.trim(), primaryContact: form.primaryContact.trim(),
    };
    setSaving(true);
    try {
      let id: string;
      let message = "Agency created.";
      if (person.email.trim()) {
        // One transaction in the database: the agency and the first invitation exist together or not at all (and it is audited there).
        const data = await invokePortalUsers({
          action: "create_agency",
          agency: {
            name: agency.name, code: agency.code, registration_number: agency.registrationNumber, business_email: agency.businessEmail,
            phone: agency.phone, address: agency.address, country: agency.country, primary_contact: agency.primaryContact,
          },
          adminEmail: person.email.trim(),
          adminName: person.name.trim(),
          redirectTo: portalPasswordResetUrl(),
        });
        id = String(data.agencyId ?? "");
        if (!id) throw new Error("The agency was created but could not be opened. Find it in the Agencies list.");
        if (form.status === "Inactive") {
          await setAgencyStatus(id, "Inactive");
          await logAgencyChange(id, "agency_deactivated", { reason: "created inactive" });
        }
        message = data.warning ? String(data.warning) : `Agency created. An invitation was ${data.emailSent ? "emailed" : "saved"} for ${person.email.trim().toLowerCase()}.`;
      } else {
        id = await createAgencyRecord({ ...agency, status: form.status });
        await logAgencyChange(id, "agency_created", { code: agency.code });
      }
      push(message);
      navigate(`/admin/agencies/${id}`, { replace: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      setFormError(/agencies_directory_business_unique|duplicate key/i.test(message) ? 'This agency already exists. Search its name and open the existing agency.' : message || "We could not create this agency.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader breadcrumb="Businesses > Add business" title="Add business" description="Search first. If the business is in the OMARA register, open it in Businesses and activate it there. Otherwise enter its details. A business you add starts inactive; activate it, or one of its agents, when it is ready to use the portal." />
      {lookupLoading ? <p role="status" className="mb-4 text-sm">Loading agency details…</p> : null}
      {selected ? <p role="status" className="mb-4 text-sm text-foreground-600">{selected.existingAgencyId ? 'This agency is already added. Open its existing record to edit details or manage its team.' : 'This business is in the OMARA register. Open it in Businesses and activate it there, so its registered agents stay linked.'}</p> : null}
      <Card className="p-5">
        <AgencyForm abnRequired value={form} errors={errors} disabled={saving || lookupLoading || Boolean(selected?.existingAgencyId)} onChange={patch}
          nameInput={<AgencyNameSearch value={form.name} disabled={saving || lookupLoading} error={errors.name} onSelect={selectAgency}
            onChange={name => {
              if (selected) { setSelected(null); setForm({ ...EMPTY_AGENCY_FORM, name, code: name.trim() ? suggestAgencyCode(name, suffix.current) : '' }); if (directoryKey) setParams({}, { replace: true }); }
              else patch({ name });
            }} />} />
        {!selected ? <div className="mt-4 text-sm" aria-live="polite">
          {abnLoading ? <p role="status">Looking up the ABN…</p> : null}
          {abnError ? <p role="alert" className="text-red-700">{abnError} <button type="button" className="underline" onClick={() => setAbnRetry(n => n + 1)}>Retry lookup</button></p> : null}
          {abnDetails?.abn === currentAbn ? <div className="rounded-md bg-green-50 p-3 text-foreground-800">
            <p className="font-medium">{abnDetails.legalName}</p>
            <p>{abnDetails.abnStatus} · {abnDetails.entityType}</p>
            <p>{[abnDetails.state, abnDetails.postcode].filter(Boolean).join(" ")}{abnDetails.gstStatus ? ` · GST: ${abnDetails.gstStatus}` : ""}</p>
            {abnDetails.businessNames.length ? <p>Registered business names: {abnDetails.businessNames.join(", ")}</p> : null}
            <a href={abnDetails.sourceUrl} target="_blank" rel="noreferrer" className="underline">View government record</a>
          </div> : null}
          <p className="mt-2 text-xs text-foreground-500">ABN Lookup supplies legal and registration details and a state/postcode, not email, phone or a street address. Enter contact details yourself. You can edit the agency name to use a registered business name.</p>
        </div> : null}
      </Card>
      {!selected?.existingAgencyId ? <Card className="mt-5 p-5">
        <h2 className="font-heading text-base font-semibold">First person (optional)</h2>
        <p className="mt-1 text-xs text-foreground-500">Invites the agency&rsquo;s first administrator, who can then add their own agents. Leave both blank to add people later.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Field label="Name">
              <TextInput disabled={saving} value={person.name} aria-invalid={Boolean(errors.firstName)} onChange={(e) => setPerson((p) => ({ ...p, name: e.target.value }))} />
            </Field>
            {errors.firstName ? <p role="alert" className="mt-1 text-xs font-medium text-red-700">{errors.firstName}</p> : null}
          </div>
          <div>
            <Field label="Email" hint={errors.firstEmail ? undefined : "This email receives the invite."}>
              <TextInput disabled={saving} type="email" value={person.email} aria-invalid={Boolean(errors.firstEmail)} onChange={(e) => setPerson((p) => ({ ...p, email: e.target.value }))} />
            </Field>
            {errors.firstEmail ? <p role="alert" className="mt-1 text-xs font-medium text-red-700">{errors.firstEmail}</p> : null}
          </div>
        </div>
      </Card> : null}
      {formError ? <p role="alert" className="mt-4 text-sm font-medium text-red-700">{formError}</p> : null}
      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" icon="ri-save-line" disabled={saving || lookupLoading || abnLoading}>{saving ? "Creating…" : selected?.existingAgencyId ? 'Open existing agency' : selected?.source === 'directory' ? 'Open in Businesses' : "Create business"}</Button>
        <Link to="/admin/businesses" className="text-sm font-medium text-foreground-600 hover:text-foreground-900">Cancel</Link>
      </div>
    </form>
  );
}
