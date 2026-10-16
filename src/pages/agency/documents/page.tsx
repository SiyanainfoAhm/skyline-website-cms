import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeading, PortalError, PortalLoading } from "@/pages/agency/components/PortalUI";
import { listApplicationDocuments, listApplications, type ApplicationListRow, type DocumentRow } from "@/pages/agency/lib/portalApplications";

export default function PortalDocumentsPage() {
  const [apps, setApps] = useState<ApplicationListRow[]>([]);
  const [docs, setDocs] = useState<Array<DocumentRow & { application: ApplicationListRow }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const applications = await listApplications();
      const perApplication = await Promise.all(applications.map(async (application) => (await listApplicationDocuments(application.id)).map((doc) => ({ ...doc, application }))));
      setApps(applications); setDocs(perApplication.flat());
    } catch (e) { setError(e instanceof Error ? e.message : "We could not load authorised documents."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div>
      <PageHeading
        eyebrow="Documents"
        title="Documents"
        description="Supporting documents, held against each student application and secured by the same access rules."
      />
      <div className="mt-6">
        {loading ? <PortalLoading label="Loading authorised documents…" /> : null}
        {error ? <PortalError message={error} /> : null}
        {!loading && !error && docs.length === 0 ? <div className="rounded-card border border-dashed border-background-300 p-6 text-sm text-foreground-600">No documents are attached to the {apps.length} application{apps.length === 1 ? "" : "s"} you can access.</div> : null}
        {!loading && !error && docs.length > 0 ? <div className="overflow-x-auto rounded-card border border-background-200 bg-background-50"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-background-100 text-xs uppercase tracking-wide text-foreground-700"><tr><th className="px-4 py-3">Application</th><th className="px-4 py-3">Document</th><th className="px-4 py-3">Extraction</th><th className="px-4 py-3">Lifecycle</th></tr></thead><tbody>{docs.map((doc) => <tr key={doc.id} className="border-t border-background-200"><td className="px-4 py-3"><Link className="font-semibold text-primary-700 hover:underline" to={`/agency/applications/${doc.application.id}`}>{doc.application.reference || "Open application"}</Link></td><td className="px-4 py-3"><p className="font-medium">{doc.filename}</p><p className="text-xs text-foreground-500">{doc.category}</p></td><td className="px-4 py-3 text-xs">{String((doc.metadata.extraction as { status?: string } | undefined)?.status ?? "Not requested")}</td><td className="px-4 py-3 text-xs"><Link className="font-semibold text-primary-700 hover:underline" to={`/agency/applications/${doc.application.id}`}>Preview, review or delete</Link></td></tr>)}</tbody></table></div> : null}
      </div>
    </div>
  );
}
