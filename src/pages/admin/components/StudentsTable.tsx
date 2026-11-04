import ResponsiveTable from "@/components/ui/ResponsiveTable";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Select } from "@/pages/admin/components/ui";
import { ApplicationStatusPills } from "@/pages/admin/components/AgencyStatus";
import { ListMessage, Pager, SearchBox } from "@/pages/admin/components/ListControls";
import { listStudents, type StudentRow } from "@/pages/admin/lib/businessData";
import { formatDate } from "@/pages/agency/lib/portalData";
import { useStatusCatalog } from "@/pages/agency/lib/statusCatalog";
import ApplicationStatusSelect from "@/pages/agency/components/ApplicationStatusSelect";
import { formatPhone } from "../../../../supabase/functions/_shared/validation/identifiers";

// Up to 100 students load per page and are sorted on this device (like the Agents list).
const PAGE_SIZE = 100;
type SortKey = "student" | "business" | "agent" | "applications" | "activity";
const text = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

function compareStudents(a: StudentRow, b: StudentRow, key: SortKey): number {
  // Students without a name yet sort after named ones.
  const byName = text(a.name || "￿").localeCompare(text(b.name || "￿")) || text(a.email).localeCompare(text(b.email));
  switch (key) {
    case "student": return byName;
    case "business": return text(a.businessName).localeCompare(text(b.businessName)) || byName;
    case "agent": return text(a.agentName || "￿").localeCompare(text(b.agentName || "￿")) || byName;
    case "applications": return a.applications - b.applications || byName;
    case "activity": return (a.lastUpdated ?? "").localeCompare(b.lastUpdated ?? "") || byName;
  }
}

/**
 * Students: who they are (name, email, mobile, passport), their business and agent, and each of their applications with
 * its course, intake and a status that can be changed in place. With `businessId`, only that business's students and no
 * business column; with `agentId`, one agent's.
 */
export default function StudentsTable({ businessId, agentId, emptyText }: { businessId?: string; agentId?: string; emptyText?: string }) {
  const statusCatalog = useStatusCatalog();
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
    listStudents({ search, status, businessId: businessId ?? null, agentId: agentId ?? null, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((result) => { if (active) { setRows(result.rows); setTotal(result.total); setLoaded(true); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "We could not load students."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, status, businessId, agentId, page, reload]);

  // No sort chosen: the server's order (latest activity first).
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const out = [...rows].sort((a, b) => compareStudents(a, b, sort.key));
    return sort.dir === "desc" ? out.reverse() : out;
  }, [rows, sort]);
  const toggleSort = (key: SortKey) => setSort((prev) => ({ key, dir: prev?.key === key && prev.dir === "asc" ? "desc" : "asc" }));
  const sortHeader = (key: SortKey, label: string, className: string) => (
    <th className={className} aria-sort={sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 hover:text-foreground-900">
        {label}
        <i aria-hidden="true" className={sort?.key === key ? (sort.dir === "asc" ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line") : "ri-arrow-up-down-line text-foreground-400"} />
      </button>
    </th>
  );

  const filtered = Boolean(search || status);
  const columns = businessId ? 4 : 5;
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="flex-1"><SearchBox label="Search students" value={search} onSearch={(v) => { setSearch(v); setPage(1); }}
          placeholder={businessId ? "Search name, email, mobile, passport, agent or application reference" : "Search name, email, mobile, passport, business, agent or application reference"} /></div>
        <Select aria-label="Has an application in status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-56">
          <option value="">Any application status</option>
          {statusCatalog.application.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      </div>
      <Card>
        {error ? (
          <ListMessage icon="ri-error-warning-line" title="Students did not load" text={error}
            action={<Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>Try again</Button>} />
        ) : loaded && !loading && rows.length === 0 ? (
          <ListMessage icon="ri-user-line" title={filtered ? "No students match" : "No students yet"}
            text={filtered ? "Check the spelling or choose another status." : emptyText ?? "Students appear here when an agent adds them."} />
        ) : (
          <div className={loading && loaded ? "opacity-60 transition-opacity" : ""}>
            <ResponsiveTable aria-busy={loading}>
              <thead>
                <tr>
                  {sortHeader("student", "Student", businessId ? "w-[30%]" : "w-[26%]")}
                  {businessId ? null : sortHeader("business", "Business", "w-[16%]")}
                  {sortHeader("agent", "Agent", "w-[14%]")}
                  {sortHeader("applications", "Applications", "w-[34%]")}
                  {sortHeader("activity", "Last activity", "w-[10%]")}
                </tr>
              </thead>
              <tbody>
                {!loaded ? <tr><td colSpan={columns} className="py-10 text-center text-foreground-500">Loading students…</td></tr> : sorted.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td>
                      <Link to={`/admin/students/${row.id}`} className="font-semibold text-foreground-900 hover:text-primary-700">
                        {row.name || <span className="italic text-foreground-500">Name not read from passport yet</span>}
                      </Link>
                      <p className="mt-0.5 text-xs text-foreground-600">{row.email || "No email"}</p>
                      {row.phone ? <p className="text-xs text-foreground-600">{formatPhone(row.phone)}</p> : null}
                      {row.passportNumber || row.nationality ? (
                        <p className="text-xs text-foreground-500">{[row.passportNumber ? `Passport ${row.passportNumber}` : "", row.nationality ?? ""].filter(Boolean).join(" · ")}</p>
                      ) : null}
                    </td>
                    {businessId ? null : <td><Link to={`/admin/businesses/${row.businessId}`} className="text-foreground-800 hover:text-primary-700">{row.businessName}</Link></td>}
                    <td>{row.agentId ? <Link to={`/admin/agents/${row.agentId}`} className="text-foreground-800 hover:text-primary-700">{row.agentName}</Link> : <span className="text-xs text-foreground-500">Not assigned</span>}</td>
                    <td>
                      {row.applicationRows ? (
                        row.applicationRows.length === 0 ? <span className="text-xs text-foreground-500">No applications</span> : (
                          <ul className="space-y-2">
                            {row.applicationRows.map((application) => (
                              <li key={application.id} className="flex flex-wrap items-center justify-between gap-2">
                                <span className="min-w-0 text-xs">
                                  <Link to={`/admin/applications/${application.id}`} className="font-semibold text-foreground-900 hover:text-primary-700">{application.reference || "Draft"}</Link>
                                  <span className="block text-foreground-600">{[application.course || "No course yet", application.intake ? `Intake ${application.intake}` : "", `${application.completion}%`].filter(Boolean).join(" · ")}</span>
                                </span>
                                <ApplicationStatusSelect applicationId={application.id} status={application.status} openHref={`/admin/applications/${application.id}`} />
                              </li>
                            ))}
                          </ul>
                        )
                      ) : (
                        <>
                          <p className="mb-1 text-xs font-semibold text-foreground-900">{row.applications} application{row.applications === 1 ? "" : "s"}</p>
                          <ApplicationStatusPills counts={row.statusCounts} />
                        </>
                      )}
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
