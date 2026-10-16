import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/pages/admin/lib/supabase";
import { portalPasswordResetUrl } from "@/pages/agency/lib/portalAuth";
import { listAgencies, listPortalUsers, ROLE_LABELS, type PortalUserRow } from "@/pages/agency/lib/portalData";
import type { PortalAgency } from "@/pages/agency/lib/portalAuth";
import { PageHeading, PortalEmpty, PortalError, PortalLoading, PortalModal } from "@/pages/agency/components/PortalUI";

const fieldClass =
  "w-full rounded-md border border-background-300 bg-background-50 px-3.5 py-2.5 text-sm text-foreground-950 placeholder:text-foreground-400 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-700";

const EMPTY_FORM = { name: "", email: "", role: "agent" as "agent" | "agency_admin", agencyId: "" };

interface EditState {
  profileId: string;
  role: "agent" | "agency_admin";
  agencyId: string;
  status: "Active" | "Inactive";
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<PortalUserRow[]>([]);
  const [agencies, setAgencies] = useState<PortalAgency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [editing, setEditing] = useState<PortalUserRow | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [u, a] = await Promise.all([listPortalUsers(), listAgencies()]);
      setUsers(u);
      setAgencies(a);
      setForm((prev) => (prev.agencyId ? prev : { ...prev, agencyId: a[0]?.id ?? "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not load portal users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (key: keyof typeof EMPTY_FORM, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    setNotice("");
    setInviteLink("");
    if (!form.email.trim() || !form.agencyId) {
      setFormError("An email address and an agency are required.");
      return;
    }
    setSaving(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("portal-admin-users", {
        body: {
          action: "invite",
          email: form.email.trim(),
          name: form.name.trim(),
          role: form.role,
          agencyId: form.agencyId,
          redirectTo: portalPasswordResetUrl(),
        },
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(String(data.error));
      if (data?.emailSent) {
        setNotice(`Invitation sent to ${form.email.trim()}. They will set their own password from the email.`);
      } else if (data?.inviteLink) {
        setInviteLink(String(data.inviteLink));
        setNotice("Account created. Share the secure setup link below with the user.");
      } else {
        setNotice("Account provisioned.");
      }
      setForm({ ...EMPTY_FORM, agencyId: form.agencyId });
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "We could not provision this account.");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (user: PortalUserRow) => {
    if (!user.role) return;
    setEditing(user);
    setEditState({
      profileId: user.profileId,
      role: user.role,
      agencyId: user.agencyId ?? agencies[0]?.id ?? "",
      status: user.status === "Active" ? "Active" : "Inactive",
    });
    setEditError("");
  };

  const handleSaveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editState) return;
    setEditError("");
    if (!editState.agencyId) {
      setEditError("Please choose an agency for this user.");
      return;
    }
    setEditSaving(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("portal-admin-users", {
        body: {
          action: "update",
          profileId: editState.profileId,
          role: editState.role,
          agencyId: editState.agencyId,
          status: editState.status,
        },
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(String(data.error));
      setEditing(null);
      await load();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "We could not save these changes.");
    } finally {
      setEditSaving(false);
    }
  };

  const toggleStatus = async (user: PortalUserRow) => {
    setBusyId(user.profileId);
    const next = user.status === "Active" ? "Inactive" : "Active";
    try {
      const { data } = await supabase.functions.invoke("portal-admin-users", {
        body: { action: "update", profileId: user.profileId, status: next },
      });
      if (data?.error) throw new Error(String(data.error));
      setUsers((prev) => prev.map((u) => (u.profileId === user.profileId ? { ...u, status: next } : u)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not change that account's status.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeading
        eyebrow="Users"
        title="Portal users"
        description="Provision agency administrator and agent accounts, then assign or reassign users to an agency and set their role. Accounts are created through a secure backend flow — no passwords are stored in the portal."
      />

      <form onSubmit={handleInvite} className="mt-6 rounded-card border border-background-200 bg-background-50 p-6">
        <h2 className="font-heading text-base font-semibold text-foreground-950">Provision a new account</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelClass}>Full name</label>
            <input className={fieldClass} value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Priya Nair" />
          </div>
          <div>
            <label className={labelClass}>Email *</label>
            <input className={fieldClass} type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="user@agency.com" />
          </div>
          <div>
            <label className={labelClass}>Role *</label>
            <select className={fieldClass} value={form.role} onChange={(e) => update("role", e.target.value)}>
              <option value="agent">Agent</option>
              <option value="agency_admin">Agency Admin</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Agency *</label>
            <select className={fieldClass} value={form.agencyId} onChange={(e) => update("agencyId", e.target.value)}>
              <option value="">Select an agency</option>
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {formError ? (
          <p className="mt-4 flex items-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2.5 text-sm text-primary-900" role="alert">
            <i className="ri-error-warning-line" aria-hidden="true" />
            {formError}
          </p>
        ) : null}
        {notice ? (
          <div className="mt-4 rounded-md border border-secondary-200 bg-secondary-50 px-3 py-2.5 text-sm text-secondary-900" role="status">
            <p className="flex items-center gap-2">
              <i className="ri-checkbox-circle-line" aria-hidden="true" />
              {notice}
            </p>
            {inviteLink ? (
              <p className="mt-2 break-all rounded border border-secondary-200 bg-background-50 px-2 py-1.5 font-mono text-xs text-foreground-700">{inviteLink}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-6 py-3 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600 disabled:opacity-70"
          >
            {saving ? <i className="ri-loader-4-line animate-spin" aria-hidden="true" /> : <i className="ri-user-add-line" aria-hidden="true" />}
            {saving ? "Provisioning\u2026" : "Provision account"}
          </button>
        </div>
      </form>

      <div className="mt-6">
        {loading ? (
          <PortalLoading label="Loading portal users\u2026" />
        ) : error ? (
          <PortalError message={error} onRetry={() => void load()} />
        ) : users.length === 0 ? (
          <PortalEmpty icon="ri-group-line" title="No portal users yet" message="Provision your first agency administrator or agent above." />
        ) : (
          <div className="overflow-hidden rounded-card border border-background-200 bg-background-50">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-background-200 bg-background-100 text-left text-xs font-semibold uppercase tracking-wide text-foreground-500">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Agency</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.profileId} className="border-b border-background-100 last:border-none">
                      <td className="px-4 py-3 font-medium text-foreground-950">{user.fullName || "\u2014"}</td>
                      <td className="px-4 py-3 text-foreground-600">{user.email}</td>
                      <td className="px-4 py-3 text-foreground-600">{user.agencyName || "\u2014"}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-secondary-100 px-2.5 py-1 text-xs font-semibold text-secondary-900">
                          {user.role ? ROLE_LABELS[user.role] : "No role"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            user.status === "Active" ? "bg-accent-100 text-accent-900" : "bg-background-200 text-foreground-600"
                          }`}
                        >
                          {user.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(user)}
                            className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 py-1.5 text-xs font-semibold text-foreground-800 transition-colors hover:border-primary-300 hover:text-primary-700"
                          >
                            <i className="ri-edit-line" aria-hidden="true" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleStatus(user)}
                            disabled={busyId === user.profileId}
                            className="cursor-pointer whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 py-1.5 text-xs font-semibold text-foreground-800 transition-colors hover:border-primary-300 hover:text-primary-700 disabled:opacity-60"
                          >
                            {user.status === "Active" ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <PortalModal
        open={Boolean(editing && editState)}
        title="Edit portal user"
        description={editing ? `Update the role, agency or status for ${editing.fullName || editing.email}.` : undefined}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="cursor-pointer whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-5 py-2.5 text-sm font-semibold text-foreground-700 transition-colors hover:bg-background-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="portal-user-edit-form"
              disabled={editSaving}
              className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-6 py-2.5 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600 disabled:opacity-70"
            >
              {editSaving ? <i className="ri-loader-4-line animate-spin" aria-hidden="true" /> : <i className="ri-save-3-line" aria-hidden="true" />}
              {editSaving ? "Saving\u2026" : "Save changes"}
            </button>
          </>
        }
      >
        {editState ? (
          <form id="portal-user-edit-form" onSubmit={handleSaveEdit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Role</label>
              <select
                className={fieldClass}
                value={editState.role}
                onChange={(e) => setEditState((prev) => (prev ? { ...prev, role: e.target.value as EditState["role"] } : prev))}
              >
                <option value="agent">Agent</option>
                <option value="agency_admin">Agency Admin</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Agency</label>
              <select
                className={fieldClass}
                value={editState.agencyId}
                onChange={(e) => setEditState((prev) => (prev ? { ...prev, agencyId: e.target.value } : prev))}
              >
                <option value="">Select an agency</option>
                {agencies.map((agency) => (
                  <option key={agency.id} value={agency.id}>
                    {agency.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Account status</label>
              <select
                className={fieldClass}
                value={editState.status}
                onChange={(e) => setEditState((prev) => (prev ? { ...prev, status: e.target.value as EditState["status"] } : prev))}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
              <p className="mt-1.5 text-xs text-foreground-500">Inactive users cannot sign in to the portal.</p>
            </div>
            {editError ? (
              <p className="flex items-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2.5 text-sm text-primary-900 sm:col-span-2" role="alert">
                <i className="ri-error-warning-line" aria-hidden="true" />
                {editError}
              </p>
            ) : null}
          </form>
        ) : null}
      </PortalModal>
    </div>
  );
}