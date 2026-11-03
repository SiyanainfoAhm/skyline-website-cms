import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Modal } from "@/pages/admin/components/ui";
import { useToast } from "@/pages/admin/components/toastContext";
import SearchPick, { type PickOption } from "@/pages/admin/components/SearchPick";
import AgentStatusBadge from "@/pages/admin/components/AgentStatusBadge";
import AddStudentRecordDialog, { type AddStudentRecordValue, type NewStudentAgent } from "@/pages/admin/components/AddStudentRecordDialog";
import {
  activateAgent, listBusinesses, setBusinessStatus,
  type AgentStatus, type BusinessStatus,
} from "@/pages/admin/lib/businessData";
import type { AgencyFormState } from "@/pages/admin/lib/agencyForm";
import { createApplication } from "@/pages/agency/lib/portalApplications";
import {
  createAgencyRecordWithBusiness, invokePortalUsers, listAgencyInvitations, listAgencyMembers, logAgencyChange,
  type AgencyMemberRow, type InvitationRow,
} from "@/pages/agency/lib/portalData";
import { portalPasswordResetUrl } from "@/pages/agency/lib/portalAuthContext";

type Business =
  | { kind: "existing"; id: string; name: string; status: BusinessStatus; agencyId: string | null }
  | { kind: "new"; name: string; details: AgencyFormState };

type PortalTeamMember = {
  id: string;
  profileId: string | null;
  name: string;
  email: string;
  role: "agent" | "agency_admin";
  status: AgentStatus;
};

type Agent =
  | { kind: "existing"; row: PortalTeamMember }
  | { kind: "new"; details: NewStudentAgent }
  // Added through the shared Add agent form, which creates and invites them straight away.
  | { kind: "created"; details: NewStudentAgent };

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
  const [recordDialogMode, setRecordDialogMode] = useState<"business" | "agent" | null>(null);
  const [initialAgentName, setInitialAgentName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setBusiness(null); setAgent(null); setRecordDialogMode(null); setInitialAgentName(""); setError("");
  }, [open]);

  const searchBusinesses = useCallback(async (q: string): Promise<PickOption[]> => {
    const r = await listBusinesses({ search: q, limit: 8, offset: 0 });
    return r.rows.map((b) => ({
      id: b.id, label: b.name, meta: [b.place, `${b.agents} agent${b.agents === 1 ? "" : "s"}`, `${b.students} student${b.students === 1 ? "" : "s"}`].filter(Boolean).join(", "),
      tag: b.status === "Active" ? undefined : <span className="rounded-full bg-background-200 px-2 py-0.5 text-[11px] font-medium text-foreground-600">Inactive</span>,
      raw: b,
    })) as PickOption[];
  }, []);

  // Each business's team is loaded once and kept, so the agent list is ready by the time a business is picked:
  // loading starts while the business is highlighted in the list, and typing filters it on this device.
  const teams = useRef(new Map<string, Promise<PortalTeamMember[]>>());
  const loadTeam = useCallback((id: string, agencyId: string): Promise<PortalTeamMember[]> => {
    const cached = teams.current.get(id);
    if (cached) return cached;
    const request = (async () => {
      const [agencyMembers, invitations] = await Promise.all([
        listAgencyMembers(agencyId), listAgencyInvitations(agencyId),
      ]);
      return [
        ...agencyMembers.map((member: AgencyMemberRow): PortalTeamMember => ({
          id: member.profileId, profileId: member.profileId, name: member.fullName || member.email,
          email: member.email, role: member.role, status: member.status === "Active" ? "Active" : "Inactive",
        })),
        ...invitations.filter((invitation: InvitationRow) => invitation.status === "pending").map((invitation): PortalTeamMember => ({
          id: `invitation:${invitation.id}`, profileId: null, name: invitation.fullName || invitation.email,
          email: invitation.email, role: invitation.role, status: "Invited",
        })),
      ];
    })();
    teams.current.set(id, request);
    request.catch(() => teams.current.delete(id));
    return request;
  }, []);
  const prefetchTeam = useCallback((o: PickOption) => {
    const agencyId = (o as PickOption & { raw?: { agencyId: string | null } }).raw?.agencyId;
    if (agencyId) void loadTeam(o.id, agencyId).catch(() => undefined);
  }, [loadTeam]);
  useEffect(() => { if (open) teams.current.clear(); }, [open]);

  const businessId = business?.kind === "existing" ? business.id : null;
  const agencyId = business?.kind === "existing" ? business.agencyId : null;
  const searchAgents = useCallback(async (q: string): Promise<PickOption[]> => {
    if (!businessId || !agencyId) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const members = (await loadTeam(businessId, agencyId)).filter((a) => {
      const text = `${a.name} ${a.email} ${a.role === "agency_admin" ? "agency admin" : "agent"}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    return members.map((a) => ({
      id: a.id, label: a.name,
      meta: [a.email, a.role === "agency_admin" ? "Agency admin" : "Agent"].filter(Boolean).join(", "),
      tag: <AgentStatusBadge status={a.status} />, raw: a,
    }));
  }, [agencyId, businessId, loadTeam]);

  const businessWillActivate = business?.kind === "new" || (business?.kind === "existing" && business.status !== "Active");

  const openNewBusiness = () => {
    setInitialAgentName("");
    setRecordDialogMode("business");
  };

  const openNewAgent = (name: string) => {
    setInitialAgentName(name);
    setRecordDialogMode("agent");
  };

  const saveNewRecord = (value: AddStudentRecordValue) => {
    setRecordDialogMode(null);
    if (value.kind === "business") {
      const { agencyId: newAgencyId, businessId: newBusinessId, name } = value.business;
      if (!newBusinessId) { setError(`${name} was added; search for it by name to continue.`); return; }
      teams.current.delete(newBusinessId);
      setBusiness({ kind: "existing", id: newBusinessId, name, status: "Active", agencyId: newAgencyId });
      setAgent(null);
    } else {
      if (business?.kind === "existing") teams.current.delete(business.id);
      setAgent({ kind: "created", details: value.agent });
    }
  };

  const submit = async () => {
    setError("");
    if (!business) { setError("Choose the student’s business, or add a new one."); return; }
    if (!agent) { setError("Choose the agent looking after this student, or add a new one."); return; }
    setBusy(true);
    const notes: string[] = [];
    try {
      let agencyId: string | null = business.kind === "existing" ? business.agencyId : null;
      let selectedBusinessId: string | null = business.kind === "existing" ? business.id : null;
      // The database only assigns applications to signed-in people with the agent role.
      const profileId: string | null = agent.kind === "existing" && agent.row.role !== "agency_admin" ? agent.row.profileId : null;
      const existingAgent = agent.kind === "existing" ? agent.row : null;
      const newAgent = agent.kind === "new" ? agent.details : null;
      const agentLabel = existingAgent?.name ?? (agent.kind === "existing" ? "" : agent.details.name);
      const cleanEmail = newAgent?.email.trim().toLowerCase() ?? "";

      if (business.kind === "new") {
        const created = await createAgencyRecordWithBusiness({ ...business.details, status: "Inactive" });
        agencyId = created.agencyId;
        selectedBusinessId = created.businessId;
        await logAgencyChange(created.agencyId, "agency_created", { code: business.details.code });
      }

      if (selectedBusinessId && (business.kind === "new" || business.status !== "Active" || !agencyId)) {
        const result = await setBusinessStatus(selectedBusinessId, "Active");
        agencyId = result.agencyId;
        notes.push(business.kind === "new" ? `${business.name} was created and activated.` : `${business.name} was activated.`);
      }

      if (newAgent) {
        const result = await activateAgent({
          businessId: selectedBusinessId,
          name: newAgent.name,
          email: cleanEmail,
          role: newAgent.role,
        });
        agencyId = result.agencyId ?? agencyId;
        if (!result.hasLogin && result.email && agencyId) {
          try {
            const sent = await invokePortalUsers({ action: "invite", email: result.email, name: result.name, role: result.role, agencyId, redirectTo: portalPasswordResetUrl() });
            if (sent.emailSent) notes.push(`A sign-in invitation was emailed to ${result.email}.`);
          } catch (e) {
            const reason = e instanceof Error ? e.message : "";
            notes.push(/already been invited/i.test(reason) ? "An invitation is already waiting for this agent." : "The agent invitation was not sent; send it from the business’s Portal team tab.");
          }
        }
      } else if (existingAgent?.status === "Inactive" && profileId) {
        await invokePortalUsers({ action: "update", profileId, status: "Active" });
        notes.push(`${agentLabel} was reactivated.`);
      }

      if (!agencyId) throw new Error("This business has no workspace yet, so the student could not be added. Activate the business and try again.");
      // Applications can only be assigned to an agent who has signed in; invited agents are attached once they accept.
      if (!profileId) {
        notes.push(existingAgent?.role === "agency_admin" && existingAgent.profileId
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

  return (<>
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
            <SearchPick label="Business" addNoun="business" autoFocus searchWhenEmpty placeholder="Search business name, place or email"
              search={searchBusinesses} onHighlight={prefetchTeam}
              onPick={(o) => {
                const b = (o as PickOption & { raw: { id: string; name: string; status: BusinessStatus; agencyId: string | null } }).raw;
                if (b.agencyId) void loadTeam(b.id, b.agencyId).catch(() => undefined);
                setBusiness({ kind: "existing", id: b.id, name: b.name, status: b.status, agencyId: b.agencyId });
                setAgent(null);
              }}
              onAddNew={openNewBusiness} />
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
                  : chip(agent.details.name, [agent.details.email, agent.details.role === "agency_admin" ? "Agency admin" : "Agent"].filter(Boolean).join(", "), () => setAgent(null))}
                {agent.kind === "existing" && agent.row.status === "Inactive" ? (
                  <p className="mt-1.5 text-xs text-foreground-500">This agent is inactive. Adding the student activates them with {business.name}.</p>
                ) : null}
              </>
            ) : business.kind === "new" ? (
              <div className="rounded-md border border-dashed border-background-300 px-3 py-3 text-sm text-foreground-600">
                A new business has no agents yet.{" "}
                <button type="button" className="font-semibold text-primary-700 hover:text-primary-800" onClick={() => openNewAgent("")}>Add its first agent</button>
              </div>
            ) : (
              <SearchPick label="Agent" addNoun="agent" placeholder={`Search or pick an agent at ${business.name}`} resetKey={business.id} autoFocus searchWhenEmpty openOnMount
                search={searchAgents}
                onPick={(o) => setAgent({ kind: "existing", row: (o as PickOption & { raw: PortalTeamMember }).raw })}
                onAddNew={openNewAgent} />
            )}
          </div>
        ) : null}

        {businessWillActivate && agent ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{business?.name} will be activated so it gets a workspace for this student.</p>
        ) : null}
        {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      </div>
    </Modal>
    <AddStudentRecordDialog mode={recordDialogMode} initialAgentName={initialAgentName}
      business={business?.kind === "existing" ? { id: business.id, name: business.name, status: business.status } : null}
      onCancel={() => setRecordDialogMode(null)} onSave={saveNewRecord} />
  </>);
}
