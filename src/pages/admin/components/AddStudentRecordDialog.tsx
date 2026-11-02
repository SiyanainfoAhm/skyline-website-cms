import { useEffect, useRef, useState } from "react";
import { Button, Field, Modal, Select, TextInput } from "@/pages/admin/components/ui";
import AgencyForm from "@/pages/admin/components/AgencyForm";
import {
  EMPTY_AGENCY_FORM, suggestAgencyCode, validateAgencyForm,
  type AgencyFormErrors, type AgencyFormState,
} from "@/pages/admin/lib/agencyForm";
import { validateEmail, validateName } from "@/pages/agency/lib/userValidation";

export interface NewStudentAgent {
  name: string;
  email: string;
  role: "agent" | "agency_admin";
}

export type AddStudentRecordValue =
  | { kind: "business"; business: AgencyFormState; agent: NewStudentAgent }
  | { kind: "agent"; agent: NewStudentAgent };

export default function AddStudentRecordDialog({
  mode,
  initialBusinessName,
  initialAgentName,
  onCancel,
  onSave,
}: {
  mode: "business" | "agent" | null;
  initialBusinessName: string;
  initialAgentName: string;
  onCancel: () => void;
  onSave: (value: AddStudentRecordValue) => void;
}) {
  const [business, setBusiness] = useState<AgencyFormState>(EMPTY_AGENCY_FORM);
  const [businessErrors, setBusinessErrors] = useState<AgencyFormErrors>({});
  const [agentName, setAgentName] = useState("");
  const [agentEmail, setAgentEmail] = useState("");
  const [agentRole, setAgentRole] = useState<NewStudentAgent["role"]>("agent");
  const [agentErrors, setAgentErrors] = useState<{ name?: string; email?: string }>({});
  const codeSuffix = useRef(Math.floor(100 + Math.random() * 900));

  useEffect(() => {
    if (!mode) return;
    setBusinessErrors({});
    setAgentErrors({});
    setAgentName(initialAgentName);
    setAgentEmail("");
    setAgentRole("agent");
    if (mode === "business") {
      codeSuffix.current = Math.floor(100 + Math.random() * 900);
      const name = initialBusinessName.trim();
      setBusiness({ ...EMPTY_AGENCY_FORM, name, code: name ? suggestAgencyCode(name, codeSuffix.current) : "" });
    }
  }, [mode, initialBusinessName, initialAgentName]);

  const patchBusiness = (patch: Partial<AgencyFormState>) => setBusiness((previous) => {
    const merged = { ...previous, ...patch };
    if (patch.name !== undefined && (!previous.code || previous.code === suggestAgencyCode(previous.name, codeSuffix.current))) {
      merged.code = patch.name.trim() ? suggestAgencyCode(patch.name, codeSuffix.current) : "";
    }
    return merged;
  });

  const save = () => {
    const nameError = validateName(agentName);
    const emailError = validateEmail(agentEmail.trim());
    setAgentErrors({ name: nameError, email: emailError });
    if (nameError || emailError) return;

    const agent: NewStudentAgent = {
      name: agentName.trim(), email: agentEmail.trim().toLowerCase(), role: agentRole,
    };
    if (mode === "business") {
      const checked = validateAgencyForm(business);
      setBusinessErrors(checked.errors);
      if (Object.keys(checked.errors).length) return;
      onSave({ kind: "business", business: { ...business, phone: checked.phone }, agent });
    } else if (mode === "agent") {
      onSave({ kind: "agent", agent });
    }
  };

  return (
    <Modal
      open={mode !== null}
      title={mode === "business" ? "Add business and first portal team member" : "Add portal team member"}
      onClose={onCancel}
      width="max-w-3xl"
      footer={<>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={save}>{mode === "business" ? "Use business and team member" : "Use team member"}</Button>
      </>}
    >
      <div className="space-y-5">
        {mode === "business" ? (
          <section>
            <h3 className="mb-3 text-sm font-semibold text-foreground-900">Business details</h3>
            <AgencyForm value={business} errors={businessErrors} onChange={patchBusiness} />
          </section>
        ) : null}

        {mode ? (
          <section className={mode === "business" ? "border-t border-background-200 pt-4" : ""}>
            {mode === "business" ? <h3 className="mb-3 text-sm font-semibold text-foreground-900">First portal team member</h3> : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Field label="Name" required>
                  <TextInput autoFocus={mode === "agent"} value={agentName} aria-invalid={Boolean(agentErrors.name)} onChange={(e) => setAgentName(e.target.value)} />
                </Field>
                {agentErrors.name ? <p role="alert" className="mt-1 text-xs font-medium text-red-700">{agentErrors.name}</p> : null}
              </div>
              <div>
                <Field label="Email" required>
                  <TextInput type="email" value={agentEmail} aria-invalid={Boolean(agentErrors.email)} onChange={(e) => setAgentEmail(e.target.value)} placeholder="name@agency.com" />
                </Field>
                {agentErrors.email ? <p role="alert" className="mt-1 text-xs font-medium text-red-700">{agentErrors.email}</p> : null}
              </div>
            </div>
            <div className="mt-3 space-y-3">
              <Field label="Role">
                <Select value={agentRole} onChange={(e) => setAgentRole(e.target.value as NewStudentAgent["role"])}>
                  <option value="agent">Agent</option>
                  <option value="agency_admin">Agency admin</option>
                </Select>
              </Field>
              <p className="text-xs text-foreground-500">A sign-in invitation will be sent when you add the student.</p>
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}