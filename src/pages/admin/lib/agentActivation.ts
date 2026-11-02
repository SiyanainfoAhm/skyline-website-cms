import type { BusinessStatus, DirectoryAgent } from "./businessData";

export interface AgentToActivate {
  agentId?: string | null;
  omaraId?: string | null;
  name: string;
  email: string;
  marn?: string;
  role?: "agent" | "agency_admin" | null;
  hasLogin?: boolean;
  /** Business to start with: the one the agent is attached to, or the one OMARA lists for them. */
  business?: { id: string; name: string; status: BusinessStatus | null } | null;
}

/** What the Activate dialog starts from for a row of the Agents list. */
export function toActivate(a: DirectoryAgent): AgentToActivate {
  return {
    agentId: a.agentId, omaraId: a.omaraId, name: a.name, email: a.email, marn: a.marn, role: a.role, hasLogin: Boolean(a.profileId),
    business: a.businessId ? { id: a.businessId, name: a.businessName, status: a.businessStatus } : null,
  };
}
