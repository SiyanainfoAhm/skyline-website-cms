import ResponsiveTable from "@/components/ui/ResponsiveTable";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, PageHeader } from "@/pages/admin/components/ui";
import { AgencyStatusBadge, ApplicationStatusPills } from "@/pages/admin/components/AgencyStatus";
import { ListMessage, Pager, SearchBox, StatusTabs } from "@/pages/admin/components/ListControls";
import { listAgents, type AgentRow, type ListCounts } from "@/pages/admin/lib/businessData";
import { useListParams } from "@/pages/admin/lib/listParams";

const PAGE_SIZE = 25;
const KEYS = ["q", "status"] as const;

/** Agencies > Agents: everyone with a portal login, across businesses. */
export default function AgentsPage() {
  const { values, page, update, setPage, clear } = useListParams(KEYS);
  const status = values.status === "Active" || values.status === "Inactive" ? values.status : "";
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<ListCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listAgents({ search: values.q, status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((r) => { if (active) { setRows(r.rows); setTotal(r.total); setCounts(r.counts); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "We could not load agents."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [values.q, status, page, reload]);

  const filtered = Boolean(values.q || status);
  return (
    <div>
      <PageHeader title="Agents" description="Everyone with a portal login: agency admins and agents. Open an agent to see their students and applications, link their MARN, or disable them." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <StatusTabs label="Agent status" value={status} onChange={(v) => update({ status: v })}
          tabs={[{ id: "", label: "All", count: counts?.all ?? null }, { id: "Active", label: "Active", count: counts?.active ?? null }, { id: "Inactive", label: "Disabled", count: counts?.inactive ?? null }]} />
        <div className="flex-1"><SearchBox label="Search agents" value={values.q} onSearch={(q) => update({ q })} placeholder="Search name, email, business or MARN" /></div>
      </div>
      <Card>
        {error ? (
          <ListMessage icon="ri-error-warning-line" title="Agents did not load" text={error} action={<Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>Try again</Button>} />
        ) : !loading && rows.length === 0 ? (
          <ListMessage icon="ri-team-line" title={filtered ? "No agents match" : "No agents yet"}
            text={filtered ? "Check the spelling or clear the filter." : "Agents appear here once a business admin invites them."}
            action={filtered ? <Button variant="outline" size="sm" onClick={clear}>Clear search and filter</Button> : undefined} />
        ) : (
          <div className={loading && counts ? "opacity-60 transition-opacity" : ""}>
            <ResponsiveTable aria-busy={loading}>
              <thead>
                <tr>
                  <th className="w-[25%]">Agent</th>
                  <th className="w-[22%]">Business</th>
                  <th className="w-[11%]">MARN</th>
                  <th className="w-[9%]">Students</th>
                  <th className="w-[21%]">Applications</th>
                  <th className="w-[12%]">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && !counts ? <tr><td colSpan={6} className="py-10 text-center text-foreground-500">Loading agents…</td></tr> : rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/admin/agents/${r.id}`} className="font-semibold text-foreground-900 hover:text-primary-700">{r.name || r.email}</Link>
                      <p className="mt-0.5 text-xs text-foreground-500">{r.role === "agency_admin" ? "Agency admin" : "Agent"}, {r.email}</p>
                    </td>
                    <td>
                      <Link to={`/admin/businesses/${r.businessId}`} className="text-foreground-800 hover:text-primary-700">{r.businessName}</Link>
                      {r.businessStatus !== "Active" ? <p className="text-xs font-medium text-amber-700">Business inactive</p> : null}
                    </td>
                    <td className="tabular-nums">{r.marn || <span className="text-xs text-foreground-500">Not linked</span>}</td>
                    <td><b className="text-foreground-900">{r.students}</b></td>
                    <td>{Object.keys(r.statusCounts).length ? <ApplicationStatusPills counts={r.statusCounts} limit={3} /> : <span className="text-xs text-foreground-500">None</span>}</td>
                    <td><AgencyStatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </div>
        )}
        {!error ? <Pager page={page} pageSize={PAGE_SIZE} total={total} loading={loading} onPage={setPage} /> : null}
      </Card>
    </div>
  );
}
