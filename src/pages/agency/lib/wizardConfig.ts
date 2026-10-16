import type { ScanType } from "@/lib/docScan";
import { countries } from "@/data/applicationForms";
import type { DocumentExtraction } from "@/pages/agency/lib/documentExtraction";
export { hasLegacyExtractionOnly, needsOcrRetry, reprocessedExtractionMetadata } from "@/pages/agency/lib/documentExtraction";
export type { DocumentExtraction } from "@/pages/agency/lib/documentExtraction";

/**
 * Configuration for the Add New Form document-upload wizard.
 *
 * The wizard reuses the exact extraction pipeline the public form uses
 * (`recognizeImage` + `parseDocument`) — nothing here re-implements OCR. It only
 * describes the steps, their storage category and the field mappings so the
 * extracted values land on the right fields of the existing SLIT enrolment form.
 *
 * Every field name below is the SAME `name` used by the shared `enrolSections`
 * form model, so anything the wizard confirms simply prefills the real form.
 */

export type WizardStepId = "passport" | "visa" | "licence" | "english" | "academic" | "details" | "review";

export type WizardFieldType = "text" | "date" | "email" | "tel" | "radio" | "select";

export interface WizardFieldSpec {
  /** Exact form field name (must match the shared enrolSections model). */
  name: string;
  label: string;
  type: WizardFieldType;
  options?: string[];
  showIf?: { field: string; equals: string[] };
  placeholder?: string;
  hint?: string;
  /** Visual group heading inside a step. */
  group?: string;
}

export interface WizardStep {
  id: WizardStepId;
  /** Undefined for the final review step and for the manual details step. */
  type?: ScanType;
  title: string;
  short: string;
  subtitle: string;
  icon: string;
  /** Storage category written to enrollment_application_documents.category ("" when there is no upload). */
  category: string;
  optional: boolean;
  multiple?: boolean;
  specs: WizardFieldSpec[];
  /** Field names this step owns — derived from specs, used for conflict routing. */
  fields: string[];
}

export const AU_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];
const TITLES = ["Mr", "Mrs", "Ms", "Miss", "Mx", "Dr", "Prof", "Rev", "Hon", "Other"];
const AU_ADDRESS = { field: "address_type", equals: ["Australian Address"] };
const OS_ADDRESS = { field: "address_type", equals: ["Overseas Address"] };

const PASSPORT_SPECS: WizardFieldSpec[] = [
  { name: "title", label: "Title", type: "select", options: TITLES, group: "Personal details" },
  { name: "first_name", label: "Given name", type: "text", group: "Personal details" },
  { name: "middle_name", label: "Middle name", type: "text", group: "Personal details" },
  { name: "last_name", label: "Surname", type: "text", group: "Personal details" },
  { name: "dob", label: "Date of birth", type: "date", group: "Personal details" },
  { name: "gender", label: "Gender", type: "radio", options: ["Male", "Female", "Prefer not to say"], group: "Personal details" },
  { name: "passport_number", label: "Passport number", type: "text", group: "Passport & nationality" },
  { name: "passport_expiry", label: "Passport expiry", type: "date", group: "Passport & nationality" },
  {
    name: "nationality",
    label: "Nationality",
    type: "select",
    options: countries,
    group: "Passport & nationality",
    hint: "Read from the passport. Never assumed to equal the country of birth.",
  },
  { name: "citizenship", label: "Country of citizenship", type: "select", options: countries, group: "Passport & nationality" },
  { name: "issuing_country", label: "Passport issuing country", type: "select", options: countries, group: "Passport & nationality" },
  { name: "birth_country", label: "Country of birth", type: "select", options: countries, group: "Passport & nationality" },
];

const ADDRESS_SPECS: WizardFieldSpec[] = [
  {
    name: "address_type",
    label: "Is the student applying from within Australia or from overseas?",
    type: "radio",
    options: ["Australian Address", "Overseas Address"],
    group: "Where is the student applying from?",
    hint: "This controls which address section of the application form is shown.",
  },
  { name: "au_street", label: "Street address", type: "text", showIf: AU_ADDRESS, group: "Address in Australia" },
  { name: "au_line2", label: "Address line 2", type: "text", showIf: AU_ADDRESS, group: "Address in Australia" },
  { name: "au_suburb", label: "Suburb", type: "text", showIf: AU_ADDRESS, group: "Address in Australia" },
  { name: "au_state", label: "State / Territory", type: "select", options: AU_STATES, showIf: AU_ADDRESS, group: "Address in Australia" },
  { name: "au_zip", label: "Postcode", type: "text", showIf: AU_ADDRESS, group: "Address in Australia" },
  { name: "au_country", label: "Country", type: "select", options: countries, showIf: AU_ADDRESS, group: "Address in Australia" },
  { name: "ov_street", label: "Address", type: "text", showIf: OS_ADDRESS, group: "Overseas address" },
  { name: "ov_line2", label: "Address line 2", type: "text", showIf: OS_ADDRESS, group: "Overseas address" },
  { name: "ov_suburb", label: "Suburb / City", type: "text", showIf: OS_ADDRESS, group: "Overseas address" },
  { name: "ov_state", label: "State / Province / Region", type: "text", showIf: OS_ADDRESS, group: "Overseas address" },
  { name: "ov_zip", label: "Postal code", type: "text", showIf: OS_ADDRESS, group: "Overseas address" },
  { name: "ov_country", label: "Country", type: "select", options: countries, showIf: OS_ADDRESS, group: "Overseas address" },
];

const ENGLISH_SPECS: WizardFieldSpec[] = [
  {
    name: "english_type",
    label: "Assessment type",
    type: "select",
    options: ["IELTS Academic", "IELTS General Training", "PTE Academic", "TOEFL iBT", "Cambridge English", "Others (Please Specify)"],
  },
  { name: "english_score", label: "Overall & component scores", type: "text", hint: "Only scores printed on the document are captured — never invented." },
  { name: "english_date", label: "Date achieved", type: "date" },
  { name: "english_reference", label: "Test reference", type: "text" },
];

const VISA_SPECS: WizardFieldSpec[] = [
  { name: "holds_visa", label: "Holds a valid Australian visa", type: "radio", options: ["Yes", "No"] },
  { name: "visa_subclass", label: "Visa subclass", type: "text", hint: "Proposed only when printed on the grant notice." },
  { name: "visa_grant_date", label: "Grant date", type: "date" },
  { name: "visa_stay_until", label: "Stay-until / expiry date", type: "date" },
  { name: "visa_grant_number", label: "Grant number", type: "text" },
];

const ACADEMIC_SPECS: WizardFieldSpec[] = [
  { name: "academic_institution", label: "Institution / School", type: "text" },
  { name: "academic_qualification", label: "Qualification / Award", type: "text" },
  { name: "academic_program", label: "Programme / stream", type: "text" },
  { name: "academic_year", label: "Year completed", type: "text" },
  { name: "academic_result", label: "Result / grade", type: "text" },
];

const DETAILS_SPECS: WizardFieldSpec[] = [
  {
    name: "has_usi",
    label: "Does the student already have an Australian USI?",
    type: "radio",
    options: ["Yes", "No", "Not sure"],
    group: "Unique Student Identifier (USI)",
    hint: "A USI is required for nationally recognised training. Apply at usi.gov.au. The portal never invents or verifies a USI.",
  },
  { name: "usi_number", label: "USI number", type: "text", showIf: { field: "has_usi", equals: ["Yes"] }, group: "Unique Student Identifier (USI)" },
  { name: "ec_name", label: "Emergency contact full name", type: "text", group: "Emergency contact" },
  { name: "ec_relationship", label: "Relationship to the student", type: "text", group: "Emergency contact" },
  { name: "ec_email", label: "Email", type: "email", group: "Emergency contact" },
  { name: "ec_phone", label: "Contact number", type: "tel", group: "Emergency contact" },
  { name: "ec_in_au", label: "Is the emergency contact in Australia?", type: "radio", options: ["Yes", "No"], group: "Emergency contact" },
  { name: "ec_street", label: "Street address", type: "text", group: "Emergency contact address" },
  { name: "ec_line2", label: "Address line 2", type: "text", group: "Emergency contact address" },
  { name: "ec_suburb", label: "Suburb", type: "text", group: "Emergency contact address" },
  { name: "ec_state", label: "State / Region", type: "text", group: "Emergency contact address" },
  { name: "ec_zip", label: "Postal code", type: "text", group: "Emergency contact address" },
  { name: "ec_country", label: "Country", type: "select", options: countries, group: "Emergency contact address" },
];

type StepSeed = Omit<WizardStep, "fields">;

function withFields(seed: StepSeed): WizardStep {
  return { ...seed, fields: seed.specs.map((spec) => spec.name) };
}

export const WIZARD_STEPS: WizardStep[] = [
  withFields({
    id: "passport",
    type: "passport",
    title: "Passport",
    short: "Passport",
    subtitle:
      "Upload the biodata page (PDF, JPG or PNG). We read the name, date of birth, nationality, passport number, expiry and gender, then map them to the application form.",
    icon: "ri-id-card-line",
    category: "Passport",
    optional: false,
    specs: PASSPORT_SPECS,
  }),
  withFields({
    id: "licence",
    type: "licence",
    title: "Driving licence & address",
    short: "Licence",
    subtitle:
      "Optional. Upload an Australian driving licence or other address evidence to prefill the student's address. Any name or date of birth that disagrees with the passport is flagged — never silently overwritten.",
    icon: "ri-profile-line",
    category: "Driving Licence",
    optional: true,
    specs: ADDRESS_SPECS,
  }),
  withFields({
    id: "visa",
    type: "visa",
    title: "Australian visa",
    short: "Visa",
    subtitle: "Optional. Upload a grant notice or VEVO record. We only propose visa details that are explicitly printed.",
    icon: "ri-passport-line",
    category: "Visa",
    optional: true,
    specs: VISA_SPECS,
  }),
  withFields({
    id: "english",
    type: "english",
    title: "English language test",
    short: "English",
    subtitle:
      "Optional. Upload IELTS, PTE Academic, TOEFL or other accepted evidence. We read the test type, date, overall score, component scores and reference where the document prints them — missing scores are never invented.",
    icon: "ri-translate-2",
    category: "English Test",
    optional: true,
    specs: ENGLISH_SPECS,
  }),
  withFields({
    id: "academic",
    type: "academic",
    title: "Academic results",
    short: "Academic",
    subtitle:
      "Optional. Add marksheets, transcripts, certificates, degrees or diplomas — several files in multiple batches. Each qualification is read separately and never overwrites a previously confirmed record.",
    icon: "ri-file-paper-2-line",
    category: "Academic",
    optional: true,
    multiple: true,
    specs: ACADEMIC_SPECS,
  }),
  withFields({
    id: "details",
    title: "Additional student details",
    short: "Details",
    subtitle:
      "These answers generally cannot be read from identity documents, so enter them directly: the student's USI and their emergency contact. Nothing here is taken from your own agent profile.",
    icon: "ri-contacts-line",
    category: "",
    optional: true,
    specs: DETAILS_SPECS,
  }),
  withFields({
    id: "review",
    title: "Review extracted information",
    short: "Review",
    subtitle: "Compare, correct and confirm everything we read before it opens the full application form.",
    icon: "ri-clipboard-line",
    category: "",
    optional: false,
    specs: [],
  }),
];

/** Friendly labels for every field the wizard can populate. */
export const WIZARD_FIELD_LABELS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const step of WIZARD_STEPS) {
    for (const spec of step.specs) map[spec.name] = spec.label;
  }
  return map;
})();

/** Per-document review of one file kept in the wizard session. */
export interface WizardDoc {
  id: string;
  category: string;
  filename: string;
  fileSize: number;
  mimeType?: string;
  /** Private storage path inside the enrollment-documents bucket. */
  storagePath: string;
  /** True once stored in the private bucket + metadata persisted. */
  stored: boolean;
  /** Extraction outcome for this document, if any. */
  extractedFields: string[];
  /** Kept on the document row; never promoted to application values until confirmed. */
  extraction?: DocumentExtraction;
  metadata?: Record<string, unknown>;
}


/** A disagreement between two sources — surfaced, never auto-merged. */
export interface WizardConflict {
  field: string;
  label: string;
  /** The value already on the draft (kept unless the agent explicitly switches). */
  existing: string;
  /** The freshly extracted value. */
  extracted: string;
  /** Where the new value came from, e.g. "Driving licence" or "Passport vs driving licence". */
  source: string;
  choice: "existing" | "extracted";
}

export interface WizardMeta {
  completedSteps: WizardStepId[];
  outstanding: string[];
  updatedAt: string;
  /** Field name → where the value came from (document title or "Manual entry"). */
  provenance?: Record<string, string>;
  /** Fields the agent has confirmed in the review screen. */
  confirmed?: string[];
}

export function fieldLabel(field: string): string {
  return WIZARD_FIELD_LABELS[field] ?? field;
}

/** Is a conditional field currently visible, given the values collected so far? */
export function isSpecVisible(spec: WizardFieldSpec, values: Record<string, string>): boolean {
  if (!spec.showIf) return true;
  const current = (values[spec.showIf.field] ?? "").trim();
  return spec.showIf.equals.some((option) => option.toLowerCase() === current.toLowerCase());
}

/** Human-friendly file size for the document list. */
export function formatBytes(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
