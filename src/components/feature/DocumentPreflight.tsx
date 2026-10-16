import { useEffect, useRef, useState } from "react";
import { isReadableFile, recognizeImage } from "@/lib/ocr";
import { SCAN_CONFIG, parseDocument, type ScanType } from "@/lib/docScan";

export type PreflightFiles = Partial<Record<ScanType, File[]>>;

type Props = {
  /** Called once the applicant finishes (or skips) every step, carrying whatever was read. */
  onDone: (values: Record<string, string>, files: PreflightFiles) => void;
};

type StepDef = {
  type: ScanType;
  label: string;
  note: string;
  multiple?: boolean;
};

const STEPS: StepDef[] = [
  {
    type: "passport",
    label: "Passport",
    note: "The big one — unlocks your name, date of birth, passport number and nationality.",
  },
  {
    type: "licence",
    label: "Driver licence",
    note: "Optional backup ID. Best-effort read of your name, date of birth and address.",
  },
  {
    type: "english",
    label: "English test",
    note: "IELTS, PTE or TOEFL result — we read your test type, score and date.",
  },
  {
    type: "academic",
    label: "Academic marksheets",
    note: "Transcripts, certificates or marksheets. Add one or more files.",
    multiple: true,
  },
];

/** Friendly labels for the little "here's what we read" preview. */
const FIELD_LABELS: Record<string, string> = {
  first_name: "Given name",
  middle_name: "Middle name",
  last_name: "Surname",
  dob: "Date of birth",
  gender: "Gender",
  title: "Title",
  passport_number: "Passport number",
  passport_expiry: "Passport expiry",
  nationality: "Nationality",
  citizenship: "Citizenship",
  birth_country: "Country of birth",
  english_type: "English test type",
  english_score: "English score",
  english_date: "Test date",
  address_type: "Address type",
  au_street: "Street address",
  academic_institution: "Institution",
  academic_qualification: "Qualification",
  academic_year: "Year completed",
};

export default function DocumentPreflight({ onDone }: Props) {
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<PreflightFiles>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "error"; text?: string }>({ kind: "idle" });
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [extracted, setExtracted] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lock background scrolling while the popup is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const resetStepUi = () => {
    setStatus({ kind: "idle" });
    setExtracted([]);
    setFileNames([]);
    setProgress(0);
  };

  const finish = () => onDone(values, files);

  const goNext = () => {
    if (index >= STEPS.length - 1) {
      finish();
      return;
    }
    setIndex(index + 1);
    resetStepUi();
  };

  const goBack = () => {
    if (index === 0) return;
    setIndex(index - 1);
    resetStepUi();
  };

  const jumpTo = (target: number) => {
    if (target === index) return;
    setIndex(Math.max(0, Math.min(target, STEPS.length - 1)));
    resetStepUi();
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const chosen = Array.from(list);
    const readable = chosen.filter(isReadableFile);
    if (readable.length === 0) {
      setStatus({ kind: "error", text: "Auto-read works on photos (JPG or PNG) and PDFs. Please attach one of those." });
      return;
    }

    setFileNames((prev) => (step.multiple ? [...prev, ...readable.map((file) => file.name)] : readable.map((file) => file.name)));
    setBusy(true);
    setProgress(0);
    setExtracted([]);
    setStatus({ kind: "idle" });

    try {
      const merged: Record<string, string> = {};
      for (let i = 0; i < readable.length; i += 1) {
        const text = await recognizeImage(readable[i], (value) =>
          setProgress(Math.round(((i + value) / readable.length) * 100)),
        );
        Object.assign(merged, parseDocument(step.type, text));
      }

      const names = Object.keys(merged);
      if (names.length > 0) setValues((prev) => ({ ...prev, ...merged }));
      setFiles((prev) => ({
        ...prev,
        [step.type]: step.multiple ? [...(prev[step.type] ?? []), ...readable] : readable,
      }));
      setExtracted(names);
      setStatus(
        names.length > 0
          ? { kind: "ok", text: `Read ${names.length} field${names.length === 1 ? "" : "s"} — we'll fill these in for you.` }
          : { kind: "error", text: "We couldn't pick out any fields, but your file is attached. You can type the rest." },
      );
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Reading failed. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const collected = Object.keys(values).length;
  const isLast = index >= STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-foreground-950/55 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preflight-title"
    >
      <div className="my-auto w-full max-w-xl rounded-xl border border-background-200 bg-background-50">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-background-200 p-5 md:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-500 text-background-50">
              <i className="ri-magic-line text-xl" aria-hidden="true" />
            </span>
            <div>
              <h2 id="preflight-title" className="font-heading text-lg font-bold text-foreground-950">
                Get a head start
              </h2>
              <p className="mt-0.5 text-sm leading-relaxed text-foreground-600">
                Add your documents and we&rsquo;ll read them for you — or skip straight to the form.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={finish}
            aria-label="Skip and open the application form"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground-500 transition-colors hover:bg-background-100 hover:text-foreground-800"
          >
            <i className="ri-close-line text-lg" aria-hidden="true" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex flex-wrap gap-2 border-b border-background-200 px-5 py-3.5 md:px-6">
          {STEPS.map((item, itemIndex) => {
            const active = itemIndex === index;
            const done = itemIndex < index;
            return (
              <button
                key={item.type}
                type="button"
                onClick={() => jumpTo(itemIndex)}
                className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? "border-primary-300 bg-primary-50 text-primary-700"
                    : done
                      ? "border-background-200 bg-background-100 text-foreground-600"
                      : "border-background-200 bg-background-50 text-foreground-400"
                }`}
              >
                <i className={done ? "ri-check-line" : "ri-circle-fill text-[6px]"} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Step body */}
        <div className="space-y-4 p-5 md:p-6">
          <div className="rounded-lg border border-background-200 bg-background-100/60 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-background-50 text-primary-600">
                <i className={`${SCAN_CONFIG[step.type].icon} text-xl`} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-heading text-sm font-semibold text-foreground-950">{SCAN_CONFIG[step.type].title}</p>
                <p className="mt-1 text-xs leading-relaxed text-foreground-600">{step.note}</p>
              </div>
            </div>

            <div className="mt-4">
              <label className="flex w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-dashed border-primary-300 bg-background-50 px-4 py-3 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50">
                <i className={busy ? "ri-loader-4-line animate-spin" : "ri-upload-cloud-2-line"} aria-hidden="true" />
                {busy
                  ? `Reading… ${progress}%`
                  : step.multiple
                    ? fileNames.length > 0
                      ? "Add more files"
                      : "Upload files"
                    : fileNames.length > 0
                      ? "Replace file"
                      : "Upload file"}
                <input
                  ref={inputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.gif,.pdf,image/*"
                  multiple={step.multiple}
                  disabled={busy}
                  onChange={(event) => {
                    void handleFiles(event.target.files);
                    event.target.value = "";
                  }}
                  className="sr-only"
                />
              </label>
              <p className="mt-2 text-center text-[11px] text-foreground-400">
                JPG, PNG or PDF · read on your device, nothing is uploaded
              </p>
            </div>
          </div>

          {fileNames.length > 0 ? (
            <ul className="space-y-1.5">
              {fileNames.map((name, nameIndex) => (
                <li
                  key={`${name}-${nameIndex}`}
                  className="flex items-center gap-2 rounded-md border border-background-200 bg-background-50 px-3 py-2 text-xs text-foreground-700"
                >
                  <i className="ri-attachment-2 text-sm text-primary-600" aria-hidden="true" />
                  <span className="truncate">{name}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {status.kind !== "idle" ? (
            <p
              role="status"
              className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
                status.kind === "ok"
                  ? "border border-accent-200 bg-accent-50 text-accent-900"
                  : "border border-primary-200 bg-primary-50 text-primary-900"
              }`}
            >
              <i
                className={status.kind === "ok" ? "ri-checkbox-circle-line mt-px" : "ri-alert-line mt-px"}
                aria-hidden="true"
              />
              <span>{status.text}</span>
            </p>
          ) : null}

          {extracted.length > 0 ? (
            <div className="rounded-lg border border-background-200 bg-background-50 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-700">
                <i className="ri-sparkling-2-line text-base text-accent-600" aria-hidden="true" />
                Read from this document
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                {extracted.map((name) => (
                  <div key={name} className="flex items-baseline justify-between gap-3 border-b border-dashed border-background-200 pb-1.5">
                    <dt className="text-xs text-foreground-500">{FIELD_LABELS[name] ?? name}</dt>
                    <dd className="min-w-0 truncate text-xs font-semibold text-foreground-950">{values[name]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-3 border-t border-background-200 p-5 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div className="flex items-center gap-4">
            {index > 0 ? (
              <button
                type="button"
                onClick={goBack}
                className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-sm font-medium text-foreground-600 transition-colors hover:text-foreground-900"
              >
                <i className="ri-arrow-left-line" aria-hidden="true" />
                Back
              </button>
            ) : null}
            <span className="text-xs text-foreground-500">
              {collected > 0 ? `${collected} field${collected === 1 ? "" : "s"} ready to fill` : "Nothing added yet"}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            <button
              type="button"
              onClick={goNext}
              disabled={busy}
              className="inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-4 py-2.5 text-sm font-semibold text-foreground-700 transition-colors hover:border-primary-300 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={busy}
              className="inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-5 py-2.5 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLast ? "Start application" : "Continue"}
              <i className={isLast ? "ri-arrow-right-circle-line" : "ri-arrow-right-line"} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="border-t border-background-200 px-5 py-3 text-center md:px-6">
          <button
            type="button"
            onClick={finish}
            className="cursor-pointer text-xs font-medium text-foreground-500 underline underline-offset-2 transition-colors hover:text-primary-600"
          >
            Skip all and open the application form
          </button>
        </div>
      </div>
    </div>
  );
}
