import { useEffect, useState } from "react";
import { Button, Field, Modal, TextInput } from "@/pages/admin/components/ui";
import { useToast } from "@/pages/admin/components/toastContext";
import { activateAgent, listBusinesses, type ActivationResult, type BusinessRow, type BusinessStatus } from "@/pages/admin/lib/businessData";
import type { AgentToActivate } from "@/pages/admin/lib/agentActivation";
import { invokePortalUsers } from "@/pages/agency/lib/portalData";
import { portalPasswordResetUrl } from "@/pages/agency/lib/portalAuthContext";

type Picked = { kind: "existing"; id: string; name: string; status: BusinessStatus | null } | { kind: "new"; name: string } | null;

const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;

/**
 * Activate an agent in one step: choose or create their business (activated too when it is inactive), confirm name, email and role,
 * and optionally send the sign-in invitation. With no agent passed it adds an agent who is not in the OMARA register.
 */
export default function ActivateAgentDialog({ agent, open, onClose, onDone }: {
  agent: AgentToActivate | null; open: boolean; onClose: () => void; onDone: (result: ActivationResult) => void;
}) {
  const { push } = useToast();
  const manual = !agent?.omaraId && !agent?.agentId;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"agent" | "agency_admin">("agent");
  const [picked, setPicked] = useState<Picked>(null);
  const [mode, setMode] = useState<"choose" | "search" | "new">("choose");
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [results, setResults] = useState<BusinessRow[] | null>(null);
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(agent?.name ?? "");
    setEmail(agent?.email ?? "");
    setRole(agent?.role === "agency_admin" ? "agency_admin" : "agent");
    setPicked(agent?.business ? { kind: "existing", ...agent.business } : null);
    setMode(agent?.business ? "choose" : "search");
    setSearch("");
    setNewName("");
    setInvite(true);
    setError("");
  }, [open, agent]);

  useEffect(() => {
    if (!open || mode !== "search") return;
    let active = true;
    const timer = window.setTimeout(() => {
      listBusinesses({ search, limit: 6, offset: 0 })
        .then((r) => { if (active) setResults(r.rows); })
        .catch(() => { if (active) setResults([]); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, mode, search]);

  const cleanEmail = email.trim().toLowerCase();
  const emailValid = !cleanEmail || EMAIL.test(cleanEmail);
  const willInvite = invite && !agent?.hasLogin && Boolean(cleanEmail) && emailValid;
  const businessName = picked?.name ?? "";
  const businessInactive = picked?.kind === "new" || (picked?.kind === "existing" && picked.status !== "Active");

  const submit = async () => {
    setError("");
    if (!name.trim()) { setError("Enter the agent's name."); return; }
    if (!emailValid) { setError("Enter a valid email address, or leave it empty."); return; }
    if (!picked) { setError("Choose the business this agent works for, or add a new one."); return; }
    setBusy(true);
    try {
      const result = await activateAgent({
        agentId: agent?.agentId ?? null, omaraId: agent?.omaraId ?? null,
        businessId: picked.kind === "existing" ? picked.id : null, newBusinessName: picked.kind === "new" ? picked.name : undefined,
        name: name.trim(), email: cleanEmail, role,
      });
      let message = `${result.name} activated with ${result.businessName}.`;
      if (result.businessCreated) message += " The business was created and activated.";
      else if (result.businessActivated) message += " The business was activated too.";
      if (willInvite && !result.hasLogin) {
        try {
          const sent = await invokePortalUsers({ action: "invite", email: result.email, name: result.name, role: result.role, agencyId: result.agencyId, redirectTo: portalPasswordResetUrl() });
          message += sent.warning ? ` ${String(sent.warning)}` : sent.emailSent ? ` A sign-in invitation was emailed to ${result.email}.` : " They can sign in with their existing account.";
        } catch (e) {
          const reason = e instanceof Error ? e.message : "";
          message += /already been invited/i.test(reason) ? " An invitation is already waiting for this email; resend it from the business's Portal team tab."
            : ` The invitation was not sent${reason ? `: ${reason}` : "."} You can invite them from the business's Portal team tab.`;
        }
      } else if (!result.hasLogin) {
        message += " No invitation was sent.";
      }
      push(message);
      onDone(result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not activate this agent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} width="max-w-xl"
      title={manual ? "Add and activate an agent" : `Activate ${agent?.name || "agent"}`}
      footer={<>
        <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={() => void submit()}>{busy ? "Activating…" : "Activate agent"}</Button>
      </>}>
      <div className="space-y-4">
        {agent?.marn ? <p className="text-sm text-foreground-600">MARN <b className="tabular-nums text-foreground-900">{agent.marn}</b>, from the OMARA register.</p> : null}

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-foreground-800">Business <span className="text-primary-600">*</span></p>
          {mode === "choose" && picked ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-background-300 px-3 py-2.5">
              <span className="text-sm">
                <b className="text-foreground-900">{businessName}</b>
                {picked.kind === "new" ? <span className="ml-2 text-xs text-foreground-500">New business</span> : null}
              </span>
              <span className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setMode("search")}>Change</Button>
                <Button size="sm" variant="ghost" onClick={() => setMode("new")}>New business</Button>
              </span>
            </div>
          ) : mode === "new" ? (
            <div className="space-y-2">
              <TextInput autoFocus placeholder="Business name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" disabled={!newName.trim()} onClick={() => { setPicked({ kind: "new", name: newName.trim() }); setMode("choose"); }}>Use this business</Button>
                <Button size="sm" variant="ghost" onClick={() => setMode("search")}>Choose an existing one</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <TextInput autoFocus type="search" placeholder="Search business name, agent or MARN" value={search} onChange={(e) => setSearch(e.target.value)} />
              {results === null ? <p className="text-xs text-foreground-500">Searching…</p> : (
                <ul className="max-h-56 divide-y divide-background-200 overflow-y-auto rounded-md border border-background-200">
                  {results.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => { setPicked({ kind: "existing", id: r.id, name: r.name, status: r.status }); setMode("choose"); }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-background-100">
                        <span><b className="text-foreground-900">{r.name}</b>{r.place ? <span className="ml-2 text-xs text-foreground-500">{r.place}</span> : null}</span>
                        <span className={`text-xs ${r.status === "Active" ? "text-emerald-700" : "text-foreground-500"}`}>{r.status}</span>
                      </button>
                    </li>
                  ))}
                  {results.length === 0 ? <li className="px-3 py-2 text-sm text-foreground-600">No business matches.</li> : null}
                </ul>
              )}
              <Button size="sm" variant="ghost" icon="ri-add-line" onClick={() => { setNewName(search); setMode("new"); }}>New business</Button>
            </div>
          )}
          {businessInactive && mode === "choose" ? (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {picked?.kind === "new" ? "The new business will be created and activated, with its own workspace." : `${businessName} is inactive. It will be activated too, and its workspace created.`}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email" hint={agent?.hasLogin ? "They already have a login." : "Where the sign-in invitation goes."}>
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!emailValid} />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-foreground-800">Role</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="agent-role" checked={role === "agent"} onChange={() => setRole("agent")} /> Agent</label>
            <label className="flex items-center gap-2"><input type="radio" name="agent-role" checked={role === "agency_admin"} onChange={() => setRole("agency_admin")} /> Agency admin <span className="text-xs text-foreground-500">(manages the business's agents)</span></label>
          </div>
        </fieldset>

        {!agent?.hasLogin ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={invite} disabled={!cleanEmail} onChange={(e) => setInvite(e.target.checked)} />
            <span>Send a sign-in invitation{cleanEmail ? ` to ${cleanEmail}` : ""}
              {!cleanEmail ? <span className="block text-xs text-foreground-500">Add an email to send an invitation. Without one, the agent is approved but cannot sign in yet.</span> : null}
            </span>
          </label>
        ) : null}

        {error ? <p role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}
      </div>
    </Modal>
  );
}
