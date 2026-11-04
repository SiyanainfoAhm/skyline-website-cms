import { useRef, useState, type ReactNode } from "react";
import { PhoneInput } from "@/components/feature/applicationInputs";
import { validateEmail } from "@/pages/agency/lib/userValidation";
import { findStudents, type StudentMatch } from "@/pages/agency/lib/portalApplications";
import { formatPhone, parseStoredPhone, validateStoredPhone } from "../../../../supabase/functions/_shared/validation/identifiers";

/** What the first step collects. Name, date of birth and passport come from the passport upload in the wizard. */
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
 * The student a new application is for: only their email and mobile. A student already on record with either is that
 * student, so their details are not collected again; the new application starts from their record.
 */
export default function StudentDetailsStep({ initial, busy, error, submitLabel = "Next", onContinue, cancel, description }: {
  initial?: Partial<StudentDraft>;
  busy: boolean;
  error?: string;
  submitLabel?: string;
  /** The email and mobile typed and, when the student is already on record, that student. */
  onContinue: (draft: StudentDraft, existing: StudentMatch | null) => void;
  cancel?: ReactNode;
  description?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<{ email?: string; mobile?: string }>({});
  const [matches, setMatches] = useState<{ draft: StudentDraft; rows: StudentMatch[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const start = { ...EMPTY, ...initial };

  const submit = async () => {
    const data = new FormData(formRef.current ?? undefined);
    const draft: StudentDraft = { ...EMPTY, email: String(data.get("email") ?? "").trim().toLowerCase(), mobile: String(data.get("mobile") ?? "").trim() };
    const next = {
      email: validateEmail(draft.email) ?? undefined,
      mobile: !draft.mobile.startsWith("+") || !parseStoredPhone(draft.mobile)?.national ? "Enter the student's mobile number." : validateStoredPhone(draft.mobile) || undefined,
    };
    setErrors(next);
    if (next.email || next.mobile) return;
    setChecking(true);
    setCheckError("");
    try {
      const rows = await findStudents(draft.email, draft.mobile);
      if (rows.length === 0) onContinue(draft, null);
      // One student on record: that is the student; their details are not asked for again.
      else if (rows.length === 1) onContinue(draft, rows[0]);
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
          <h2 className="font-heading text-base font-semibold text-foreground-950">This student is already on record</h2>
          <p className="mt-1.5 text-sm text-foreground-600">More than one student has this email or mobile. Choose the student this application is for; their details are already on file.</p>
        </div>
        <ul className="divide-y divide-background-200 rounded-md border border-background-200">
          {matches.rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <b className="block text-foreground-900">{row.name || "Name not read from passport yet"}</b>
                <span className="block text-xs text-foreground-600">{[row.email, row.phone ? formatPhone(row.phone) : ""].filter(Boolean).join(" · ")}</span>
                <span className="block text-xs text-foreground-500">
                  {row.businessName}{row.agentName ? `, ${row.agentName}` : ""} · {row.applications} application{row.applications === 1 ? "" : "s"} · matches {[row.emailMatch ? "email" : "", row.phoneMatch ? "mobile" : ""].filter(Boolean).join(" and ")}
                </span>
              </span>
              <button type="button" disabled={waiting} onClick={() => onContinue(matches.draft, row)}
                className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-4 py-2 text-sm font-semibold text-background-50 hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? "Starting…" : "New application for this student"}
              </button>
            </li>
          ))}
        </ul>
        {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
        <button type="button" disabled={waiting} onClick={() => setMatches(null)}
          className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-background-300 px-5 py-2.5 text-sm font-semibold text-foreground-800 hover:bg-background-100 disabled:opacity-60">
          <i className="ri-arrow-left-line" aria-hidden="true" /> Change email or mobile
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}
      // A field's error goes as soon as it is edited; both are checked again on Next.
      onInput={(event) => {
        const name = (event.target as HTMLInputElement).name;
        if (name === "email" || name === "mobile") setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
      }}>
      <h2 className="font-heading text-base font-semibold text-foreground-950">Student contact details</h2>
      <p className="mt-1.5 text-sm text-foreground-600">{description ?? "Email and mobile only. A student already on record is used as they are; for a new student, the name and other details are read from the passport you upload next."}</p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="student-email" className="mb-1.5 block text-[13px] font-medium text-foreground-800">Email <span className="text-primary-600">*</span></label>
          <input id="student-email" name="email" type="email" required autoFocus autoComplete="off" maxLength={254} defaultValue={start.email} placeholder="student@example.com" aria-invalid={Boolean(errors.email)} className={INPUT} />
          {errors.email ? <p className="mt-1 text-xs text-primary-800" role="alert">{errors.email}</p> : null}
        </div>
        <div>
          <label htmlFor="student-mobile" className="mb-1.5 block text-[13px] font-medium text-foreground-800">Mobile <span className="text-primary-600">*</span></label>
          <PhoneInput id="student-mobile" name="mobile" value={start.mobile} required placeholder="041 234 5678" />
          {errors.mobile ? <p className="mt-1 text-xs text-primary-800" role="alert">{errors.mobile}</p> : null}
        </div>
      </div>

      {error || checkError ? <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error || checkError}</p> : null}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        {cancel}
        <button type="submit" disabled={waiting}
          className="inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-6 py-3 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto">
          {waiting ? <><i className="ri-loader-4-line animate-spin" aria-hidden="true" /> {checking ? "Checking…" : "Starting…"}</> : <>{submitLabel} <i className="ri-arrow-right-line" aria-hidden="true" /></>}
        </button>
      </div>
    </form>
  );
}
