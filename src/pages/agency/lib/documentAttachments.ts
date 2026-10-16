/** The persisted document category for each file input in the agency form. */
export const DOCUMENT_FIELD_CATEGORIES: Record<string, string> = {
  passport_copy: "Passport",
  visa_copy: "Visa",
  english_upload: "English Test",
  academic_upload: "Academic",
};

export function documentCategoryForField(fieldName: string): string | null {
  return DOCUMENT_FIELD_CATEGORIES[fieldName] ?? null;
}

export function extractionStatus(metadata: Record<string, unknown>): string {
  const extraction = metadata.extraction as { status?: unknown } | undefined;
  return typeof extraction?.status === "string" && extraction.status ? extraction.status : "Not requested";
}
