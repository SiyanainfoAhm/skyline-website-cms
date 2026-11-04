import { useRef, useState, type ReactNode } from "react";
import { PhoneInput } from "@/components/feature/applicationInputs";
import { validateEmail } from "@/pages/agency/lib/userValidation";
import { findStudents, type StudentMatch } from "@/pages/agency/lib/portalApplications";
import { formatPhone, parseStoredPhone, validateStoredPhone } from "../../../../supabase/functions/_shared/validation/identifiers";

export interface StudentDraft {
  fullName: string;
  email: string;
  mobile: string;
  dateOfBirth: string;
  passportNumber: string;
}

const EMPTY: StudentDraft = { fullName: "", email: "", mobile: "", dateOfBirth: "", passportNumber: "" };
const INPUT = "w-full rounded-md border border-background-300 bg-background-50 px-3.5 py-2.5 text-sm text-foreground-950 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40";

/**
 * The student a new application is for. Name, email and mobile are required; a matching student already on record
 * (same email, mobile or passport) is offered first, so one student keeps one record with all their applications.
 */
export default function StudentDetailsStep({ initial, busy, error, submitLabel = "Next", onContinue, cancel, description }: {
  initial?: Partial<StudentDraft>;
  busy: boolean;
  error?: string;
  submitLabel?: string;
  /** The details typed and, when the person chose one, the existing student to reuse instead of creating a new record. */
  onContinue: (draft: StudentDraft, existing: StudentMatch | null) => void;
  cancel?: ReactNode;
  description?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof StudentDraft, string>>>({});
  const [matches, setMatches] = useState<{ draft: StudentDraft; rows: StudentMatch[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const start = { ...EMPTY, ...initial };

  const read = (): StudentDraft => {
    const data = new FormData(formRef.current ?? undefined);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    return { fullName: text("full_name").replace(/\s+/g, " "), email: text("email").toLowerCase(), mobile: text("mobile"), dateOfBirth: text("dob"), passportNumber: text("passport_number").toUpperCase().replace(/\s/g, "") };
  };

  const submit = async () => {
    const draft = read();
    const next: Partial<Record<keyof StudentDraft, string>> = {
      fullName: draft.fullName ? undefined : "Enter the student's name.",
      email: validateEmail(draft.email) ?? undefined,
      mobile: !draft.mobile.startsWith("+") || !parseStoredPhone(draft.mobile)?.national ? "Enter the student's mobile number." : validateStoredPhone(draft.mobile) || undefined,
      dateOfBirth: draft.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(draft.dateOfBirth) ? "Enter the date of birth." : undefined,
    };
    setErrors(next);
    if (next.fullName || next.email || next.mobile || next.dateOfBirth) return;
    setChecking(true);
    setCheckError("");
    try {
      const rows = await findStudents(draft.email, draft.mobile, draft.passportNumber);
      if (rows.length === 0) onContinue(draft, null);
      else setMatches({ draft, rows });
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "We could not check for an existing student.");
    } finally {
      setChecking(false);
    }
  };

  const waiting = busy || checking;

  if (matches) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground-950">This student may already be on record</h2>
          <p className="mt-1.5 text-sm text-foreground-600">A student with the same email, mobile or passport exists. Start a new application for them, or add {matches.draft.fullName} as a new student.</p>
        </div>
        <ul className="divide-y divide-background-200 rounded-md border border-background-200">
          {matches.rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <b className="block text-foreground-900">{row.name || "Unnamed student"}</b>
                <span className="block text-xs text-foreground-600">
                  {[row.email, row.phone ? formatPhone(row.phone) : "", row.passportNumber ? `Passport ${row.passportNumber}` : ""].filter(Boolean).join(" · ")}
                </span>
                <span className="block text-xs text-foreground-500">
                  {row.businessName}{row.agentName ? `, ${row.agentName}` : ""} · {row.applications} application{row.applications === 1 ? "" : "s"} · matches {[row.emailMatch ? "email" : "", row.phoneMatch ? "mobile" : "", row.passportMatch ? "passport" : ""].filter(Boolean).join(", ")}
                </span>
              </span>
              <button type="button" disabled={waiting} onClick={() => onContinue(matches.draft, row)}
                className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-4 py-2 text-sm font-semibold text-background-50 hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60">
                New application for this student
              </button>
            </li>
          ))}
        </ul>
        {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          <button type="button" disabled={waiting} onClick={() => setMatches(null)}
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-background-300 px-5 py-2.5 text-sm font-semibold text-foreground-800 hover:bg-background-100 disabled:opacity-60">
            <i className="ri-arrow-left-line" aria-hidden="true" /> Back
          </button>
          <button type="button" disabled={waiting} onClick={() => onContinue(matches.draft, null)}
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-primary-300 px-5 py-2.5 text-sm font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-60 sm:ml-auto">
            {busy ? "Adding…" : "No, add as a new student"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}
      // A field's error goes as soon as it is edited; everything is checked again on submit.
      onInput={(event) => {
        const name = (event.target as HTMLInputElement).name;
        const key = name === "full_name" ? "fullName" : name === "dob" ? "dateOfBirth" : name === "passport_number" ? "passportNumber" : name;
        setErrors((prev) => (prev[key as keyof StudentDraft] ? { ...prev, [key]: undefined } : prev));
      }}>
      <h2 className="font-heading text-base font-semibold text-foreground-950">Student details</h2>
      <p className="mt-1.5 text-sm text-foreground-600">{description ?? "Name, email and mobile are required. Everything else is filled from the documents you upload."}</p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="student-full-name" className="mb-1.5 block text-[13px] font-medium text-foreground-800">Full name <span className="text-primary-600">*</span></label>
          <input id="student-full-name" name="full_name" required autoFocus autoComplete="off" maxLength={200} defaultValue={start.fullName} placeholder="As shown in the passport" aria-invalid={Boolean(errors.fullName)} className={INPUT} />
          {errors.fullName ? <p className="mt-1 text-xs text-primary-800" role="alert">{errors.fullName}</p> : null}
        </div>
        <div>
          <label htmlFor="student-email" className="mb-1.5 block text-[13px] font-medium text-foreground-800">Email <span className="text-primary-600">*</span></label>
          <input id="student-email" name="email" type="email" required autoComplete="off" maxLength={254} defaultValue={start.email} placeholder="student@example.com" aria-invalid={Boolean(errors.email)} className={INPUT} />
          {errors.email ? <p className="mt-1 text-xs text-primary-800" role="alert">{errors.email}</p> : null}
        </div>
        <div>
          <label htmlFor="student-mobile" className="mb-1.5 block text-[13px] font-medium text-foreground-800">Mobile <span className="text-primary-600">*</span></label>
          <PhoneInput id="student-mobile" name="mobile" value={start.mobile} required placeholder="041 234 5678" />
          {errors.mobile ? <p className="mt-1 text-xs text-primary-800" role="alert">{errors.mobile}</p> : null}
        </div>
        <div>
          <label htmlFor="student-dob" className="mb-1.5 block text-[13px] font-medium text-foreground-800">Date of birth</label>
          <input id="student-dob" name="dob" type="date" max={new Date().toISOString().slice(0, 10)} defaultValue={start.dateOfBirth} aria-invalid={Boolean(errors.dateOfBirth)} className={INPUT} />
          {errors.dateOfBirth ? <p className="mt-1 text-xs text-primary-800" role="alert">{errors.dateOfBirth}</p> : null}
        </div>
        <div>
          <label htmlFor="student-passport" className="mb-1.5 block text-[13px] font-medium text-foreground-800">Passport number</label>
          <input id="student-passport" name="passport_number" autoComplete="off" maxLength={40} defaultValue={start.passportNumber} placeholder="Optional; read from the passport later" className={INPUT} />
        </div>
      </div>

      {error || checkError ? <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error || checkError}</p> : null}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        {cancel}
        <button type="submit" disabled={waiting}
          className="inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-6 py-3 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto">
          {waiting ? <><i className="ri-loader-4-line animate-spin" aria-hidden="true" /> {checking ? "Checking…" : "Creating…"}</> : <>{submitLabel} <i className="ri-arrow-right-line" aria-hidden="true" /></>}
        </button>
      </div>
    </form>
  );
}
