import { useState } from "react";
import { Button, PageHeader } from "@/pages/admin/components/ui";
import StudentsTable from "@/pages/admin/components/StudentsTable";
import AddStudentDialog from "@/pages/admin/components/AddStudentDialog";

/** Agencies > Students: every student across businesses, with their applications by status. */
export default function StudentsPage() {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <PageHeader title="Students" description="Every student an agency has started an application for. Open a student to see all of their applications."
        actions={<Button icon="ri-user-add-line" onClick={() => setAdding(true)}>Add student</Button>} />
      <StudentsTable />
      <AddStudentDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
