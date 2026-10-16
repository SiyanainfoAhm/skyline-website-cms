/**
 * Approval-gated migration runner for legacy course units and attachments.
 *
 * Default mode is read-only and writes a JSON report to migration-reports/.
 * `--apply` is deliberately required before it can change Storage or the DB.
 * Required environment variables are SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Never place the service-role key in VITE_* variables or browser code.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const BUCKET = "cms-media";
const SOURCE = path.resolve("src/data/courseUnits.ts");
const REPORT_DIR = path.resolve("migration-reports");
const MAX_BYTES = 20 * 1024 * 1024;
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for this server-side script.");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function parseStaticUnits(source) {
  const courses = new Map();
  const courseBlock = /^  "([^"\r\n]+)": \[\r?\n([\s\S]*?)^  \],?$/gm;
  for (const match of source.matchAll(courseBlock)) {
    const units = [...match[2].matchAll(/^    \["([^"]+)", "([^"]+)", "([^"]+)"\],?$/gm)]
      .map((unit, sort) => ({ code: unit[1], name: unit[2], category: unit[3], sort }));
    if (!units.length) throw new Error(`No units parsed for ${match[1]}; source format changed.`);
    courses.set(match[1], units);
  }
  if (!courses.size) throw new Error("No static course-unit lists parsed; aborting.");
  return courses;
}

const safeName = (name) => name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "file";
const extension = (name) => name.split(".").pop()?.toLowerCase() || "";
const allowedExtensions = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv"]);
const documentMime = (mime) => /^(application\/(pdf|msword|vnd\.|rtf|octet-stream)|text\/plain|text\/csv)/i.test(mime || "");
function hasDocumentSignature(body, name, mime) {
  const head = body.subarray(0, 512);
  const text = head.toString("utf8").trimStart().toLowerCase();
  if (text.startsWith("<!doctype html") || text.startsWith("<html") || text.startsWith("<?xml")) return false;
  if (extension(name) === "pdf" || mime === "application/pdf") return head.subarray(0, 5).toString() === "%PDF-";
  // Office Open XML documents are ZIP containers; legacy binary Office and
  // plain-text formats do not have a reliable common MIME signature.
  if (["docx", "xlsx", "pptx"].includes(extension(name))) return head[0] === 0x50 && head[1] === 0x4b;
  return true;
}
const deterministicUnitId = (courseId, sort, code) => `unit-${courseId}-${sort + 1}-${code.replace(/[^A-Za-z0-9]+/g, "-")}`;

async function jsonReport(report) {
  await mkdir(REPORT_DIR, { recursive: true });
  const out = path.join(REPORT_DIR, `course-content-${new Date().toISOString().replace(/[:.]/g, "-")}${APPLY ? "-apply" : "-dry-run"}.json`);
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return out;
}

async function auditAndMigrateAttachments(rows, report) {
  for (const attachment of rows) {
    const item = {
      id: attachment.id, courseId: attachment.course_id, displayName: attachment.name,
      originalUrl: attachment.url, storagePath: attachment.storage_path ?? null,
      storageExists: false, available: false, fileType: null, fileSize: null,
      status: "skipped", reason: null,
    };
    report.attachments.push(item);
    if (attachment.storage_path) {
      const folder = attachment.storage_path.slice(0, attachment.storage_path.lastIndexOf("/"));
      const file = attachment.storage_path.slice(attachment.storage_path.lastIndexOf("/") + 1);
      const { data, error } = await supabase.storage.from(attachment.bucket_name || BUCKET).list(folder, { search: file });
      item.storageExists = !error && Boolean(data?.some((object) => object.name === file));
      item.status = item.storageExists ? "already-migrated" : "reconcile-required";
      if (!item.storageExists) item.reason = error?.message || "Storage object missing";
      continue;
    }
    if (!/^https?:\/\//i.test(attachment.url)) { item.reason = "URL is not HTTP(S)"; continue; }
    let response;
    try { response = await fetch(attachment.url, { redirect: "follow" }); }
    catch (error) { item.reason = `Download failed: ${error.message}`; continue; }
    const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const inferredName = attachment.original_file_name || response.headers.get("content-disposition")?.match(/filename[^;=\n]*=(?:UTF-8''|"?)([^;"\n]+)/i)?.[1] || attachment.name;
    const cleanName = decodeURIComponent(inferredName).trim();
    const body = Buffer.from(await response.arrayBuffer());
    item.available = response.ok;
    item.fileType = contentType || null;
    item.fileSize = body.length;
    if (!response.ok) { item.reason = `HTTP ${response.status}`; continue; }
    if (!cleanName || !allowedExtensions.has(extension(cleanName))) { item.reason = "Unapproved or missing filename extension"; continue; }
    if (!documentMime(contentType) || /^text\/html/i.test(contentType) || !hasDocumentSignature(body, cleanName, contentType)) { item.reason = `Response is not a permitted document (${contentType || "unknown MIME"})`; continue; }
    if (!body.length || body.length > MAX_BYTES) { item.reason = `Invalid size (${body.length} bytes)`; continue; }
    item.status = APPLY ? "pending-upload" : "ready";
    if (!APPLY) continue;
    const storageFileName = `${attachment.id}-${safeName(cleanName)}`;
    const storagePath = `courses/${attachment.course_id}/attachments/${storageFileName}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, body, { upsert: false, contentType });
    if (uploadError) { item.status = "failed"; item.reason = `Upload failed: ${uploadError.message}`; continue; }
    const { data: objects, error: verifyError } = await supabase.storage.from(BUCKET).list(storagePath.slice(0, storagePath.lastIndexOf("/")), { search: storageFileName });
    if (verifyError || !objects?.some((object) => object.name === storageFileName && Number(object.metadata?.size) === body.length)) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      item.status = "failed"; item.reason = "Storage verification failed; uploaded object removed"; continue;
    }
    const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    const update = { original_file_name: cleanName, storage_file_name: storageFileName, bucket_name: BUCKET, storage_path: storagePath, mime_type: contentType, file_size: body.length, legacy_url: attachment.legacy_url || attachment.url, url: publicUrl.publicUrl, migration_status: "migrated", migration_error: null, migrated_at: new Date().toISOString() };
    const { error: updateError } = await supabase.from("cms_course_attachments").update(update).eq("id", attachment.id).is("storage_path", null);
    if (updateError) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      item.status = "failed"; item.reason = `Metadata update failed; object removed: ${updateError.message}`; continue;
    }
    item.status = "migrated"; item.storagePath = storagePath; item.storageExists = true;
  }
}

async function main() {
  const staticUnits = parseStaticUnits(await readFile(SOURCE, "utf8"));
  const [{ data: courses, error: courseError }, { data: existingUnits, error: unitError }, { data: attachments, error: attachmentError }] = await Promise.all([
    supabase.from("cms_courses").select("id,slug"),
    supabase.from("cms_course_units").select("course_id,code"),
    supabase.from("cms_course_attachments").select("id,course_id,name,url,original_file_name,bucket_name,storage_path,legacy_url,sort").order("course_id").order("sort"),
  ]);
  if (courseError || unitError || attachmentError) throw new Error(courseError?.message || unitError?.message || attachmentError?.message);
  const report = { mode: APPLY ? "apply" : "dry-run", generatedAt: new Date().toISOString(), units: { staticCourses: staticUnits.size, staticUnits: 0, existing: existingUnits.length, inserted: 0, skipped: 0, uncertain: [] }, attachments: [] };
  const bySlug = new Map(courses.map((course) => [course.slug, course]));
  const existing = new Set(existingUnits.map((unit) => `${unit.course_id}:${unit.code}`));
  const inserts = [];
  for (const [slug, units] of staticUnits) {
    report.units.staticUnits += units.length;
    const course = bySlug.get(slug);
    if (!course) { report.units.uncertain.push({ slug, reason: "No cms_courses match" }); continue; }
    for (const unit of units) {
      if (existing.has(`${course.id}:${unit.code}`)) { report.units.skipped++; continue; }
      inserts.push({ id: deterministicUnitId(course.id, unit.sort, unit.code), course_id: course.id, ...unit });
    }
  }
  if (APPLY && inserts.length) {
    const { error } = await supabase.from("cms_course_units").insert(inserts);
    if (error) throw new Error(`Unit insert failed: ${error.message}`);
    report.units.inserted = inserts.length;
  } else report.units.inserted = inserts.length;
  await auditAndMigrateAttachments(attachments, report);
  const reportPath = await jsonReport(report);
  console.log(JSON.stringify({ reportPath, units: report.units, attachments: report.attachments.length }, null, 2));
}

main().catch(async (error) => { console.error(error); process.exitCode = 1; });
