import { useMemo } from "react";
import { Button, Modal } from "@/pages/admin/components/ui";
import AddBusinessForm from "@/pages/admin/components/AddBusinessForm";
import ActivateAgentDialog from "@/pages/admin/components/ActivateAgentDialog";
import { useToast } from "@/pages/admin/components/toastContext";
import type { BusinessStatus } from "@/pages/admin/lib/businessData";

export interface NewStudentAgent {
  /** The agent record created, so the student can be attached to it straight away. */
  agentId: string;
  name: string;
  email: string;
  role: "agent" | "agency_admin";
}

/** Both are created straight away by the shared forms; the caller only selects them. */
export type AddStudentRecordValue =
  | { kind: "business"; business: { agencyId: string; businessId: string | null; name: string } }
  | { kind: "agent"; agent: NewStudentAgent };

/**
 * Adding a business or an agent while starting an application or adding a student opens the same forms as
 * Businesses > Add business (ABN lookup, point of contact) and Agents > Add agent, so there is one workflow everywhere.
 */
export default function AddStudentRecordDialog({
  mode,
  initialAgentName,
  business,
  onCancel,
  onSave,
}: {
  mode: "business" | "agent" | null;
  initialAgentName: string;
  /** The business the new agent joins (agent mode). */
  business: { id: string; name: string; status: BusinessStatus | null } | null;
  onCancel: () => void;
  onSave: (value: AddStudentRecordValue) => void;
}) {
  const { push } = useToast();
  // Stable while the dialog is open: the agent dialog resets its fields whenever this object changes.
  const businessId = business?.id ?? "";
  const businessName = business?.name ?? "";
  const businessStatus = business?.status ?? null;
  const agent = useMemo(
    () => (mode === "agent" ? { name: initialAgentName, email: "", business: businessId ? { id: businessId, name: businessName, status: businessStatus } : null } : null),
    [mode, initialAgentName, businessId, businessName, businessStatus],
  );
  return (
    <>
      <Modal open={mode === "business"} title="Add business" onClose={onCancel} width="max-w-3xl">
        {mode === "business" ? (
          <AddBusinessForm
            inDialog
            onCreated={({ agencyId, businessId, name, message }) => { push(message); onSave({ kind: "business", business: { agencyId, businessId, name } }); }}
            onUseExisting={(existing) => onSave({ kind: "business", business: existing })}
            cancel={<Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
          />
        ) : null}
      </Modal>
      <ActivateAgentDialog
        open={mode === "agent"}
        agent={agent}
        onClose={onCancel}
        onDone={(result) => onSave({ kind: "agent", agent: { agentId: result.agentId, name: result.name, email: result.email, role: result.role } })}
      />
    </>
  );
}
