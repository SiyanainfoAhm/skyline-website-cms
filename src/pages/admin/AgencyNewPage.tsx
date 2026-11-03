import { normalizeAbn, validateAbn, type AgencyAbnDetails } from "../../../supabase/functions/_shared/validation/abn";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Card, Field, PageHeader, TextInput } from "@/pages/admin/components/ui";
import { useToast } from "@/pages/admin/components/toastContext";
import { EMPTY_AGENCY_FORM, suggestAgencyCode, validateAgencyForm, type AgencyFormErrors, type AgencyFormState } from "@/pages/admin/lib/agencyForm";
import { setBusinessStatus } from "@/pages/admin/lib/businessData";
import { validateName } from "@/pages/agency/lib/userValidation";
import { agencyBusinessId, findAgencyByAbn, invokePortalUsers, queryAgencyDirectory, type DirectoryAgency } from "@/pages/agency/lib/portalData";
import { portalPasswordResetUrl } from "@/pages/agency/lib/portalAuthContext";

type Errors = AgencyFormErrors & { form?: string };

/**
 * Businesses > Add business. The administrator enters only the ABN; the government register fills and locks the
 * business details (Edit unlocks them). The point of contact becomes the business's first administrator, and the
 * business is created Active.
 */
export default function AgencyNewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const directoryKey = params.get("directory") ?? "";
  const { push } = useToast();
  const suffix = useRef(Math.floor(100 + Math.random() * 900));

  const [abnInput, setAbnInput] = useState("");
  const abn = normalizeAbn(abnInput);
  const abnProblem = validateAbn(abn);
  const [details, setDetails] = useState<AgencyAbnDetails | null>(null);
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [retry, setRetry] = useState(0);

  const [form, setForm] = useState<AgencyFormState>(EMPTY_AGENCY_FORM);
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  // A link from the Agencies directory points at one listed business: send it to its existing record instead.
  const [directory, setDirectory] = useState<DirectoryAgency | null>(null);
  useEffect(() => {
    if (!directoryKey) return;
    let cancelled = false;
    queryAgencyDirectory({ key: directoryKey, limit: 1, offset: 0 })
      .then(result => { if (!cancelled) setDirectory(result.rows[0] ?? null); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [directoryKey]);

  // Look the ABN up once it is complete and valid; a newer ABN discards an older response.
  useEffect(() => {
    setDetails(null); setExisting(null); setLookupError(""); setEditing(false);
    if (abnProblem) { setLookupLoading(false); return; }
    let cancelled = false;
    setLookupLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const [result, already] = await Promise.all([
          invokePortalUsers({ action: "lookup_agency_abn", abn }),
          findAgencyByAbn(abn),
        ]);
        if (cancelled) return;
        const business = result.business as AgencyAbnDetails | undefined;
        if (!business || business.abn !== abn || !business.legalName) throw new Error("The lookup returned an unexpected business. Try again.");
        setDetails(business);
        setExisting(already);
        setForm(prev => ({
          ...prev, registrationNumber: abn, name: business.legalName, code: suggestAgencyCode(business.legalName, suffix.current),
          country: "Australia", address: [business.state, business.postcode].filter(Boolean).join(" "), status: "Active",
        }));
        setErrors({});
      } catch (error) {
        if (!cancelled) setLookupError(error instanceof Error ? error.message : "ABN Lookup is unavailable. Try again.");
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [abn, abnProblem, retry]);

  const patch = (next: Partial<AgencyFormState>) => setForm(prev => {
    const merged = { ...prev, ...next };
    // The code follows the name until the administrator edits it.
    if (next.name !== undefined && prev.code === suggestAgencyCode(prev.name, suffix.current)) merged.code = next.name.trim() ? suggestAgencyCode(next.name, suffix.current) : "";
    return merged;
  });

  const ready = Boolean(details && details.abn === abn && !existing);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || lookupLoading) return;
    if (!ready) { setErrors({ registrationNumber: abnProblem || "Look up this ABN successfully before creating the business." }); return; }
    const checked = validateAgencyForm({ ...form, registrationNumber: abn }, true);
    const next: Errors = { ...checked.errors };
    const contactName = validateName(form.primaryContact);
    if (contactName) next.primaryContact = contactName;
    if (!form.phone.trim()) next.phone = "Enter the contact's phone number.";
    setErrors(next);
    if (Object.keys(next).some(key => next[key as keyof Errors])) {
      if (next.name || next.code || next.address || next.country) setEditing(true);
      return;
    }
    setSaving(true);
    try {
      // One transaction: the Active agency and its first administrator's invitation exist together or not at all.
      const email = form.businessEmail.trim().toLowerCase();
      const data = await invokePortalUsers({
        action: "create_agency",
        agency: {
          name: form.name.trim(), code: form.code.trim(), registration_number: abn, business_email: email,
          phone: checked.phone, address: form.address.trim(), country: form.country.trim(), primary_contact: form.primaryContact.trim(),
        },
        adminEmail: email,
        adminName: form.primaryContact.trim(),
        redirectTo: portalPasswordResetUrl(),
      });
      const id = String(data.agencyId ?? "");
      if (!id) throw new Error("The business was created but could not be opened. Find it in Businesses.");
      let message = data.warning ? String(data.warning) : `Business created and active. An admin invitation was ${data.emailSent ? "emailed" : "saved"} for ${email}.`;
      try {
        const businessId = await agencyBusinessId(id);
        if (businessId) await setBusinessStatus(businessId, "Active");
      } catch {
        message += " Its business record could not be marked active; activate it in Businesses.";
      }
      push(message);
      navigate(`/admin/agencies/${id}`, { replace: true });
    } catch (e) {
      const text = e instanceof Error ? e.message : "";
      setErrors({ form: /agencies_directory_business_unique|duplicate key|already exists/i.test(text) ? text.includes("code") ? "This agency code is already used. Edit the details and choose another code." : "This business already exists. Open it from Businesses." : text || "We could not create this business." });
    } finally {
      setSaving(false);
    }
  };

  const error = (key: keyof Errors) => errors[key] ? <p role="alert" className="mt-1 text-xs font-medium text-red-700">{errors[key]}</p> : null;
  const input = (key: keyof AgencyFormState, label: string, hint: string, props: { required?: boolean; type?: string; placeholder?: string; autoComplete?: string } = {}) => (
    <div>
      <Field label={label} hint={errors[key] ? undefined : hint} required={props.required}>
        <TextInput disabled={saving} required={props.required} type={props.type} placeholder={props.placeholder} autoComplete={props.autoComplete}
          value={form[key]} aria-invalid={Boolean(errors[key])} onChange={e => patch({ [key]: e.target.value })} />
      </Field>
      {error(key)}
    </div>
  );
  const lockedRow = (label: string, value: string) => (
    <div>
      <dt className="text-xs font-medium text-green-800">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground-900">{value || "—"}</dd>
    </div>
  );

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader breadcrumb="Businesses > Add business" title="Add business"
        description="Enter the business's ABN. Its registered details are filled from the government register; then add the point of contact, who becomes the business's administrator. The business is created active." />
      {directory ? (
        <Card className="mb-5 p-5 text-sm">
          <p role="status">{directory.existingAgencyId ? `${directory.name} is already added.` : `${directory.name} is in the OMARA register. Activate it in Businesses so its registered agents stay linked.`}</p>
          <Link className="mt-2 inline-block font-medium text-primary-700 underline" to={directory.existingAgencyId ? `/admin/agencies/${directory.existingAgencyId}` : `/admin/businesses?q=${encodeURIComponent(directory.name)}`}>
            {directory.existingAgencyId ? "Open existing business" : "Open in Businesses"}
          </Link>
        </Card>
      ) : null}

      <Card className="p-5">
        <div className="max-w-md">
          <Field label="ABN" required hint={errors.registrationNumber ? undefined : "Enter the 11-digit ABN to look up the business."}>
            <TextInput autoFocus disabled={saving} required inputMode="numeric" placeholder="12 345 678 901" value={abnInput}
              aria-invalid={Boolean(errors.registrationNumber || (abn.length >= 11 && abnProblem))} onChange={e => setAbnInput(e.target.value)} />
          </Field>
          {abn.length >= 11 && abnProblem ? <p role="alert" className="mt-1 text-xs font-medium text-red-700">{abnProblem}</p> : error("registrationNumber")}
        </div>
        <div className="mt-3 text-sm" aria-live="polite">
          {lookupLoading ? <p role="status" className="text-foreground-600">Looking up the ABN…</p> : null}
          {lookupError ? <p role="alert" className="text-red-700">{lookupError} <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Retry lookup</button></p> : null}
          {existing ? <p role="alert" className="text-red-700">{existing.name || "A business"} is already added with this ABN. <Link className="underline" to={`/admin/agencies/${existing.id}`}>Open it</Link></p> : null}
        </div>

        {ready && details ? (
          <section className="mt-4 rounded-lg border border-green-300 bg-green-50 p-4" aria-label="Business details from ABN Lookup">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-green-900">
                  <i className={editing ? "ri-edit-line" : "ri-lock-line"} aria-hidden="true" />
                  {editing ? "Editing business details" : "Verified from ABN Lookup"}
                </p>
                <p className="mt-0.5 text-xs text-green-800">
                  {details.abnStatus}{details.entityType ? ` · ${details.entityType}` : ""}{details.gstStatus ? ` · GST: ${details.gstStatus}` : ""}
                  {" · "}<a href={details.sourceUrl} target="_blank" rel="noreferrer" className="underline">Government record</a>
                </p>
              </div>
              <Button type="button" variant="secondary" icon={editing ? "ri-lock-line" : "ri-edit-line"} disabled={saving} onClick={() => setEditing(v => !v)}>
                {editing ? "Done" : "Edit"}
              </Button>
            </div>
            {editing ? (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                {input("name", "Business name", details.businessNames.length ? `Registered names: ${details.businessNames.join(", ")}` : "As it appears to staff and on applications.", { required: true })}
                {input("code", "Agency code", "A short unique code, for example GPE-001.", { required: true })}
                {input("country", "Country", "Where the business is based.")}
                {input("address", "Address", "Street address, if known.")}
              </div>
            ) : (
              <dl className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {lockedRow("Business name", form.name)}
                {lockedRow("Agency code", form.code)}
                {lockedRow("Country", form.country)}
                {lockedRow("Address", form.address)}
                {details.businessNames.length ? lockedRow("Registered business names", details.businessNames.join(", ")) : null}
                {lockedRow("ABN", details.abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4"))}
              </dl>
            )}
          </section>
        ) : null}
      </Card>

      {ready ? (
        <Card className="mt-5 p-5">
          <h2 className="font-heading text-base font-semibold">Point of contact</h2>
          <p className="mt-1 text-xs text-foreground-500">ABN Lookup does not supply contact details. This person becomes the business&rsquo;s administrator and receives the portal invitation.</p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {input("primaryContact", "Name", "The person at the business we deal with.", { required: true, autoComplete: "name" })}
            {input("businessEmail", "Email", "Receives the administrator invitation.", { required: true, type: "email", autoComplete: "email" })}
            {input("phone", "Phone", "Australian numbers as 0412 345 678 or 02 9123 4567; otherwise start with + and the country code.", { required: true, type: "tel", placeholder: "0412 345 678", autoComplete: "tel" })}
          </div>
        </Card>
      ) : null}

      {errors.form ? <p role="alert" className="mt-4 text-sm font-medium text-red-700">{errors.form}</p> : null}
      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" icon="ri-save-line" disabled={saving || lookupLoading || !ready}>{saving ? "Creating…" : "Create business"}</Button>
        <Link to="/admin/businesses" className="text-sm font-medium text-foreground-600 hover:text-foreground-900">Cancel</Link>
      </div>
    </form>
  );
}
