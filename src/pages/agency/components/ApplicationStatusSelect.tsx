import { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PortalAuthContext } from "@/pages/agency/lib/portalAuthContext";
import { statusMeta } from "@/pages/agency/lib/portalData";
import { nextStatusOptions } from "@/pages/agency/lib/applicationAccess";
import { setApplicationStatus } from "@/pages/agency/lib/portalApplications";
import { statusLabel, useStatusCatalog } from "@/pages/agency/lib/statusCatalog";
import { StatusBadge } from "@/pages/agency/components/PortalUI";

/**
 * An application's status as a dropdown listing every status from the backend catalogue, the same list as the status
 * filter. Only the moves the backend's admissions rules allow are selectable; the rest are shown greyed out. Choosing
 * Submitted on a draft opens its form (`openHref`), where required answers, consent and the frozen copy are checked.
 * People who cannot change statuses see the status only.
 */
export default function ApplicationStatusSelect({ applicationId, status, allowed, openHref, onChanged }: {
  applicationId: string;
  status: string;
  /** The moves the backend allows from `status` for the signed-in user (from the list query); used while the status is unchanged. */
  allowed?: string[];
  /** The application's page: where a draft is submitted. */
  openHref?: string;
  onChanged?: (next: string) => void;
}) {
  const navigate = useNavigate();
  const catalog = useStatusCatalog();
  // Inside the portal the signed-in role decides. CMS pages (Students, a business's tabs) have no portal context and
  // are open to SLIT administrators only; the database checks every change either way.
  const portal = useContext(PortalAuthContext);
  const isSlitAdmin = portal ? portal.role === "slit_admin" : true;
  const [current, setCurrent] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previous, setPrevious] = useState(status);
  if (previous !== status) { setPrevious(status); setCurrent(status); }

  // The backend's moves win while the status is the one they were worked out for; after a change here the same rules
  // apply until the list reloads.
  const fromBackend = allowed !== undefined && current === status;
  const admin = fromBackend ? allowed.length > 0 || isSlitAdmin : isSlitAdmin;
  const moves = new Set(fromBackend ? allowed : admin ? nextStatusOptions(current) : []);
  // A draft is submitted from its form: Submitted opens it.
  const submitViaForm = admin && current === "draft" && Boolean(openHref);
  if (submitViaForm) moves.add("submitted");
  if (!moves.size) return <StatusBadge status={current} />;

  const change = async (next: string) => {
    if (!next || next === current) return;
    if (next === "submitted" && submitViaForm) { if (openHref) navigate(openHref); return; }
    let note = "";
    if (next === "action_required") {
      const reason = window.prompt("What does the agent need to correct? This is sent with the status change.");
      if (reason === null) return;
      note = reason.trim();
      if (!note) { setError("A reason is required for Action required."); return; }
    } else if (current === "draft" && !window.confirm(`Mark this draft as ${statusLabel(catalog.application, next)}? It can no longer be edited or submitted.`)) {
      return;
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

  const list = catalog.application.some((item) => item.value === current) ? catalog.application : [{ value: current, label: statusMeta(current).label }, ...catalog.application];
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <label className="sr-only" htmlFor={`status-${applicationId}`}>Status</label>
      <select id={`status-${applicationId}`} value={current} disabled={busy} onChange={(e) => void change(e.target.value)}
        className={`cursor-pointer rounded-full border-0 py-1 pl-2.5 pr-7 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-60 ${statusMeta(current).className}`}>
        {list.map((item) => (
          <option key={item.value} value={item.value} disabled={item.value !== current && !moves.has(item.value)}>
            {item.value === current && busy ? "Saving…" : item.label}{item.value === "submitted" && submitViaForm ? " (opens form)" : ""}
          </option>
        ))}
      </select>
      {error ? <span role="alert" className="max-w-[14rem] text-[11px] font-medium text-red-700">{error}</span> : null}
    </span>
  );
}
