import { useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/pages/admin/lib/supabase";
import { Button, Field, Select, TextInput } from "@/pages/admin/components/ui";
import { PhoneInput } from "@/components/feature/applicationInputs";
import { portalCourseOptions } from "@/pages/agency/lib/portalSections";
import { dateOfBirthProblem, dateOfBirthRange, mobileProblem, validEmail } from "@/lib/enrolForm";

/** Names from Google / Facebook profile data, when they gave them. */
function namesFrom(user: User): { first: string; last: string } {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const first = String(meta.given_name ?? meta.first_name ?? "").trim();
  const last = String(meta.family_name ?? meta.last_name ?? "").trim();
  if (first || last) return { first, last };
  const full = String(meta.full_name ?? meta.name ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: full.slice(0, -1).join(" ") || full[0] || "", last: full.length > 1 ? full[full.length - 1] : "" };
}

/**
 * After signing up with Google, Facebook or a phone number: the few details that make the account a student. Whatever the
 * provider verified (email or mobile) is shown and locked; the database links an existing record only through those.
 */
export default function CompleteStudentProfile({ user, onDone, onCancel }: { user: User; onDone: () => void; onCancel: () => void }) {
  const names = namesFrom(user);
  const emailVerified = Boolean(user.email && user.email_confirmed_at);
  const phoneVerified = Boolean(user.phone && user.phone_confirmed_at);
  const [first, setFirst] = useState(names.first);
  const [last, setLast] = useState(names.last);
  const [email, setEmail] = useState(emailVerified ? String(user.email) : "");
  const [dob, setDob] = useState("");
  const [course, setCourse] = useState("");
  const [referral, setReferral] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const range = dateOfBirthRange();
  const verifiedPhone = phoneVerified ? `+${String(user.phone).replace(/^\+/, "")}` : "";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const mobile = phoneVerified ? verifiedPhone : String(new FormData(event.currentTarget).get("mobile") ?? "");
    const next: Record<string, string> = {};
    if (!first.trim()) next.first = "Enter your first name.";
    if (!last.trim()) next.last = "Enter your last name.";
    if (!emailVerified && !validEmail(email)) next.email = "Enter a valid email address.";
    const mobileError = phoneVerified ? "" : mobileProblem(mobile); if (mobileError) next.mobile = mobileError;
    const dobError = dateOfBirthProblem(dob); if (dobError) next.dob = dobError;
    if (referral.trim().length > 40) next.referral = "Check the referral code.";
    if (!agreed) next.agreed = "Please agree to the terms and privacy policy.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    const { error } = await supabase.rpc("portal_self_enrol_complete", {
      p_input: { firstName: first.trim(), lastName: last.trim(), email: email.trim().toLowerCase(), phone: mobile, dateOfBirth: dob, course, referralCode: referral.trim() },
    });
    setBusy(false);
    if (error) { setErrors({ form: error.message || "We could not finish setting up your account. Please try again." }); return; }
    onDone();
  };

  const problem = (key: string) => (errors[key] ? <span className="mt-1 block text-xs text-primary-700" role="alert">{errors[key]}</span> : null);

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Almost done · Student</p>
      <h2 className="mt-1 font-heading text-2xl font-bold text-foreground-950">Your details</h2>
      <p className="mt-1.5 text-sm text-foreground-600">A few details to set up your student account.</p>
      <div className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" required><TextInput value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" />{problem("first")}</Field>
          <Field label="Last name" required><TextInput value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" />{problem("last")}</Field>
        </div>
        <Field label="Email" required hint={emailVerified ? "Confirmed by your sign-in." : undefined}>
          <TextInput type="email" value={email} readOnly={emailVerified} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" className={emailVerified ? "bg-background-100" : ""} />
          {problem("email")}
        </Field>
        {phoneVerified ? (
          <Field label="Mobile" hint="Confirmed by your sign-in."><TextInput value={verifiedPhone} readOnly className="bg-background-100" /></Field>
        ) : (
          <div>
            <label htmlFor="complete-mobile" className="mb-1.5 block text-[13px] font-medium text-foreground-800">Mobile <span className="text-primary-600">*</span></label>
            <PhoneInput id="complete-mobile" name="mobile" required placeholder="041 234 5678" />
            {problem("mobile")}
          </div>
        )}
        <Field label="Date of birth" required hint="You must be between 10 and 100 years old.">
          <TextInput type="date" value={dob} min={range.min} max={range.max} autoComplete="bday" onChange={(e) => setDob(e.target.value)} />
          {problem("dob")}
        </Field>
        <Field label="Course of interest">
          <Select value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">Select a course</option>
            {portalCourseOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </Select>
        </Field>
        <Field label="Agent referral code" hint="Your education agent gives you this. Leave it blank if you are applying by yourself.">
          <TextInput value={referral} onChange={(e) => setReferral(e.target.value)} placeholder="e.g. AGT-1234" autoComplete="off" />{problem("referral")}
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-foreground-700">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-background-400" />
          <span>I agree to the <a href="/forms-policies" target="_blank" rel="noopener" className="font-medium text-primary-700 hover:underline">terms</a> and <a href="/forms-policies" target="_blank" rel="noopener" className="font-medium text-primary-700 hover:underline">privacy policy</a>.</span>
        </label>
        {problem("agreed")}
        {errors.form ? <div className="rounded-md border border-primary-200 bg-primary-50 px-3 py-2.5 text-[13px] text-primary-900" role="alert">{errors.form}</div> : null}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Setting up your account…" : "Create student account"}</Button>
        <button type="button" onClick={onCancel} className="w-full cursor-pointer text-center text-xs text-foreground-600 hover:text-foreground-900">Not you? Sign out</button>
      </div>
    </form>
  );
}
