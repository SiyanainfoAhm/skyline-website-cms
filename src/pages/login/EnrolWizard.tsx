import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Field, Select, TextInput } from "@/pages/admin/components/ui";
import { portalCourseOptions } from "@/pages/agency/lib/portalSections";
import { PhoneInput } from "@/components/feature/applicationInputs";
import QuickSignIn from "@/pages/login/QuickSignIn";
import AgentBusinessStep, { type ChosenBusiness } from "@/pages/login/AgentBusinessStep";
import { rememberSignUpBusiness } from "@/lib/authProviders";
import {
  EMPTY_AGENT_ENROL, EMPTY_STUDENT_ENROL, abnProblem, dateOfBirthProblem, dateOfBirthRange, formatAbn, validateAgentEnrol, validateStudentEnrol,
  type AgentEnrolForm, type EnrolErrors, type EnrolKind, type StudentEnrolForm,
} from "@/lib/enrolForm";
import { enrolAgent, enrolStudent, lookupAbn, type AbnDetails, type EnrolResult } from "@/lib/selfEnrol";

type Step = 1 | 2 | 3;

/**
 * "Enroll now" on the sign-in page: who you are (step 1), your details (step 2), what happens next (step 3).
 * A student is enrolled at once and emailed a password link; an agent's business waits for SLIT's review; staff are
 * invite-only and are pointed back to their invitation email. Nothing here grants access: the password link and the
 * review are what let someone in.
 */
export default function EnrolWizard({ initialKind, onSignIn, onSignedIn }: { initialKind: EnrolKind | null; onSignIn: () => void; onSignedIn: (userId: string) => void }) {
  const [kind, setKind] = useState<EnrolKind>(initialKind ?? "student");
  // Everyone starts on "Who are you enrolling as?"; a link from the Enrol Now page only pre-selects Student or Agent.
  const [step, setStep] = useState<Step>(1);
  const [result, setResult] = useState<EnrolResult | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => { top.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [step]);

  const done = (r: EnrolResult) => { setResult(r); setStep(3); };

  return (
    <div ref={top}>
      {step === 1 ? <KindStep kind={kind} onChange={setKind} onContinue={() => setStep(kind === "staff" ? 1 : 2)} onSignIn={onSignIn} /> : null}
      {step === 2 && kind === "student" ? <StudentStep onBack={() => setStep(1)} onDone={done} onSignedIn={onSignedIn} /> : null}
      {step === 2 && kind === "agent" ? <AgentStep onBack={() => setStep(1)} onDone={done} onSignedIn={onSignedIn} /> : null}
      {step === 3 && result ? <DoneStep result={result} onSignIn={onSignIn} /> : null}
    </div>
  );
}

function Progress({ step }: { step: Step }) {
  return (
    <div className="mt-4 flex gap-1.5" aria-hidden="true">
      {[1, 2, 3].map((n) => <span key={n} className={`h-1 flex-1 rounded-full ${n <= step ? "bg-primary-500" : "bg-background-300"}`} />)}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">{children}</p>;
}

/* ----------------------------------------------------------------- step 1 */

const KINDS: Array<{ id: EnrolKind; icon: string; title: string; note?: string; text: string }> = [
  { id: "student", icon: "ri-graduation-cap-line", title: "Student", text: "Apply for a course and track your enrolment." },
  { id: "agent", icon: "ri-briefcase-4-line", title: "Agent", note: "Needs approval", text: "Refer and manage students for your agency." },
  { id: "staff", icon: "ri-user-3-line", title: "Staff", note: "Invite only", text: "Staff accounts are created by your administrator. Use the link in your invitation email." },
];

function KindStep({ kind, onChange, onContinue, onSignIn }: { kind: EnrolKind; onChange: (k: EnrolKind) => void; onContinue: () => void; onSignIn: () => void }) {
  return (
    <div>
      <Eyebrow>Step 1 of 3</Eyebrow>
      <h2 className="mt-1 font-heading text-2xl font-bold text-foreground-950">Who are you enrolling as?</h2>
      <Progress step={1} />
      <div role="radiogroup" aria-label="Account type" className="mt-6 space-y-3">
        {KINDS.map((item) => {
          const selected = item.id === kind;
          return (
            <button key={item.id} type="button" role="radio" aria-checked={selected} onClick={() => onChange(item.id)}
              className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors ${selected ? "border-primary-500 bg-primary-50 ring-1 ring-primary-500" : "border-background-300 bg-background-50 hover:border-primary-300"}`}>
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl ${selected ? "bg-primary-500 text-background-50" : "bg-background-100 text-foreground-700"}`}>
                <i className={item.icon} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-heading text-base font-semibold text-foreground-950">{item.title}</span>
                  {item.note ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${item.id === "agent" ? "bg-amber-50 text-amber-900" : "bg-background-200 text-foreground-700"}`}>{item.note}</span> : null}
                </span>
                <span className="mt-0.5 block text-sm text-foreground-600">{item.text}</span>
              </span>
              <span className={`mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-primary-500" : "border-background-400"}`} aria-hidden="true">
                {selected ? <span className="h-2.5 w-2.5 rounded-full bg-primary-500" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      {kind === "staff" ? (
        <div className="mt-5 rounded-md border border-secondary-200 bg-secondary-50 px-3 py-2.5 text-[13px] text-secondary-900" role="status">
          Staff accounts cannot be created here. Open the link in the invitation email your administrator sent you to set your password, then sign in.
          Lost it? Ask your administrator to resend the invitation.
        </div>
      ) : null}
      <Button type="button" className="mt-6 w-full" onClick={onContinue} disabled={kind === "staff"}>Continue</Button>
      <p className="mt-5 text-center text-sm text-foreground-600">
        Already have an account? <button type="button" onClick={onSignIn} className="cursor-pointer font-semibold text-primary-700 hover:text-primary-800">Sign in</button>
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- shared form bits */

function Problem({ text }: { text?: string }) {
  return text ? <span className="mt-1 block text-xs text-primary-700" role="alert">{text}</span> : null;
}

function Agree({ checked, onChange, error }: { checked: boolean; onChange: (v: boolean) => void; error?: string }) {
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-foreground-700">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-background-400 text-primary-600 focus:ring-primary-200" />
        <span>I agree to the <Link to="/forms-policies" target="_blank" rel="noopener" className="font-medium text-primary-700 hover:underline">terms</Link> and <Link to="/forms-policies" target="_blank" rel="noopener" className="font-medium text-primary-700 hover:underline">privacy policy</Link>.</span>
      </label>
      <Problem text={error} />
    </div>
  );
}

function StepHeader({ step, kind, title, onBack }: { step: Step; kind: string; title: string; onBack: () => void }) {
  return (
    <div>
      <div className="flex items-start gap-3">
        <button type="button" onClick={onBack} aria-label="Back" className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-background-300 text-foreground-700 hover:bg-background-100">
          <i className="ri-arrow-left-s-line text-xl" aria-hidden="true" />
        </button>
        <div>
          <Eyebrow>Step {step} of 3 · {kind}</Eyebrow>
          <h2 className="mt-0.5 font-heading text-2xl font-bold text-foreground-950">{title}</h2>
        </div>
      </div>
      <Progress step={step} />
    </div>
  );
}

function FormError({ text }: { text?: string }) {
  return text ? (
    <div className="flex items-start gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2.5 text-[13px] text-primary-900" role="alert">
      <i className="ri-error-warning-line mt-0.5 text-base" aria-hidden="true" /><span>{text}</span>
    </div>
  ) : null;
}

/* ----------------------------------------------------------------- step 2: student */

function StudentStep({ onBack, onDone, onSignedIn }: { onBack: () => void; onDone: (r: EnrolResult) => void; onSignedIn: (userId: string) => void }) {
  const [form, setForm] = useState<StudentEnrolForm>(EMPTY_STUDENT_ENROL);
  const [errors, setErrors] = useState<EnrolErrors<StudentEnrolForm>>({});
  const [busy, setBusy] = useState(false);
  const [website, setWebsite] = useState("");
  const patch = (next: Partial<StudentEnrolForm>) => setForm((prev) => ({ ...prev, ...next }));
  const range = dateOfBirthRange();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    // The phone field keeps its value (E.164, with the country code) in a hidden input named "mobile".
    const current = { ...form, mobile: String(new FormData(event.currentTarget).get("mobile") ?? "") };
    setForm(current);
    const checked = validateStudentEnrol(current);
    setErrors(checked);
    if (Object.keys(checked).length) return;
    setBusy(true);
    try { onDone(await enrolStudent(current, website)); }
    catch (e) { setErrors({ form: e instanceof Error ? e.message : "We could not complete your enrolment. Please try again." }); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate>
      <StepHeader step={2} kind="Student" title="Your details" onBack={onBack} />
      <QuickStart onSignedIn={onSignedIn} intent="student" />
      <div className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" required><TextInput value={form.firstName} onChange={(e) => patch({ firstName: e.target.value })} autoComplete="given-name" /><Problem text={errors.firstName} /></Field>
          <Field label="Last name" required><TextInput value={form.lastName} onChange={(e) => patch({ lastName: e.target.value })} autoComplete="family-name" /><Problem text={errors.lastName} /></Field>
        </div>
        <Field label="Email" required><TextInput type="email" value={form.email} onChange={(e) => patch({ email: e.target.value })} placeholder="you@example.com" autoComplete="email" /><Problem text={errors.email} /></Field>
        <div>
          <label htmlFor="enrol-mobile" className="mb-1.5 block text-[13px] font-medium text-foreground-800">Mobile <span className="text-primary-600">*</span></label>
          <PhoneInput id="enrol-mobile" name="mobile" value={form.mobile} required placeholder="041 234 5678" />
          <Problem text={errors.mobile} />
        </div>
        <Field label="Date of birth" required hint="You must be between 10 and 100 years old.">
          <TextInput type="date" value={form.dateOfBirth} min={range.min} max={range.max} autoComplete="bday"
            onChange={(e) => { patch({ dateOfBirth: e.target.value }); if (errors.dateOfBirth) setErrors((prev) => ({ ...prev, dateOfBirth: undefined })); }}
            onBlur={(e) => { const problem = e.target.value ? dateOfBirthProblem(e.target.value) : ""; setErrors((prev) => ({ ...prev, dateOfBirth: problem || undefined })); }} />
          <Problem text={errors.dateOfBirth} />
        </Field>
        <Field label="Course of interest">
          <Select value={form.course} onChange={(e) => patch({ course: e.target.value })}>
            <option value="">Select a course</option>
            {portalCourseOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </Select>
        </Field>
        <Field label="Agent referral code" hint="Your education agent gives you this. Leave it blank if you are applying by yourself.">
          <TextInput value={form.referralCode} onChange={(e) => patch({ referralCode: e.target.value })} placeholder="e.g. AGT-1234" autoComplete="off" /><Problem text={errors.referralCode} />
        </Field>
        <p className="text-xs text-foreground-500">We email you a link to choose your password; that link also confirms your email address.</p>
        {/* Honeypot: hidden from people, filled by bots. */}
        <div className="hidden" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label></div>
        <Agree checked={form.agreed} onChange={(agreed) => patch({ agreed })} error={errors.agreed} />
        <FormError text={errors.form} />
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating your account…" : "Create student account"}</Button>
      </div>
    </form>
  );
}

/** Google / Facebook / phone above the student form; hidden entirely when none of them is switched on. */
function QuickStart({ onSignedIn, intent }: { onSignedIn: (userId: string) => void; intent: "student" | "agent" }) {
  return (
    <div className="mt-6">
      <QuickSignIn create intent={intent} onSignedIn={onSignedIn} />
      <div className="mt-5 flex items-center gap-3 text-xs text-foreground-500" aria-hidden="true">
        <span className="h-px flex-1 bg-background-300" />or fill in your details<span className="h-px flex-1 bg-background-300" />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- step 2: agent */

function AgentStep({ onBack, onDone, onSignedIn }: { onBack: () => void; onDone: (r: EnrolResult) => void; onSignedIn: (userId: string) => void }) {
  // First the business (ABN Lookup, confirmed by the agent), then how they sign up: Google / Facebook / phone or company email.
  const [business, setBusiness] = useState<ChosenBusiness | null>(null);
  const [form, setForm] = useState<AgentEnrolForm>(EMPTY_AGENT_ENROL);
  const [errors, setErrors] = useState<EnrolErrors<AgentEnrolForm>>({});
  const [busy, setBusy] = useState(false);
  const [website, setWebsite] = useState("");
  const patch = (next: Partial<AgentEnrolForm>) => setForm((prev) => ({ ...prev, ...next }));

  const choose = (chosen: ChosenBusiness) => {
    setBusiness(chosen);
    setForm((prev) => ({ ...prev, abn: formatAbn(chosen.abn), businessName: chosen.businessName }));
    rememberSignUpBusiness({ abn: chosen.abn, businessName: chosen.businessName, looked: Boolean(chosen.details) });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !business) return;
    const current = { ...form, abn: formatAbn(business.abn), businessName: business.businessName };
    const checked = validateAgentEnrol(current);
    setErrors(checked);
    if (Object.keys(checked).length) return;
    setBusy(true);
    try { const result = await enrolAgent(current, website); rememberSignUpBusiness(null); onDone(result); }
    catch (e) { setErrors({ form: e instanceof Error ? e.message : "We could not submit your application. Please try again." }); }
    finally { setBusy(false); }
  };

  if (!business) {
    return (
      <div>
        <StepHeader step={2} kind="Agent" title="Let's find your business" onBack={onBack} />
        <div className="mt-5"><AgentBusinessStep initial={null} onChosen={choose} /></div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <StepHeader step={2} kind="Agent" title="Create your agent account" onBack={() => setBusiness(null)} />
      <div className="mt-5 flex items-start justify-between gap-3 rounded-lg border border-background-300 bg-background-50 p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <i className={business.details ? "ri-check-line" : "ri-edit-line"} aria-hidden="true" /> {business.details ? "From ABN Lookup" : "Entered by you"}
          </p>
          <p className="mt-0.5 truncate font-semibold text-foreground-900">{business.businessName}</p>
          <p className="text-xs text-foreground-600">ABN {formatAbn(business.abn)}{business.details?.state ? ` · ${business.details.state} ${business.details.postcode}` : ""}</p>
        </div>
        <button type="button" onClick={() => setBusiness(null)} className="shrink-0 cursor-pointer text-sm font-medium text-primary-700 hover:text-primary-800">Change</button>
      </div>
      <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900" role="status">
        <i className="ri-error-warning-line mt-0.5 text-base" aria-hidden="true" /><span>Agent accounts are reviewed by our team before you can sign in.</span>
      </div>
      <div className="mt-5">
        <QuickSignIn create intent="agent" onSignedIn={onSignedIn} />
        <div className="mt-5 flex items-center gap-3 text-xs text-foreground-500" aria-hidden="true">
          <span className="h-px flex-1 bg-background-300" />or use your company email<span className="h-px flex-1 bg-background-300" />
        </div>
      </div>
      <div className="mt-5 space-y-4">
        <Field label="Contact person" required><TextInput value={form.contactName} onChange={(e) => patch({ contactName: e.target.value })} autoComplete="name" /><Problem text={errors.contactName} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Work email" required><TextInput type="email" value={form.email} onChange={(e) => patch({ email: e.target.value })} autoComplete="email" /><Problem text={errors.email} /></Field>
          <Field label="Phone" required><TextInput type="tel" inputMode="tel" value={form.phone} onChange={(e) => patch({ phone: e.target.value })} autoComplete="tel" /><Problem text={errors.phone} /></Field>
        </div>
        <p className="text-xs text-foreground-500">We email you a link to choose your password. You become the administrator of your agency's workspace once SLIT approves it.</p>
        <div className="hidden" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label></div>
        <Agree checked={form.agreed} onChange={(agreed) => patch({ agreed })} error={errors.agreed} />
        {errors.abn || errors.businessName ? <FormError text={errors.abn || errors.businessName} /> : null}
        <FormError text={errors.form} />
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Submitting…" : "Submit application"}</Button>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------------- step 3 */

function DoneStep({ result, onSignIn }: { result: EnrolResult; onSignIn: () => void }) {
  const agent = result.kind === "agent";
  const title = agent ? "Application received" : "Check your email";
  const text = result.existingIdentity
    ? "This email already has a password. Sign in with it and your enrolment is linked to your account automatically."
    : result.warning
      ? result.warning
      : agent
        ? "Your application has been received and our team is looking into it. We will get back to you."
        : "We've sent you a link to choose your password. Open it, set your password, then sign in to see your application.";
  return (
    <div className="text-center">
      <Progress step={3} />
      <span className="mx-auto mt-8 flex h-20 w-20 items-center justify-center rounded-full bg-primary-50 text-4xl text-primary-600">
        <i className={agent ? "ri-time-line" : "ri-mail-check-line"} aria-hidden="true" />
      </span>
      <Eyebrow><span className="mt-5 block">Step 3 of 3</span></Eyebrow>
      <h2 className="mt-1 font-heading text-2xl font-bold text-foreground-950">{title}</h2>
      <p className="mx-auto mt-3 max-w-sm text-sm text-foreground-600">{text}</p>
      <dl className="mt-6 space-y-2 rounded-lg border border-background-200 bg-background-50 p-4 text-left text-sm">
        <div className="flex justify-between gap-3"><dt className="text-foreground-500">Account type</dt><dd className="font-semibold text-foreground-900">{agent ? "Agent" : "Student"}</dd></div>
        {result.businessName ? <div className="flex justify-between gap-3"><dt className="text-foreground-500">Business</dt><dd className="font-semibold text-foreground-900">{result.businessName}</dd></div> : null}
        <div className="flex justify-between gap-3"><dt className="text-foreground-500">Status</dt>
          <dd><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${agent ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>{agent ? "Pending review" : result.emailSent ? "Email sent" : "Ready to sign in"}</span></dd>
        </div>
      </dl>
      <Button type="button" variant="outline" className="mt-6 w-full" onClick={onSignIn}>Back to sign in</Button>
    </div>
  );
}
