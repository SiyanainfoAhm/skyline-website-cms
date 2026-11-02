import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Card, ConfirmDialog, Field, PageHeader, Select, TextInput } from "@/pages/admin/components/ui";
import { AgencyStatusBadge, ApplicationStatusPills } from "@/pages/admin/components/AgencyStatus";
import ApplicationsList from "@/pages/admin/components/ApplicationsList";
import { ListMessage } from "@/pages/admin/components/ListControls";
import { useToast } from "@/pages/admin/components/toastContext";
import { getAgent, linkAgentMarn, type AgentDetail } from "@/pages/admin/lib/businessData";
import { groupByStudent } from "@/pages/admin/lib/businessGroups";
import { invokePortalUsers } from "@/pages/agency/lib/portalData";

/** Agencies > Agents > {name}: MARN, status, and the agent's students with each one's applications. */
export default function AgentDetailPage() {
  const { id = "" } = useParams();
  const { push } = useToast();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    try {
      const found = await getAgent(id);
      setAgent(found);
      setState(found ? "ready" : "missing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not load this agent.");
      setState("error");
    }
  }, [id]);
  useEffect(() => { setState("loading"); void load(); }, [load]);

  const changeStatus = async (next: "Active" | "Inactive") => {
    if (!agent) return;
    setBusy(true);
    try {
      await invokePortalUsers({ action: "update", profileId: agent.id, status: next });
      push(next === "Inactive" ? `${agent.name} disabled. They can no longer sign in.` : `${agent.name} enabled.`);
      await load();
    } catch (e) {
      push(e instanceof Error ? e.message : "We could not change this agent’s status.", "error");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  if (state === "loading") return <p className="p-6 text-sm text-foreground-600">Loading agent&hellip;</p>;
  if (!agent) {
    return (
      <div>
        <PageHeader title="Agent not found" />
        <p role="alert" className="text-sm text-red-700">{state === "error" ? error : "This agent could not be found."}</p>
        <Link to="/admin/agents" className="mt-3 inline-block text-sm font-semibold text-primary-700 underline">Back to Agents</Link>
      </div>
    );
  }

  const shown = status ? agent.applications.filter((a) => a.status === status) : agent.applications;
  const groups = groupByStudent(shown, agent.students);
  const counts: Record<string, number> = {};
  for (const a of agent.applications) counts[a.status] = (counts[a.status] ?? 0) + 1;

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap gap-1.5 text-sm text-foreground-600">
        <Link to="/admin/agents" className="hover:text-foreground-900">Agents</Link>
        {agent.business ? <><span aria-hidden="true">/</span><Link to={`/admin/businesses/${agent.business.id}`} className="hover:text-foreground-900">{agent.business.name}</Link></> : null}
      </nav>
      <PageHeader
        title={agent.name || agent.email}
        description={`${agent.role === "agency_admin" ? "Agency admin" : "Agent"}${agent.business ? ` at ${agent.business.name}` : ""}. ${agent.email}`}
        actions={
          <>
            <AgencyStatusBadge status={agent.status} />
            {agent.status === "Active"
              ? <Button variant="outline" disabled={busy} onClick={() => setConfirm(true)}>Disable agent</Button>
              : <Button disabled={busy || agent.business?.status !== "Active"} onClick={() => void changeStatus("Active")}>{busy ? "Enabling…" : "Enable agent"}</Button>}
          </>
        }
      />
      {agent.business && agent.business.status !== "Active" ? (
        <p role="status" className="-mt-2 mb-5 rounded-md border border-background-300 bg-background-100 px-4 py-3 text-sm text-foreground-700">
          {agent.business.name} is inactive, so nobody in it can sign in. Activate the business first.
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap items-start gap-5">
        <dl className="grid min-w-0 flex-[999_1_480px] grid-cols-3 gap-px overflow-hidden rounded-lg border border-background-200 bg-background-200">
          <div className="bg-background-50 px-4 py-3"><dt className="text-xs text-foreground-500">Students</dt><dd className="mt-1 font-heading text-xl font-bold tabular-nums">{agent.students.length}</dd></div>
          <div className="bg-background-50 px-4 py-3"><dt className="text-xs text-foreground-500">Applications</dt><dd className="mt-1 font-heading text-xl font-bold tabular-nums">{agent.applications.length}</dd></div>
          <div className="bg-background-50 px-4 py-3"><dt className="text-xs text-foreground-500">By status</dt><dd className="mt-1.5"><ApplicationStatusPills counts={counts} />{agent.applications.length ? null : <span className="text-xs text-foreground-500">None yet</span>}</dd></div>
        </dl>
        <MarnCard agent={agent} onChanged={load} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold text-foreground-900">Students and applications</h2>
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">All statuses</option>
          {Object.keys(counts).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())} ({counts[s]})</option>)}
        </Select>
      </div>
      {groups.length === 0 ? (
        <Card><ListMessage icon="ri-user-line" title={status ? "No applications in this status" : "No students yet"} text={status ? "Choose another status." : "Students appear here when this agent starts an application."} /></Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.student.id}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-background-200 px-4 py-3">
                <div>
                  <Link to={`/admin/students/${g.student.id}`} className="font-heading text-[15px] font-semibold text-foreground-900 hover:text-primary-700">{g.student.name || "Unnamed student"}</Link>
                  {g.student.email ? <p className="text-xs text-foreground-500">{g.student.email}</p> : null}
                </div>
                <span className="text-xs text-foreground-600"><b className="text-foreground-900">{g.applications.length}</b> application{g.applications.length === 1 ? "" : "s"}</span>
              </div>
              <ApplicationsList rows={g.applications} />
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog open={confirm} title={`Disable ${agent.name || "this agent"}?`}
        message="They will be signed out and cannot sign in. Their students and applications stay with the business, and you can enable them again."
        confirmLabel={busy ? "Disabling…" : "Disable agent"} onConfirm={() => { if (!busy) void changeStatus("Inactive"); }} onCancel={() => { if (!busy) setConfirm(false); }} />
    </div>
  );
}

function MarnCard({ agent, onChanged }: { agent: AgentDetail; onChanged: () => Promise<void> }) {
  const { push } = useToast();
  const [pick, setPick] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (omaraId: string | null) => {
    setBusy(true);
    try {
      const r = await linkAgentMarn(agent.id, omaraId, evidence);
      push(r.linked ? `MARN ${r.marn ?? ""} linked.` : "MARN unlinked.");
      setPick(""); setEvidence("");
      await onChanged();
    } catch (e) {
      push(e instanceof Error ? e.message : "We could not link this MARN.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex-[1_1_280px] p-4">
      <h2 className="mb-2 font-heading text-[15px] font-semibold text-foreground-900">OMARA registration</h2>
      {agent.omara ? (
        <div className="space-y-2 text-sm">
          <p><span className="text-foreground-500">MARN</span> <b className="tabular-nums text-foreground-900">{agent.omara.marn}</b></p>
          <p className={agent.omara.registered ? "text-emerald-800" : "font-medium text-amber-700"}>{agent.omara.registered ? "Registered with OMARA" : "No longer registered with OMARA"}</p>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>Unlink MARN</Button>
        </div>
      ) : agent.marnOptions.length === 0 ? (
        <p className="text-sm text-foreground-600">No unlinked MARN is listed for {agent.business?.name ?? "this business"}.</p>
      ) : (
        <div className="space-y-3">
          <Field label="MARN">
            <Select value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy}>
              <option value="">Choose the agent’s MARN</option>
              {agent.marnOptions.map((o) => <option key={o.id} value={o.id}>{o.marn}, {o.name}</option>)}
            </Select>
          </Field>
          <Field label="How you checked it">
            <TextInput value={evidence} onChange={(e) => setEvidence(e.target.value)} disabled={busy} placeholder="For example: checked on the OMARA register" />
          </Field>
          <Button size="sm" disabled={busy || !pick || !evidence.trim()} onClick={() => void save(pick)}>{busy ? "Linking…" : "Link MARN"}</Button>
        </div>
      )}
    </Card>
  );
}
