/** Development-only, content-free request counters for portal diagnosis. */
const counters = new Map<string, number>();
export function countPortalMetric(name: string): void {
  if (!import.meta.env.DEV) return;
  const next = (counters.get(name) ?? 0) + 1;
  counters.set(name, next);
  // Intentionally logs no IDs, URLs, document text, or auth material.
  console.debug(`[portal-metric] ${name}: ${next}`);
}
export function portalMetricsSnapshot(): Record<string, number> {
  return Object.fromEntries(counters);
}
