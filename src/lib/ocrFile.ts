/** Lightweight browser-safe OCR file helpers. Keeps worker/PDF code off normal routes. */
export type OcrLanguage = "eng" | "msa" | "chi_sim" | "chi_tra" | "kor";
export const SUPPORTED_OCR_LANGUAGES: Record<OcrLanguage, string> = {
  eng: "English", msa: "Malay", chi_sim: "Simplified Chinese", chi_tra: "Traditional Chinese", kor: "Korean",
};
export function isPdfFile(file: File) { return file.type === "application/pdf" || /\.pdf$/i.test(file.name); }
export function isImageFile(file: File) { return file.type.startsWith("image/") || /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i.test(file.name); }
export function isReadableFile(file: File) { return isPdfFile(file) || isImageFile(file); }
