import { useEffect, useState } from "react";
import { supabase } from "@/pages/admin/lib/supabase";

/** One row of the national (training.gov.au) course catalogue as returned by search. */
export interface CatalogueCourse {
  course_code: string;
  course_name: string;
  course_type: "QUALIFICATION" | "ACCREDITED_COURSE";
  aqf_level: string | null;
  training_package_code: string | null;
  training_package_name: string | null;
  national_status: string;
  release_number: string | null;
  is_active: boolean;
  website_enabled: boolean;
  admissions_enabled: boolean;
  domestic_enabled: boolean;
  international_enabled: boolean;
  cms_course_id: string | null;
  match_rank: number;
  total_count: number;
}

export interface CatalogueSearch {
  query: string;
  courseType?: string;
  aqfLevel?: string;
  nationalStatus?: string;
  skyline?: "" | "active" | "inactive";
  limit?: number;
  offset?: number;
}

export interface SkylineActivation {
  active: boolean;
  website: boolean;
  applications: boolean;
  domestic: boolean;
  international: boolean;
}

export const COURSE_TYPE_LABEL: Record<string, string> = {
  QUALIFICATION: "Qualification",
  ACCREDITED_COURSE: "Accredited Course",
};

export const NATIONAL_STATUSES = ["CURRENT", "SUPERSEDED", "DELETED", "CANCELLED", "NON_CURRENT"];

export function titleCase(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}

/** Backend-driven search; never loads the whole catalogue into the browser. */
export async function searchCatalogue(s: CatalogueSearch): Promise<{ rows: CatalogueCourse[]; total: number }> {
  const { data, error } = await supabase.rpc("search_australian_course_catalogue", {
    p_query: s.query,
    p_course_type: s.courseType || null,
    p_aqf_level: s.aqfLevel || null,
    p_national_status: s.nationalStatus || null,
    p_skyline: s.skyline || null,
    p_limit: s.limit ?? 20,
    p_offset: s.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as CatalogueCourse[];
  return { rows, total: rows.length ? Number(rows[0].total_count) : 0 };
}

export async function fetchAqfLevels(): Promise<string[]> {
  const { data, error } = await supabase.rpc("australian_course_catalogue_aqf_levels");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map(String);
}

/** National record for a Skyline course code, or null when the code is not in the catalogue. */
export async function fetchCatalogueCourse(code: string): Promise<CatalogueCourse | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const { rows } = await searchCatalogue({ query: trimmed, limit: 1 });
  return rows[0] && rows[0].course_code.toUpperCase() === trimmed.toUpperCase() ? rows[0] : null;
}

/**
 * Activates (or updates Skyline settings for) a national course. Links an existing Skyline
 * course with the same code or creates one Draft course; never overwrites an existing course.
 * Returns the managed course's slug when there is one.
 */
export async function activateCatalogueCourse(
  code: string,
  a: SkylineActivation,
): Promise<{ cmsCourseId: string | null; slug: string | null; created: boolean }> {
  const { data, error } = await supabase.rpc("activate_australian_course", {
    p_course_code: code,
    p_active: a.active,
    p_website: a.website,
    p_applications: a.applications,
    p_domestic: a.domestic,
    p_international: a.international,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as { cms_course_id?: string | null; created?: boolean };
  const cmsCourseId = result.cms_course_id ?? null;
  let slug: string | null = null;
  if (cmsCourseId) {
    const { data: course } = await supabase.from("cms_courses").select("slug").eq("id", cmsCourseId).maybeSingle();
    slug = (course?.slug as string | undefined) ?? null;
  }
  return { cmsCourseId, slug, created: Boolean(result.created) };
}

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
