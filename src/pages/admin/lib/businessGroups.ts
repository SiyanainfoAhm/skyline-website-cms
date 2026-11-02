import type { ApplicationRow } from "./businessData";

/** Applications grouped by student, in the order each student first appears (newest activity first). */
export function groupByStudent(applications: ApplicationRow[], students: Array<{ id: string; name: string; email: string }>) {
  const byId = new Map(students.map((s) => [s.id, s]));
  const groups = new Map<string, { student: { id: string; name: string; email: string }; applications: ApplicationRow[] }>();
  for (const application of applications) {
    const student = byId.get(application.studentId) ?? { id: application.studentId, name: "Student", email: "" };
    const group = groups.get(student.id) ?? { student, applications: [] };
    group.applications.push(application);
    groups.set(student.id, group);
  }
  return [...groups.values()];
}
