import { Button, Modal } from "@/pages/admin/components/ui";

/**
 * The agent's email and/or phone already belong to another company (the server names which). Shown as a popup because
 * the agent must change the matched field before they can register: this account becomes the company's administrator.
 */
export default function ContactConflictPopup({ message, onClose }: { message: string; onClose: () => void }) {
  const matched = /email and phone/i.test(message) ? "email and phone number" : /email/i.test(message) ? "email" : "phone number";
  return (
    <Modal open={Boolean(message)} title={`This ${matched} is already in use`} onClose={onClose}
      footer={<Button onClick={onClose}>Change {matched}</Button>}>
      <div className="flex items-start gap-3 text-sm text-foreground-700">
        <i className="ri-error-warning-line mt-0.5 text-xl text-amber-600" aria-hidden="true" />
        <p>{message}</p>
      </div>
    </Modal>
  );
}
