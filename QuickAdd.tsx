import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Modal, Toggle } from "@/pages/admin/components/ui";
import QuickPick, { type QuickPickOption } from "@/pages/admin/components/QuickPick";
import { setBusinessStatus } from "@/pages/admin/lib/businessData";
import { searchBusinessOptions, searchCourseOptions, type BusinessOption } from "@/pages/admin/lib/quickAddSearch";
import { suggestAgencyCode, validateAgencyForm, validateFirstPerson, EMPTY_AGENCY_FORM } from "@/pages/admin/lib/agencyForm";
import { createAgencyRecord, invokePortalUsers, logAgencyChange, setAgencyStatus } from "@/pages/agency/lib/portalData";
import { portalPasswordResetUrl } from "@/pages/agency/lib/portalAuthContext";
import { normaliseEmail, validateEmail, validateName } from "@/pages/agency/lib/userValidation";
import { activateCatalogueCourse, COURSE_TYPE_LABEL, type CatalogueCourse, type SkylineActivation } from "@/pages/admin/lib/courseCatalogue";
import { ActivationOptions } from "@/pages/admin/components/CourseCatalogue";

/* ------------------------------------------------------------------ shared bits */

function Input({ label, required, error, hint, ...rest }: { label: string; required?: boolean; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-foreground-800">{label}{required ? <span className="ml-0.5 text-primary-600">*</span> : null}</span>
      <input {...rest} aria-invalid={Boolean(error)}
        className={`w-full rounded-md border bg-background-50 px-3 py-2 text-sm text-foreground-950 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-400/40 disabled:bg-background-100 ${error ? "border-red-500" : "border-background-300 focus:border-primary-500"}`} />
      {error ? <span role="alert" className="mt-1 block text-xs font-medium text-red-700">{error}</span> : hint ? <span className="mt-1 block text-xs text-foreground-500">{hint}</span> : null}
    </label>
  );
}

function FormError({ children }: { children: ReactNode }) {
  return children ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{children}</p> : null;
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-background-200">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] font-medium text-foreground-800 hover:bg-background-100">
        {title}<i className={`ri-arrow-down-s-line text-lg transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? <div className="space-y-3 border-t border-background-200 p-3">{children}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ businesses */

/**
 * Business picker with "Add new business". Picking an inactive business offers to activate it right here,
 * because only an active business (with a workspace) can hold agents and applications.
 */
export function BusinessPicker({ value, onChange, label = "Business", required, error, autoFocus, needsActive = true }: {
  value: BusinessOption | null; onChange: (b: BusinessOption | null) => void; label?: string; required?: boolean; error?: string; autoFocus?: boolean; needsActive?: boolean;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const activate = async () => {
    if (!value) return;
    setBusy(true); setProblem("");
    try {
      const r = await setBusinessStatus(value.businessId, "Active");
      onChange({ ...value, id: r.agencyId ?? value.id, agencyId: r.agencyId, active: true, tag: undefined });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "We could not activate this business.");
    } finally { setBusy(false); }
  };
  const blocked = needsActive && value && (!value.active || !value.agencyId);
  return (
    <div>
      <QuickPick label={label} required={required} error={error} autoFocus={autoFocus} value={value}
        onChange={(o) => { setProblem(""); onChange(o as BusinessOption | null); }}
        search={searchBusinessOptions} placeholder="Search business name, code or city…" addLabel="business"
        emptyText="No business found." onAddNew={(typed) => setAdding(typed)} />
      {blocked ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>{value.label} is inactive. Activate it to continue.</span>
          <Button size="sm" disabled={busy} onClick={() => void activate()}>{busy ? "Activating…" : "Activate business"}</Button>
        </div>
      ) : null}
      {problem ? <p role="alert" className="mt-1 text-xs font-medium text-red-700">{problem}</p> : null}
      <AddBusinessModal open={adding !== null} initialName={adding ?? ""} defaultActive onClose={() => setAdding(null)}
        onCreated={(b) => { setAdding(null); onChange(b); }} />
    </div>
  );
}

/** Small popup to add a business without leaving the screen. */
export function AddBusinessModal({ open, initialName = "", defaultActive = false, onClose, onCreated }: {
  open: boolean; initialName?: string; defaultActive?: boolean; onClose: () => void;
  onCreated: (b: BusinessOption, message: string) => void;
}) {
  const suffix = useRef(Math.floor(100 + Math.random() * 900));
  const [form, setForm] = useState({ ...EMPTY_AGENCY_FORM });
  const [active, setActive] = useState(defaultActive);
  const [person, setPerson] = useState({ name: "", email: "" });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY_AGENCY_FORM, name: initialName, code: initialName.trim() ? suggestAgencyCode(initialName, suffix.current) : "" });
    setActive(defaultActive); setPerson({ name: "", email: "" }); setErrors({}); setFormError("");
  }, [open, initialName, defaultActive]);

  const setName = (name: string) => setForm((f) => ({
    ...f, name, code: !f.code || f.code === suggestAgencyCode(f.name, suffix.current) ? (name.trim() ? suggestAgencyCode(name, suffix.current) : "") : f.code,
  }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError("");
    const checked = validateAgencyForm(form);
    const first = validateFirstPerson(person.name, person.email);
    const next = { ...checked.errors, firstName: first.name, firstEmail: first.email };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    const status = active ? "Active" : "Inactive";
    setSaving(true);
    try {
      let agencyId: string;
      let message = `${form.name.trim()} added.`;
      if (person.email.trim()) {
        const data = await invokePortalUsers({
          action: "create_agency",
          agency: {
            name: form.name.trim(), code: form.code.trim(), registration_number: form.registrationNumber.trim(), business_email: form.businessEmail.trim(),
            phone: checked.phone, address: form.address.trim(), country: form.country.trim(), primary_contact: form.primaryContact.trim(),
          },
          adminEmail: person.email.trim(), adminName: person.name.trim(), redirectTo: portalPasswordResetUrl(),
        });
        agencyId = String(data.agencyId ?? "");
        if (!agencyId) throw new Error("The business was created but could not be opened. Find it in Businesses.");
        if (status === "Inactive") { await setAgencyStatus(agencyId, "Inactive"); await logAgencyChange(agencyId, "agency_deactivated", { reason: "created inactive" }); }
        message = data.warning ? String(data.warning) : `${form.name.trim()} added. Invitation ${data.emailSent ? "emailed" : "saved"} for ${normaliseEmail(person.email)}.`;
      } else {
        agencyId = await createAgencyRecord({
          name: form.name, code: form.code, registrationNumber: form.registrationNumber, businessEmail: form.businessEmail, phone: checked.phone,
          address: form.address, country: form.country, primaryContact: form.primaryContact, status,
        });
        await logAgencyChange(agencyId, "agency_created", { code: form.code.trim() });
      }
      onCreated({ id: agencyId, agencyId, businessId: "", active, label: form.name.trim(), meta: form.code.trim(), tag: active ? undefined : "Inactive" }, message);
    } catch (err) {
      const m = err instanceof Error ? err.message : "";
      setFormError(/duplicate key|already exists|unique/i.test(m) ? "A business with this name or code already exists. Search for it instead." : m || "We could not add this business.");
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} title="Add new business" onClose={saving ? () => undefined : onClose} width="max-w-lg"
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="quick-add-business" icon="ri-check-line" disabled={saving}>{saving ? "Saving…" : "Save business"}</Button>
      </>}>
      <form id="quick-add-business" onSubmit={submit} noValidate className="space-y-3.5">
        <Input label="Business name" required autoFocus value={form.name} error={errors.name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Input label="Business email" required type="email" value={form.businessEmail} error={errors.businessEmail} onChange={(e) => setForm((f) => ({ ...f, businessEmail: e.target.value }))} />
          <Input label="Phone" value={form.phone} error={errors.phone} placeholder="+61…" onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </div>
        <Disclosure title="More details (code, ABN, address, contact)">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Business code" required value={form.code} error={errors.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            <Input label="ABN / registration no." value={form.registrationNumber} onChange={(e) => setForm((f) => ({ ...f, registrationNumber: e.target.value }))} />
            <Input label="Country" value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} />
            <Input label="Primary contact" value={form.primaryContact} onChange={(e) => setForm((f) => ({ ...f, primaryContact: e.target.value }))} />
          </div>
          <Input label="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        </Disclosure>
        <Disclosure title="Invite first admin (optional)">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Name" value={person.name} error={errors.firstName} onChange={(e) => setPerson((p) => ({ ...p, name: e.target.value }))} />
            <Input label="Email" type="email" value={person.email} error={errors.firstEmail} onChange={(e) => setPerson((p) => ({ ...p, email: e.target.value }))} />
          </div>
        </Disclosure>
        <div className="flex items-center justify-between rounded-md bg-background-100 px-3 py-2.5">
          <span className="text-[13px] text-foreground-800">{active ? "Active now: its people can sign in" : "Starts inactive: activate it later"}</span>
          <Toggle checked={active} onChange={setActive} label="Active" />
        </div>
        <FormError>{formError}</FormError>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ agents */

/**
 * Small popup to invite an agent. With `agencyId` the business is fixed (agency admins, or a business already chosen);
 * otherwise a business picker (with its own "Add new business") is shown.
 */
export function AddAgentModal({ open, initialName = "", agencyId, agencyName, allowAdminRole = true, onClose, onInvited }: {
  open: boolean; initialName?: string; agencyId?: string | null; agencyName?: string; allowAdminRole?: boolean;
  onClose: () => void; onInvited: (message: string) => void;
}) {
  const [business, setBusiness] = useState<BusinessOption | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"agent" | "agency_admin">("agent");
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const looksLikeEmail = initialName.includes("@");
    setName(looksLikeEmail ? "" : initialName); setEmail(looksLikeEmail ? initialName : "");
    setRole("agent"); setErrors({}); setFormError("");
    setBusiness(agencyId ? { id: agencyId, agencyId, businessId: "", active: true, label: agencyName ?? "" } : null);
  }, [open, initialName, agencyId, agencyName]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError("");
    const next = {
      business: !business?.agencyId || !business.active ? "Choose an active business." : null,
      name: validateName(name), email: validateEmail(email),
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setSaving(true);
    try {
      const data = await invokePortalUsers({ action: "invite", email: normaliseEmail(email), name: name.trim(), role, agencyId: business!.agencyId, redirectTo: portalPasswordResetUrl() });
      onInvited(data.warning ? String(data.warning) : `Invitation ${data.emailSent ? "emailed" : "saved"} for ${normaliseEmail(email)}. They appear as an agent once they accept.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "We could not send this invitation.");
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} title="Add new agent" onClose={saving ? () => undefined : onClose} width="max-w-lg"
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="quick-add-agent" icon="ri-mail-send-line" disabled={saving}>{saving ? "Sending…" : "Send invite"}</Button>
      </>}>
      <form id="quick-add-agent" onSubmit={submit} noValidate className="space-y-3.5">
        {agencyId ? (
          <p className="rounded-md bg-background-100 px-3 py-2 text-[13px] text-foreground-700">Business: <b className="text-foreground-900">{agencyName}</b></p>
        ) : (
          <BusinessPicker value={business} onChange={setBusiness} required error={errors.business ?? undefined} />
        )}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Input label="Full name" required autoFocus={Boolean(agencyId)} value={name} error={errors.name ?? undefined} onChange={(e) => setName(e.target.value)} />
          <Input label="Email" required type="email" value={email} error={errors.email ?? undefined} hint="The invite is sent here." onChange={(e) => setEmail(e.target.value)} />
        </div>
        {allowAdminRole ? (
          <div role="radiogroup" aria-label="Role" className="grid grid-cols-2 gap-2">
            {([["agent", "Agent", "Works on their own students"], ["agency_admin", "Agency admin", "Sees the whole business"]] as const).map(([id, title, text]) => (
              <button key={id} type="button" role="radio" aria-checked={role === id} onClick={() => setRole(id)}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${role === id ? "border-primary-500 bg-primary-50 ring-1 ring-primary-500" : "border-background-300 hover:bg-background-100"}`}>
                <span className="block text-[13px] font-semibold text-foreground-900">{title}</span>
                <span className="block text-xs text-foreground-500">{text}</span>
              </button>
            ))}
          </div>
        ) : null}
        <FormError>{formError}</FormError>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ courses */

/**
 * Small popup to add a course to Skyline: search the national register (training.gov.au), choose the course and its
 * Skyline settings, and save. Stays on the current screen.
 */
export function AddCourseModal({ open, initialQuery = "", forApplications = false, beforeChange, onClose, onAdded }: {
  open: boolean; initialQuery?: string; forApplications?: boolean; beforeChange?: () => Promise<void>;
  onClose: () => void; onAdded: (r: { code: string; title: string; slug: string | null; created: boolean; cmsCourseId: string | null; active: boolean }) => void;
}) {
  const [picked, setPicked] = useState<(QuickPickOption & { course: CatalogueCourse }) | null>(null);
  const [value, setValue] = useState<SkylineActivation>({ active: true, website: false, applications: false, domestic: false, international: false });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [seed, setSeed] = useState(0);

  useEffect(() => { if (open) { setPicked(null); setFormError(""); setSeed((n) => n + 1); } }, [open]);
  useEffect(() => {
    const c = picked?.course;
    if (!c) return;
    setValue({
      active: true,
      website: c.website_enabled,
      applications: forApplications || c.admissions_enabled,
      domestic: c.domestic_enabled,
      international: forApplications || c.international_enabled,
    });
  }, [picked, forApplications]);

  const course = picked?.course ?? null;
  const save = async () => {
    if (!course) return;
    setSaving(true); setFormError("");
    try {
      await beforeChange?.();
      const r = await activateCatalogueCourse(course.course_code, value);
      onAdded({ code: course.course_code, title: course.course_name, slug: r.slug, created: r.created, cmsCourseId: r.cmsCourseId, active: value.active });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "We could not add this course.");
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} title="Add new course" onClose={saving ? () => undefined : onClose} width="max-w-xl"
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button icon="ri-check-line" onClick={() => void save()} disabled={saving || !course}>{saving ? "Saving…" : course?.is_active ? "Save settings" : "Add course"}</Button>
      </>}>
      <div className="space-y-4">
        <QuickPick key={seed} label="National course" required autoFocus initialText={initialQuery} value={picked}
          onChange={(o) => setPicked(o as typeof picked)} search={searchCourseOptions}
          placeholder="Search course name or code, e.g. BSB50120" emptyText="No current national course matches." minChars={2} />
        {course ? (
          <div className="rounded-lg border border-background-200">
            <div className="flex items-start justify-between gap-3 border-b border-background-200 bg-background-100 px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold text-foreground-600">{course.course_code}</p>
                <p className="text-sm font-semibold text-foreground-900">{course.course_name}</p>
                <p className="mt-0.5 text-xs text-foreground-500">{[COURSE_TYPE_LABEL[course.course_type], course.aqf_level, course.training_package_name].filter(Boolean).join(" · ")}</p>
              </div>
              <a className="shrink-0 text-xs font-medium text-primary-700 underline" href={`https://training.gov.au/training/details/${course.course_code}`} target="_blank" rel="noreferrer">training.gov.au</a>
            </div>
            <div className="p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground-500">Skyline settings</p>
              <ActivationOptions value={value} onChange={setValue} />
              <p className="mt-3 text-xs text-foreground-500">
                {course.cms_course_id ? "Already in Skyline: its content is not changed." : "Added as a Draft course. Add CRICOS, fees and media later from Courses."}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-foreground-500">Courses come from the national register (training.gov.au). Search by name or code.</p>
        )}
        <FormError>{formError}</FormError>
      </div>
    </Modal>
  );
}

