import { enrolSections, type AppSection } from "@/data/applicationForms";
import { courses } from "@/data/courses";

/**
 * The agency portal reuses the exact same international student application
 * sections (fields, conditions, validation) as the public website, so there is
 * a single source of truth. This module layers on the two portal-specific bits:
 *
 *   1. The course checklist is built from the shared course catalogue instead
 *      of a hand-maintained list, and domestic-only courses (BSB80120) are
 *      never offered to international applicants.
 *   2. The agency/agent block is auto-filled from the signed-in membership and
 *      locked, so an agent can never file the form as the student.
 */

/** Field name of the multi-select course checklist inside the shared sections. */
export const COURSE_FIELD = "courses_of_interest";

/** Fields the portal auto-fills from the authenticated agency/agent, then locks. */
export const LOCKED_AGENT_FIELDS = new Set([
  "via_agent",
  "agent_agency",
  "agent_contact_name",
  "agent_email",
  "agent_phone",
]);

/** Domestic-only qualification — never shown as an international application choice. */
const DOMESTIC_ONLY_CODES = new Set(["BSB80120"]);

/**
 * International course options, derived from the shared course catalogue.
 * Two variants of the same code (e.g. RII60520 at 52 and 104 weeks) stay
 * distinct because the option label carries the variant name.
 */
export const portalCourseOptions: string[] = (() => {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const course of courses) {
    if (!course.code || DOMESTIC_ONLY_CODES.has(course.code)) continue;
    const label = `${course.code} - ${course.name}`;
    if (seen.has(label)) continue;
    seen.add(label);
    options.push(label);
  }
  return options;
})();

export interface ResolvedCourse {
  courseId: string;
  code: string;
  title: string;
  variant: string;
}

/** Maps a selected checklist label back to concrete course catalogue fields. */
export function resolveCourseOption(label: string): ResolvedCourse {
  const matched = courses.find((course) => `${course.code} - ${course.name}` === label);
  if (matched) {
    return {
      courseId: matched.slug,
      code: matched.code ?? label.split(" - ")[0],
      title: matched.name,
      variant: matched.duration ?? "",
    };
  }
  const code = label.split(" - ")[0]?.trim() ?? label;
  return { courseId: label, code, title: label, variant: "" };
}

/**
 * Portal application sections — the shared sections with the course checklist
 * sourced from the live catalogue.
 *
 * NOTE (conflict flag): the reference English-score table embedded in section 3
 * ("Visa, English & Agent Details") lists IELTS 6.0 / PTE 50 / TOEFL 60, while
 * individual course entry summaries only state "Over 18 years". These are
 * surfaced for review as-is rather than overwritten with invented thresholds —
 * see the implementation report.
 */
export const portalSections: AppSection[] = enrolSections.map((section) => ({
  ...section,
  fields: section.fields.map((field) =>
    field.name === COURSE_FIELD
      ? {
          ...field,
          options: portalCourseOptions,
          description:
            "Tick one or more courses below. Only courses open to international students are shown. Each option lists the course code, title and duration.",
        }
      : field,
  ),
}));

/** Human label for the whole application, used in review + confirmation screens. */
export function summarizeCourses(labels: string[]): string {
  if (labels.length === 0) return "No course selected";
  return labels.map((label) => label.split(" - ")[0]).join(", ");
}