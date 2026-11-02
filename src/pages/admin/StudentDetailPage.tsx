import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, PageHeader } from "@/pages/admin/components/ui";
import { AgencyStatusBadge, ApplicationStatusPills } from "@/pages/admin/components/AgencyStatus";
import ApplicationsList from "@/pages/admin/components/ApplicationsList";
import { ListMessage } from "@/pages/admin/components/ListControls";
import { getStudent, type StudentDetail } from "@/pages/admin/lib/businessData";
import { formatDate } from "@/pages/agency/lib/portalData";

/** Agencies > Students > {name}: every application this student has, across statuses. */
export default function StudentDetailPage() {
  const { id = "" } = useParams();
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setState("loading");
    getStudent(id).then((s) => { if (active) { setStudent(s); setState(s ? "ready" : "missing"); } })
      .catch((e) => { if (active) { setError(e instanceof Error ? e.message : "We could not load this student."); setState("error"); } });
    return () => { active = false; };
  }, [id]);

  if (state === "loading") return <p className="p-6 text-sm text-foreground-600">Loading student&hellip;</p>;
  if (!student) {
    return (
      <div>
        <PageHeader title="Student not found" />
        <p role="alert" className="text-sm text-red-700">{state === "error" ? error : "This student could not be found."}</p>
        <Link to="/admin/students" className="mt-3 inline-block text-sm font-semibold text-primary-700 underline">Back to Students</Link>
      </div>
    );
  }

  const counts: Record<string, number> = {};
  for (const a of student.applications) counts[a.status] = (counts[a.status] ?? 0) + 1;
  const agents = [...new Map(student.applications.filter((a) => a.agentId).map((a) => [a.agentId as string, a.agentName])).entries()];

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap gap-1.5 text-sm text-foreground-600">
        <Link to="/admin/businesses" className="hover:text-foreground-900">Businesses</Link><span aria-hidden="true">/</span>
        <Link to={`/admin/businesses/${student.business.id}`} className="hover:text-foreground-900">{student.business.name}</Link><span aria-hidden="true">/</span>
        <span className="text-foreground-900">Student</span>
      </nav>
      <PageHeader title={student.name || "Unnamed student"}
        description={`Student of ${student.business.name}${agents.length ? `, handled by ${agents.map(([, n]) => n).join(" and ")}` : ""}.`} />

      <div className="flex flex-wrap items-start gap-5">
        <Card className="min-w-0 flex-[999_1_560px]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-background-200 px-4 py-3">
            <h2 className="font-heading text-base font-semibold text-foreground-900">Applications <span className="font-normal text-foreground-500">{student.applications.length}</span></h2>
            <ApplicationStatusPills counts={counts} />
          </div>
          {student.applications.length ? <ApplicationsList rows={student.applications} showAgent />
            : <ListMessage icon="ri-file-list-3-line" title="No applications" text="This student has no applications yet." />}
        </Card>
        <Card className="flex-[1_1_260px] p-5">
          <h2 className="mb-3 font-heading text-[15px] font-semibold text-foreground-900">Student details</h2>
          <dl className="space-y-3 text-sm">
            <Row label="Email" value={student.email} />
            <Row label="Phone" value={student.phone} />
            <Row label="Date of birth" value={student.dateOfBirth ? formatDate(student.dateOfBirth) : ""} />
            <div><dt className="text-xs text-foreground-500">Business</dt><dd className="flex flex-wrap items-center gap-2"><Link to={`/admin/businesses/${student.business.id}`} className="text-foreground-900 hover:text-primary-700">{student.business.name}</Link><AgencyStatusBadge status={student.business.status} /></dd></div>
            <div><dt className="text-xs text-foreground-500">Agent</dt><dd>{agents.length ? agents.map(([aid, n]) => <Link key={aid} to={`/admin/agents/${aid}`} className="mr-2 text-foreground-900 hover:text-primary-700">{n}</Link>) : <span className="text-foreground-500">Not assigned</span>}</dd></div>
            <Row label="First recorded" value={formatDate(student.createdAt)} />
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-foreground-500">{label}</dt><dd className={value ? "text-foreground-900" : "text-foreground-500"}>{value || "Not recorded"}</dd></div>;
}
