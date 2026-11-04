import ResponsiveTable from "@/components/ui/ResponsiveTable";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, ConfirmDialog, PageHeader } from "@/pages/admin/components/ui";
import { ApplicationStatusPills } from "@/pages/admin/components/AgencyStatus";
import { ListMessage, Pager, SearchBox, StatusTabs } from "@/pages/admin/components/ListControls";
import { useToast } from "@/pages/admin/components/toastContext";
import { listBusinesses, setBusinessStatus, type BusinessRow, type BusinessStatus, type ListCounts } from "@/pages/admin/lib/businessData";
import { useListParams } from "@/pages/admin/lib/listParams";
import { useStatusCatalog } from "@/pages/agency/lib/statusCatalog";

const PAGE_SIZE = 25;
const KEYS = ["q", "status"] as const;

/** Agencies > Businesses: one row per business (ABN), with its agents, students and applications. */
export default function BusinessesPage() {
  const { push } = useToast();
  const { values, page, update, setPage, clear } = useListParams(KEYS);
  // Tabs and each row's dropdown use the backend's business statuses.
  const businessStatuses = useStatusCatalog().business;
  const status = values.status === "Active" || values.status === "Inactive" ? values.status : "";
  const countFor = (value: string) => (value === "Active" ? counts?.active : value === "Inactive" ? counts?.inactive : undefined) ?? null;
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<ListCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [confirm, setConfirm] = useState<BusinessRow | null>(null);
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listBusinesses({ search: values.q, status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((result) => { if (active) { setRows(result.rows); setTotal(result.total); setCounts(result.counts); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "We could not load businesses."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [values.q, status, page, reload]);

  const change = async (row: BusinessRow, next: BusinessStatus) => {
    setBusyId(row.id);
    try {
      await setBusinessStatus(row.id, next);
      push(next === "Inactive" ? `${row.name} deactivated. Its people can no longer sign in.` : `${row.name} activated.`);
      setReload((n) => n + 1);
    } catch (e) {
      push(e instanceof Error ? e.message : "We could not change this business’s status.", "error");
    } finally {
      setBusyId("");
      setConfirm(null);
    }
  };

  const filtered = Boolean(values.q || status);
  return (
    <div>
      <PageHeader
        title="Businesses"
        description="Every business, identified by its ABN. A business has agents; each agent has students; each student has applications. Deactivate a business to block everyone in it."
        actions={<Link to="/admin/agencies/new"><Button icon="ri-add-line">Add business</Button></Link>}
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <StatusTabs label="Business status" value={status} onChange={(v) => update({ status: v })}
          tabs={[{ id: "", label: "All", count: counts?.all ?? null }, ...businessStatuses.map((item) => ({ id: item.value, label: item.label, count: countFor(item.value) }))]} />
        <div className="flex-1">
          <SearchBox label="Search businesses" value={values.q} onSearch={(q) => update({ q })} placeholder="Search business, ABN, agent name, MARN, email or phone" />
        </div>
      </div>

      <Card>
        {error ? (
          <ListMessage icon="ri-error-warning-line" title="Businesses did not load" text={error}
            action={<Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>Try again</Button>} />
        ) : !loading && rows.length === 0 ? (
          <ListMessage icon="ri-building-line" title={filtered ? "No businesses match" : "No businesses yet"}
            text={filtered ? "Check the spelling, search fewer words, or clear the filters." : "Add a business with its ABN to get started."}
            action={filtered ? <Button variant="outline" size="sm" onClick={clear}>Clear search and filters</Button> : undefined} />
        ) : (
          <div className={loading && counts ? "opacity-60 transition-opacity" : ""}>
            <ResponsiveTable aria-busy={loading}>
              <thead>
                <tr>
                  <th className="w-[30%]">Business</th>
                  <th className="w-[13%]">Agents</th>
                  <th className="w-[9%]">Students</th>
                  <th className="w-[22%]">Applications</th>
                  <th className="w-[10%]">Status</th>
                  <th className="w-[16%]"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading && !counts ? <tr><td colSpan={6} className="py-10 text-center text-foreground-500">Loading businesses…</td></tr> : rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/admin/businesses/${row.id}`} className="font-semibold text-foreground-900 hover:text-primary-700">{row.name}</Link>
                      <p className="mt-0.5 text-xs text-foreground-500">{[row.abn ? `ABN ${row.abn}` : row.agencyCode, row.contact].filter(Boolean).join(", ")}</p>
                    </td>
                    <td className="text-xs">
                      <p><b className="text-foreground-900">{row.agents}</b> agent{row.agents === 1 ? "" : "s"}</p>
                      <p><b className="text-foreground-900">{row.admins}</b> admin{row.admins === 1 ? "" : "s"}</p>
                      {row.admins === 0 ? <p className="mt-0.5 font-medium text-amber-700">No admin yet</p> : null}
                    </td>
                    <td><Link to={`/admin/businesses/${row.id}?tab=students`} className="font-bold text-foreground-900 hover:text-primary-700">{row.students}</Link></td>
                    <td>
                      {row.applications === 0 ? <span className="text-xs text-foreground-500">No applications</span> : (
                        <div className="space-y-1.5">
                          <Link to={`/admin/businesses/${row.id}?tab=applications`} className="text-xs font-semibold text-foreground-900 hover:text-primary-700">
                            {row.applications} application{row.applications === 1 ? "" : "s"}
                          </Link>
                          <ApplicationStatusPills counts={row.statusCounts} hrefFor={(s) => `/admin/businesses/${row.id}?tab=applications&status=${s}`} limit={3} />
                        </div>
                      )}
                    </td>
                    <td>
                      {/* Activating happens at once; deactivating asks first, as it blocks everyone in the business. */}
                      <label className="sr-only" htmlFor={`business-status-${row.id}`}>Status for {row.name}</label>
                      <select id={`business-status-${row.id}`} value={row.status} disabled={busyId === row.id}
                        onChange={(e) => { if (e.target.value === "Inactive") setConfirm(row); else void change(row, "Active"); }}
                        className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60 ${row.status === "Active" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-background-300 bg-background-100 text-foreground-600"}`}>
                        {businessStatuses.map((item) => (
                          <option key={item.value} value={item.value}>{busyId === row.id && item.value === row.status ? "Saving…" : item.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Link to={`/admin/businesses/${row.id}`} className="inline-flex items-center rounded-md border border-background-300 px-2.5 py-1 text-[13px] font-medium text-foreground-800 hover:bg-background-100">Open</Link>
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
