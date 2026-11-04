import { supabase } from "@/pages/admin/lib/supabase";

/**
 * SLIT administrator views of the one chain: business (an agency record, unique by ABN) -> agents -> students -> applications.
 * Every call is a SQL function that checks for a SLIT administrator itself (migration 20261104090000), so nothing here relies on hiding UI.
 */

export type BusinessStatus = "Active" | "Inactive";
export type StatusCounts = Record<string, number>;
export interface ListCounts { all: number; active: number; inactive: number }

export interface BusinessRow {
  id: string;
  name: string;
  status: BusinessStatus;
  /** The same id: the business is the agency record. Kept so callers that pass an agency id keep working. */
  agencyId: string;
  agencyCode: string;
  abn: string;
  place: string;
  contact: string;
  email: string;
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
  createdAt: string;
  agency: {
    id: string; code: string; name: string; status: BusinessStatus; email: string; phone: string; address: string;
    country: string; contact: string; registrationNumber: string; createdAt: string;
  };
  counts: { admins: number; agents: number; inactiveAgents: number; students: number; applications: number };
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
  id: string; name: string; email: string; phone: string; dateOfBirth: string | null; passportNumber: string; createdAt: string; lastUpdated: string | null;
  agencyId: string; businessId: string; businessName: string; agentId: string | null; agentName: string;
  applications: number; statusCounts: StatusCounts;
  /** Migration 107: nationality and each application of the student (absent on older databases). */
  nationality?: string;
  applicationRows?: StudentApplication[];
  /** Migration 112: Active, or Inactive (Disabled: every application of the student is locked). */
  status?: "Active" | "Inactive";
}

export interface StudentApplication {
  id: string; reference: string; status: string; intake: string; completion: number; updatedAt: string; course: string | null;
  /** Moves the backend allows for the signed-in administrator (empty while the student is disabled). */
  nextStatuses?: string[];
}

/** Enable (Active) or disable (Inactive) a student; disabling locks all of their applications. */
export const setStudentStatus = (id: string, status: "Active" | "Inactive") =>
  call<{ studentId: string; status: "Active" | "Inactive" }>("admin_student_set_status", { p_student: id, p_status: status }, "We could not change this student's status.");

export interface StudentDetail {
  id: string; name: string; email: string; phone: string; dateOfBirth: string | null; passportNumber: string; nationality: string; createdAt: string;
  business: { id: string; name: string; status: BusinessStatus }; agencyId: string;
  agent: null | { id: string; name: string; email: string };
  applications: ApplicationRow[];
}

async function call<T>(fn: string, params: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(friendly(error.message) || fallback);
  return data as T;
}

/** Database messages written for people are passed through; anything technical becomes the caller's fallback. */
function friendly(message: string | undefined): string {
  if (!message) return "";
  return /^(SLIT administrator|Business|Agency|That business|This business|An agency|An agent|This MARN|Say how|Portal user|OMARA agent|Status must|Agent not found|Student not found|A business with|Choose the business|Choose an agent|This agent|This student|Another student|Delete this|Enter |Role must|Only the student)/.test(message) ? message : "";
}

/** Edits a student's details (migration 113). Email and mobile stay unique across all students. */
export const updateStudent = (id: string, input: {
  fullName: string; email: string; mobile: string; dateOfBirth: string; passportNumber: string; nationality: string; agentId: string | null;
}) => call<{ id: string }>("admin_student_update", {
  p_student: id, p_full_name: input.fullName, p_email: input.email, p_phone: input.mobile, p_date_of_birth: input.dateOfBirth || null,
  p_passport: input.passportNumber, p_nationality: input.nationality, p_agent: input.agentId,
}, "We could not save this student.");

/** Deletes a student who has no applications left (their drafts are removed first by the caller). */
export const deleteStudentRecord = (id: string) => call<{ deleted: boolean }>("admin_student_delete", { p_student: id }, "We could not delete this student.");

export const listBusinesses = (f: { search?: string; status?: string; limit: number; offset: number }) =>
  call<{ total: number; counts: ListCounts; rows: BusinessRow[] }>("admin_business_list", {
    p_search: f.search ?? "", p_status: f.status ?? "", p_limit: f.limit, p_offset: f.offset,
  }, "We could not load businesses. Please try again.");

export const getBusiness = (id: string) => call<BusinessDetail | null>("admin_business_detail", { p_business: id }, "We could not load this business.");

export const listBusinessAgents = (id: string) => call<DirectoryAgent[]>("admin_business_agents", { p_business: id }, "We could not load this business’s agents.");

export const setBusinessStatus = (id: string, status: BusinessStatus) =>
  call<{ businessId: string; status: BusinessStatus; agencyId: string; workspaceCreated: boolean }>("admin_business_set_status",
    { p_business: id, p_status: status }, "We could not change this business’s status.");

/** Students, optionally filtered by the student's own status (a value from the backend's student status list). */
export const listStudents = (f: { search?: string; status?: string; studentStatus?: string; businessId?: string | null; agentId?: string | null; limit: number; offset: number }) =>
  call<{ total: number; rows: StudentRow[] }>("admin_students_list", {
    p_search: f.search ?? "", p_status: f.status ?? "", p_business: f.businessId ?? null, p_agent: f.agentId ?? null, p_limit: f.limit, p_offset: f.offset,
    p_student_status: f.studentStatus ?? "",
  }, "We could not load students. Please try again.");

export const getStudent = (id: string) => call<StudentDetail | null>("admin_student_detail", { p_student: id }, "We could not load this student.");

/* ------------------------------------------------------------------ agents */

/** Active: approved and signed up. Invited: approved, no login yet. Inactive: everything else (the default). */
export type AgentStatus = "Active" | "Invited" | "Inactive";
export interface AgentCounts { all: number; active: number; invited: number; inactive: number }

export interface DirectoryAgent {
  /** The agent record's id, used in links. */
  key: string;
  agentId: string;
  omaraId: string | null;
  profileId: string | null;
  /** The sign-in invitation still waiting for this agent, if any. */
  invitationId: string | null;
  name: string;
  email: string;
  phone: string;
  role: "agent" | "agency_admin";
  status: AgentStatus;
  statusChangedAt: string | null;
  marn: string;
  registered: boolean | null;
  businessId: string;
  businessName: string;
  businessStatus: BusinessStatus;
  students: number;
  statusCounts: StatusCounts;
}

export interface AgentOverview {
  key: string;
  agentId: string;
  profileId: string | null;
  omaraId: string | null;
  invitationId: string | null;
  name: string;
  email: string;
  phone: string;
  role: "agent" | "agency_admin";
  status: AgentStatus;
  statusChangedAt: string | null;
  marn: string;
  business: { id: string; name: string; status: BusinessStatus };
  applications: ApplicationRow[];
  students: Array<{ id: string; name: string; email: string }>;
}

export interface ActivationResult {
  agentId: string; businessId: string; businessName: string; agencyId: string;
  businessCreated: boolean; businessActivated: boolean; hasLogin: boolean; email: string; name: string; role: "agent" | "agency_admin";
}

export const listAgentDirectory = (f: { search?: string; status?: string; businessId?: string | null; limit: number; offset: number }) =>
  call<{ total: number; counts: AgentCounts; rows: DirectoryAgent[] }>("admin_agent_directory", {
    p_search: f.search ?? "", p_status: f.status ?? "", p_business: f.businessId ?? null, p_limit: f.limit, p_offset: f.offset,
  }, "We could not load agents. Please try again.");

/** Accepts an agent id, a portal profile id or an OMARA agent id. */
export const getAgentOverview = (id: string) => call<AgentOverview | null>("admin_agent_overview", { p_id: id }, "We could not load this agent.");

/** Adds an agent to a business, or activates an existing one. `marn` links the agent to the OMARA register when given. */
export const activateAgent = (input: {
  agentId?: string | null; businessId: string | null; name: string; email: string; phone?: string; marn?: string; role: "agent" | "agency_admin";
}) => call<ActivationResult>("admin_agent_activate", {
  p_agent: input.agentId ?? null, p_business: input.businessId, p_name: input.name, p_email: input.email, p_phone: input.phone ?? "", p_marn: input.marn ?? "", p_role: input.role,
}, "We could not activate this agent.");

export const deactivateAgent = (agentId: string) => call<{ agentId: string; status: "Inactive" }>("admin_agent_deactivate", { p_agent: agentId }, "We could not deactivate this agent.");
