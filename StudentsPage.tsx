import { Link } from "react-router-dom";
import { Button, PageHeader } from "@/pages/admin/components/ui";
import StudentsTable from "@/pages/admin/components/StudentsTable";

/** Agencies > Students: every student across businesses, with their applications by status. */
export default function StudentsPage() {
  return (
    <div>
      <PageHeader title="Students" description="Every student with an application. Open one to see all of their applications."
        actions={<Link to="/admin/applications/new"><Button icon="ri-user-add-line">Add student</Button></Link>} />
      <StudentsTable />
    </div>
  );
}
