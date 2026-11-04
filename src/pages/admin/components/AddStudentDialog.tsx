import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Modal } from "@/pages/admin/components/ui";
import { useToast } from "@/pages/admin/components/toastContext";
import SearchPick, { type PickOption } from "@/pages/admin/components/SearchPick";
import AgentStatusBadge from "@/pages/admin/components/AgentStatusBadge";
import AddStudentRecordDialog, { type AddStudentRecordValue } from "@/pages/admin/components/AddStudentRecordDialog";
import StudentDetailsStep, { type StudentDraft } from "@/pages/agency/components/StudentDetailsStep";
import { activateAgent, listBusinesses, setBusinessStatus, type BusinessStatus } from "@/pages/admin/lib/businessData";
import { createApplicationForStudent, listAgentsOfBusiness, saveStudent, type BusinessAgentOption, type StudentMatch } from "@/pages/agency/lib/portalApplications";

type Business = { id: string; name: string; status: BusinessStatus };

function newKey(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * SLIT admin: add a student down the chain. Choose the business, then the agent who looks after them, then the student's
 * details; a student already on record is offered first. The student's first application then opens as a draft.
 */
export default function AddStudentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const [business, setBusiness] = useState<Business | null>(null);
  const [agent, setAgent] = useState<BusinessAgentOption | null>(null);
  const [recordDialogMode, setRecordDialogMode] = useState<"business" | "agent" | null>(null);
  const [initialAgentName, setInitialAgentName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setBusiness(null); setAgent(null); setRecordDialogMode(null); setInitialAgentName(""); setError("");
  }, [open]);

  const searchBusinesses = useCallback(async (q: string): Promise<PickOption[]> => {
    // Only active businesses and active agents can be chosen.
    const r = await listBusinesses({ search: q, status: "Active", limit: 8, offset: 0 });
    return r.rows.map((b) => ({
      id: b.id, label: b.name, meta: [b.abn ? `ABN ${b.abn}` : "", `${b.agents} agent${b.agents === 1 ? "" : "s"}`, `${b.students} student${b.students === 1 ? "" : "s"}`].filter(Boolean).join(", "),
      raw: b,
    })) as PickOption[];
  }, []);

  const businessId = business?.id ?? "";
  const searchAgents = useCallback(async (q: string): Promise<PickOption[]> => {
    if (!businessId) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (await listAgentsOfBusiness(businessId))
      .filter((a) => a.status === "Active")
      .filter((a) => { const text = `${a.name} ${a.email} ${a.role === "agency_admin" ? "agency admin" : "agent"}`.toLowerCase(); return words.every((w) => text.includes(w)); })
      .map((a) => ({ id: a.id, label: a.name, meta: [a.email, a.role === "agency_admin" ? "Agency admin" : "Agent"].filter(Boolean).join(", "), tag: <AgentStatusBadge status={a.status} />, raw: a }));
  }, [businessId]);

  const saveNewRecord = (value: AddStudentRecordValue) => {
    setRecordDialogMode(null);
    if (value.kind === "business") {
      setBusiness({ id: value.business.agencyId, name: value.business.name, status: "Active" });
      setAgent(null);
    } else {
      setAgent({ id: value.agent.agentId, profileId: null, name: value.agent.name, email: value.agent.email, role: value.agent.role, status: "Invited" });
    }
  };

  // The student: reuse the one chosen from the matches, or create them under the chosen agent; then open their first application.
  const finish = async (draft: StudentDraft, existing: StudentMatch | null) => {
    if (!business || !agent) return;
    setBusy(true);
    setError("");
    const notes: string[] = [];
    try {
      let studentId = existing?.id ?? "";
      if (!existing) {
        if (business.status !== "Active") {
          await setBusinessStatus(business.id, "Active");
          notes.push(`${business.name} was activated.`);
        }
        if (agent.status === "Inactive") {
          await activateAgent({ agentId: agent.id, businessId: business.id, name: agent.name, email: agent.email, role: agent.role });
          notes.push(`${agent.name} was activated.`);
        }
        const saved = await saveStudent({ agentId: agent.id, fullName: draft.fullName, email: draft.email, mobile: draft.mobile, dateOfBirth: draft.dateOfBirth, passportNumber: draft.passportNumber });
        studentId = saved.id;
        if (saved.reused) notes.push(`${saved.name} was already on record with this passport or email and date of birth, so that record is used.`);
      } else {
        notes.push(`New application for ${existing.name || "the existing student"} with ${existing.businessName}${existing.agentName ? ` (${existing.agentName})` : ""}.`);
      }
      const created = await createApplicationForStudent(newKey(), studentId);
      push([existing ? "Application started as a draft." : "Student added and their application started as a draft.", ...notes].join(" "));
      onClose();
      // The new application opens on the document wizard, as New application does.
      navigate(`/admin/applications/${created.id}?wizard=1`);
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

  const ready = Boolean(business && agent);
  return (<>
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} width="max-w-2xl" title="Add student"
      footer={ready ? undefined : <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>}>
      <div className="space-y-5">
        {!ready ? <p className="text-sm text-foreground-600">Choose the business and the agent who looks after the student, then enter the student's details. Their first application starts as a draft.</p> : null}

        {/* Business */}
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-foreground-800">Business</p>
          {business ? chip(business.name, business.status === "Active" ? "Active business" : "Inactive, activated when you add the student", () => { setBusiness(null); setAgent(null); }) : (
            <SearchPick label="Business" addNoun="business" autoFocus searchWhenEmpty placeholder="Search business name, ABN or agent"
              search={searchBusinesses}
              onPick={(o) => { const b = (o as PickOption & { raw: { id: string; name: string; status: BusinessStatus } }).raw; setBusiness({ id: b.id, name: b.name, status: b.status }); setAgent(null); }}
              onAddNew={() => { setInitialAgentName(""); setRecordDialogMode("business"); }} />
          )}
        </div>

        {/* Agent */}
        {business ? (
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-foreground-800">Agent</p>
            {agent ? (
              <>
                {chip(agent.name, agent.email || "No email on record", () => setAgent(null), <AgentStatusBadge status={agent.status} />)}
                {agent.status === "Inactive" ? <p className="mt-1.5 text-xs text-foreground-500">This agent is inactive. Adding the student activates them.</p> : null}
              </>
            ) : (
              <SearchPick label="Agent" addNoun="agent" placeholder={`Search or pick an agent at ${business.name}`} resetKey={business.id} autoFocus searchWhenEmpty openOnMount
                search={searchAgents}
                onPick={(o) => setAgent((o as PickOption & { raw: BusinessAgentOption }).raw)}
                onAddNew={(name) => { setInitialAgentName(name); setRecordDialogMode("agent"); }} />
            )}
          </div>
        ) : null}

        {/* Student */}
        {ready ? (
          <div className="border-t border-background-200 pt-5">
            <StudentDetailsStep busy={busy} error={error} submitLabel="Add student and open form"
              description="Email and mobile only. Each must be new: a student already on record with either cannot be added again. The name and other details are read from the passport on the form."
              onContinue={(draft, existing) => void finish(draft, existing)}
              cancel={<Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>} />
          </div>
        ) : error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      </div>
    </Modal>
    <AddStudentRecordDialog mode={recordDialogMode} initialAgentName={initialAgentName}
      business={business ? { id: business.id, name: business.name, status: business.status } : null}
      onCancel={() => setRecordDialogMode(null)} onSave={saveNewRecord} />
  </>);
}
