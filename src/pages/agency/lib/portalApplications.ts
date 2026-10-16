import { supabase } from "@/pages/admin/lib/supabase";
import { countPortalMetric } from "@/pages/agency/lib/devMetrics";
import type { ApplicationStatus } from "@/pages/agency/lib/portalData";

/**
 * Data access for student applications in the Agency Portal.
 *
 * Every read is scoped by database RLS — an Agent only ever receives rows
 * assigned to them, an Agency Admin only rows for their agency, and SLIT Admin
 * rows across every agency. Nothing here trusts a client-supplied scope.
 */

const APP_COLUMNS =
  "id, reference, status, student_name, student_email, intake, completion, agency_id, assigned_agent_id, created_at, updated_at, submitted_at, is_test";

export interface ApplicationCourseRow {
  courseId: string;
  code: string;
  title: string;
  variant: string;
}

export interface ApplicationListRow {
  id: string;
  reference: string;
  status: ApplicationStatus;
  studentName: string;
  studentEmail: string;
  intake: string;
  completion: number;
  agencyId: string;
  agencyName: string;
  agentId: string | null;
  agentName: string;
  courses: ApplicationCourseRow[];
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  isTest: boolean;
}

export interface ApplicationFilters {
  search?: string;
  status?: string;
  agencyId?: string;
  agentId?: string;
  courseCode?: string;
  intake?: string;
}

function str(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

async function profileNames(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data, error } = await supabase.from("portal_profiles").select("id, full_name").in("id", unique);
  if (error) return map;
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    map.set(str(r.id), str(r.full_name));
  }
  return map;
}

/** Every application the caller is authorised to see, with agency/agent/course detail. */
export async function listApplications(filters: ApplicationFilters = {}): Promise<ApplicationListRow[]> {
  countPortalMetric("applications.list");
  let query = supabase
    .from("enrollment_applications")
    .select(APP_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(1000);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.agencyId) query = query.eq("agency_id", filters.agencyId);
  if (filters.agentId) query = query.eq("assigned_agent_id", filters.agentId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const appIds = rows.map((r) => str(r.id));
  const agentIds = rows.map((r) => str(r.assigned_agent_id)).filter(Boolean);
  const agencyIds = Array.from(new Set(rows.map((r) => str(r.agency_id)).filter(Boolean)));

  const [nameMap, agencyMap, courseMap] = await Promise.all([
    profileNames(agentIds),
    fetchAgencyNames(agencyIds),
    fetchCoursesByApplication(appIds),
  ]);

  const mapped: ApplicationListRow[] = rows.map((r) => {
    const id = str(r.id);
    const agentId = str(r.assigned_agent_id) || null;
    const agencyId = str(r.agency_id);
    return {
      id,
      reference: str(r.reference),
      status: (str(r.status, "draft") as ApplicationStatus) ?? "draft",
      studentName: str(r.student_name),
      studentEmail: str(r.student_email),
      intake: str(r.intake),
      completion: Number(r.completion ?? 0),
      agencyId,
      agencyName: agencyMap.get(agencyId) ?? "",
      agentId,
      agentName: agentId ? nameMap.get(agentId) ?? "" : "",
      courses: courseMap.get(id) ?? [],
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
      submittedAt: r.submitted_at ? str(r.submitted_at) : null,
      isTest: Boolean(r.is_test),
    };
  });

  const search = (filters.search ?? "").trim().toLowerCase();
  const intake = (filters.intake ?? "").trim().toLowerCase();

  return mapped.filter((row) => {
    if (search) {
      const haystack = `${row.studentName} ${row.studentEmail} ${row.reference}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (filters.courseCode && !row.courses.some((c) => c.code === filters.courseCode)) return false;
    if (intake && !row.intake.toLowerCase().includes(intake)) return false;
    return true;
  });
}

async function fetchAgencyNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase.from("agencies").select("id, name").in("id", ids);
  if (error) return map;
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    map.set(str(r.id), str(r.name));
  }
  return map;
}

async function fetchCoursesByApplication(appIds: string[]): Promise<Map<string, ApplicationCourseRow[]>> {
  const map = new Map<string, ApplicationCourseRow[]>();
  if (appIds.length === 0) return map;
  const { data, error } = await supabase
    .from("enrollment_application_courses")
    .select("application_id, course_id, course_code, course_title, variant")
    .in("application_id", appIds);
  if (error) return map;
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const key = str(r.application_id);
    const list = map.get(key) ?? [];
    list.push({
      courseId: str(r.course_id),
      code: str(r.course_code),
      title: str(r.course_title),
      variant: str(r.variant),
    });
    map.set(key, list);
  }
  return map;
}

/* --------------------------------------------------------------- Dashboard */

export interface StatBucket {
  id: string;
  name: string;
  total: number;
  drafts: number;
  submitted: number;
  actionRequired: number;
  enrolled: number;
}

export interface DashboardStats {
  total: number;
  drafts: number;
  submitted: number;
  inReview: number;
  actionRequired: number;
  enrolled: number;
  byAgency: StatBucket[];
  byAgent: StatBucket[];
  recent: ApplicationListRow[];
}

function emptyBucket(id: string, name: string): StatBucket {
  return { id, name, total: 0, drafts: 0, submitted: 0, actionRequired: 0, enrolled: 0 };
}

function addToBucket(bucket: StatBucket, status: ApplicationStatus): void {
  bucket.total += 1;
  if (status === "draft") bucket.drafts += 1;
  else if (status === "submitted" || status === "under_review") bucket.submitted += 1;
  else if (status === "action_required") bucket.actionRequired += 1;
  else if (status === "enrolled") bucket.enrolled += 1;
}

/** Totals + agency-wise and agent-wise breakdowns for a set of applications. */
export function summarizeApplications(rows: ApplicationListRow[]): DashboardStats {
  const stats: DashboardStats = {
    total: 0,
    drafts: 0,
    submitted: 0,
    inReview: 0,
    actionRequired: 0,
    enrolled: 0,
    byAgency: [],
    byAgent: [],
    recent: rows.slice(0, 6),
  };

  const agencies = new Map<string, StatBucket>();
  const agents = new Map<string, StatBucket>();

  for (const row of rows) {
    stats.total += 1;
    if (row.status === "draft") stats.drafts += 1;
    else if (row.status === "submitted") stats.submitted += 1;
    else if (row.status === "under_review") stats.inReview += 1;
    else if (row.status === "action_required") stats.actionRequired += 1;
    else if (row.status === "enrolled") stats.enrolled += 1;

    if (row.agencyId) {
      const bucket = agencies.get(row.agencyId) ?? emptyBucket(row.agencyId, row.agencyName || "Agency");
      addToBucket(bucket, row.status);
      agencies.set(row.agencyId, bucket);
    }
    if (row.agentId) {
      const bucket = agents.get(row.agentId) ?? emptyBucket(row.agentId, row.agentName || "Agent");
      addToBucket(bucket, row.status);
      agents.set(row.agentId, bucket);
    }
  }

  stats.byAgency = Array.from(agencies.values()).sort((a, b) => b.total - a.total);
  stats.byAgent = Array.from(agents.values()).sort((a, b) => b.total - a.total);
  return stats;
}

/** Convenience wrapper that fetches the caller's scope then summarises it. */
export async function getDashboardStats(): Promise<DashboardStats> {
  return summarizeApplications(await listApplications());
}

/* -------------------------------------------------------------- Detail */

export interface ConsentRow {
  id: string;
  method: string;
  signedDocumentRef: string;
  declarationVersion: string;
  recordedByName: string;
  createdAt: string;
}

export interface ApplicationDetail {
  id: string;
  reference: string;
  status: ApplicationStatus;
  agencyId: string;
  agencyName: string;
  createdBy: string | null;
  createdByName: string;
  agentId: string | null;
  agentName: string;
  submittedByName: string;
  studentName: string;
  studentEmail: string;
  intake: string;
  completion: number;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  version: number;
  isTest: boolean;
  courses: ApplicationCourseRow[];
  consents: ConsentRow[];
}

export interface StatusHistoryRow {
  id: string;
  previousStatus: string;
  newStatus: string;
  actorName: string;
  actorRole: string;
  note: string;
  createdAt: string;
}

export interface DocumentRow {
  id: string;
  category: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  reviewState: string;
  isCurrent: boolean;
  createdAt: string;
  storagePath: string;
  metadata: Record<string, unknown>;
}

export async function getApplication(id: string): Promise<ApplicationDetail | null> {
  countPortalMetric("applications.detail");
  const { data, error } = await supabase
    .from("enrollment_applications")
    .select(`${APP_COLUMNS}, created_by, submitted_by, data, version`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const r = data as Record<string, unknown>;
  const agencyId = str(r.agency_id);
  const [nameMap, agencyMap, courseMap, consents] = await Promise.all([
    profileNames([str(r.created_by), str(r.assigned_agent_id), str(r.submitted_by)]),
    fetchAgencyNames([agencyId]),
    fetchCoursesByApplication([id]),
    listConsents(id),
  ]);

  return {
    id: str(r.id),
    reference: str(r.reference),
    status: (str(r.status, "draft") as ApplicationStatus) ?? "draft",
    agencyId,
    agencyName: agencyMap.get(agencyId) ?? "",
    createdBy: str(r.created_by) || null,
    createdByName: nameMap.get(str(r.created_by)) ?? "",
    agentId: str(r.assigned_agent_id) || null,
    agentName: nameMap.get(str(r.assigned_agent_id)) ?? "",
    submittedByName: nameMap.get(str(r.submitted_by)) ?? "",
    studentName: str(r.student_name),
    studentEmail: str(r.student_email),
    intake: str(r.intake),
    completion: Number(r.completion ?? 0),
    data: (r.data as Record<string, unknown>) ?? {},
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    submittedAt: r.submitted_at ? str(r.submitted_at) : null,
    version: Number(r.version ?? 1),
    isTest: Boolean(r.is_test),
    courses: courseMap.get(id) ?? [],
    consents,
  };
}

export async function listConsents(applicationId: string): Promise<ConsentRow[]> {
  const { data, error } = await supabase
    .from("enrollment_application_consents")
    .select("id, method, signed_document_ref, declaration_version, recorded_by_name, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: str(r.id),
      method: str(r.method),
      signedDocumentRef: str(r.signed_document_ref),
      declarationVersion: str(r.declaration_version),
      recordedByName: str(r.recorded_by_name),
      createdAt: str(r.created_at),
    };
  });
}

export async function listStatusHistory(applicationId: string): Promise<StatusHistoryRow[]> {
  const { data, error } = await supabase
    .from("enrollment_application_status_history")
    .select("id, previous_status, new_status, actor_name, actor_role, note, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: str(r.id),
      previousStatus: str(r.previous_status),
      newStatus: str(r.new_status),
      actorName: str(r.actor_name),
      actorRole: str(r.actor_role),
      note: str(r.note),
      createdAt: str(r.created_at),
    };
  });
}

export async function listApplicationDocuments(applicationId: string): Promise<DocumentRow[]> {
  countPortalMetric("documents.metadata");
  const { data, error } = await supabase
    .from("enrollment_application_documents")
    .select("id, category, filename, mime_type, file_size, review_state, is_current, created_at, storage_path, metadata")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: str(r.id),
      category: str(r.category, "Other"),
      filename: str(r.filename),
      mimeType: str(r.mime_type),
      fileSize: Number(r.file_size ?? 0),
      reviewState: str(r.review_state, "Pending"),
      isCurrent: Boolean(r.is_current),
      createdAt: str(r.created_at),
      storagePath: str(r.storage_path),
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    };
  });
}

/* ------------------------------------------------------------ Mutation */

export interface DraftPatch {
  data: Record<string, unknown>;
  studentName: string;
  studentEmail: string;
  intake: string;
  completion: number;
}

/** Persists the current draft values (RLS-only permits draft/submitted status). */
export async function saveApplicationDraft(id: string, patch: DraftPatch): Promise<void> {
  const { error } = await supabase
    .from("enrollment_applications")
    .update({
      data: patch.data,
      student_name: patch.studentName,
      student_email: patch.studentEmail,
      intake: patch.intake,
      completion: patch.completion,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Replaces the selected course rows for an application. */
export async function replaceApplicationCourses(
  id: string,
  coursesToSave: ApplicationCourseRow[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("enrollment_application_courses")
    .delete()
    .eq("application_id", id);
  if (deleteError) throw new Error(deleteError.message);
  if (coursesToSave.length === 0) return;
  const { error } = await supabase.from("enrollment_application_courses").insert(
    coursesToSave.map((course) => ({
      application_id: id,
      course_id: course.courseId,
      course_code: course.code,
      course_title: course.title,
      variant: course.variant,
    })),
  );
  if (error) throw new Error(error.message);
}

export interface ConsentInput {
  method: string;
  signedDocumentRef: string;
  declarationVersion: string;
  recordedByName: string;
}

export async function recordConsent(applicationId: string, consent: ConsentInput): Promise<void> {
  const { error } = await supabase.from("enrollment_application_consents").insert({
    application_id: applicationId,
    method: consent.method,
    signed_document_ref: consent.signedDocumentRef,
    declaration_version: consent.declarationVersion,
    recorded_by_name: consent.recordedByName,
  });
  if (error) throw new Error(error.message);
}

/** Uploads a signed consent document into the private application store. */
export async function uploadConsentDocument(applicationId: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${applicationId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from("enrollment-documents").upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  const { error: docError } = await supabase.from("enrollment_application_documents").insert({
    application_id: applicationId,
    category: "Consent",
    bucket_name: "enrollment-documents",
    storage_path: path,
    filename: file.name,
    mime_type: file.type || null,
    file_size: file.size,
  });
  if (docError) throw new Error(docError.message);
  return path;
}

/* -------------------------------------------------------------- RPCs */

export async function createApplication(
  clientKey: string,
  assignedAgentId?: string | null,
  agencyId?: string | null,
): Promise<{ id: string; reference: string }> {
  const input: Record<string, string | null> = {
    p_client_key: clientKey,
    p_assigned_agent_id: assignedAgentId ?? null,
  };
  // Omit this key for the deployed two-argument RPC until the safe incremental
  // migration is applied; agency users never get to supply an agency id.
  if (agencyId) input.p_agency_id = agencyId;
  const { data, error } = await supabase.rpc("portal_create_application", input);
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { application_id?: string; application_reference?: string }
    | null
    | undefined;
  if (!row?.application_id) throw new Error("The application could not be created.");
  return { id: String(row.application_id), reference: String(row.application_reference ?? "") };
}

export async function assignApplicationAgent(applicationId: string, agentProfileId: string | null): Promise<void> {
  const { error } = await supabase.rpc("portal_assign_agent", {
    p_application_id: applicationId,
    p_agent_profile_id: agentProfileId,
  });
  if (error) throw new Error(error.message);
}

export async function submitApplication(
  applicationId: string,
  snapshot: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await supabase.rpc("portal_submit_application", {
    p_application_id: applicationId,
    p_snapshot: snapshot,
  });
  if (error) throw new Error(error.message);
  return String(data ?? "");
}

export async function setApplicationStatus(applicationId: string, status: string, note = ""): Promise<void> {
  const { error } = await supabase.rpc("portal_set_application_status", {
    p_application_id: applicationId,
    p_status: status,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}

/* --------------------------------------------------------------- Agents */

export interface AgentOption {
  profileId: string;
  fullName: string;
  email: string;
  agencyId: string;
  agencyName: string;
}

/** Active agents the caller may assign work to. */
export async function listAssignableAgents(agencyId?: string): Promise<AgentOption[]> {
  let query = supabase
    .from("agency_memberships")
    .select("user_id, agency_id, role, status, portal_profiles(id, full_name, email), agencies(name)")
    .eq("role", "agent")
    .eq("status", "Active");
  if (agencyId) query = query.eq("agency_id", agencyId);

  const { data, error } = await query;
  if (error) return [];
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const profile = (r.portal_profiles as Record<string, unknown> | null) ?? {};
    const agency = (r.agencies as Record<string, unknown> | null) ?? {};
    return {
      profileId: str(r.user_id),
      fullName: str(profile.full_name),
      email: str(profile.email),
      agencyId: str(r.agency_id),
      agencyName: str(agency.name),
    };
  });
}

/* ------------------------------------------- Wizard: documents + drafts */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const DOCUMENT_TYPES: Record<string, string[]> = {
  "application/pdf": ["%PDF-"],
  "image/png": ["\u0089PNG"],
  "image/jpeg": ["\u00ff\u00d8\u00ff"],
  "image/jpg": ["\u00ff\u00d8\u00ff"],
};

async function validateDocumentFile(file: File): Promise<void> {
  if (file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) throw new Error("Each document must be a PDF, JPG, or PNG no larger than 10 MB.");
  if (!/\.(pdf|png|jpe?g)$/i.test(file.name) || !DOCUMENT_TYPES[file.type]) throw new Error("Only PDF, JPG, and PNG documents are supported.");
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const signature = String.fromCharCode(...header);
  if (!DOCUMENT_TYPES[file.type].some((prefix) => signature.startsWith(prefix))) throw new Error("The selected file does not match its declared document type.");
}

export interface UploadDocumentInput {
  applicationId: string;
  category: string;
  file: File;
  uploadedBy?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UploadedDocument {
  id: string;
  path: string;
  category: string;
  filename: string;
}

async function sha256(file: File): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Uploads a document into the private `enrollment-documents` bucket and records
 * its metadata row. Storage success is only reported once BOTH the object upload
 * and the metadata insert succeed — if the metadata write fails we remove the
 * orphaned object so storage and the database can never drift apart.
 */
export async function uploadApplicationDocument(input: UploadDocumentInput): Promise<UploadedDocument> {
  const { applicationId, category, file, uploadedBy, metadata } = input;
  await validateDocumentFile(file);
  const contentSha256 = await sha256(file);
  // A retry after a lost response must return the original document, rather than
  // creating another private object and another qualification.
  const { data: duplicate, error: duplicateError } = await supabase
    .from("enrollment_application_documents")
    .select("id, storage_path, category, filename")
    .eq("application_id", applicationId)
    .eq("category", category)
    .eq("metadata->>contentSha256", contentSha256)
    .maybeSingle();
  if (duplicateError) throw new Error(duplicateError.message);
  if (duplicate) return { id: String(duplicate.id), path: String(duplicate.storage_path), category: String(duplicate.category), filename: String(duplicate.filename) };

  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${applicationId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("enrollment-documents")
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error: metaError } = await supabase
    .from("enrollment_application_documents")
    .insert({
      application_id: applicationId,
      category,
      bucket_name: "enrollment-documents",
      storage_path: path,
      filename: file.name,
      mime_type: file.type || null,
      file_size: file.size,
      uploaded_by: uploadedBy ?? null,
      metadata: { ...(metadata ?? {}), contentSha256 },
    })
    .select("id")
    .maybeSingle();

  if (metaError) {
    // Metadata failed → remove the orphaned object so storage stays consistent.
    await supabase.storage.from("enrollment-documents").remove([path]);
    throw new Error(metaError.message);
  }

  const id = String(data?.id ?? "");
  // Queue through a trusted backend after the row exists. A failed enqueue does
  // not invalidate an upload; it remains visible and can be retried explicitly.
  try { await queueDocumentExtraction(id); } catch { /* surfaced by the document's retry control */ }
  return { id, path, category, filename: file.name };
}

/** Queues one authorised document for backend extraction; never sends file data or provider credentials from the browser. */
export async function queueDocumentExtraction(documentId: string, reextract = false): Promise<void> {
  const { data, error } = await supabase.functions.invoke("portal-document-extract", { body: { documentId, reextract } });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(String(data?.error ?? "Document extraction could not be queued."));
}

export interface DocumentFieldReview {
  id: string;
  applicationId: string;
  documentId: string | null;
  field: string;
  candidateValue: string;
  existingValue: string;
  finalValue: string;
  state: "auto_applied" | "corroborated" | "conflict" | "confirmed" | "corrected" | "rejected" | "stale";
  source: Record<string, unknown>;
  createdAt: string;
}

/** RLS limits this to the caller's agency and (for agents) assigned drafts. */
export async function listDocumentFieldReviews(applicationId: string): Promise<DocumentFieldReview[]> {
  const { data, error } = await supabase
    .from("enrollment_document_field_reviews")
    .select("id, application_id, document_id, field_identifier, candidate_value, existing_value, final_value, state, source, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  // Older portal deployments may not have the additive 0013 audit table yet.
  // Keep ordinary draft editing available; the document-review UI activates as
  // soon as that migration is safely reconciled and applied.
  if (error) {
    if (error.code === "42P01" || /enrollment_document_field_reviews/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({
    id: String(row.id), applicationId: String(row.application_id), documentId: row.document_id ? String(row.document_id) : null,
    field: String(row.field_identifier), candidateValue: String(row.candidate_value ?? ""), existingValue: String(row.existing_value ?? ""),
    finalValue: String(row.final_value ?? ""), state: row.state as DocumentFieldReview["state"],
    source: (row.source ?? {}) as Record<string, unknown>, createdAt: String(row.created_at),
  }));
}

/** Serialised server-side with extraction writes; no browser read/modify/write race. */
export async function saveDocumentReview(input: {
  applicationId: string; values: Record<string, string>; provenance: Record<string, string>;
  confirmed: string[]; resolutions?: Array<{ field: string; documentId?: string | null; candidateValue?: string; state: "confirmed" | "corrected" | "rejected" }>;
  wizard?: Record<string, unknown>; studentName?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("portal_save_document_review", {
    p_application_id: input.applicationId, p_values: input.values, p_provenance: input.provenance,
    p_confirmed: input.confirmed, p_resolutions: input.resolutions ?? [], p_wizard: input.wizard ?? {}, p_student_name: input.studentName ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Persist document-local OCR review data. RLS constrains the row to the caller's application scope. */
export async function updateDocumentExtraction(
  id: string,
  metadata: Record<string, unknown>,
  reviewState: "Pending" | "Accepted" | "Rejected",
): Promise<void> {
  const { error } = await supabase
    .from("enrollment_application_documents")
    .update({ metadata, review_state: reviewState })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Removes a document (object + metadata row) the caller is authorised to delete. */
export async function deleteApplicationDocument(doc: { id: string; storagePath: string }): Promise<void> {
  // The server resolves bucket/path from the authorised document row. Never
  // accept a browser-controlled storage path for destructive operations.
  const { data, error } = await supabase.functions.invoke("portal-document-delete", { body: { documentId: doc.id } });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(String(data?.error ?? "Document deletion failed."));
}

/** Creates a short-lived signed URL so an authorised user can view a private document. */
export async function getDocumentSignedUrl(storagePath: string, expiresIn = 300): Promise<string> {
  countPortalMetric("documents.signedUrl");
  if (!storagePath) throw new Error("This document has no stored file.");
  const { data, error } = await supabase.storage
    .from("enrollment-documents")
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw new Error(error.message);
  return data?.signedUrl ?? "";
}

export interface ApplicationDataPatch {
  values?: Record<string, string>;
  wizard?: Record<string, unknown>;
  studentName?: string;
  studentEmail?: string;
  intake?: string;
  completion?: number;
  /** Derived from document-local accepted academic extraction records. */
  academicQualifications?: Array<Record<string, string>>;
}

/**
 * Merges wizard-produced values into a draft's `data` without clobbering stored
 * courses or any field it does not explicitly carry. Only ever touches drafts the
 * caller is authorised to write (RLS enforces the agency/agent scope).
 */
export async function patchApplicationData(id: string, patch: ApplicationDataPatch): Promise<void> {
  const { data: current, error: readError } = await supabase
    .from("enrollment_applications")
    .select("data")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const existing = ((current?.data as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const nextData: Record<string, unknown> = { ...existing };

  if (patch.values) {
    const currentValues = (existing.values as Record<string, unknown> | undefined) ?? {};
    nextData.values = { ...currentValues, ...patch.values };
  }
  if (patch.wizard) {
    const currentWizard = (existing.wizard as Record<string, unknown> | undefined) ?? {};
    nextData.wizard = { ...currentWizard, ...patch.wizard };
  }
  if (patch.academicQualifications) nextData.academicQualifications = patch.academicQualifications;

  const update: Record<string, unknown> = { data: nextData, updated_at: new Date().toISOString() };
  if (patch.studentName !== undefined) update.student_name = patch.studentName;
  if (patch.studentEmail !== undefined) update.student_email = patch.studentEmail;
  if (patch.intake !== undefined) update.intake = patch.intake;
  if (patch.completion !== undefined) update.completion = patch.completion;

  const { error } = await supabase.from("enrollment_applications").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Removes a draft the caller owns (used only when a wizard session is abandoned empty). */
export async function deleteApplicationDraft(id: string): Promise<void> {
  const { error } = await supabase.from("enrollment_applications").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
