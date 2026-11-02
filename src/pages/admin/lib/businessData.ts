import { supabase } from "@/pages/admin/lib/supabase";

/**
 * SLIT administrator views of businesses, their OMARA agents, portal agents and students. Every call is a SQL function that
 * checks for a SLIT administrator itself (migration 20261102140000), so nothing here relies on hiding UI.
 */

export type BusinessStatus = "Active" | "Inactive";
export type StatusCounts = Record<string, number>;
export interface ListCounts { all: number; active: number; inactive: number }

export interface BusinessRow {
  id: string;
  name: string;
  status: BusinessStatus;
  source: "omara" | "manual";
  identityStatus: string;
  agencyId: string | null;
  agencyCode: string;
  place: string;
  contact: string;
  email: string;
  omaraAgents: number;
  omaraEnded: number;
  admins: number;
  agents: number;
  students: number;
  applications: number;
  statusCounts: StatusCounts;
}

export interface BusinessDetail {
  id: string;
  name: string;
  status: BusinessStatus;
  identityStatus: string;
  source: "omara" | "manual";
  registration: { country: string | null; type: string | null; number: string | null };
  statusChangedAt: string | null;
  createdAt: string;
  directoryContact: { name: string; email: string; phone: string; address: string; website: string; place: string };
  agency: null | {
    id: string; code: string; name: string; status: BusinessStatus; email: string; phone: string; address: string;
    country: string; contact: string; registrationNumber: string; createdAt: string;
  };
  counts: { omaraAgents: number; omaraEnded: number; admins: number; agents: number; students: number; applications: number };
  statusCounts: StatusCounts;
}

export interface OmaraAgentRow {
  omaraId: string;
  name: string;
  marn: string;
  registrationStatus: string;
  registered: boolean;
  email: string;
  phone: string;
  place: string;
  relationship: "directory_reported" | "verified" | "ended";
  endedAt: string | null;
  profile: null | { id: string; name: string; email: string; role: string | null; status: BusinessStatus };
  students: number;
  statusCounts: StatusCounts;
}

export interface ApplicationRow {
  id: string;
  reference: string;
  status: string;
  intake: string;
  completion: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  studentId: string;
  agentId: string | null;
  agentName: string;
  courses: Array<{ code: string; title: string }>;
}

export interface StudentRow {
  id: string; name: string; email: string; phone: string; createdAt: string; lastUpdated: string | null;
  agencyId: string; businessId: string; businessName: string; agentId: string | null; agentName: string;
  applications: number; statusCounts: StatusCounts;
}

export interface StudentDetail {
  id: string; name: string; email: string; phone: string; dateOfBirth: string | null; createdAt: string;
  business: { id: string; name: string; status: BusinessStatus }; agencyId: string; applications: ApplicationRow[];
}

export interface AgentRow {
  id: string; name: string; email: string; role: "agency_admin" | "agent"; status: BusinessStatus; marn: string;
  agencyId: string; businessId: string; businessName: string; businessStatus: BusinessStatus; students: number; statusCounts: StatusCounts;
}

export interface AgentDetail {
  id: string; name: string; email: string; phone: string; jobTitle: string; role: "agency_admin" | "agent" | null; status: BusinessStatus;
  agencyId: string | null; business: null | { id: string; name: string; status: BusinessStatus };
  omara: null | { id: string; marn: string; registered: boolean; registrationStatus: string };
  marnOptions: Array<{ id: string; name: string; marn: string }>;
  applications: ApplicationRow[]; students: Array<{ id: string; name: string; email: string }>;
}

async function call<T>(fn: string, params: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(friendly(error.message) || fallback);
  return data as T;
}

/** Database messages written for people are passed through; anything technical becomes the caller's fallback. */
function friendly(message: string | undefined): string {
  if (!message) return "";
  return /^(SLIT administrator|Business|Agency|That business|This business|An agency|This MARN|Say how|Portal user|OMARA agent|Status must)/.test(message) ? message : "";
}

export const listBusinesses = (f: { search?: string; status?: string; source?: string; workspace?: string; limit: number; offset: number }) =>
  call<{ total: number; counts: ListCounts; rows: BusinessRow[] }>("admin_business_list", {
    p_search: f.search ?? "", p_status: f.status ?? "", p_source: f.source ?? "", p_workspace: f.workspace ?? "", p_limit: f.limit, p_offset: f.offset,
  }, "We could not load businesses. Please try again.");

export const getBusiness = (id: string) => call<BusinessDetail | null>("admin_business_detail", { p_business: id }, "We could not load this business.");

export const listBusinessAgents = (id: string) => call<OmaraAgentRow[]>("admin_business_agents", { p_business: id }, "We could not load this business’s OMARA agents.");

export const setBusinessStatus = (id: string, status: BusinessStatus) =>
  call<{ businessId: string; status: BusinessStatus; agencyId: string | null; workspaceCreated: boolean }>("admin_business_set_status",
    { p_business: id, p_status: status }, "We could not change this business’s status.");

export const linkAgencyToBusiness = (agencyId: string, businessId: string) =>
  call<{ businessId: string; agencyId: string; changed: boolean }>("admin_business_link_agency", { p_agency: agencyId, p_business: businessId }, "We could not link these records.");

export const listStudents = (f: { search?: string; status?: string; businessId?: string | null; limit: number; offset: number }) =>
  call<{ total: number; rows: StudentRow[] }>("admin_students_list", {
    p_search: f.search ?? "", p_status: f.status ?? "", p_business: f.businessId ?? null, p_limit: f.limit, p_offset: f.offset,
  }, "We could not load students. Please try again.");

export const getStudent = (id: string) => call<StudentDetail | null>("admin_student_detail", { p_student: id }, "We could not load this student.");

export const listAgents = (f: { search?: string; status?: string; businessId?: string | null; limit: number; offset: number }) =>
  call<{ total: number; counts: ListCounts; rows: AgentRow[] }>("admin_agents_list", {
    p_search: f.search ?? "", p_status: f.status ?? "", p_business: f.businessId ?? null, p_limit: f.limit, p_offset: f.offset,
  }, "We could not load agents. Please try again.");

export const getAgent = (id: string) => call<AgentDetail | null>("admin_agent_detail", { p_profile: id }, "We could not load this agent.");

export const linkAgentMarn = (profileId: string, omaraId: string | null, evidence: string) =>
  call<{ linked: boolean; marn?: string }>("admin_link_agent_marn", { p_profile: profileId, p_omara: omaraId, p_evidence: evidence }, "We could not link this MARN.");
