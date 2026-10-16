import type { ApplicationStatus } from "@/pages/agency/lib/portalData";

/**
 * UI affordance only. The database is the authority and enforces the same
 * agency/assignment restrictions through RLS. Never infer this from progress,
 * submission dates, extraction state, or the current user's display role.
 */
export function isEditableApplicationStatus(status: ApplicationStatus | string): boolean {
  return status === "draft" || status === "action_required";
}
