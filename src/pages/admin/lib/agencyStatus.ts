import type { ApplicationStatus } from "@/pages/agency/lib/portalData";

/** Order used wherever a status breakdown is shown: work that needs attention first, closed outcomes last. */
export const STATUS_ORDER: ApplicationStatus[] = [
  "action_required", "draft", "submitted", "under_review", "offer_issued", "offer_accepted", "coe_issued", "enrolled", "rejected", "withdrawn",
];

/** Statuses with at least one application, in STATUS_ORDER. Unknown statuses are ignored. */
export function sortedStatusCounts(counts: Record<string, number> | undefined): Array<[ApplicationStatus, number]> {
  return STATUS_ORDER.filter((s) => (counts?.[s] ?? 0) > 0).map((s) => [s, counts?.[s] ?? 0]);
}
