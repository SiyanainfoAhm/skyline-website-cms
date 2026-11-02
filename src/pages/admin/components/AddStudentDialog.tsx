import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Modal } from "@/pages/admin/components/ui";
import { useToast } from "@/pages/admin/components/toastContext";
import SearchPick, { type PickOption } from "@/pages/admin/components/SearchPick";
import AgentStatusBadge from "@/pages/admin/components/AgentStatusBadge";
import AddStudentRecordDialog, { type AddStudentRecordValue, type NewStudentAgent } from "@/pages/admin/components/AddStudentRecordDialog";
import {
  activateAgent, listAgentDirectory, listBusinesses, setBusinessStatus,
  type BusinessStatus, type DirectoryAgent,
} from "@/pages/admin/lib/businessData";
import type { AgencyFormState } from "@/pages/admin/lib/agencyForm";
import { createApplication } from "@/pages/agency/lib/portalApplications";
import { createAgencyRecordWithBusiness, invokePortalUsers, logAgencyChange } from "@/pages/agency/lib/portalData";
import { portalPasswordResetUrl } from "@/pages/agency/lib/portalAuthContext";

type Business =
  | { kind: "existing"; id: string; name: string; status: BusinessStatus; agencyId: string | null }
  | { kind: "new"; name: string; details: AgencyFormState };

type Agent =
  | { kind: "existing"; row: DirectoryAgent }
  | { kind: "new"; details: NewStudentAgent };

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
  const [initialBusinessName, setInitialBusinessName] = useState("");
  const [initialAgentName, setInitialAgentName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setBusiness(null); setAgent(null); setRecordDialogMode(null); setInitialBusinessName(""); setInitialAgentName(""); setError("");
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
  const teams = useRef(new Map<string, Promise<DirectoryAgent[]>>());
  const loadTeam = useCallback((id: string): Promise<DirectoryAgent[]> => {
    const cached = teams.current.get(id);
    if (cached) return cached;
    const request = (async () => {
      const members: DirectoryAgent[] = [];
      let offset = 0;
      let total = 0;
      let pageSize = 0;
      do {
        const result = await listAgentDirectory({ search: "", businessId: id, limit: 100, offset });
        members.push(...result.rows.filter((row) => row.agentId !== null));
        total = result.total;
        pageSize = result.rows.length;
        offset += pageSize;
      } while (offset < total && pageSize > 0);
      return members;
    })();
    teams.current.set(id, request);
    request.catch(() => teams.current.delete(id));
    return request;
  }, []);
  const prefetchTeam = useCallback((o: PickOption) => { void loadTeam(o.id).catch(() => undefined); }, [loadTeam]);
  useEffect(() => { if (open) teams.current.clear(); }, [open]);

  const businessId = business?.kind === "existing" ? business.id : null;
  const searchAgents = useCallback(async (q: string): Promise<PickOption[]> => {
    if (!businessId) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const members = (await loadTeam(businessId)).filter((a) => {
      const text = `${a.name} ${a.email} ${a.marn} ${a.role === "agency_admin" ? "agency admin" : "agent"}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    return members.map((a) => ({
      id: a.key, label: a.name || a.email,
      meta: [a.email, a.role === "agency_admin" ? "Agency admin" : "Agent"].filter(Boolean).join(", "),
      tag: <AgentStatusBadge status={a.status} />, raw: a,
    }));
  }, [businessId, loadTeam]);

  const needsActivation = agent?.kind === "new" || (agent?.kind === "existing" && agent.row.status === "Inactive") || business?.kind === "new";
  const businessWillActivate = business?.kind === "new" || (business?.kind === "existing" && business.status !== "Active");

  const openNewBusiness = (name: string) => {
    setInitialBusinessName(name);
    setInitialAgentName("");
    setRecordDialogMode("business");
  };

  const openNewAgent = (name: string) => {
    setInitialAgentName(name);
    setRecordDialogMode("agent");
  };

  const saveNewRecord = (value: AddStudentRecordValue) => {
    if (value.kind === "business") {
      setBusiness({ kind: "new", name: value.business.name, details: value.business });
      setAgent({ kind: "new", details: value.agent });
    } else {
      setAgent({ kind: "new", details: value.agent });
    }
    setRecordDialogMode(null);
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
      const agentLabel = existingAgent?.name ?? newAgent?.name ?? "";
      const cleanEmail = newAgent?.email.trim().toLowerCase() ?? "";

      if (business.kind === "new") {
        const created = await createAgencyRecordWithBusiness({ ...business.details, status: "Inactive" });
        agencyId = created.agencyId;
        selectedBusinessId = created.businessId;
        await logAgencyChange(created.agencyId, "agency_created", { code: business.details.code });
      }

      if (needsActivation) {
        const result = await activateAgent({
          agentId: existingAgent?.agentId ?? null, omaraId: existingAgent?.omaraId ?? null,
          businessId: selectedBusinessId,
          name: existingAgent?.name ?? newAgent?.name ?? "",
          email: existingAgent?.email ?? cleanEmail,
          role: existingAgent?.role ?? newAgent?.role ?? "agent",
        });
        agencyId = result.agencyId;
        if (business.kind === "new") notes.push(`${result.businessName} was created and activated.`);
        else if (result.businessActivated) notes.push(`${result.businessName} was activated.`);
        if (!result.hasLogin && result.email && agencyId) {
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
                void loadTeam(b.id).catch(() => undefined);
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
                onPick={(o) => setAgent({ kind: "existing", row: (o as PickOption & { raw: DirectoryAgent }).raw })}
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
    <AddStudentRecordDialog mode={recordDialogMode} initialBusinessName={initialBusinessName} initialAgentName={initialAgentName}
      onCancel={() => setRecordDialogMode(null)} onSave={saveNewRecord} />
  </>);
}
