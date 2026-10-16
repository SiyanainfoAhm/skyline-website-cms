import { supabase } from "@/pages/admin/lib/supabase";
import type { PortalAgency } from "@/pages/agency/lib/portalAuth";

/** Data access for the Agency Portal. Every read is scoped by database RLS. */

export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "action_required"
  | "offer_issued"
  | "offer_accepted"
  | "coe_issued"
  | "enrolled"
  | "rejected"
  | "withdrawn";

export const STATUS_META: Record<ApplicationStatus, { label: string; className: string; icon: string }> = {
  draft: { label: "Draft", className: "bg-background-100 text-foreground-700", icon: "ri-file-edit-line" },
  submitted: { label: "Submitted", className: "bg-secondary-100 text-secondary-900", icon: "ri-send-plane-line" },
  under_review: { label: "Under review", className: "bg-secondary-100 text-secondary-900", icon: "ri-search-eye-line" },
  action_required: { label: "Action required", className: "bg-primary-100 text-primary-800", icon: "ri-alert-line" },
  offer_issued: { label: "Offer issued", className: "bg-accent-100 text-accent-900", icon: "ri-mail-star-line" },
  offer_accepted: { label: "Offer accepted", className: "bg-accent-100 text-accent-900", icon: "ri-checkbox-circle-line" },
  coe_issued: { label: "CoE issued", className: "bg-accent-100 text-accent-900", icon: "ri-file-shield-2-line" },
  enrolled: { label: "Enrolled", className: "bg-accent-500 text-background-50", icon: "ri-graduation-cap-line" },
  rejected: { label: "Rejected", className: "bg-primary-100 text-primary-800", icon: "ri-close-circle-line" },
  withdrawn: { label: "Withdrawn", className: "bg-background-200 text-foreground-600", icon: "ri-arrow-go-back-line" },
};

export const ROLE_LABELS: Record<string, string> = {
  slit_admin: "SLIT Admin",
  agency_admin: "Agency Admin",
  agent: "Agent",
};

export function statusMeta(status: string) {
  return STATUS_META[status as ApplicationStatus] ?? STATUS_META.draft;
}

export interface DashboardCounts {
  total: number;
  drafts: number;
  inReview: number;
  actionRequired: number;
  enrolled: number;
}

export interface AgencyMemberRow {
  profileId: string;
  fullName: string;
  email: string;
  role: "agency_admin" | "agent";
  status: string;
}

export interface PortalUserRow {
  profileId: string;
  authUserId: string;
  fullName: string;
  email: string;
  phone: string;
  status: string;
  role: "agency_admin" | "agent" | null;
  agencyId: string | null;
  agencyName: string;
}

export interface NotificationRow {
  id: string;
  reference: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

function mapAgency(row: Record<string, unknown>): PortalAgency {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    code: String(row.code ?? ""),
    registrationNumber: String(row.registration_number ?? ""),
    businessEmail: String(row.business_email ?? ""),
    phone: String(row.phone ?? ""),
    address: String(row.address ?? ""),
    country: String(row.country ?? ""),
    primaryContact: String(row.primary_contact ?? ""),
    status: String(row.status ?? "Active"),
    isPermanent: Boolean(row.is_permanent),
  };
}

const AGENCY_COLUMNS =
  "id, name, code, registration_number, business_email, phone, address, country, primary_contact, status, is_permanent";

export async function listAgencies(): Promise<PortalAgency[]> {
  const { data, error } = await supabase
    .from("agencies")
    .select(AGENCY_COLUMNS)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapAgency(row as Record<string, unknown>));
}

export interface AgencyPatch {
  name: string;
  code: string;
  registrationNumber: string;
  businessEmail: string;
  phone: string;
  address: string;
  country: string;
  primaryContact: string;
}

/** Update an agency's core details (SLIT Admin only — enforced by RLS). */
export async function updateAgency(id: string, patch: AgencyPatch): Promise<void> {
  const { error } = await supabase
    .from("agencies")
    .update({
      name: patch.name.trim(),
      code: patch.code.trim(),
      registration_number: patch.registrationNumber.trim(),
      business_email: patch.businessEmail.trim(),
      phone: patch.phone.trim(),
      address: patch.address.trim(),
      country: patch.country.trim(),
      primary_contact: patch.primaryContact.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Set an agency's active state (SLIT Admin only — enforced by RLS). */
export async function setAgencyStatus(id: string, status: "Active" | "Inactive"): Promise<void> {
  const { error } = await supabase
    .from("agencies")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Delete an agency (SLIT Admin only). Blocked if it still owns applications. */
export async function deleteAgency(id: string): Promise<void> {
  const { error } = await supabase.from("agencies").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Members of one agency (visible to that agency's admin, or SLIT Admin). */
export async function listAgencyMembers(agencyId: string): Promise<AgencyMemberRow[]> {
  const { data, error } = await supabase
    .from("agency_memberships")
    .select("role, status, portal_profiles(id, full_name, email)")
    .eq("agency_id", agencyId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const profiles = (row as unknown as { portal_profiles?: Record<string, unknown> | Record<string, unknown>[] | null }).portal_profiles;
    const profile = (Array.isArray(profiles) ? profiles[0] : profiles) ?? {};
    return {
      profileId: String(profile.id ?? ""),
      fullName: String(profile.full_name ?? ""),
      email: String(profile.email ?? ""),
      role: (row as { role?: string }).role === "agency_admin" ? "agency_admin" : "agent",
      status: String((row as { status?: string }).status ?? "Active"),
    };
  });
}

/** Every portal user (SLIT Admin only — RLS returns nothing for others). */
export async function listPortalUsers(): Promise<PortalUserRow[]> {
  const { data, error } = await supabase
    .from("portal_profiles")
    .select("id, auth_user_id, full_name, email, phone, status, agency_memberships(role, status, agency_id, agencies(name))")
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const memberships = (r.agency_memberships as Array<Record<string, unknown>> | undefined) ?? [];
    const m = memberships[0];
    const agency = (m?.agencies as Record<string, unknown> | undefined) ?? undefined;
    return {
      profileId: String(r.id),
      authUserId: String(r.auth_user_id ?? ""),
      fullName: String(r.full_name ?? ""),
      email: String(r.email ?? ""),
      phone: String(r.phone ?? ""),
      status: String(r.status ?? "Active"),
      role: m ? (m.role === "agency_admin" ? "agency_admin" : "agent") : null,
      agencyId: m ? String(m.agency_id ?? "") || null : null,
      agencyName: String(agency?.name ?? ""),
    };
  });
}

/** Totals for the signed-in user's authorized scope (RLS decides the rows). */
export async function getDashboardCounts(): Promise<DashboardCounts> {
  const { data, error } = await supabase.from("enrollment_applications").select("status");
  if (error) throw new Error(error.message);
  const counts: DashboardCounts = { total: 0, drafts: 0, inReview: 0, actionRequired: 0, enrolled: 0 };
  for (const row of data ?? []) {
    const status = String((row as { status?: string }).status ?? "draft");
    counts.total += 1;
    if (status === "draft") counts.drafts += 1;
    else if (status === "submitted" || status === "under_review") counts.inReview += 1;
    else if (status === "action_required") counts.actionRequired += 1;
    else if (status === "enrolled") counts.enrolled += 1;
  }
  return counts;
}

export async function listNotifications(): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("portal_notifications")
    .select("id, reference, title, message, read, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      reference: String(r.reference ?? ""),
      title: String(r.title ?? ""),
      message: String(r.message ?? ""),
      read: Boolean(r.read),
      createdAt: String(r.created_at ?? ""),
    };
  });
}

export async function markNotificationRead(id: string): Promise<void> {
  await supabase.from("portal_notifications").update({ read: true }).eq("id", id);
}

export async function markAllNotificationsRead(): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) return;
  await supabase.from("portal_notifications").update({ read: true }).eq("recipient", uid).eq("read", false);
}

export function formatDate(value: string | null): string {
  if (!value) return "\u2014";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "\u2014";
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
