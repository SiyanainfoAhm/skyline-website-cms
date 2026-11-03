import ResponsiveTable from "@/components/ui/ResponsiveTable";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, ConfirmDialog, PageHeader } from "@/pages/admin/components/ui";
import { ApplicationStatusPills } from "@/pages/admin/components/AgencyStatus";
import ActivateAgentDialog from "@/pages/admin/components/ActivateAgentDialog";
import { toActivate, type AgentToActivate } from "@/pages/admin/lib/agentActivation";
import { ListMessage, Pager, SearchBox, StatusTabs } from "@/pages/admin/components/ListControls";
import { useToast } from "@/pages/admin/components/toastContext";
import { deactivateAgent, listAgentDirectory, type AgentCounts, type AgentStatus, type DirectoryAgent } from "@/pages/admin/lib/businessData";
import { useListParams } from "@/pages/admin/lib/listParams";

const PAGE_SIZE = 100;
const KEYS = ["q", "status", "sort", "dir"] as const;
type SortKey = "business" | "agent" | "students" | "applications" | "status";
const SORT_KEYS: SortKey[] = ["business", "agent", "students", "applications", "status"];
const STATUS_RANK: Record<AgentStatus, number> = { Active: 0, Invited: 1, Inactive: 2 };
const applicationTotal = (r: DirectoryAgent) => Object.values(r.statusCounts).reduce((sum, n) => sum + Number(n || 0), 0);
const text = (value: string) => value.trim().toLowerCase();

function compareAgents(a: DirectoryAgent, b: DirectoryAgent, key: SortKey): number {
  switch (key) {
    case "business": return text(a.businessName || "\uffff").localeCompare(text(b.businessName || "\uffff")) || text(a.name).localeCompare(text(b.name));
    case "agent": return text(a.name).localeCompare(text(b.name));
    case "students": return a.students - b.students || text(a.name).localeCompare(text(b.name));
    case "applications": return applicationTotal(a) - applicationTotal(b) || text(a.name).localeCompare(text(b.name));
    case "status": return STATUS_RANK[a.status] - STATUS_RANK[b.status] || text(a.name).localeCompare(text(b.name));
  }
}

const STATUS_SELECT: Record<AgentStatus, string> = {
  Active: "border-emerald-200 bg-emerald-50 text-emerald-800",
  Invited: "border-amber-200 bg-amber-50 text-amber-900",
  Inactive: "border-background-300 bg-background-100 text-foreground-600",
};

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
  const sortKey = SORT_KEYS.includes(values.sort as SortKey) ? values.sort as SortKey : null;
  const sortDir = values.dir === "desc" ? "desc" : "asc";
  // Sorts the loaded page (up to 100 agents); without a sort the server order applies (Active, Invited, Inactive, then name).
  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const out = [...rows].sort((a, b) => compareAgents(a, b, sortKey));
    return sortDir === "desc" ? out.reverse() : out;
  }, [rows, sortKey, sortDir]);
  const toggleSort = (key: SortKey) => update({ sort: key, dir: sortKey === key && sortDir === "asc" ? "desc" : "asc", page: page > 1 ? String(page) : "" });
  const sortHeader = (key: SortKey, label: string, className: string) => (
    <th className={className} aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 hover:text-foreground-900">
        {label}
        <i aria-hidden="true" className={sortKey === key ? (sortDir === "asc" ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line") : "ri-arrow-up-down-line text-foreground-400"} />
      </button>
    </th>
  );
  // The status menu: activating opens the Activate dialog (business, email, invitation); deactivating asks first.
  const changeStatus = (row: DirectoryAgent, next: string) => {
    if (next === row.status) return;
    if (next === "Active") openActivate(toActivate(row));
    else if (next === "Inactive") setConfirm(row);
  };
  const applicationsHref = (row: DirectoryAgent, status?: string) => {
    const query = new URLSearchParams();
    if (row.businessId) query.set("business", row.businessId);
    if (row.profileId) query.set("agent", row.profileId);
    if (status) query.set("status", status);
    return `/admin/applications?${query.toString()}`;
  };

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
                  {sortHeader("business", "Business", "w-[24%]")}
                  {sortHeader("agent", "Agent", "w-[28%]")}
                  {sortHeader("students", "Students", "w-[9%]")}
                  {sortHeader("applications", "Applications", "w-[23%]")}
                  {sortHeader("status", "Status", "w-[16%]")}
                </tr>
              </thead>
              <tbody>
                {loading && !counts ? <tr><td colSpan={5} className="py-10 text-center text-foreground-500">Loading agents…</td></tr> : sorted.map((r) => (
                  <tr key={r.key}>
                    <td>
                      {r.businessId ? <Link to={`/admin/businesses/${r.businessId}`} className="font-medium text-foreground-800 hover:text-primary-700">{r.businessName}</Link> : <span className="text-xs text-foreground-500">No business</span>}
                      {r.businessId && r.businessStatus !== "Active" && r.status !== "Inactive" ? <p className="text-xs font-medium text-amber-700">Business inactive</p> : null}
                    </td>
                    <td>
                      <Link to={`/admin/agents/${r.key}`} className="font-semibold text-foreground-900 hover:text-primary-700">{r.name}</Link>
                      <p className="mt-0.5 text-xs text-foreground-500">
                        {[r.marn ? `MARN ${r.marn}` : "Not in OMARA", r.role === "agency_admin" ? "Agency admin" : null, r.place || r.email].filter(Boolean).join(", ")}
                      </p>
                      {r.registered === false ? <p className="text-xs font-medium text-amber-700">No longer registered with OMARA</p> : null}
                    </td>
                    <td>{r.profileId ? <b className="text-foreground-900">{r.students}</b> : <span className="text-xs text-foreground-500">None</span>}</td>
                    <td>
                      {applicationTotal(r) > 0 && r.profileId ? (
                        <div className="flex flex-col items-start gap-1">
                          <Link to={applicationsHref(r)} className="text-xs font-semibold text-primary-700 hover:underline">{applicationTotal(r)} application{applicationTotal(r) === 1 ? "" : "s"}</Link>
                          <ApplicationStatusPills counts={r.statusCounts} limit={3} hrefFor={(status) => applicationsHref(r, status)} />
                        </div>
                      ) : <span className="text-xs text-foreground-500">None</span>}
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`status-${r.key}`}>Status for {r.name}</label>
                      <select id={`status-${r.key}`} value={r.status} disabled={busyKey === r.key} onChange={(e) => changeStatus(r, e.target.value)}
                        className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60 ${STATUS_SELECT[r.status]}`}>
                        {r.status === "Inactive"
                          ? <><option value="Inactive">Inactive</option><option value="Active">Activate…</option></>
                          : <><option value={r.status}>{r.status}</option><option value="Inactive">Deactivate…</option></>}
                      </select>
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
