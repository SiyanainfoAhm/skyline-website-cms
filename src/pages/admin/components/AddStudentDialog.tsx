import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Field, Modal, Select, TextInput } from "@/pages/admin/components/ui";
import { useToast } from "@/pages/admin/components/toastContext";
import SearchPick, { type PickOption } from "@/pages/admin/components/SearchPick";
import AgentStatusBadge from "@/pages/admin/components/AgentStatusBadge";
import {
  activateAgent, listAgentDirectory, listBusinesses, setBusinessStatus,
  type BusinessStatus, type DirectoryAgent,
} from "@/pages/admin/lib/businessData";
import { createApplication } from "@/pages/agency/lib/portalApplications";
import { invokePortalUsers } from "@/pages/agency/lib/portalData";
import { portalPasswordResetUrl } from "@/pages/agency/lib/portalAuthContext";

type Business =
  | { kind: "existing"; id: string; name: string; status: BusinessStatus; agencyId: string | null }
  | { kind: "new"; name: string };

type Agent =
  | { kind: "existing"; row: DirectoryAgent }
  | { kind: "new"; name: string };

const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;

function newKey(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * SLIT admin: add a student by choosing (or creating) the business and the agent who looks after them,
 * then open the application form. The agent is always attached to that business, and a new or inactive
 * business is activated so the student has a workspace to belong to.
 */
export default function AddStudentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const [business, setBusiness] = useState<Business | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentName, setAgentName] = useState("");
  const [agentEmail, setAgentEmail] = useState("");
  const [agentRole, setAgentRole] = useState<"agent" | "agency_admin">("agent");
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setBusiness(null); setAgent(null); setAgentName(""); setAgentEmail(""); setAgentRole("agent"); setInvite(true); setError("");
  }, [open]);

  const searchBusinesses = useCallback(async (q: string): Promise<PickOption[]> => {
    const r = await listBusinesses({ search: q, limit: 8, offset: 0 });
    return r.rows.map((b) => ({
      id: b.id, label: b.name, meta: [b.place, `${b.agents} agent${b.agents === 1 ? "" : "s"}`, `${b.students} student${b.students === 1 ? "" : "s"}`].filter(Boolean).join(", "),
      tag: b.status === "Active" ? undefined : <span className="rounded-full bg-background-200 px-2 py-0.5 text-[11px] font-medium text-foreground-600">Inactive</span>,
      raw: b,
    })) as PickOption[];
  }, []);

  const businessId = business?.kind === "existing" ? business.id : null;
  const searchAgents = useCallback(async (q: string): Promise<PickOption[]> => {
    if (!businessId) return [];
    const r = await listAgentDirectory({ search: q, businessId, limit: 8, offset: 0 });
    return r.rows.map((a) => ({ id: a.key, label: a.name || a.email, meta: [a.email, a.marn ? `MARN ${a.marn}` : ""].filter(Boolean).join(", "), tag: <AgentStatusBadge status={a.status} />, raw: a })) as PickOption[];
  }, [businessId]);

  const cleanEmail = agentEmail.trim().toLowerCase();
  const needsActivation = agent?.kind === "new" || (agent?.kind === "existing" && agent.row.status === "Inactive") || business?.kind === "new";
  const businessWillActivate = business?.kind === "new" || (business?.kind === "existing" && business.status !== "Active");

  const submit = async () => {
    setError("");
    if (!business) { setError("Choose the student’s business, or add a new one."); return; }
    if (!agent) { setError("Choose the agent looking after this student, or add a new one."); return; }
    if (agent.kind === "new") {
      if (!agentName.trim()) { setError("Enter the new agent’s name."); return; }
      if (cleanEmail && !EMAIL.test(cleanEmail)) { setError("Enter a valid email for the agent, or leave it empty."); return; }
    }
    setBusy(true);
    const notes: string[] = [];
    try {
      let agencyId: string | null = business.kind === "existing" ? business.agencyId : null;
      // The database only assigns applications to signed-in people with the agent role.
      const profileId: string | null = agent.kind === "existing" && agent.row.role !== "agency_admin" ? agent.row.profileId : null;
      let agentLabel = agent.kind === "existing" ? agent.row.name : agentName.trim();

      if (needsActivation) {
        const existing = agent.kind === "existing" ? agent.row : null;
        const result = await activateAgent({
          agentId: existing?.agentId ?? null, omaraId: existing?.omaraId ?? null,
          businessId: business.kind === "existing" ? business.id : null,
          newBusinessName: business.kind === "new" ? business.name : undefined,
          name: existing ? existing.name : agentName.trim(),
          email: existing ? existing.email : cleanEmail,
          role: existing?.role ?? agentRole,
        });
        agencyId = result.agencyId;
        agentLabel = result.name;
        if (result.businessCreated) notes.push(`${result.businessName} was created and activated.`);
        else if (result.businessActivated) notes.push(`${result.businessName} was activated.`);
        if (!result.hasLogin && invite && result.email && agencyId) {
          try {
            const sent = await invokePortalUsers({ action: "invite", email: result.email, name: result.name, role: result.role, agencyId, redirectTo: portalPasswordResetUrl() });
            if (sent.emailSent) notes.push(`A sign-in invitation was emailed to ${result.email}.`);
          } catch (e) {
            const reason = e instanceof Error ? e.message : "";
            notes.push(/already been invited/i.test(reason) ? "An invitation is already waiting for this agent." : "The agent invitation was not sent; send it from the business’s Portal team tab.");
          }
        }
      } else if (business.kind === "existing" && (business.status !== "Active" || !agencyId)) {
        const r = await setBusinessStatus(business.id, "Active");
        agencyId = r.agencyId;
        notes.push(`${business.name} was activated.`);
      }

      if (!agencyId) throw new Error("This business has no workspace yet, so the student could not be added. Activate the business and try again.");
      // Applications can only be assigned to an agent who has signed in; invited agents are attached once they accept.
      if (!profileId) {
        notes.push(agent.kind === "existing" && agent.row.role === "agency_admin" && agent.row.profileId
          ? `${agentLabel} is an agency admin, so the application is not assigned to them; assign an agent on the application.`
          : `Assign ${agentLabel} on the application once they have signed in.`);
      }

      const created = await createApplication(newKey(), profileId, agencyId);
      push(["Student added as a draft application.", ...notes].join(" "));
      onClose();
      navigate(`/admin/applications/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not add this student.");
    } finally {
      setBusy(false);
    }
  };

  const chip = (title: string, sub: string, onChange: () => void, badge?: ReactNode) => (
    <div className="flex items-center justify-between gap-3 rounded-md border border-background-300 bg-background-50 px-3 py-2.5">
      <span className="min-w-0">
        <span className="flex items-center gap-2"><b className="truncate text-sm text-foreground-900">{title}</b>{badge}</span>
        <span className="block truncate text-xs text-foreground-500">{sub}</span>
      </span>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onChange}>Change</Button>
    </div>
  );

  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} width="max-w-xl" title="Add student"
      footer={<>
        <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !business || !agent} onClick={() => void submit()}>{busy ? "Adding…" : "Add student and open form"}</Button>
      </>}>
      <div className="space-y-5">
        <p className="text-sm text-foreground-600">Choose who the student is with. You fill in the student’s details on the application form next; it starts as a draft.</p>

        {/* Business */}
        <div>
          {business ? (
            <>
              <p className="mb-1.5 text-[13px] font-medium text-foreground-800">Business</p>
              {chip(business.name, business.kind === "new" ? "New business, created when you add the student" : business.status === "Active" ? "Active business" : "Inactive, activated when you add the student",
                () => { setBusiness(null); setAgent(null); })}
            </>
          ) : (
            <SearchPick label="Business" addNoun="business" autoFocus placeholder="Search business name, place or email"
              search={searchBusinesses}
              onPick={(o) => {
                const b = (o as PickOption & { raw: { id: string; name: string; status: BusinessStatus; agencyId: string | null } }).raw;
                setBusiness({ kind: "existing", id: b.id, name: b.name, status: b.status, agencyId: b.agencyId });
                setAgent(null);
              }}
              onAddNew={(name) => { setBusiness({ kind: "new", name }); setAgent(null); }} />
          )}
        </div>

        {/* Agent */}
        {business ? (
          <div>
            {agent ? (
              <>
                <p className="mb-1.5 text-[13px] font-medium text-foreground-800">Agent</p>
                {agent.kind === "existing"
                  ? chip(agent.row.name, agent.row.email || "No email on record", () => setAgent(null), <AgentStatusBadge status={agent.row.status} />)
                  : chip("New agent", `Added to ${business.name}`, () => setAgent(null))}
                {agent.kind === "existing" && agent.row.status === "Inactive" ? (
                  <p className="mt-1.5 text-xs text-foreground-500">This agent is inactive. Adding the student activates them with {business.name}.</p>
                ) : null}
              </>
            ) : business.kind === "new" ? (
              <div className="rounded-md border border-dashed border-background-300 px-3 py-3 text-sm text-foreground-600">
                A new business has no agents yet.{" "}
                <button type="button" className="font-semibold text-primary-700 hover:text-primary-800" onClick={() => setAgent({ kind: "new", name: "" })}>Add its first agent</button>
              </div>
            ) : (
              <SearchPick label="Agent" addNoun="agent" placeholder={`Search agents at ${business.name}`} resetKey={business.id}
                search={searchAgents}
                onPick={(o) => setAgent({ kind: "existing", row: (o as PickOption & { raw: DirectoryAgent }).raw })}
                onAddNew={(name) => { setAgent({ kind: "new", name }); setAgentName(name); }} />
            )}

            {agent?.kind === "new" ? (
              <div className="mt-3 space-y-3 rounded-md border border-background-200 bg-background-100/50 p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Agent name" required><TextInput autoFocus value={agentName} onChange={(e) => setAgentName(e.target.value)} /></Field>
                  <Field label="Agent email"><TextInput type="email" value={agentEmail} onChange={(e) => setAgentEmail(e.target.value)} placeholder="name@agency.com" /></Field>
                </div>
                <Field label="Role">
                  <Select value={agentRole} onChange={(e) => setAgentRole(e.target.value as "agent" | "agency_admin")}>
                    <option value="agent">Agent</option>
                    <option value="agency_admin">Agency admin</option>
                  </Select>
                </Field>
                <label className="flex items-center gap-2 text-sm text-foreground-800">
                  <input type="checkbox" checked={invite} disabled={!cleanEmail} onChange={(e) => setInvite(e.target.checked)} />
                  Email them a sign-in invitation
                </label>
              </div>
            ) : null}
          </div>
        ) : null}

        {businessWillActivate && agent ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{business?.name} will be activated so it gets a workspace for this student.</p>
        ) : null}
        {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      </div>
    </Modal>
  );
}
