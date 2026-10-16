import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/pages/admin/lib/supabase";
import { formatDate, ROLE_LABELS } from "@/pages/agency/lib/portalData";
import { PageHeading, PortalEmpty, PortalError, PortalLoading } from "@/pages/agency/components/PortalUI";

interface AuditRow {
  id: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
}

function actionLabel(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminAuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: qError } = await supabase
        .from("portal_audit_log")
        .select("id, actor_name, actor_role, action, target_type, target_id, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (qError) throw new Error(qError.message);
      setRows(
        (data ?? []).map((row) => {
          const r = row as Record<string, unknown>;
          return {
            id: String(r.id),
            actorName: String(r.actor_name ?? "System"),
            actorRole: String(r.actor_role ?? ""),
            action: String(r.action ?? ""),
            targetType: String(r.target_type ?? ""),
            targetId: String(r.target_id ?? ""),
            createdAt: String(r.created_at ?? ""),
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not load the audit log.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeading
        eyebrow="Audit Log"
        title="Audit log"
        description="A record of significant portal actions — status changes, account provisioning and applications."
      />

      <div className="mt-6">
        {loading ? (
          <PortalLoading label="Loading audit records\u2026" />
        ) : error ? (
          <PortalError message={error} onRetry={() => void load()} />
        ) : rows.length === 0 ? (
          <PortalEmpty icon="ri-history-line" title="No audit records yet" message="Portal actions will be recorded here." />
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1.5 rounded-lg border border-background-200 bg-background-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-100 text-base text-primary-700">
                    <i className="ri-history-line" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground-950">{actionLabel(row.action)}</p>
                    <p className="mt-0.5 text-xs text-foreground-500">
                      {row.actorName}
                      {row.actorRole ? ` \u00b7 ${ROLE_LABELS[row.actorRole] ?? row.actorRole}` : ""}
                      {row.targetType ? ` \u00b7 ${row.targetType}` : ""}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-foreground-400 sm:shrink-0">{formatDate(row.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}