import { useState } from "react";
import { useLocation } from "react-router-dom";

/** Shown on the applications list after an application is submitted (passed in the navigation state). */
export default function SubmittedBanner() {
  const state = useLocation().state as { submittedReference?: string; submittedName?: string } | null;
  const [open, setOpen] = useState(Boolean(state?.submittedReference));
  if (!open || !state?.submittedReference) return null;
  return (
    <div className="mb-5 flex items-start justify-between gap-3 rounded-card border border-accent-200 bg-accent-50 px-4 py-3" role="status">
      <p className="flex items-start gap-2 text-sm text-accent-900">
        <i className="ri-checkbox-circle-line mt-px text-lg" aria-hidden="true" />
        <span>
          <strong>Application submitted</strong> &middot; {state.submittedReference}
          {state.submittedName ? ` for ${state.submittedName}` : ""}. SLIT admissions will review it.
        </span>
      </p>
      <button type="button" onClick={() => setOpen(false)} aria-label="Dismiss" className="cursor-pointer text-accent-900 hover:opacity-70">
        <i className="ri-close-line" aria-hidden="true" />
      </button>
    </div>
  );
}
