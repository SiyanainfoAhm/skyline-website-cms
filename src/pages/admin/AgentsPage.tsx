import ResponsiveTable from "@/components/ui/ResponsiveTable";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, ConfirmDialog, PageHeader } from "@/pages/admin/components/ui";
import { ApplicationStatusPills } from "@/pages/admin/components/AgencyStatus";
import ActivateAgentDialog from "@/pages/admin/components/ActivateAgentDialog";
import { toActivate, type AgentToActivate } from "@/pages/admin/lib/agentActivation";
import AgentStatusBadge from "@/pages/admin/components/AgentStatusBadge";
import { ListMessage, Pager, SearchBox, StatusTabs } from "@/pages/admin/components/ListControls";
import { useToast } from "@/pages/admin/components/toastContext";
import { deactivateAgent, listAgentDirectory, type AgentCounts, type DirectoryAgent } from "@/pages/admin/lib/businessData";
import { useListParams } from "@/pages/admin/lib/listParams";

const PAGE_SIZE = 25;
const KEYS = ["q", "status"] as const;

/** Agencies > Agents: every agent on the OMARA register plus agents added by hand. Inactive until a SLIT administrator activates them. */
export default function AgentsPage() {
  const { push } = useToast();
  const { values, page, update, setPage, clear } = useListParams(KEYS);
  const status = ["Active", "Invited", "Inactive"].includes(values.status) ? values.status : "";
  const [rows, setRows] = useState<DirectoryAgent[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<AgentCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [activating, setActivating] = useState<AgentToActivate | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirm, setConfirm] = useState<DirectoryAgent | null>(null);
  const [busyKey, setBusyKey] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listAgentDirectory({ search: values.q, status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((r) => { if (active) { setRows(r.rows); setTotal(r.total); setCounts(r.counts); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "We could not load agents."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [values.q, status, page, reload]);

  const openActivate = (agent: AgentToActivate | null) => { setActivating(agent); setDialogOpen(true); };
  const deactivate = async (row: DirectoryAgent) => {
    if (!row.agentId) return;
    setBusyKey(row.key);
    try {
      await deactivateAgent(row.agentId);
      push(`${row.name} deactivated. They can no longer sign in; their students and applications are kept.`);
      setReload((n) => n + 1);
    } catch (e) {
      push(e instanceof Error ? e.message : "We could not deactivate this agent.", "error");
    } finally {
      setBusyKey("");
      setConfirm(null);
    }
  };

  const filtered = Boolean(values.q || status);
  return (
    <div>
      <PageHeader title="Agents"
        description="Every agent on the OMARA register, plus agents you add. Agents are inactive until you activate them; activating attaches them to a business and can send their sign-in invitation."
        actions={<Button icon="ri-user-add-line" onClick={() => openActivate(null)}>Add agent</Button>} />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <StatusTabs label="Agent status" value={status} onChange={(v) => update({ status: v })}
          tabs={[{ id: "", label: "All", count: counts?.all ?? null }, { id: "Active", label: "Active", count: counts?.active ?? null },
            { id: "Invited", label: "Invited", count: counts?.invited ?? null }, { id: "Inactive", label: "Inactive", count: counts?.inactive ?? null }]} />
        <div className="flex-1"><SearchBox label="Search agents" value={values.q} onSearch={(q) => update({ q })} placeholder="Search name, MARN, email, business or city" /></div>
      </div>
      <Card>
        {error ? (
          <ListMessage icon="ri-error-warning-line" title="Agents did not load" text={error} action={<Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>Try again</Button>} />
        ) : !loading && rows.length === 0 ? (
          <ListMessage icon="ri-team-line" title={filtered ? "No agents match" : "No agents yet"}
            text={filtered ? "Check the spelling, search fewer words, or clear the filter." : "Agents appear here when the OMARA register is imported or when you add one."}
            action={filtered ? <Button variant="outline" size="sm" onClick={clear}>Clear search and filter</Button> : undefined} />
        ) : (
          <div className={loading && counts ? "opacity-60 transition-opacity" : ""}>
            <ResponsiveTable aria-busy={loading}>
              <thead>
                <tr>
                  <th className="w-[24%]">Agent</th>
                  <th className="w-[22%]">Business</th>
                  <th className="w-[8%]">Students</th>
                  <th className="w-[19%]">Applications</th>
                  <th className="w-[11%]">Status</th>
                  <th className="w-[16%]"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading && !counts ? <tr><td colSpan={6} className="py-10 text-center text-foreground-500">Loading agents…</td></tr> : rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <Link to={`/admin/agents/${r.key}`} className="font-semibold text-foreground-900 hover:text-primary-700">{r.name}</Link>
                      <p className="mt-0.5 text-xs text-foreground-500">
                        {[r.marn ? `MARN ${r.marn}` : "Not in OMARA", r.role === "agency_admin" ? "Agency admin" : null, r.place || r.email].filter(Boolean).join(", ")}
                      </p>
                      {r.registered === false ? <p className="text-xs font-medium text-amber-700">No longer registered with OMARA</p> : null}
                    </td>
                    <td>
                      {r.businessId ? <Link to={`/admin/businesses/${r.businessId}`} className="text-foreground-800 hover:text-primary-700">{r.businessName}</Link> : <span className="text-xs text-foreground-500">No business</span>}
                      {r.businessId && r.businessStatus !== "Active" && r.status !== "Inactive" ? <p className="text-xs font-medium text-amber-700">Business inactive</p> : null}
                    </td>
                    <td>{r.profileId ? <b className="text-foreground-900">{r.students}</b> : <span className="text-xs text-foreground-500">None</span>}</td>
                    <td>{Object.keys(r.statusCounts).length ? <ApplicationStatusPills counts={r.statusCounts} limit={3} /> : <span className="text-xs text-foreground-500">None</span>}</td>
                    <td><AgentStatusBadge status={r.status} /></td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {r.status === "Inactive"
                          ? <Button size="sm" onClick={() => openActivate(toActivate(r))}>Activate</Button>
                          : <Button size="sm" variant="ghost" disabled={busyKey === r.key} onClick={() => setConfirm(r)}>Deactivate</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </div>
        )}
        {!error ? <Pager page={page} pageSize={PAGE_SIZE} total={total} loading={loading} onPage={setPage} /> : null}
      </Card>

      <ActivateAgentDialog agent={activating} open={dialogOpen} onClose={() => setDialogOpen(false)} onDone={() => setReload((n) => n + 1)} />
      <ConfirmDialog open={Boolean(confirm)} title={`Deactivate ${confirm?.name ?? "this agent"}?`}
        message="They will not be able to sign in, and an invitation still waiting is withdrawn. Their students and applications stay with the business. You can activate them again at any time."
        confirmLabel={busyKey ? "Deactivating…" : "Deactivate agent"} onConfirm={() => { if (confirm && !busyKey) void deactivate(confirm); }} onCancel={() => { if (!busyKey) setConfirm(null); }} />
    </div>
  );
}
