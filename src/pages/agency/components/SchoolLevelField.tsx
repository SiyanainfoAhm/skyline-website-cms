import { useEffect, useRef } from "react";
import type { AppField } from "@/data/applicationForms";
import { DEGREE_LEVELS, schoolLevelFor } from "@/pages/agency/lib/educationLevels";


/**
 * "Highest completed school level" with Bachelor's, Master's and PhD added. The choice is saved as highest_education;
 * the reported school_level (the only values submission accepts) is kept in a hidden input that follows it.
 */
export default function SchoolLevelField({ field, id, choice, schoolLevel, locked }: {
  field: AppField;
  id: string;
  choice: string;
  schoolLevel: string;
  locked: boolean;
}) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);

  // A school level written straight into the hidden input (restored draft) shows in the dropdown when no degree is chosen.
  useEffect(() => {
    const hidden = hiddenRef.current;
    const select = selectRef.current;
    if (!hidden || !select) return undefined;
    const follow = () => {
      if (!DEGREE_LEVELS.includes(select.value) && select.value !== hidden.value) select.value = hidden.value;
    };
    hidden.addEventListener("input", follow);
    return () => hidden.removeEventListener("input", follow);
  }, []);

  const sync = () => {
    const select = selectRef.current;
    const hidden = hiddenRef.current;
    if (!select || !hidden) return;
    const next = schoolLevelFor(select.value);
    if (hidden.value === next) return;
    hidden.value = next;
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return (
    <>
      <select
        ref={selectRef}
        id={id}
        name="highest_education"
        disabled={locked}
        defaultValue={choice || schoolLevel}
        onChange={sync}
        // Applied values (from documents) arrive as input events.
        onInput={sync}
        className={`w-full rounded-md border border-background-300 bg-background-50 px-3.5 py-2.5 text-sm text-foreground-950 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40${locked ? " bg-background-100 text-foreground-600" : ""}`}
      >
        <option value="" disabled>{field.placeholder ?? "Select"}</option>
        <optgroup label="University">
          {DEGREE_LEVELS.map((option) => <option key={option} value={option}>{option}</option>)}
        </optgroup>
        <optgroup label="School">
          {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </optgroup>
      </select>
      <input ref={hiddenRef} type="hidden" name={field.name} defaultValue={schoolLevel} />
    </>
  );
}
