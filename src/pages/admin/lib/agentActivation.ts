import type { BusinessStatus, DirectoryAgent } from "./businessData";

export interface AgentToActivate {
  agentId?: string | null;
  name: string;
  email: string;
  phone?: string;
  marn?: string;
  role?: "agent" | "agency_admin" | null;
  hasLogin?: boolean;
  /** The business the agent is attached to. */
  business?: { id: string; name: string; status: BusinessStatus | null } | null;
}

/** What the Activate dialog starts from for a row of the Agents list. */
export function toActivate(a: DirectoryAgent): AgentToActivate {
  return {
    agentId: a.agentId, name: a.name, email: a.email, phone: a.phone, marn: a.marn, role: a.role, hasLogin: Boolean(a.profileId),
    business: { id: a.businessId, name: a.businessName, status: a.businessStatus },
  };
}
