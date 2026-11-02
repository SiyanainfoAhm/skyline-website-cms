import { PageHeader } from "@/pages/admin/components/ui";
import StudentsTable from "@/pages/admin/components/StudentsTable";

/** Agencies > Students: every student across businesses, with their applications by status. */
export default function StudentsPage() {
  return (
    <div>
      <PageHeader title="Students" description="Every student an agency has started an application for. Open a student to see all of their applications." />
      <StudentsTable />
    </div>
  );
}
