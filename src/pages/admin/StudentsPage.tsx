import { useState } from "react";
import { Button, PageHeader } from "@/pages/admin/components/ui";
import StudentsTable from "@/pages/admin/components/StudentsTable";
import AddStudentDialog from "@/pages/admin/components/AddStudentDialog";

/** Agencies > Students: every student across businesses, with their applications by status. */
export default function StudentsPage() {
  const [adding, setAdding] = useState(false);
  const [refresh, setRefresh] = useState(0);
  return (
    <div>
      <PageHeader title="Students" description="Every student, with their business and agent. Add a student here; start their applications from Applications."
        actions={<Button icon="ri-user-add-line" onClick={() => setAdding(true)}>Add student</Button>} />
      <StudentsTable refreshKey={refresh} />
      <AddStudentDialog open={adding} onClose={() => setAdding(false)} onAdded={() => setRefresh((n) => n + 1)} />
    </div>
  );
}
