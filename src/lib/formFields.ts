/**
 * Canonical form-field model shared by the CMS Form Builder, the CMS preview
 * and the public form renderer. Keeping ONE type union + ONE renderer means the
 * editor, the preview and the live website can never disagree about what a
 * "Radio", "Dropdown", "Checkbox", etc. actually is.
 */

export type FormFieldType =
  | "Text"
  | "Email"
  | "Phone"
  | "Number"
  | "Date"
  | "Dropdown"
  | "Radio"
  | "Checkbox"
  | "Textarea"
  | "File Upload"
  | "Section Heading"
  | "Static Note"
  | "Terms"
  | "Table";

export const FORM_FIELD_TYPES: FormFieldType[] = [
  "Text",
  "Email",
  "Phone",
  "Number",
  "Date",
  "Dropdown",
  "Radio",
  "Checkbox",
  "Textarea",
  "File Upload",
  "Section Heading",
  "Static Note",
  "Terms",
  "Table",
];

/** Field types that carry a list of options (labels / column headers). */
export const OPTION_FIELD_TYPES: FormFieldType[] = ["Dropdown", "Radio", "Checkbox", "Terms", "Table"];

/** Field types where a single option can be marked as the default selection. */
export const DEFAULT_OPTION_TYPES: FormFieldType[] = ["Dropdown", "Radio", "Checkbox"];

export const supportsOptions = (type: FormFieldType): boolean => OPTION_FIELD_TYPES.includes(type);
export const supportsDefault = (type: FormFieldType): boolean => DEFAULT_OPTION_TYPES.includes(type);

/** A single, render-ready field — the common shape both the CMS and the site use. */
export interface RenderField {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  help: string;
  options: string[];
  visible: boolean;
  placeholder?: string;
  defaultValue?: string;
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
  fileTypes?: string;
  maxSizeMb?: number;
  rows?: number;
}

/** Turns a comma/space separated list of extensions into an accept="" string. */
export function acceptAttribute(fileTypes?: string): string {
  if (!fileTypes) return ".jpg,.jpeg,.png,.gif,.pdf";
  return fileTypes
    .split(/[,\s]+/)
    .map((part) => part.trim().replace(/^\./, ""))
    .filter(Boolean)
    .map((ext) => `.${ext}`)
    .join(",");
}