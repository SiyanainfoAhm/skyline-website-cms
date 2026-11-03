import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePortalAuth } from "@/pages/agency/lib/portalAuthContext";
import {
  createAgencyRecordWithBusiness,
  invokePortalUsers,
  listAgencyInvitations,
  listAgencyMembers,
  logAgencyChange,
  type AgencyMemberRow,
  type InvitationRow,
} from "@/pages/agency/lib/portalData";
import {
  activateAgent,
  listBusinesses,
  setBusinessStatus,
  type AgentStatus,
  type BusinessStatus,
} from "@/pages/admin/lib/businessData";
import { useToast } from "@/pages/admin/components/toastContext";
import SearchPick, { type PickOption } from "@/pages/admin/components/SearchPick";
import AgentStatusBadge from "@/pages/admin/components/AgentStatusBadge";
import AddStudentRecordDialog, {
  type AddStudentRecordValue,
  type NewStudentAgent,
} from "@/pages/admin/components/AddStudentRecordDialog";
import type { AgencyFormState } from "@/pages/admin/lib/agencyForm";
import { portalPasswordResetUrl } from "@/pages/agency/lib/portalAuthContext";
import {
  createApplication,
  deleteApplicationDocument,
  deleteApplicationDraft,
  getApplication,
  listApplicationDocuments,
  listAssignableAgents,
  type AgentOption,
} from "@/pages/agency/lib/portalApplications";
import { useApplicationPaths } from "@/pages/agency/lib/applicationPaths";
import ApplicationWizard from "@/pages/agency/components/ApplicationWizard";
import { isEditableApplicationStatus } from "@/pages/agency/lib/applicationAccess";
import { PageHeading, PortalError, PortalLoading } from "@/pages/agency/components/PortalUI";

import { portalScopeCacheKey } from "@/lib/portalScope";

function newClientKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A pending wizard session, so reopening the wizard resumes the SAME draft. */
function sessionKey(uid: string): string {
  return `slit-portal-wizard-v1:${portalScopeCacheKey()}:${uid}`;
}

function readSession(uid: string): string | null {
  try {
    const raw = window.localStorage.getItem(sessionKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { applicationId?: string };
    return parsed.applicationId ?? null;
  } catch {
    return null;
  }
}

function writeSession(uid: string, applicationId: string): void {
  try {
    window.localStorage.setItem(sessionKey(uid), JSON.stringify({ applicationId }));
  } catch {
    /* storage unavailable — the wizard still works for this session */
  }
}

function clearSession(uid: string): void {
  try {
    window.localStorage.removeItem(sessionKey(uid));
  } catch {
    /* ignore */
  }
}

type Phase = "checking" | "pick" | "wizard";

type BusinessSelection =
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

type AgentSelection =
  | { kind: "existing"; row: PortalTeamMember }
  | { kind: "new"; details: NewStudentAgent };

export default function NewApplicationPage() {
  const paths = useApplicationPaths();
  const { role, agency, authUser, authLoading, identityLoading } = usePortalAuth();
  const navigate = useNavigate();
  const { push } = useToast();

  const clientKeyRef = useRef(newClientKey());
  const bootRef = useRef(false);
  const agentOptionsByBusiness = useRef(new Map<string, Promise<Array<PickOption & { raw: PortalTeamMember; searchable: string }>>>()).current;

  const [phase, setPhase] = useState<Phase>("checking");
  const [applicationId, setApplicationId] = useState("");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState("");
  const [business, setBusiness] = useState<BusinessSelection | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentSelection | null>(null);
  const [recordDialogMode, setRecordDialogMode] = useState<"business" | "agent" | null>(null);
  const [initialBusinessName, setInitialBusinessName] = useState("");
  const [initialAgentName, setInitialAgentName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const selectedBusinessId = business?.kind === "existing" ? business.id : null;
  const selectedAgencyId = business?.kind === "existing" ? business.agencyId : null;

  const searchBusinesses = useCallback(async (q: string): Promise<PickOption[]> => {
    const result = await listBusinesses({ search: q, limit: 8, offset: 0 });
    return result.rows.map((row) => ({
      id: row.id,
      label: row.name,
      meta: [row.place, `${row.agents} agent${row.agents === 1 ? "" : "s"}`, `${row.students} student${row.students === 1 ? "" : "s"}`].filter(Boolean).join(", "),
      tag: row.status === "Active" ? undefined : <span className="rounded-full bg-background-200 px-2 py-0.5 text-[11px] font-medium text-foreground-600">Inactive</span>,
      raw: row,
    })) as PickOption[];
  }, []);

  const searchAgents = useCallback(async (q: string): Promise<PickOption[]> => {
    if (!selectedBusinessId || !selectedAgencyId) return [];
    let membersPromise = agentOptionsByBusiness.get(selectedBusinessId);
    if (!membersPromise) {
      membersPromise = (async () => {
        const [agencyMembers, invitations] = await Promise.all([
          listAgencyMembers(selectedAgencyId),
          listAgencyInvitations(selectedAgencyId),
        ]);
        const portalMembers: PortalTeamMember[] = [
          ...agencyMembers.map((member: AgencyMemberRow) => ({
            id: member.profileId,
            profileId: member.profileId,
            name: member.fullName || member.email,
            email: member.email,
            role: member.role,
            status: member.status === "Active" ? "Active" as const : "Inactive" as const,
          })),
          ...invitations.filter((invitation: InvitationRow) => invitation.status === "pending").map((invitation) => ({
            id: `invitation:${invitation.id}`,
            profileId: null,
            name: invitation.fullName || invitation.email,
            email: invitation.email,
            role: invitation.role,
            status: "Invited" as const,
          })),
        ];
        return portalMembers.map((member) => {
          const meta = [member.email, member.role === "agency_admin" ? "Agency admin" : "Agent"].filter(Boolean).join(", ");
          return {
            id: member.id,
            label: member.name,
            meta,
            tag: <AgentStatusBadge status={member.status} />,
            raw: member,
            searchable: `${member.name} ${meta}`.toLowerCase(),
          };
        });
      })();
      agentOptionsByBusiness.set(selectedBusinessId, membersPromise);
      void membersPromise.catch(() => {
        if (agentOptionsByBusiness.get(selectedBusinessId) === membersPromise) agentOptionsByBusiness.delete(selectedBusinessId);
      });
    }
    const members = await membersPromise;
    const query = q.trim().toLowerCase();
    return query ? members.filter((member) => member.searchable.includes(query)) : members;
  }, [agentOptionsByBusiness, selectedAgencyId, selectedBusinessId]);

  const startDraft = useCallback(
    async (assignedAgentId: string | null, selectedAgencyId?: string | null): Promise<string> => {
      const { id } = await createApplication(clientKeyRef.current, assignedAgentId, selectedAgencyId);
      clientKeyRef.current = newClientKey();
      if (authUser?.id) writeSession(authUser.id, id);
      return id;
    },
    [authUser?.id],
  );

  // Resolve an existing wizard session, or create a fresh draft.
  useEffect(() => {
    if (authLoading || identityLoading) return;
    if (!role || !authUser) return;
    if (bootRef.current) return;
    bootRef.current = true;

    (async () => {
      setError("");
      try {
        const existing = readSession(authUser.id);
        if (existing) {
          const app = await getApplication(existing).catch(() => null);
          if (app && isEditableApplicationStatus(app.status)) {
            setApplicationId(app.id);
            setPhase("wizard");
            return;
          }
          clearSession(authUser.id);
        }

        if (role === "agent") {
          setCreating(true);
          const id = await startDraft(null);
          setApplicationId(id);
          setPhase("wizard");
        } else {
          setPhase("pick");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "We could not start a new application.");
        setPhase(role === "agent" ? "checking" : "pick");
        bootRef.current = false;
      } finally {
        setCreating(false);
      }
    })();
  }, [authLoading, identityLoading, role, authUser, startDraft]);

  useEffect(() => {
    if (phase !== "pick") return;
    if (role === "slit_admin") return;
    if (!agency?.id) { setAgents([]); return; }
    void listAssignableAgents(agency.id).then(setAgents).catch((e) => {
      setError(e instanceof Error ? e.message : "We could not load agents for this agency.");
    });
  }, [phase, role, agency?.id]);

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
      setSelectedAgent({ kind: "new", details: value.agent });
    } else {
      setSelectedAgent({ kind: "new", details: value.agent });
    }
    setRecordDialogMode(null);
  };

  const handlePick = async () => {
    setCreating(true);
    setError("");
    try {
      let agencyId: string | null = role === "slit_admin" && business?.kind === "existing" ? business.agencyId : null;
      let businessId: string | null = role === "slit_admin" && business?.kind === "existing" ? business.id : null;
      let assignedAgentId = role === "slit_admin"
        ? selectedAgent?.kind === "existing" && selectedAgent.row.role !== "agency_admin" ? selectedAgent.row.profileId : null
        : agentId || null;
      const notes: string[] = [];

      if (role === "slit_admin") {
        if (!business) throw new Error("Choose a business, or add a new one.");
        if (!selectedAgent) throw new Error("Choose an agent, or add a new one.");

        if (business.kind === "new") {
          const created = await createAgencyRecordWithBusiness({ ...business.details, status: "Inactive" });
          agencyId = created.agencyId;
          businessId = created.businessId;
          await logAgencyChange(created.agencyId, "agency_created", { code: business.details.code });
        }

        if (businessId && (business.kind === "new" || business.status !== "Active" || !agencyId)) {
          const result = await setBusinessStatus(businessId, "Active");
          agencyId = result.agencyId;
          notes.push(`${business.name} was ${business.kind === "new" ? "created and " : ""}activated.`);
        }

        if (selectedAgent.kind === "new") {
          const result = await activateAgent({
            businessId,
            name: selectedAgent.details.name,
            email: selectedAgent.details.email.trim().toLowerCase(),
            role: selectedAgent.details.role,
          });
          agencyId = result.agencyId ?? agencyId;
          if (!result.hasLogin && result.email && agencyId) {
            try {
              const sent = await invokePortalUsers({
                action: "invite",
                email: result.email,
                name: result.name,
                role: result.role,
                agencyId,
                redirectTo: portalPasswordResetUrl(),
              });
              if (sent.emailSent) notes.push(`A sign-in invitation was emailed to ${result.email}.`);
            } catch (e) {
              const reason = e instanceof Error ? e.message : "";
              notes.push(/already been invited/i.test(reason)
                ? "An invitation is already waiting for this agent."
                : "The agent invitation was not sent; send it from the business’s Portal team tab.");
            }
          }
          assignedAgentId = null;
          notes.push(`Assign ${selectedAgent.details.name} on the application once they have signed in.`);
        } else if (selectedAgent.row.status === "Inactive" && selectedAgent.row.profileId) {
          await invokePortalUsers({ action: "update", profileId: selectedAgent.row.profileId, status: "Active" });
          notes.push(`${selectedAgent.row.name} was reactivated.`);
        } else if (!assignedAgentId) {
          notes.push(`${selectedAgent.row.name} is an agency admin or has not signed in; assign an agent on the application.`);
        }

        if (!agencyId) throw new Error("This business has no workspace yet, so the application could not be created. Activate the business and try again.");
      }

      const id = await startDraft(assignedAgentId, role === "slit_admin" ? agencyId : null);
      if (notes.length) push(notes.join(" "));
      setApplicationId(id);
      setPhase("wizard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not start a new application.");
    } finally {
      setCreating(false);
    }
  };

  const handleFinish = () => {
    if (authUser?.id) clearSession(authUser.id);
    navigate(paths.detail(applicationId), { replace: true });
  };

  // Cancelling discards the unfinished draft and its uploads, then starts a fresh application.
  const handleCancel = async () => {
    const uid = authUser?.id;
    if (uid) clearSession(uid);
    const abandoned = applicationId;
    setApplicationId("");
    setPhase("checking");
    setCreating(true);
    setError("");
    try {
      const docs = await listApplicationDocuments(abandoned).catch(() => []);
      await Promise.all(docs.map((doc) => deleteApplicationDocument({ id: doc.id, storagePath: doc.storagePath }).catch(() => undefined)));
      await deleteApplicationDraft(abandoned).catch(() => undefined);
      if (role === "agent") {
        const id = await startDraft(null);
        setApplicationId(id);
        setPhase("wizard");
      } else {
        setBusiness(null);
        setSelectedAgent(null);
        setAgentId("");
        setPhase("pick");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not start a new application.");
    } finally {
      setCreating(false);
    }
  };

  if (authLoading || identityLoading || phase === "checking") {
    return (
      <div>
        <PageHeading
          eyebrow="Add New Form"
          title="Starting a new application"
          description="Student details always start empty and are only ever filled from the documents you upload."
        />
        <div className="mt-6">
          {error ? (
            <div className="space-y-3">
              <PortalError message={error} />
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-5 py-2.5 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600"
              >
                <i className="ri-refresh-line" aria-hidden="true" />
                Try again
              </button>
            </div>
          ) : (
            <PortalLoading label={creating ? "Preparing your blank application\u2026" : "Opening\u2026"} />
          )}
        </div>
      </div>
    );
  }

  if (phase === "wizard") {
    return (
      <ApplicationWizard
        applicationId={applicationId}
        agencyName={business?.name ?? agency?.name ?? ""}
        onFinish={handleFinish}
        onCancel={() => void handleCancel()}
      />
    );
  }

  const businessNeedsActivation = business?.kind === "new" || (business?.kind === "existing" && business.status !== "Active");

  return (
    <div>
      <PageHeading
        eyebrow="Add New Form"
        title="New student application"
        description="Choose the business and agent for this application. Student details always start empty."
      />

      <div className="mt-6 max-w-2xl rounded-card border border-background-200 bg-background-50 p-6">
        <h2 className="font-heading text-base font-semibold text-foreground-950">Who is this application for?</h2>
        <p className="mt-1.5 text-sm text-foreground-600">
          {role === "slit_admin"
            ? "Choose an existing business and one of its portal team members, or add them here. The document wizard opens next."
            : `Assign the application to an active agent in ${agency?.name ?? "your agency"}, or leave it unassigned and allocate it later. The document wizard opens next.`}
        </p>

        {role === "slit_admin" ? (
          <div className="mt-5 space-y-5">
            <div>
              {business ? (
                <>
                  <p className="mb-1.5 text-[13px] font-medium text-foreground-800">Business</p>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-background-300 bg-background-50 px-3 py-2.5">
                    <span className="min-w-0">
                      <b className="block truncate text-sm text-foreground-900">{business.name}</b>
                      <span className="block truncate text-xs text-foreground-500">
                        {business.kind === "new" ? "New business, created when you start the application" : business.status === "Active" ? "Active business" : "Inactive, activated when you start the application"}
                      </span>
                    </span>
                    <button type="button" disabled={creating} onClick={() => { setBusiness(null); setSelectedAgent(null); }} className="rounded px-2 py-1 text-sm font-medium text-primary-700 hover:bg-background-100 disabled:opacity-60">Change</button>
                  </div>
                </>
              ) : (
                <SearchPick
                  label="Business"
                  addNoun="business"
                  autoFocus
                  placeholder="Search business name, place or email"
                  search={searchBusinesses}
                  onPick={(option) => {
                    const row = (option as PickOption & { raw: { id: string; name: string; status: BusinessStatus; agencyId: string | null } }).raw;
                    setBusiness({ kind: "existing", id: row.id, name: row.name, status: row.status, agencyId: row.agencyId });
                    setSelectedAgent(null);
                  }}
                  onAddNew={openNewBusiness}
                />
              )}
            </div>

            {business ? (
              <div>
                {selectedAgent ? (
                  <>
                    <p className="mb-1.5 text-[13px] font-medium text-foreground-800">Portal team member</p>
                    <div className="flex items-center justify-between gap-3 rounded-md border border-background-300 bg-background-50 px-3 py-2.5">
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <b className="truncate text-sm text-foreground-900">{selectedAgent.kind === "existing" ? selectedAgent.row.name : selectedAgent.details.name}</b>
                          {selectedAgent.kind === "existing" ? <AgentStatusBadge status={selectedAgent.row.status} /> : null}
                        </span>
                        <span className="block truncate text-xs text-foreground-500">
                          {selectedAgent.kind === "existing"
                            ? [selectedAgent.row.email, selectedAgent.row.role === "agency_admin" ? "Agency admin" : "Agent"].filter(Boolean).join(", ")
                            : [selectedAgent.details.email, selectedAgent.details.role === "agency_admin" ? "Agency admin" : "Agent"].filter(Boolean).join(", ")}
                        </span>
                      </span>
                      <button type="button" disabled={creating} onClick={() => setSelectedAgent(null)} className="rounded px-2 py-1 text-sm font-medium text-primary-700 hover:bg-background-100 disabled:opacity-60">Change</button>
                    </div>
                  </>
                ) : business.kind === "new" || !business.agencyId ? (
                  <div className="rounded-md border border-dashed border-background-300 px-3 py-3 text-sm text-foreground-600">
                    This business has no portal team yet.{" "}
                    <button type="button" disabled={creating} className="font-semibold text-primary-700 hover:text-primary-800 disabled:opacity-60" onClick={() => openNewAgent("")}>Add its first agent</button>
                  </div>
                ) : (
                  <SearchPick
                    label="Portal team member"
                    addNoun="team member"
                    placeholder={`Search team members at ${business.name}`}
                    resetKey={business.id}
                    autoFocus
                    searchWhenEmpty
                    openOnMount
                    search={searchAgents}
                    onPick={(option) => setSelectedAgent({ kind: "existing", row: (option as PickOption & { raw: PortalTeamMember }).raw })}
                    onAddNew={openNewAgent}
                  />
                )}
              </div>
            ) : null}

            {businessNeedsActivation && selectedAgent ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{business?.name} will be activated so it gets a workspace for this application.</p>
            ) : null}
          </div>
        ) : (
          <div className="mt-5">
            <label htmlFor="new-app-agent" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-700">
              Assigned agent
            </label>
            <select
              id="new-app-agent"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="w-full rounded-md border border-background-300 bg-background-50 px-3.5 py-2.5 text-sm text-foreground-950 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40"
            >
              <option value="">Leave unassigned</option>
              {agents.map((agent) => (
                <option key={agent.profileId} value={agent.profileId}>
                  {agent.fullName}
                  {agent.email ? ` (${agent.email})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {error ? (
          <div className="mt-4">
            <PortalError message={error} />
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            disabled={creating || (role === "slit_admin" && (!business || !selectedAgent))}
            onClick={() => void handlePick()}
            className="inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-6 py-3 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? (
              <>
                <i className="ri-loader-4-line animate-spin" aria-hidden="true" />
                Creating&hellip;
              </>
            ) : (
              <>
                <i className="ri-magic-line" aria-hidden="true" />
                Start with document wizard
              </>
            )}
          </button>
          <Link
            to={paths.list}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-background-300 px-5 py-3 text-sm font-semibold text-foreground-800 transition-colors hover:bg-background-100"
          >
            Cancel
          </Link>
        </div>
      </div>
      <AddStudentRecordDialog
        mode={recordDialogMode}
        initialBusinessName={initialBusinessName}
        initialAgentName={initialAgentName}
        onCancel={() => setRecordDialogMode(null)}
        onSave={saveNewRecord}
      />
    </div>
  );
}
