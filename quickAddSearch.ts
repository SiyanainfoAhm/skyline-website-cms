import type { QuickPickOption } from "@/pages/admin/components/QuickPick";
import { listBusinesses } from "@/pages/admin/lib/businessData";
import { listAssignableAgents } from "@/pages/agency/lib/portalApplications";
import { COURSE_TYPE_LABEL, searchCatalogue, type CatalogueCourse } from "@/pages/admin/lib/courseCatalogue";

/** Search functions behind the quick-add pickers (QuickPick + QuickAdd popups). */

/** A business picker option. `id` is the agency (workspace) id; businesses without one are `b:<businessId>`. */
export interface BusinessOption extends QuickPickOption { businessId: string; agencyId: string | null; active: boolean }

export async function searchBusinessOptions(query: string): Promise<BusinessOption[]> {
  const r = await listBusinesses({ search: query, limit: 12, offset: 0 });
  return r.rows.map((b) => ({
    id: b.agencyId ?? `b:${b.id}`,
    businessId: b.id,
    agencyId: b.agencyId,
    active: b.status === "Active",
    label: b.name,
    meta: [b.agencyCode || (b.source === "omara" ? "OMARA register" : "Added by SLIT"), b.place].filter(Boolean).join(" · "),
    tag: b.status !== "Active" ? "Inactive" : undefined,
  }));
}

export async function searchAgentOptions(agencyId: string, query: string): Promise<QuickPickOption[]> {
  const q = query.trim().toLowerCase();
  const rows = await listAssignableAgents(agencyId);
  return rows
    .filter((a) => !q || a.fullName.toLowerCase().includes(q) || a.email.toLowerCase().includes(q))
    .slice(0, 20)
    .map((a) => ({ id: a.profileId, label: a.fullName || a.email, meta: a.email }));
}

export async function searchCourseOptions(query: string): Promise<Array<QuickPickOption & { course: CatalogueCourse }>> {
  const r = await searchCatalogue({ query, nationalStatus: "CURRENT", limit: 12, offset: 0 });
  return r.rows.map((c) => ({
    id: c.course_code, course: c, label: `${c.course_code} ${c.course_name}`,
    meta: [COURSE_TYPE_LABEL[c.course_type], c.aqf_level, c.training_package_name].filter(Boolean).join(" · "),
    tag: c.is_active ? "At Skyline" : undefined,
  }));
}

