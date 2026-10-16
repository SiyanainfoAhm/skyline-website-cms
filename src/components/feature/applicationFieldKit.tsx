import type { AppField, FieldCondition } from "@/data/applicationForms";

/**
 * Shared rendering kit for the international student application form.
 *
 * Both the public application form and the agency portal workspace render the
 * exact same fields from `src/data/applicationForms.ts` through these helpers,
 * so the two experiences can never disagree about a field's type, options or
 * conditional visibility.
 */

export const baseFieldClass =
  "w-full rounded-md border border-background-300 bg-background-50 px-3.5 py-2.5 text-sm text-foreground-950 placeholder:text-foreground-400 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40";

/** Resolves whether a conditional field/section is currently visible. */
export function isConditionMet(condition: FieldCondition | undefined, values: Record<string, string>): boolean {
  if (!condition) return true;
  return condition.equals.includes(values[condition.field] ?? "");
}

/** Checks a rendered field in the live form to see whether the applicant has filled it in. */
export function isFieldFilled(form: HTMLFormElement, field: AppField): boolean {
  if (field.type === "checkbox") {
    const nodes = form.querySelectorAll<HTMLInputElement>(`input[name="${field.name}[]"]`);
    return Array.from(nodes).some((node) => node.checked);
  }
  if (field.type === "radio") {
    return Boolean(form.querySelector(`input[name="${field.name}"]:checked`));
  }
  if (field.type === "file") {
    const input = form.querySelector<HTMLInputElement>(`input[name="${field.name}"]`);
    return Boolean(input && (input.files?.length ?? 0) > 0);
  }
  const control = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `[name="${field.name}"]`,
  );
  if (!control) return false;
  return control.value.trim() !== "";
}

/** Strips a leading "1. " style number so accordion headers read as topics, not steps. */
export function sectionHeading(title: string | undefined, index: number): string {
  if (!title) return `Section ${index + 1}`;
  return title.replace(/^\s*\d+[a-z]?\.\s*/i, "").trim() || title;
}

/** Picks a Remix icon that reflects the section topic. */
export function sectionIcon(title: string | undefined): string {
  const text = (title ?? "").toLowerCase();
  if (text.includes("scan") || text.includes("quick start")) return "ri-scan-2-line";
  if (text.includes("personal")) return "ri-user-line";
  if (text.includes("address")) return "ri-map-pin-2-line";
  if (text.includes("passport") || text.includes("visa")) return "ri-id-card-line";
  if (text.includes("academic")) return "ri-file-text-line";
  if (text.includes("identifier") || text.includes("avetmiss")) return "ri-fingerprint-line";
  if (text.includes("unique student") || text.includes("usi")) return "ri-shield-user-line";
  if (text.includes("emergency")) return "ri-phone-line";
  if (text.includes("course information")) return "ri-graduation-cap-line";
  if (text.includes("study reason")) return "ri-book-open-line";
  if (text.includes("credit")) return "ri-award-line";
  if (text.includes("health") || text.includes("oshc")) return "ri-heart-pulse-line";
  if (text.includes("hear")) return "ri-question-line";
  if (text.includes("checklist")) return "ri-checkbox-multiple-line";
  if (text.includes("declaration")) return "ri-quill-pen-line";
  if (text.includes("company")) return "ri-building-line";
  if (text.includes("contact")) return "ri-contacts-line";
  if (text.includes("profile")) return "ri-profile-line";
  if (text.includes("reference")) return "ri-user-star-line";
  if (text.includes("attachment")) return "ri-attachment-line";
  if (text.includes("consent")) return "ri-shield-check-line";
  return "ri-file-list-3-line";
}

/** Today's date as an ISO (yyyy-mm-dd) string, for date fields defaulting to today. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function ApplicationFieldControl({
  field,
  formId,
  value,
  locked,
}: {
  field: AppField;
  formId: string;
  value?: string;
  /** Renders the field read-only (used for auto-filled agency/agent details). */
  locked?: boolean;
}) {
  const id = `${formId}-${field.name}`;

  if (field.type === "static") {
    return (
      <p className="rounded-md border border-background-200 bg-background-100 px-4 py-3 text-xs font-semibold uppercase leading-relaxed tracking-wide text-foreground-700">
        {field.description}
      </p>
    );
  }

  if (field.type === "radio") {
    return (
      <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
        {(field.options ?? []).map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 text-sm text-foreground-700">
            <input
              type="radio"
              name={field.name}
              value={option}
              required={field.required && !locked}
              disabled={locked}
              className="h-4 w-4 accent-primary-500"
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
        {(field.options ?? []).map((option) => (
          <label key={option} className="flex cursor-pointer items-start gap-2 text-sm text-foreground-700">
            <input
              type="checkbox"
              name={`${field.name}[]`}
              value={option}
              disabled={locked}
              className="mt-0.5 h-4 w-4 accent-primary-500"
            />
            <span className="leading-snug">{option}</span>
          </label>
        ))}
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <textarea
        id={id}
        name={field.name}
        rows={4}
        maxLength={500}
        required={field.required && !locked}
        readOnly={locked}
        placeholder={field.placeholder}
        defaultValue={value}
        className={`${baseFieldClass}${locked ? " bg-background-100 text-foreground-600" : ""}`}
      />
    );
  }

  if (field.type === "select") {
    return (
      <select
        id={id}
        name={field.name}
        required={field.required && !locked}
        disabled={locked}
        defaultValue={value ?? ""}
        className={`${baseFieldClass}${locked ? " bg-background-100 text-foreground-600" : ""}`}
      >
        <option value="" disabled>
          {field.placeholder ?? "Select"}
        </option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "file") {
    return (
      <input
        id={id}
        name={field.name}
        type="file"
        accept=".jpg,.jpeg,.gif,.png,.pdf"
        multiple={field.multiple}
        disabled={locked}
        className="w-full cursor-pointer rounded-md border border-dashed border-background-300 bg-background-50 px-3.5 py-2.5 text-sm text-foreground-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-700"
      />
    );
  }

  if (field.type === "table") {
    const headers = field.headers ?? [];
    const rows = field.rows ?? [];
    return (
      <div className="overflow-x-auto rounded-md border border-background-200">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-background-100 text-foreground-700">
            <tr>
              {headers.map((header) => (
                <th key={header} className="border-b border-background-200 px-3 py-2 font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${row[0] ?? "row"}-${rowIndex}`} className="border-b border-background-200 last:border-b-0">
                {row.map((cell, cellIndex) => (
                  <td key={`${cell}-${cellIndex}`} className="px-3 py-2 text-foreground-700">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <input
      id={id}
      name={field.name}
      type={field.type}
      required={field.required && !locked}
      readOnly={locked}
      placeholder={field.placeholder}
      defaultValue={value ?? (field.defaultToday ? todayIso() : undefined)}
      className={`${baseFieldClass}${locked ? " bg-background-100 text-foreground-600" : ""}`}
    />
  );
}