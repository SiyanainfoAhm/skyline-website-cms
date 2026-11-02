import ResponsiveTable from "@/components/ui/ResponsiveTable";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Card, ConfirmDialog, PageHeader } from "@/pages/admin/components/ui";
import { AgencyStatusBadge, ApplicationStatusPills } from "@/pages/admin/components/AgencyStatus";
import { ListMessage, SearchBox } from "@/pages/admin/components/ListControls";
import StudentsTable from "@/pages/admin/components/StudentsTable";
import { useToast } from "@/pages/admin/components/toastContext";
import { AgentsTab, ApplicationsTab, DetailsTab } from "@/pages/admin/AgencyDetailPage";
import {
  getBusiness, linkAgencyToBusiness, listBusinessAgents, listBusinesses, setBusinessStatus,
  type BusinessDetail, type BusinessRow, type BusinessStatus, type OmaraAgentRow,
} from "@/pages/admin/lib/businessData";
import { formatDate, getAgency, type AgencySummary } from "@/pages/agency/lib/portalData";

type Tab = "details" | "omara" | "team" | "students" | "applications";
const TAB_IDS: Tab[] = ["details", "omara", "team", "students", "applications"];

/** Agencies > Businesses > {name}. The tab lives in the URL so links such as "2 Draft" open the right view. */
export default function BusinessDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") as Tab | null;
  const { push } = useToast();
  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const found = await getBusiness(id);
      setBusiness(found);
      if (!found) setError("This business could not be found.");
    } catch (e) {
      setBusiness(null);
      setError(e instanceof Error ? e.message : "We could not load this business.");
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { setBusiness(null); void load(); }, [load]);

  const change = async (next: BusinessStatus) => {
    if (!business) return;
    setBusy(true);
    try {
      const result = await setBusinessStatus(business.id, next);
      push(next === "Inactive" ? `${business.name} deactivated. Its people can no longer sign in.`
        : result.workspaceCreated ? `${business.name} activated and its workspace created. Invite its first admin in Portal team.` : `${business.name} activated.`);
      await load();
      if (result.workspaceCreated) setParams({ tab: "team" });
    } catch (e) {
      push(e instanceof Error ? e.message : "We could not change this business’s status.", "error");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  if (loading && !business) return <p className="p-6 text-sm text-foreground-600">Loading business&hellip;</p>;
  if (!business) {
    return (
      <div>
        <PageHeader title="Business not found" />
        <p role="alert" className="text-sm text-red-700">{error || "This business could not be found."}</p>
        <Link to="/admin/businesses" className="mt-3 inline-block text-sm font-semibold text-primary-700 underline">Back to Businesses</Link>
      </div>
    );
  }

  const tab: Tab = requested && TAB_IDS.includes(requested) ? requested : "details";
  const agency = business.agency;
  const c = business.counts;
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "details", label: "Details" },
    { id: "omara", label: "OMARA agents", count: c.omaraAgents },
    { id: "team", label: "Portal team", count: c.admins + c.agents },
    { id: "students", label: "Students", count: c.students },
    { id: "applications", label: "Applications", count: c.applications },
  ];
  const place = business.directoryContact.place || agency?.address || "";

  return (
    <div>
      <Link to="/admin/businesses" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-foreground-600 hover:text-foreground-900">
        <i className="ri-arrow-left-line" aria-hidden="true" /> Businesses
      </Link>
      <PageHeader
        title={business.name}
        description={[agency?.code, place, business.source === "omara" ? "Imported from OMARA" : "Added by SLIT",
          agency ? `workspace since ${formatDate(agency.createdAt)}` : "no workspace yet"].filter(Boolean).join(", ")}
        actions={
          <>
            <AgencyStatusBadge status={business.status} />
            {business.status === "Active"
              ? <Button variant="outline" disabled={busy} onClick={() => setConfirm(true)}>Deactivate business</Button>
              : <Button disabled={busy} onClick={() => void change("Active")}>{busy ? "Activating…" : agency ? "Activate business" : "Activate and create workspace"}</Button>}
          </>
        }
      />

      {business.status !== "Active" ? (
        <p role="status" className="-mt-2 mb-5 rounded-md border border-background-300 bg-background-100 px-4 py-3 text-sm text-foreground-700">
          {agency ? "This business is inactive. Its administrators and agents cannot sign in until you activate it."
            : "This business has no workspace yet. Activating it creates the workspace; then invite its first administrator in Portal team."}
        </p>
      ) : null}

      {business.source === "manual" && agency ? <LinkToDirectory agencyId={agency.id} name={business.name} onLinked={(to) => navigate(`/admin/businesses/${to}`, { replace: true })} /> : null}

      <nav className="mb-5 flex flex-wrap gap-1 border-b border-background-200" aria-label="Business sections">
        {tabs.map((item) => (
          <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} onClick={() => setParams(item.id === "details" ? {} : { tab: item.id })}
            className={`-mb-px cursor-pointer border-b-2 px-4 py-2.5 text-sm font-medium ${tab === item.id ? "border-primary-500 text-primary-700" : "border-transparent text-foreground-600 hover:text-foreground-900"}`}>
            {item.label}
            {item.count !== undefined ? <span className="ml-1.5 rounded-full bg-background-200 px-1.5 py-0.5 text-[11px] tabular-nums text-foreground-700">{item.count}</span> : null}
            {item.id === "team" && agency && c.admins === 0 ? <span className="ml-1.5 text-[11px] font-medium text-amber-700">no admin</span> : null}
            {item.id === "omara" && c.omaraEnded ? <span className="ml-1.5 text-[11px] font-medium text-amber-700">{c.omaraEnded} left</span> : null}
          </button>
        ))}
      </nav>

      {tab === "details" ? <DetailsSection business={business} onSaved={load} /> : null}
      {tab === "omara" ? <OmaraAgentsSection businessId={business.id} /> : null}
      {tab === "team" ? (agency
        ? <AgentsTab key={agency.id} agencyId={agency.id} agencyName={agency.name} onChanged={load} />
        : <NoWorkspace onActivate={() => void change("Active")} busy={busy} />) : null}
      {tab === "students" ? (agency ? <StudentsTable businessId={business.id} emptyText="Students appear here when this business’s agents start an application." /> : <NoWorkspace onActivate={() => void change("Active")} busy={busy} />) : null}
      {tab === "applications" ? (agency
        ? <ApplicationsTab key={`${agency.id}:${params.get("status") ?? ""}`} agencyId={agency.id} initialStatus={params.get("status") ?? ""} />
        : <NoWorkspace onActivate={() => void change("Active")} busy={busy} />) : null}

      <ConfirmDialog
        open={confirm}
        title={`Deactivate ${business.name}?`}
        message={`Its ${c.admins + c.agents} portal user${c.admins + c.agents === 1 ? "" : "s"} will not be able to sign in. Students, applications and history are kept, and you can activate it again at any time.`}
        confirmLabel={busy ? "Deactivating…" : "Deactivate business"}
        onConfirm={() => { if (!busy) void change("Inactive"); }}
        onCancel={() => { if (!busy) setConfirm(false); }}
      />
    </div>
  );
}

function NoWorkspace({ onActivate, busy }: { onActivate: () => void; busy: boolean }) {
  return (
    <Card>
      <ListMessage icon="ri-building-line" title="No workspace yet" text="Activate this business to create its workspace. Its team, students and applications appear here afterwards."
        action={<Button disabled={busy} onClick={onActivate}>{busy ? "Activating…" : "Activate and create workspace"}</Button>} />
    </Card>
  );
}

function DetailsSection({ business, onSaved }: { business: BusinessDetail; onSaved: () => Promise<void> }) {
  const [agency, setAgency] = useState<AgencySummary | null>(null);
  const agencyId = business.agency?.id ?? "";
  useEffect(() => {
    if (!agencyId) return;
    let active = true;
    void getAgency(agencyId).then((found) => { if (active) setAgency(found); }).catch(() => { if (active) setAgency(null); });
    return () => { active = false; };
  }, [agencyId]);
  const d = business.directoryContact;
  const reg = business.registration;
  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="min-w-0 flex-[999_1_520px]">
        {agencyId ? (agency ? <DetailsTab key={agency.id} agency={agency} onSaved={onSaved} /> : <p className="text-sm text-foreground-600">Loading details&hellip;</p>) : (
          <Card className="p-5 text-sm text-foreground-700">
            <p>These details come from the OMARA register. Activate the business to create its workspace; you can then edit the business email, phone and registration.</p>
          </Card>
        )}
      </div>
      <Card className="flex-[1_1_260px] p-5">
        <h2 className="mb-3 font-heading text-[15px] font-semibold text-foreground-900">From the OMARA register</h2>
        {business.source === "manual" && !d.name ? <p className="text-sm text-foreground-600">Not linked to the OMARA register.</p> : (
          <dl className="space-y-3 text-sm">
            <Item label="Listed contact" value={d.name} />
            <Item label="Email" value={d.email} />
            <Item label="Phone" value={d.phone} />
            <Item label="Address" value={d.address || d.place} />
            <Item label="Website" value={d.website} />
            <Item label="Registration" value={reg.number ? `${reg.type ?? ""} ${reg.number}`.trim() : ""} fallback="Not verified" />
          </dl>
        )}
      </Card>
    </div>
  );
}

function Item({ label, value, fallback = "Not listed" }: { label: string; value: string; fallback?: string }) {
  return (
    <div>
      <dt className="text-xs text-foreground-500">{label}</dt>
      <dd className={value ? "text-foreground-900" : "text-foreground-500"}>{value || fallback}</dd>
    </div>
  );
}

function OmaraAgentsSection({ businessId }: { businessId: string }) {
  const [rows, setRows] = useState<OmaraAgentRow[] | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    listBusinessAgents(businessId).then((r) => { if (active) setRows(r); }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "We could not load agents."); });
    return () => { active = false; };
  }, [businessId, reload]);
  return (
    <Card>
      <p className="border-b border-background-200 px-4 py-3 text-sm text-foreground-600">Registered migration agents the OMARA register lists for this business. Link an agent’s portal login to their MARN from the agent’s page.</p>
      {error ? <ListMessage icon="ri-error-warning-line" title="Agents did not load" text={error} action={<Button size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}>Try again</Button>} />
        : rows === null ? <p className="p-6 text-sm text-foreground-500">Loading agents…</p>
        : rows.length === 0 ? <ListMessage icon="ri-team-line" title="No OMARA agents" text="The OMARA register lists no agents for this business." /> : (
          <ResponsiveTable>
            <thead>
              <tr>
                <th className="w-[24%]">Agent</th>
                <th className="w-[12%]">MARN</th>
                <th className="w-[14%]">OMARA</th>
                <th className="w-[20%]">Portal login</th>
                <th className="w-[9%]">Students</th>
                <th className="w-[21%]">Applications</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ended = r.relationship === "ended";
                return (
                  <tr key={r.omaraId} className={ended ? "opacity-70" : ""}>
                    <td>
                      {r.profile ? <Link to={`/admin/agents/${r.profile.id}`} className="font-semibold text-foreground-900 hover:text-primary-700">{r.name}</Link> : <span className="font-semibold text-foreground-900">{r.name}</span>}
                      <p className="mt-0.5 text-xs text-foreground-500">{ended ? `Left this business ${formatDate(r.endedAt)}` : r.place || r.email || ""}</p>
                    </td>
                    <td className="tabular-nums">{r.marn}</td>
                    <td>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ended || !r.registered ? "bg-background-200 text-foreground-600" : "bg-emerald-50 text-emerald-800"}`}>
                        {ended ? "Ended" : r.registered ? "Registered" : "Not registered"}
                      </span>
                    </td>
                    <td>
                      {r.profile ? (
                        <>
                          <Link to={`/admin/agents/${r.profile.id}`} className="inline-flex items-center gap-1 font-medium text-emerald-800 hover:text-primary-700"><i className="ri-check-line" aria-hidden="true" />{r.profile.name}</Link>
                          <p className="text-xs text-foreground-500">{r.profile.role === "agency_admin" ? "Agency admin" : "Agent"}, {r.profile.status.toLowerCase()}</p>
                        </>
                      ) : <span className="text-xs text-foreground-500">No login linked</span>}
                    </td>
                    <td>{r.profile ? <b className="text-foreground-900">{r.students}</b> : <span className="text-xs text-foreground-500">None</span>}</td>
                    <td>{Object.keys(r.statusCounts).length ? <ApplicationStatusPills counts={r.statusCounts} /> : <span className="text-xs text-foreground-500">None</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </ResponsiveTable>
        )}
    </Card>
  );
}

/** For an agency added before the OMARA import: find its directory record and link it, so both become one business. */
function LinkToDirectory({ agencyId, name, onLinked }: { agencyId: string; name: string; onLinked: (businessId: string) => void }) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(name);
  const [rows, setRows] = useState<BusinessRow[] | null>(null);
  const [pick, setPick] = useState<BusinessRow | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setRows(null);
    listBusinesses({ search, source: "omara", workspace: "no", limit: 6, offset: 0 })
      .then((r) => { if (active) setRows(r.rows); }).catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [open, search]);
  const link = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await linkAgencyToBusiness(agencyId, pick.id);
      push(`Linked to the OMARA record for ${pick.name}.`);
      onLinked(pick.id);
    } catch (e) {
      push(e instanceof Error ? e.message : "We could not link these records.", "error");
    } finally {
      setBusy(false);
      setPick(null);
    }
  };
  return (
    <Card className="mb-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-foreground-700"><b className="text-foreground-900">Not linked to the OMARA register.</b> If this business is listed there, link it to see its registered agents.</p>
        {!open ? <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Find in OMARA</Button> : null}
      </div>
      {open ? (
        <div className="mt-3 space-y-3">
          <SearchBox label="Search the OMARA register" value={search} onSearch={setSearch} placeholder="Business or agent name, or MARN" />
          {rows === null ? <p className="text-sm text-foreground-500">Searching…</p> : rows.length === 0 ? <p className="text-sm text-foreground-600">No unlinked OMARA business matches. Try fewer words.</p> : (
            <ul className="divide-y divide-background-200 rounded-md border border-background-200">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <span><b className="text-foreground-900">{r.name}</b> <span className="text-xs text-foreground-500">{[r.place, `${r.omaraAgents} registered agent${r.omaraAgents === 1 ? "" : "s"}`].filter(Boolean).join(", ")}</span></span>
                  <Button size="sm" variant="secondary" onClick={() => setPick(r)}>Link</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      <ConfirmDialog open={Boolean(pick)} title={`Link to ${pick?.name ?? "this business"}?`}
        message={`${name} and its workspace will use this OMARA record from now on. Only link it if it is the same business.`}
        confirmLabel={busy ? "Linking…" : "Link records"} onConfirm={() => { if (!busy) void link(); }} onCancel={() => { if (!busy) setPick(null); }} />
    </Card>
  );
}
