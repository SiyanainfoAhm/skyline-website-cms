import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePortalAuth } from "@/pages/agency/lib/portalAuthContext";
import {
  createApplication,
  getApplication,
} from "@/pages/agency/lib/portalApplications";
import QuickPick, { type QuickPickOption } from "@/pages/admin/components/QuickPick";
import { AddAgentModal, BusinessPicker } from "@/pages/admin/components/QuickAdd";
import { searchAgentOptions, type BusinessOption } from "@/pages/admin/lib/quickAddSearch";
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

export default function NewApplicationPage() {
  const paths = useApplicationPaths();
  const { role, agency, authUser, authLoading, identityLoading } = usePortalAuth();
  const navigate = useNavigate();

  const clientKeyRef = useRef(newClientKey());
  const bootRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("checking");
  const [applicationId, setApplicationId] = useState("");
  const [business, setBusiness] = useState<BusinessOption | null>(null);
  const [agent, setAgent] = useState<QuickPickOption | null>(null);
  const [addingAgent, setAddingAgent] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const agencyId = business?.active ? business.agencyId ?? "" : "";
  const agentId = agent?.id ?? "";
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

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

  const pickAgency = role === "slit_admin" ? agencyId : agency?.id ?? "";
  // A different business means a different team: clear the agent.
  useEffect(() => { setAgent(null); }, [pickAgency]);

  const handlePick = async () => {
    setCreating(true);
    setError("");
    try {
      if (role === "slit_admin" && !agencyId) {
        setError("Choose an active business before creating an application.");
        return;
      }
      const id = await startDraft(agentId || null, role === "slit_admin" ? agencyId : null);
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

  const handleCancel = async () => {
    const uid = authUser?.id;
    if (uid) clearSession(uid);
    // A new draft has a real reference and must remain available even if the
    // document wizard is closed before any field is filled.
    navigate(paths.detail(applicationId), { replace: true });
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
        agencyName={agency?.name ?? ""}
        onFinish={handleFinish}
        onCancel={() => void handleCancel()}
      />
    );
  }

  // SLIT admin / agency admin: choose the business and agent before the wizard opens.
  return (
    <div>
      <PageHeading
        eyebrow="Add student"
        title="New student application"
        description="Pick who the student belongs to. Student details are filled from the documents you upload next."
      />

      <div className="mt-6 max-w-xl rounded-card border border-background-200 bg-background-50 shadow-sm">
        <div className="space-y-5 p-6">
          {role === "slit_admin" ? (
            <BusinessPicker value={business} onChange={setBusiness} required autoFocus />
          ) : (
            <p className="rounded-md bg-background-100 px-3 py-2 text-sm text-foreground-700">Business: <b className="text-foreground-900">{agency?.name ?? "Your agency"}</b></p>
          )}

          <QuickPick
            key={pickAgency || "none"}
            label="Agent"
            value={agent}
            onChange={setAgent}
            disabled={!pickAgency}
            search={(q) => searchAgentOptions(pickAgency, q)}
            placeholder={pickAgency ? "Search agent name or email…" : "Choose a business first"}
            addLabel="agent"
            emptyText="No active agent found."
            onAddNew={(typed) => setAddingAgent(typed)}
            hint="Optional. Leave empty to assign it later."
          />

          {notice ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p> : null}
          {error ? <PortalError message={error} /> : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-background-200 bg-background-100/60 px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
          <Link
            to={paths.list}
            className="inline-flex items-center justify-center rounded-md border border-background-300 bg-background-50 px-4 py-2 text-sm font-medium text-foreground-800 transition-colors hover:bg-background-100"
          >
            Cancel
          </Link>
          <button
            type="button"
            disabled={creating || (role === "slit_admin" && !agencyId)}
            onClick={() => void handlePick()}
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-primary-500 px-5 py-2 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? <><i className="ri-loader-4-line animate-spin" aria-hidden="true" />Creating&hellip;</> : <>Continue to documents<i className="ri-arrow-right-line" aria-hidden="true" /></>}
          </button>
        </div>
      </div>

      <AddAgentModal
        open={addingAgent !== null}
        initialName={addingAgent ?? ""}
        agencyId={pickAgency}
        agencyName={role === "slit_admin" ? business?.label : agency?.name}
        onClose={() => setAddingAgent(null)}
        onInvited={(message) => { setAddingAgent(null); setNotice(message); }}
      />
    </div>
  );
}
