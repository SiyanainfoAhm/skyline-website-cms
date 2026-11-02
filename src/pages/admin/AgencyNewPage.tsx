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

  const suffix = useRef(Math.floor(100 + Math.random() * 900));
  // The code follows the name until the administrator edits it.
  const patch = (next: Partial<AgencyFormState>) =>
    setForm((prev) => {
      const merged = { ...prev, ...next };
      if (next.name !== undefined && (!prev.code || prev.code === suggestAgencyCode(prev.name, suffix.current))) merged.code = next.name.trim() ? suggestAgencyCode(next.name, suffix.current) : "";
      return merged;
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lookupLoading || saving) return;
    if (selected?.existingAgencyId) { navigate(`/admin/agencies/${selected.existingAgencyId}`); return; }
    setFormError("");
    const checked = validateAgencyForm(form);
    const first = validateFirstPerson(person.name, person.email);
    setErrors({ ...checked.errors, firstName: first.name, firstEmail: first.email });
    if (Object.keys(checked.errors).length > 0 || first.name || first.email) return;
    const agency = {
      name: form.name.trim(), code: form.code.trim(), registrationNumber: form.registrationNumber.trim(), businessEmail: form.businessEmail.trim(),
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
      <PageHeader breadcrumb="Agencies > Add agency" title="Add agency" description="Search the directory to fill available business details, or enter a new agency. Complete any missing contact information before saving." />
      {lookupLoading ? <p role="status" className="mb-4 text-sm">Loading agency details…</p> : null}
      {selected ? <p role="status" className="mb-4 text-sm text-foreground-600">{selected.existingAgencyId ? 'This agency is already added. Open its existing record to edit details or manage its team.' : 'Available directory details have been filled. Review them and complete any missing information.'}</p> : null}
      <Card className="p-5">
        <AgencyForm value={form} errors={errors} disabled={saving || lookupLoading || Boolean(selected?.existingAgencyId)} onChange={patch}
          nameInput={<AgencyNameSearch value={form.name} disabled={saving || lookupLoading} error={errors.name} onSelect={selectAgency}
            onChange={name => {
              if (selected) { setSelected(null); setForm({ ...EMPTY_AGENCY_FORM, name, code: name.trim() ? suggestAgencyCode(name, suffix.current) : '' }); if (directoryKey) setParams({}, { replace: true }); }
              else patch({ name });
            }} />} />
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
        <Button type="submit" icon="ri-save-line" disabled={saving || lookupLoading}>{saving ? "Creating…" : selected?.existingAgencyId ? 'Open existing agency' : "Create agency"}</Button>
        <Link to="/admin/agencies" className="text-sm font-medium text-foreground-600 hover:text-foreground-900">Cancel</Link>
      </div>
    </form>
  );
}
