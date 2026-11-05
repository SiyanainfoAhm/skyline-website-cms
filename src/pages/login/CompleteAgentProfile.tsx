import { useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/pages/admin/lib/supabase";
import { Button, Field, TextInput } from "@/pages/admin/components/ui";
import { abnProblem, formatAbn, validEmail } from "@/lib/enrolForm";
import { lookupAbn, type AbnDetails } from "@/lib/selfEnrol";
import { readSignUpBusiness, rememberSignUpBusiness } from "@/lib/authProviders";

/**
 * After an agent signs up with Google, Facebook or a phone number: the agency details. The business is created inactive
 * and waits for SLIT's review; this account is its administrator once approved. Verified email or mobile is locked.
 */
export default function CompleteAgentProfile({ user, onDone }: { user: User; onDone: (businessName: string) => void }) {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const emailVerified = Boolean(user.email && user.email_confirmed_at);
  const phoneVerified = Boolean(user.phone && user.phone_confirmed_at);
  const verifiedPhone = phoneVerified ? `+${String(user.phone).replace(/^\+/, "")}` : "";
  // The business confirmed on the Enroll now page before leaving for Google / Facebook / phone, when there is one.
  const [chosen] = useState(readSignUpBusiness);
  const [abn, setAbn] = useState(chosen ? formatAbn(chosen.abn) : "");
  const [business, setBusiness] = useState(chosen?.businessName ?? "");
  const [contact, setContact] = useState(String(meta.full_name ?? meta.name ?? "").trim());
  const [email, setEmail] = useState(emailVerified ? String(user.email) : "");
  const [phone, setPhone] = useState(verifiedPhone);
  const [agreed, setAgreed] = useState(false);
  const [found, setFound] = useState<AbnDetails | null>(null);
  const [looking, setLooking] = useState(false);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const lookUp = async () => {
    const problem = abnProblem(abn);
    if (problem) { setErrors((prev) => ({ ...prev, abn: problem })); return; }
    setLooking(true); setNote(""); setFound(null);
    try {
      const result = await lookupAbn(abn);
      setFound(result);
      if (!business.trim()) setBusiness(result.businessNames[0] || result.legalName);
      setErrors((prev) => ({ ...prev, abn: "" }));
      if (!/active/i.test(result.abnStatus)) setNote(`This ABN is listed as ${result.abnStatus || "not active"}. Check it before continuing.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "We could not look this ABN up. Enter the details yourself.");
    } finally { setLooking(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const next: Record<string, string> = {};
    const abnError = abnProblem(abn); if (abnError) next.abn = abnError;
    if (business.trim().length < 2) next.business = "Enter the agency or company name.";
    if (contact.trim().length < 2) next.contact = "Enter the contact person's name.";
    if (!emailVerified && !validEmail(email)) next.email = "Enter a valid work email address.";
    if (!phoneVerified && !/^\+?[\d\s().-]{6,40}$/.test(phone.trim())) next.phone = "Enter a phone number.";
    if (!agreed) next.agreed = "Please agree to the terms and privacy policy.";
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setBusy(true);
    const { error } = await supabase.rpc("portal_self_register_agent_complete", {
      p_input: { abn: abn.replace(/\s/g, ""), businessName: business.trim(), contactName: contact.trim(), email: email.trim().toLowerCase(), phone: phone.trim() },
    });
    setBusy(false);
    if (error) { setErrors({ form: error.message || "We could not submit your application. Please try again." }); return; }
    rememberSignUpBusiness(null);
    onDone(business.trim());
  };

  const problem = (key: string) => (errors[key] ? <span className="mt-1 block text-xs text-primary-700" role="alert">{errors[key]}</span> : null);

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900" role="status">
        <i className="ri-error-warning-line mt-0.5 text-base" aria-hidden="true" /><span>Agent accounts are reviewed by our team before you can sign in.</span>
      </div>
      <div className="mt-5 space-y-4">
        <Field label="ABN" required hint={found ? `${found.legalName}${found.entityType ? `, ${found.entityType}` : ""}${found.state ? `, ${found.state} ${found.postcode}` : ""}.` : "We fill in your registered business name."}>
          <div className="flex gap-2">
            <TextInput inputMode="numeric" value={abn} onChange={(e) => { setAbn(formatAbn(e.target.value)); setFound(null); setNote(""); setErrors((prev) => ({ ...prev, abn: "" })); }} placeholder="11 digits" autoComplete="off" />
            <Button type="button" variant="outline" onClick={() => void lookUp()} disabled={looking || !abn.trim()}>{looking ? "Looking…" : "Look up"}</Button>
          </div>
          {problem("abn")}
          {note ? <span className="mt-1 block text-xs text-amber-800">{note}</span> : null}
        </Field>
        <Field label="Agency / company name" required><TextInput value={business} onChange={(e) => setBusiness(e.target.value)} autoComplete="organization" />{problem("business")}</Field>
        <Field label="Contact person" required><TextInput value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="name" />{problem("contact")}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Work email" required hint={emailVerified ? "Confirmed by your sign-in." : undefined}>
            <TextInput type="email" value={email} readOnly={emailVerified} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={emailVerified ? "bg-background-100" : ""} />{problem("email")}
          </Field>
          <Field label="Phone" required hint={phoneVerified ? "Confirmed by your sign-in." : undefined}>
            <TextInput type="tel" inputMode="tel" value={phone} readOnly={phoneVerified} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" className={phoneVerified ? "bg-background-100" : ""} />{problem("phone")}
          </Field>
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-foreground-700">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-background-400" />
          <span>I agree to the <a href="/forms-policies" target="_blank" rel="noopener" className="font-medium text-primary-700 hover:underline">terms</a> and <a href="/forms-policies" target="_blank" rel="noopener" className="font-medium text-primary-700 hover:underline">privacy policy</a>.</span>
        </label>
        {problem("agreed")}
        {errors.form ? <div className="rounded-md border border-primary-200 bg-primary-50 px-3 py-2.5 text-[13px] text-primary-900" role="alert">{errors.form}</div> : null}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Submitting…" : "Submit application"}</Button>
      </div>
    </form>
  );
}
