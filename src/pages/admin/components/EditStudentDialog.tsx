import { useEffect, useState } from "react";
import { Button, Field, Modal, Select, TextInput } from "@/pages/admin/components/ui";
import { useToast } from "@/pages/admin/components/toastContext";
import { updateStudent, type StudentRow } from "@/pages/admin/lib/businessData";
import { listAgentsOfBusiness, type BusinessAgentOption } from "@/pages/agency/lib/portalApplications";
import { PhoneInput } from "@/components/feature/applicationInputs";
import { validateEmail } from "@/pages/agency/lib/userValidation";
import { parseStoredPhone, validateStoredPhone } from "../../../../supabase/functions/_shared/validation/identifiers";

/** Edit a student's details: name, email, mobile, date of birth, passport, nationality and agent. */
export default function EditStudentDialog({ student, onClose, onSaved }: { student: StudentRow | null; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [passportNumber, setPassportNumber] = useState("");
  const [nationality, setNationality] = useState("");
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<BusinessAgentOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!student) return;
    setFullName(student.name ?? "");
    setEmail(student.email ?? "");
    setMobile(student.phone ?? "");
    setDateOfBirth(student.dateOfBirth ? String(student.dateOfBirth).slice(0, 10) : "");
    setPassportNumber(student.passportNumber ?? "");
    setNationality(student.nationality ?? "");
    setAgentId(student.agentId ?? "");
    setError("");
    let active = true;
    void listAgentsOfBusiness(student.businessId).then((list) => { if (active) setAgents(list); }).catch(() => { if (active) setAgents([]); });
    return () => { active = false; };
  }, [student]);

  const save = async () => {
    if (!student) return;
    setError("");
    const cleanEmail = email.trim().toLowerCase();
    const emailProblem = validateEmail(cleanEmail);
    if (emailProblem) { setError(emailProblem); return; }
    if (!parseStoredPhone(mobile)?.national) { setError("Enter the student's mobile number."); return; }
    const phoneProblem = validateStoredPhone(mobile);
    if (phoneProblem) { setError(phoneProblem); return; }
    setBusy(true);
    try {
      await updateStudent(student.id, {
        fullName: fullName.trim(), email: cleanEmail, mobile: mobile.trim(), dateOfBirth, passportNumber: passportNumber.trim(),
        nationality: nationality.trim(), agentId: agentId || null,
      });
      push(`${fullName.trim() || cleanEmail} saved.`);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not save this student.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={Boolean(student)} onClose={() => { if (!busy) onClose(); }} width="max-w-xl" title="Edit student"
      footer={<>
        <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save student"}</Button>
      </>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Full name" hint="As shown in the passport. The last word is saved as the surname.">
            <TextInput value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={200} />
          </Field>
        </div>
        <Field label="Email" required><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} /></Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-foreground-800">Mobile <span className="text-primary-600">*</span></p>
          <div onInput={(e) => { const target = e.target as HTMLInputElement; if (target.name === "student_mobile") setMobile(target.value); }}>
            <PhoneInput key={student?.id ?? "none"} id="edit-student-mobile" name="student_mobile" value={mobile} required locked={busy} placeholder="041 234 5678" />
          </div>
        </div>
        <Field label="Date of birth"><TextInput type="date" value={dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDateOfBirth(e.target.value)} /></Field>
        <Field label="Passport number"><TextInput value={passportNumber} onChange={(e) => setPassportNumber(e.target.value.toUpperCase())} maxLength={40} /></Field>
        <Field label="Nationality"><TextInput value={nationality} onChange={(e) => setNationality(e.target.value)} maxLength={100} /></Field>
        <Field label="Agent">
          <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agentId && !agents.some((a) => a.id === agentId) ? <option value={agentId}>{student?.agentName || "Current agent"}</option> : null}
            {!agentId ? <option value="">Not assigned</option> : null}
            {/* Only active agents can be chosen; the current one stays listed. */}
            {agents.filter((a) => a.status === "Active" || a.id === agentId).map((a) => <option key={a.id} value={a.id}>{a.name}{a.status !== "Active" ? ` (${a.status})` : ""}</option>)}
          </Select>
        </Field>
        {error ? <p role="alert" className="sm:col-span-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      </div>
    </Modal>
  );
}
