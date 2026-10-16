import {
  formatBytes,
  isSpecVisible,
  type WizardConflict,
  type WizardDoc,
  type WizardStep,
} from "@/pages/agency/lib/wizardConfig";

interface Props {
  values: Record<string, string>;
  provenance: Record<string, string>;
  confirmed: string[];
  documents: WizardDoc[];
  conflicts: WizardConflict[];
  outstanding: string[];
  missing: string[];
  steps: WizardStep[];
  onManualChange: (field: string, value: string) => void;
  onConfirm: (field: string) => void;
  onResolveConflict: (field: string, choice: "existing" | "extracted") => void;
  onEditStep: (index: number) => void;
  onViewDocument: (doc: WizardDoc) => void;
  viewingPath: string;
}

export default function WizardReviewStep({
  values,
  provenance,
  confirmed,
  documents,
  conflicts,
  outstanding,
  missing,
  steps,
  onManualChange,
  onConfirm,
  onResolveConflict,
  onEditStep,
  onViewDocument,
  viewingPath,
}: Props) {
  const docSteps = steps.filter((step) => step.id !== "review");
  const capturedCount = Object.values(values).filter((value) => value && value.trim() !== "").length;
  const confirmedSet = new Set(confirmed);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-background-200 bg-background-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-100 text-accent-900">
              <i className="ri-sparkling-2-line text-xl" aria-hidden="true" />
            </span>
            <div>
              <p className="font-heading text-sm font-semibold text-foreground-950">Review extracted information</p>
              <p className="mt-0.5 text-xs text-foreground-600">
                {capturedCount} value{capturedCount === 1 ? "" : "s"} captured from {documents.length} document
                {documents.length === 1 ? "" : "s"}. Confirm or correct anything below before continuing.
              </p>
            </div>
          </div>
          <span className="rounded-full bg-background-100 px-3 py-1 text-[11px] font-semibold text-foreground-700">
            Extraction is best-effort
          </span>
        </div>

        {/* Which sections were populated */}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {docSteps.map((step, index) => {
            const visible = step.specs.filter((spec) => isSpecVisible(spec, values));
            const filled = visible.filter((spec) => (values[spec.name] ?? "").trim() !== "");
            const done = visible.length > 0 && filled.length === visible.length;
            return (
              <div
                key={step.id}
                className="flex items-center gap-2 rounded-md border border-background-200 bg-background-50 px-3 py-2"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    done ? "bg-accent-100 text-accent-900" : filled.length > 0 ? "bg-primary-100 text-primary-800" : "bg-background-100 text-foreground-500"
                  }`}
                >
                  {done ? <i className="ri-check-line" aria-hidden="true" /> : step.id === "details" ? <i className="ri-contacts-line" aria-hidden="true" /> : <i className="ri-file-line" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground-800">{step.short}</span>
                <span className="shrink-0 text-[11px] text-foreground-500">
                  {filled.length}/{visible.length}
                </span>
                <button
                  type="button"
                  onClick={() => onEditStep(index)}
                  className="shrink-0 cursor-pointer text-[11px] font-semibold text-primary-700 hover:text-primary-800"
                >
                  Edit
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {missing.length > 0 ? (
        <div className="rounded-lg border border-primary-200 bg-primary-50 p-4">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary-900">
            <i className="ri-error-warning-line" aria-hidden="true" />
            Information still missing
          </p>
          <ul className="mt-2 space-y-1">
            {missing.map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs text-primary-900">
                <i className="ri-arrow-right-s-line mt-px" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-primary-900/80">
            You can continue and fill these in the full application form — nothing is submitted from here.
          </p>
        </div>
      ) : null}

      {outstanding.length > 0 ? (
        <div className="rounded-lg border border-accent-200 bg-accent-50 p-4">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent-900">
            <i className="ri-flag-line" aria-hidden="true" />
            Outstanding requirements
          </p>
          <ul className="mt-2 space-y-1">
            {outstanding.map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs text-accent-900">
                <i className="ri-arrow-right-s-line mt-px" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="space-y-3 rounded-lg border border-primary-200 bg-primary-50 p-4">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary-900">
            <i className="ri-error-warning-line" aria-hidden="true" />
            Conflicting details — confirm which to keep
          </p>
          {conflicts.map((conflict) => (
            <div key={conflict.field} className="rounded-md border border-primary-200 bg-background-50 p-3">
              <p className="text-xs font-semibold text-foreground-900">
                {conflict.label}
                <span className="ml-2 font-normal text-foreground-500">({conflict.source})</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["existing", "extracted"] as const).map((option) => {
                  const value = option === "existing" ? conflict.existing : conflict.extracted;
                  return (
                    <label
                      key={option}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${
                        conflict.choice === option
                          ? "border-primary-400 bg-primary-100 text-primary-900"
                          : "border-background-200 text-foreground-600"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`review-conflict-${conflict.field}`}
                        checked={conflict.choice === option}
                        onChange={() => onResolveConflict(conflict.field, option)}
                        className="h-3.5 w-3.5 accent-primary-500"
                      />
                      <span className="font-semibold">{option === "existing" ? "Keep" : "Use"}:</span>
                      <span>{value || "\u2014"}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {docSteps.map((step, index) => {
        const rows = step.specs.filter(
          (spec) => isSpecVisible(spec, values) && (values[spec.name] ?? "").trim() !== "",
        );
        if (rows.length === 0) return null;
        return (
          <div key={step.id} className="rounded-lg border border-background-200 bg-background-50">
            <div className="flex items-center justify-between gap-3 border-b border-background-200 px-4 py-3">
              <p className="flex items-center gap-2 font-heading text-sm font-semibold text-foreground-950">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-100 text-primary-700">
                  <i className={step.icon} aria-hidden="true" />
                </span>
                {step.title}
              </p>
              <button
                type="button"
                onClick={() => onEditStep(index)}
                className="shrink-0 cursor-pointer text-[11px] font-semibold text-primary-700 hover:text-primary-800"
              >
                Edit step
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-background-100 uppercase tracking-wide text-foreground-600">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Field</th>
                    <th className="px-4 py-2 font-semibold">Extracted value</th>
                    <th className="px-4 py-2 font-semibold">Source</th>
                    <th className="px-4 py-2 font-semibold">Review status</th>
                    <th className="px-4 py-2 font-semibold">{""}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((spec) => {
                    const isConfirmed = confirmedSet.has(spec.name);
                    const source = provenance[spec.name] ?? "Manual entry";
                    return (
                      <tr key={spec.name} className="border-t border-background-200 align-middle">
                        <td className="px-4 py-2.5 font-medium text-foreground-800">{spec.label}</td>
                        <td className="px-4 py-2.5">
                          <input
                            type="text"
                            value={values[spec.name] ?? ""}
                            onChange={(event) => onManualChange(spec.name, event.target.value)}
                            className="w-full rounded-md border border-background-300 bg-background-50 px-2.5 py-1.5 text-xs text-foreground-950 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40"
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-secondary-100 px-2 py-0.5 text-[10px] font-semibold text-secondary-900">
                            <i className="ri-file-line" aria-hidden="true" />
                            {source}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {isConfirmed ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-700">
                              <i className="ri-checkbox-circle-line" aria-hidden="true" />
                              Confirmed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700">
                              <i className="ri-error-warning-line" aria-hidden="true" />
                              Needs review
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {!isConfirmed ? (
                            <button
                              type="button"
                              onClick={() => onConfirm(spec.name)}
                              className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border border-accent-300 bg-accent-50 px-2 py-1 text-[11px] font-semibold text-accent-900 hover:bg-accent-100"
                            >
                              <i className="ri-check-line" aria-hidden="true" />
                              Confirm
                            </button>
                          ) : (
                            <i className="ri-check-double-line text-accent-600" aria-hidden="true" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="rounded-lg border border-background-200 bg-background-50 p-4">
        <p className="flex items-center gap-2 font-heading text-sm font-semibold text-foreground-950">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary-100 text-secondary-900">
            <i className="ri-folder-shield-2-line" aria-hidden="true" />
          </span>
          Documents stored privately
        </p>
        {documents.length === 0 ? (
          <p className="mt-3 text-xs text-foreground-500">
            No documents attached yet. That's fine — you can add them later from the application's Documents tab.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 text-xs text-foreground-700">
                <span className="flex min-w-0 items-center gap-2">
                  <i className="ri-file-shield-2-line text-accent-600" aria-hidden="true" />
                  <span className="truncate">{doc.filename}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-foreground-500">
                    {doc.category}
                    {doc.fileSize ? ` \u00b7 ${formatBytes(doc.fileSize)}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => onViewDocument(doc)}
                    disabled={!doc.storagePath || viewingPath === doc.storagePath}
                    className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border border-background-300 px-2 py-0.5 font-semibold text-foreground-700 hover:border-primary-300 hover:text-primary-700 disabled:opacity-50"
                  >
                    <i className={viewingPath === doc.storagePath ? "ri-loader-4-line animate-spin" : "ri-eye-line"} aria-hidden="true" />
                    View
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}