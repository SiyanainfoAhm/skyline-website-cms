import { baseFieldClass, isConditionMet, isFieldFilled, sectionHeading, sectionIcon, todayIso } from "./applicationFieldHelpers";
import type { AppField, FieldCondition } from "@/data/applicationForms";
import { PhoneInput, UsiInput, YearSelect } from "./applicationInputs";
import { useEffect, useRef, useState } from "react";

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

  if (field.type === "checkbox" && (field.options ?? []).length > 6) {
    return <SearchableChecklist name={field.name} options={field.options ?? []} disabled={locked} />;
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

  if (field.format === "year") return <YearSelect id={id} name={field.name} value={value} locked={locked} required={field.required} />;
  if (field.format === "usi") return <UsiInput id={id} name={field.name} value={value} locked={locked} required={field.required} placeholder={field.placeholder} />;
  if (field.format === "phone") return <PhoneInput id={id} name={field.name} value={value} locked={locked} required={field.required} placeholder={field.placeholder} />;

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
/**
 * Long option lists (e.g. courses): a search box filters the ticks as you type. Every checkbox stays in the
 * form (non-matching ones are only hidden), so saving, restoring and validation work exactly as before.
 */
function SearchableChecklist({ name, options, disabled }: { name: string; options: string[]; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [onlySelected, setOnlySelected] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const read = () => setSelected(Array.from(boxRef.current?.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked") ?? []).map((i) => i.value));
  // Saved ticks are restored programmatically (no change event), so re-read shortly after mount and when options change.
  useEffect(() => { const t = window.setTimeout(read, 50); const t2 = window.setTimeout(read, 600); return () => { window.clearTimeout(t); window.clearTimeout(t2); }; }, [options]);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (o: string) => (!onlySelected || selected.includes(o)) && words.every((w) => o.toLowerCase().includes(w));
  const shown = options.filter(matches).length;
  const untick = (value: string) => {
    const input = Array.from(boxRef.current?.querySelectorAll<HTMLInputElement>("input[type=checkbox]") ?? []).find((i) => i.value === value);
    if (input && !input.disabled) input.click();
  };
  return (
    <div ref={boxRef} onChange={read} className="overflow-hidden rounded-lg border border-background-300 bg-background-50">
      <div className="flex flex-wrap items-center gap-2 border-b border-background-200 bg-background-100/70 p-2">
        <div className="relative min-w-[12rem] flex-1">
          <i className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" aria-hidden="true" />
          <input type="search" aria-label="Search courses" placeholder="Search by course code or name…" value={query}
            onChange={(e) => { e.stopPropagation(); setQuery(e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); if (e.key === "Escape") setQuery(""); }}
            className="w-full rounded-md border border-background-300 bg-background-50 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40" />
        </div>
        <button type="button" onClick={() => setOnlySelected((v) => !v)} aria-pressed={onlySelected}
          className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${onlySelected ? "bg-primary-500 text-background-50" : "text-foreground-700 hover:bg-background-200"}`}>
          {selected.length} selected
        </button>
      </div>
      {selected.length ? (
        <div className="flex flex-wrap gap-1.5 border-b border-background-200 px-3 py-2">
          {selected.map((v) => (
            <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary-800">
              <span className="truncate">{v.split(" - ")[0]}</span>
              {disabled ? null : <button type="button" aria-label={`Remove ${v}`} onClick={() => untick(v)} className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary-100"><i className="ri-close-line" aria-hidden="true" /></button>}
            </span>
          ))}
        </div>
      ) : null}
      <div className="max-h-72 overflow-y-auto py-1">
        {options.map((option) => (
          <label key={option} className={`${matches(option) ? "flex" : "hidden"} cursor-pointer items-start gap-2.5 px-3 py-2 text-sm text-foreground-700 hover:bg-background-100`}>
            <input type="checkbox" name={`${name}[]`} value={option} disabled={disabled} className="mt-0.5 h-4 w-4 shrink-0 accent-primary-500" />
            <span className="leading-snug">{option}</span>
          </label>
        ))}
        {shown === 0 ? <p className="px-3 py-3 text-sm text-foreground-500">{onlySelected && !selected.length ? "Nothing selected yet." : "No course matches. Check the code or name."}</p> : null}
      </div>
    </div>
  );
}
