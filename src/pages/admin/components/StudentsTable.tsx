import ResponsiveTable from "@/components/ui/ResponsiveTable";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Select } from "@/pages/admin/components/ui";
import { ApplicationStatusPills } from "@/pages/admin/components/AgencyStatus";
import { ListMessage, Pager, SearchBox } from "@/pages/admin/components/ListControls";
import { listStudents, type StudentRow } from "@/pages/admin/lib/businessData";
import { formatDate } from "@/pages/agency/lib/portalData";
import { SELECTABLE_STATUSES, STATUS_LABELS } from "@/pages/agency/lib/applicationAccess";

const PAGE_SIZE = 25;

/** Students with their application status counts. With `businessId`, only that business's students and no business column. */
export default function StudentsTable({ businessId, emptyText }: { businessId?: string; emptyText?: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listStudents({ search, status, businessId: businessId ?? null, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((result) => { if (active) { setRows(result.rows); setTotal(result.total); setLoaded(true); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "We could not load students."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, status, businessId, page, reload]);

  const filtered = Boolean(search || status);
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="flex-1"><SearchBox label="Search students" value={search} onSearch={(v) => { setSearch(v); setPage(1); }}
          placeholder={businessId ? "Search student, email, agent or application reference" : "Search student, email, business, agent or application reference"} /></div>
        <Select aria-label="Has an application in status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-56">
          <option value="">Any application status</option>
          {SELECTABLE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </Select>
      </div>
      <Card>
        {error ? (
          <ListMessage icon="ri-error-warning-line" title="Students did not load" text={error}
            action={<Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>Try again</Button>} />
        ) : loaded && !loading && rows.length === 0 ? (
          <ListMessage icon="ri-user-line" title={filtered ? "No students match" : "No students yet"}
            text={filtered ? "Check the spelling or choose another status." : emptyText ?? "Students appear here when an agent starts their first application."} />
        ) : (
          <div className={loading && loaded ? "opacity-60 transition-opacity" : ""}>
            <ResponsiveTable aria-busy={loading}>
              <thead>
                <tr>
                  <th className={businessId ? "w-[30%]" : "w-[24%]"}>Student</th>
                  {businessId ? null : <th className="w-[20%]">Business</th>}
                  <th className="w-[18%]">Agent</th>
                  <th className="w-[26%]">Applications</th>
                  <th className="w-[12%]">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {!loaded ? <tr><td colSpan={businessId ? 4 : 5} className="py-10 text-center text-foreground-500">Loading students…</td></tr> : rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/admin/students/${row.id}`} className="font-semibold text-foreground-900 hover:text-primary-700">{row.name || "Unnamed student"}</Link>
                      {row.email ? <p className="mt-0.5 text-xs text-foreground-500">{row.email}</p> : null}
                    </td>
                    {businessId ? null : <td><Link to={`/admin/businesses/${row.businessId}`} className="text-foreground-800 hover:text-primary-700">{row.businessName}</Link></td>}
                    <td>{row.agentId ? <Link to={`/admin/agents/${row.agentId}`} className="text-foreground-800 hover:text-primary-700">{row.agentName}</Link> : <span className="text-xs text-foreground-500">Not assigned</span>}</td>
                    <td>
                      <p className="mb-1 text-xs font-semibold text-foreground-900">{row.applications} application{row.applications === 1 ? "" : "s"}</p>
                      <ApplicationStatusPills counts={row.statusCounts} />
                    </td>
                    <td className="text-xs text-foreground-600">{formatDate(row.lastUpdated)}</td>
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
