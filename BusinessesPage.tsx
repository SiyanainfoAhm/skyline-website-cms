import ResponsiveTable from "@/components/ui/ResponsiveTable";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, ConfirmDialog, PageHeader, Select } from "@/pages/admin/components/ui";
import { AgencyStatusBadge, ApplicationStatusPills } from "@/pages/admin/components/AgencyStatus";
import { ListMessage, Pager, SearchBox, StatusTabs } from "@/pages/admin/components/ListControls";
import { useToast } from "@/pages/admin/components/toastContext";
import { listBusinesses, setBusinessStatus, type BusinessRow, type BusinessStatus, type ListCounts } from "@/pages/admin/lib/businessData";
import { useListParams } from "@/pages/admin/lib/listParams";
import { AddBusinessModal } from "@/pages/admin/components/QuickAdd";

const PAGE_SIZE = 25;
const KEYS = ["q", "status", "source", "workspace"] as const;

/** Agencies > Businesses: every OMARA business plus businesses added by SLIT. */
export default function BusinessesPage() {
  const { push } = useToast();
  const { values, page, update, setPage, clear } = useListParams(KEYS);
  const status = values.status === "Active" || values.status === "Inactive" ? values.status : "";
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<ListCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [confirm, setConfirm] = useState<BusinessRow | null>(null);
  const [busyId, setBusyId] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listBusinesses({ search: values.q, status, source: values.source, workspace: values.workspace, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((result) => { if (active) { setRows(result.rows); setTotal(result.total); setCounts(result.counts); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "We could not load businesses."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [values.q, status, values.source, values.workspace, page, reload]);

  const change = async (row: BusinessRow, next: BusinessStatus) => {
    setBusyId(row.id);
    try {
      const result = await setBusinessStatus(row.id, next);
      push(next === "Inactive" ? `${row.name} deactivated. Its people can no longer sign in.`
        : result.workspaceCreated ? `${row.name} activated and its workspace created. Invite its first admin from the business page.` : `${row.name} activated.`);
      setReload((n) => n + 1);
    } catch (e) {
      push(e instanceof Error ? e.message : "We could not change this business’s status.", "error");
    } finally {
      setBusyId("");
      setConfirm(null);
    }
  };

  const filtered = Boolean(values.q || status || values.source || values.workspace);
  return (
    <div>
      <PageHeader
        title="Businesses"
        description="OMARA-registered businesses and businesses added by SLIT. Activate one to give it a workspace."
        actions={<Button icon="ri-add-line" onClick={() => setAdding(true)}>Add business</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center">
        <StatusTabs label="Business status" value={status} onChange={(v) => update({ status: v })}
          tabs={[{ id: "", label: "All", count: counts?.all ?? null }, { id: "Active", label: "Active", count: counts?.active ?? null }, { id: "Inactive", label: "Inactive", count: counts?.inactive ?? null }]} />
        <div className="min-w-0 flex-1"><SearchBox label="Search businesses" value={values.q} onSearch={(q) => update({ q })} placeholder="Search business, agent, MARN, email or city" /></div>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Source" value={values.source} onChange={(e) => update({ source: e.target.value })} className="w-auto">
            <option value="">All sources</option>
            <option value="omara">Imported from OMARA</option>
            <option value="manual">Added by SLIT</option>
          </Select>
          <Select aria-label="Workspace" value={values.workspace} onChange={(e) => update({ workspace: e.target.value })} className="w-auto">
            <option value="">Any workspace</option>
            <option value="yes">Has a workspace</option>
            <option value="no">No workspace</option>
          </Select>
        </div>
      </div>

      <Card>
        {error ? (
          <ListMessage icon="ri-error-warning-line" title="Businesses did not load" text={error}
            action={<Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>Try again</Button>} />
        ) : !loading && rows.length === 0 ? (
          <ListMessage icon="ri-building-line" title={filtered ? "No businesses match" : "No businesses yet"}
            text={filtered ? "Check the spelling, search fewer words, or clear the filters." : "Businesses appear here when the OMARA import runs or when you add one."}
            action={filtered ? <Button variant="outline" size="sm" onClick={clear}>Clear search and filters</Button> : undefined} />
        ) : (
          <div className={loading && counts ? "opacity-60 transition-opacity" : ""}>
            <ResponsiveTable aria-busy={loading}>
              <thead>
                <tr>
                  <th className="w-[34%]">Business</th>
                  <th className="w-[16%]">People</th>
                  <th className="w-[10%]">Students</th>
                  <th className="w-[22%]">Applications</th>
                  <th className="w-[18%] text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && !counts ? <tr><td colSpan={5} className="py-10 text-center text-foreground-500">Loading businesses…</td></tr> : rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/admin/businesses/${row.id}`} className="font-semibold text-foreground-900 hover:text-primary-700">{row.name}</Link>
                      <p className="mt-0.5 truncate text-xs text-foreground-500">
                        {[row.agencyCode || (row.source === "omara" ? "OMARA" : "Added by SLIT"), row.place].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td className="text-[13px]">
                      {!row.agencyId ? (
                        <span className="text-foreground-500">{row.omaraAgents ? `${row.omaraAgents} OMARA agent${row.omaraAgents === 1 ? "" : "s"}` : "No workspace"}</span>
                      ) : (
                        <>
                          <span className="text-foreground-900"><b>{row.admins + row.agents}</b> in team</span>
                          {row.admins === 0 ? <span className="mt-0.5 block text-xs font-medium text-amber-700">No admin yet</span>
                            : row.omaraEnded > 0 ? <span className="mt-0.5 block text-xs font-medium text-amber-700">{row.omaraEnded} left OMARA</span>
                            : <span className="mt-0.5 block text-xs text-foreground-500">{row.omaraAgents} on OMARA</span>}
                        </>
                      )}
                    </td>
                    <td>{row.agencyId ? <b className="text-foreground-900">{row.students}</b> : <span className="text-foreground-400">–</span>}</td>
                    <td>
                      {row.applications === 0 ? <span className="text-foreground-400">–</span> : (
                        <div className="space-y-1.5">
                          <Link to={`/admin/businesses/${row.id}?tab=applications`} className="text-[13px] font-semibold text-foreground-900 hover:text-primary-700">
                            {row.applications}
                          </Link>
                          <ApplicationStatusPills counts={row.statusCounts} hrefFor={(s) => `/admin/businesses/${row.id}?tab=applications&status=${s}`} limit={3} />
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <AgencyStatusBadge status={row.status} />
                        {row.status === "Active" ? (
                          <button type="button" aria-label={`Deactivate ${row.name}`} title="Deactivate" disabled={busyId === row.id} onClick={() => setConfirm(row)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-500 hover:bg-background-100 hover:text-foreground-900 disabled:opacity-50">
                            <i className="ri-pause-circle-line text-lg" aria-hidden="true" />
                          </button>
                        ) : (
                          <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => void change(row, "Active")}>{busyId === row.id ? "Activating…" : "Activate"}</Button>
                        )}
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

      <AddBusinessModal open={adding} onClose={() => setAdding(false)}
        onCreated={(_b, message) => { setAdding(false); push(message); setReload((n) => n + 1); }} />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={`Deactivate ${confirm?.name ?? "this business"}?`}
        message="Its administrators and agents will not be able to sign in. Students, applications and history are kept, and you can activate it again at any time."
        confirmLabel={busyId ? "Deactivating…" : "Deactivate business"}
        onConfirm={() => { if (confirm && !busyId) void change(confirm, "Inactive"); }}
        onCancel={() => { if (!busyId) setConfirm(null); }}
      />
    </div>
  );
}
