import { supabase } from "@/pages/admin/lib/supabase";

export const CMS_MEDIA_BUCKET = "cms-media";
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv"]);

export type StoredFile = {
  id: string;
  originalFileName: string;
  storageFileName: string;
  bucketName: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  url: string;
};

function safeName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "file";
}

function extension(name: string) { return name.split(".").pop()?.toLowerCase() ?? ""; }

export function validateDocument(file: File) {
  const ext = extension(file.name);
  if (!DOCUMENT_EXTENSIONS.has(ext)) throw new Error("Allowed file types: PDF, Word, Excel, PowerPoint, text, RTF, or CSV.");
  if (file.size === 0 || file.size > MAX_DOCUMENT_BYTES) throw new Error("Files must be between 1 byte and 20 MB.");
}

/** Uploads without upsert, then verifies that the exact object exists. */
export async function uploadCmsDocument(file: File, module: "courses" | "forms" | "policies" | "pages", parentId: string, attachmentId?: string): Promise<StoredFile> {
  validateDocument(file);
  const id = attachmentId ?? crypto.randomUUID();
  const originalFileName = file.name;
  const storageFileName = `${id}-${safeName(originalFileName)}`;
  const storagePath = module === "courses" ? `courses/${parentId}/attachments/${storageFileName}` : `${module}/${parentId}/${storageFileName}`;
  const { error } = await supabase.storage.from(CMS_MEDIA_BUCKET).upload(storagePath, file, {
    upsert: false, contentType: file.type || "application/octet-stream", cacheControl: "31536000",
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: objects, error: verifyError } = await supabase.storage.from(CMS_MEDIA_BUCKET).list(storagePath.slice(0, storagePath.lastIndexOf("/")), { search: storageFileName });
  if (verifyError || !objects?.some((object) => object.name === storageFileName)) {
    await supabase.storage.from(CMS_MEDIA_BUCKET).remove([storagePath]);
    throw new Error("Upload could not be verified in Storage.");
  }
  const { data } = supabase.storage.from(CMS_MEDIA_BUCKET).getPublicUrl(storagePath);
  return { id, originalFileName, storageFileName, bucketName: CMS_MEDIA_BUCKET, storagePath, mimeType: file.type || "application/octet-stream", fileSize: file.size, url: data.publicUrl };
}

export async function removeCmsObject(bucketName?: string, storagePath?: string) {
  if (!bucketName || !storagePath) return;
  const { error } = await supabase.storage.from(bucketName).remove([storagePath]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}
