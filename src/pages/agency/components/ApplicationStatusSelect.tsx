import { useContext, useState } from "react";
import { PortalAuthContext } from "@/pages/agency/lib/portalAuthContext";
import { statusMeta } from "@/pages/agency/lib/portalData";
import { nextStatusOptions } from "@/pages/agency/lib/applicationAccess";
import { setApplicationStatus } from "@/pages/agency/lib/portalApplications";
import { StatusBadge } from "@/pages/agency/components/PortalUI";

/**
 * An application's status as a pill. A SLIT administrator can change it from the pill: only the moves the admissions
 * rules allow are offered (a draft is submitted from its form, so it has none). Everyone else sees the status only.
 */
export default function ApplicationStatusSelect({ applicationId, status, onChanged }: {
  applicationId: string;
  status: string;
  onChanged?: (next: string) => void;
}) {
  // Inside the portal the signed-in role decides. CMS pages (Students, a business's tabs) have no portal context and
  // are open to SLIT administrators only; the database checks every change either way.
  const portal = useContext(PortalAuthContext);
  const isSlitAdmin = portal ? portal.role === "slit_admin" : true;
  const [current, setCurrent] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previous, setPrevious] = useState(status);
  if (previous !== status) { setPrevious(status); setCurrent(status); }

  const options = isSlitAdmin ? nextStatusOptions(current) : [];
  if (!options.length) return <StatusBadge status={current} />;

  const change = async (next: string) => {
    if (!next || next === current) return;
    let note = "";
    if (next === "action_required") {
      const reason = window.prompt("What does the agent need to correct? This is sent with the status change.");
      if (reason === null) return;
      note = reason.trim();
      if (!note) { setError("A reason is required for Action required."); return; }
    }
    setBusy(true);
    setError("");
    try {
      await setApplicationStatus(applicationId, next, note);
      setCurrent(next);
      onChanged?.(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The status could not be changed.");
    } finally {
      setBusy(false);
    }
  };

  const meta = statusMeta(current);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <label className="sr-only" htmlFor={`status-${applicationId}`}>Status</label>
      <select id={`status-${applicationId}`} value={current} disabled={busy} onChange={(e) => void change(e.target.value)}
        className={`cursor-pointer rounded-full border-0 py-1 pl-2.5 pr-7 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-60 ${meta.className}`}>
        <option value={current}>{busy ? "Saving…" : meta.label}</option>
        {options.map((value) => <option key={value} value={value}>Change to {statusMeta(value).label}</option>)}
      </select>
      {error ? <span role="alert" className="max-w-[14rem] text-[11px] font-medium text-red-700">{error}</span> : null}
    </span>
  );
}
