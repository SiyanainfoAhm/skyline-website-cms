import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? ""; // shared backend secret; never returned
const configuredOpenAiBaseUrl = (Deno.env.get("OPENAI_BASE_URL") ?? "").replace(/\/$/, "");
// A provider override is intentionally available only to the disposable local
// test key and a local Docker/loopback endpoint. Real keys always use OpenAI.
const openAiBaseUrl = openAiKey === "local-test-openai-key" && /^http:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal)(:\d+)?\/v1$/.test(configuredOpenAiBaseUrl)
  ? configuredOpenAiBaseUrl
  : "https://api.openai.com/v1";
/** See public-assistant: parsed endpoints prevent formatted URL text from
 * becoming a provider endpoint. Production is constrained to api.openai.com. */
function openAiEndpoint(resource: "embeddings" | "responses"): string {
  const endpoint = new URL(resource, `${openAiBaseUrl}/`);
  const isLocalTest = openAiKey === "local-test-openai-key";
  if (
    endpoint.pathname !== `/v1/${resource}` ||
    (!isLocalTest && endpoint.origin !== "https://api.openai.com")
  ) {
    throw new Error("invalid_openai_endpoint");
  }
  return endpoint.toString();
}
const model = Deno.env.get("PUBLIC_ASSISTANT_EMBEDDING_MODEL") ?? "text-embedding-3-small";
const dimensions = Number(Deno.env.get("PUBLIC_ASSISTANT_EMBEDDING_DIMENSIONS") ?? "1536");
const workerSecret = Deno.env.get("PUBLIC_ASSISTANT_WORKER_SECRET") ?? "";
const reply = (body: unknown, status = 200) => Response.json(body, { status });
const strip = (html: string) => html.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const safeUrl = (value: string) => value.startsWith("/") || /^https:\/\//i.test(value) ? value : "";

type Page = { number: number; original: string; cleaned: string; status: "digital" | "ocr" | "empty" | "partial" | "failed"; warnings: string[] };
type Source = { type: "course" | "page" | "document"; key: string; version: string; title: string; canonicalUrl: string; content: string; courseCode?: string; pages?: Page[]; fileHash?: string; extractionMethod?: string; extractionStatus?: "complete" | "partial" };
const maxDocumentBytes = Number(Deno.env.get("PUBLIC_ASSISTANT_DOCUMENT_MAX_BYTES") ?? 20 * 1024 * 1024);
const maxDocumentPages = Number(Deno.env.get("PUBLIC_ASSISTANT_DOCUMENT_MAX_PAGES") ?? 120);
const extractionModel = Deno.env.get("PUBLIC_ASSISTANT_DOCUMENT_EXTRACTION_MODEL") ?? "gpt-4.1-mini";

function chunks(content: string, pages?: Page[]): Array<{ heading: string; content: string; pageReference?: string }> {
  const words = content.split(/\s+/).filter(Boolean); const size = Number(Deno.env.get("PUBLIC_ASSISTANT_CHUNK_TOKENS") ?? 420); const overlap = Number(Deno.env.get("PUBLIC_ASSISTANT_CHUNK_OVERLAP") ?? 60);
  const output: Array<{ heading: string; content: string; pageReference?: string }> = [];
  for (let start = 0; start < words.length; start += size - overlap) {
    const part = words.slice(start, start + size).join(" ");
    const pageNumbers = pages?.filter((page) => part.includes(page.cleaned.slice(0, 48))).map((page) => page.number) ?? [];
    if (part) output.push({ heading: pageNumbers.length ? `Document page ${pageNumbers[0]}` : "Published information", content: part, pageReference: pageNumbers.length ? `pp. ${pageNumbers[0]}${pageNumbers.length > 1 ? `–${pageNumbers.at(-1)}` : ""}` : undefined });
    if (start + size >= words.length) break;
  }
  return output;
}

const digest = async (value: Uint8Array | string) => { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value; const result = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(result)].map((x) => x.toString(16).padStart(2, "0")).join(""); };
async function digitalPdfPages(bytes: Uint8Array): Promise<Page[]> { const pdfjs = await import("https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.mjs"); const pdf = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise; if (pdf.numPages > maxDocumentPages) throw new Error(`page_limit_exceeded:${pdf.numPages}`); const pages: Page[] = []; for (let number = 1; number <= pdf.numPages; number++) { const text = (await (await pdf.getPage(number)).getTextContent()).items.map((item: any) => String(item.str ?? "")).join(" ").replace(/\s+/g, " ").trim(); pages.push({ number, original: text, cleaned: text, status: text.length >= 40 ? "digital" : "empty", warnings: text.length >= 40 ? [] : ["No usable embedded text; OCR is required for this page."] }); } return pages; }
const base64 = (bytes: Uint8Array) => { let value = ""; for (let i = 0; i < bytes.length; i += 0x8000) value += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(value); };
async function ocrPdf(bytes: Uint8Array, filename: string): Promise<Page[]> { if (!openAiKey) throw new Error("ocr_fallback_unconfigured"); const b64 = base64(bytes); const response = await fetch(openAiEndpoint("responses"), { method: "POST", signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: extractionModel, max_output_tokens: 12000, input: [{ role: "user", content: [{ type: "input_text", text: "Extract this public PDF verbatim by page. Preserve headings, paragraphs, lists, tables with headers, and policy exceptions. Return JSON only: {pages:[{page:number,text:string,warnings:string[]}]}. Mark unreadable pages with an explicit warning; never invent text." }, { type: "input_file", filename, file_data: `data:application/pdf;base64,${b64}` }] }] }) }); if (!response.ok) throw new Error(`ocr_provider_${response.status}`); const payload = await response.json(); const raw = String(payload.output_text ?? "").replace(/^```json\s*|```$/g, ""); const parsed = JSON.parse(raw); if (!Array.isArray(parsed.pages) || !parsed.pages.length) throw new Error("ocr_invalid_page_output"); return parsed.pages.map((p: any) => ({ number: Number(p.page), original: String(p.text ?? ""), cleaned: String(p.text ?? "").replace(/\s+/g, " ").trim(), status: String(p.text ?? "").trim() ? "ocr" : "failed", warnings: Array.isArray(p.warnings) ? p.warnings.map(String) : [] })); }
async function extractDocument(admin: ReturnType<typeof createClient>, doc: any, version: string): Promise<Source> { const bucket = String(doc.bucket_name ?? ""), path = String(doc.storage_path ?? ""), mime = String(doc.mime_type ?? "").toLowerCase(); if (bucket !== "cms-media" || !path.startsWith("forms/") && !path.startsWith("policies/")) throw new Error("untrusted_document_location"); if (mime !== "application/pdf") throw new Error("unsupported_document_type"); if (!doc.file_size || Number(doc.file_size) > maxDocumentBytes) throw new Error("document_size_limit"); const { data: blob, error } = await admin.storage.from(bucket).download(path); if (error || !blob) throw new Error("document_download_failed"); const bytes = new Uint8Array(await blob.arrayBuffer()); if (!bytes.length || bytes.length > maxDocumentBytes || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("invalid_pdf_signature"); let pages: Page[]; let method = "pdfjs-digital-v1"; try { pages = await digitalPdfPages(bytes); if (pages.some((page) => page.status === "empty")) { const ocr = await ocrPdf(bytes, String(doc.original_file_name ?? doc.file_name ?? "document.pdf")); pages = pages.map((page) => ocr.find((candidate) => candidate.number === page.number) ?? { ...page, status: "failed", warnings: [...page.warnings, "OCR did not return this page."] }); method = "pdfjs+openai-page-ocr-v1"; } } catch { pages = await ocrPdf(bytes, String(doc.original_file_name ?? doc.file_name ?? "document.pdf")); method = "openai-page-ocr-v1"; } const bad = pages.filter((page) => page.status === "failed" || !page.cleaned).length; if (bad) throw new Error(`document_partial_or_unreadable:${bad}`); const original = pages.map((page) => `\n\n[Page ${page.number}]\n${page.original}`).join(""); const cleaned = pages.map((page) => `\n\n[Page ${page.number}]\n${page.cleaned}`).join(""); const fileHash = await digest(bytes); const { data: textRow, error: textError } = await admin.from("public_assistant_document_text").upsert({ document_id: doc.id, source_version: version, file_hash: fileHash, original_text: original, cleaned_text: cleaned, extraction_method: method, extraction_version: "public-document-extraction-v1", processing_status: "complete", warning: pages.flatMap((page) => page.warnings), extracted_at: new Date().toISOString() }, { onConflict: "document_id,source_version,file_hash" }).select("id").single(); if (textError || !textRow) throw new Error("document_text_persist_failed"); const { data: corrections } = await admin.from("public_assistant_document_corrections").select("page_number,replacement_text").eq("document_text_id", textRow.id).not("approved_at", "is", null); pages = pages.map((page) => { const correction = (corrections ?? []).find((item: any) => item.page_number === page.number); return correction ? { ...page, cleaned: String(correction.replacement_text), warnings: [...page.warnings, "Approved CMS correction applied to indexing text."] } : page; }); const indexedText = pages.map((page) => `\n\n[Page ${page.number}]\n${page.cleaned}`).join(""); await admin.from("public_assistant_document_text").update({ cleaned_text: indexedText, updated_at: new Date().toISOString() }).eq("id", textRow.id); await admin.from("public_assistant_document_pages").delete().eq("document_text_id", textRow.id); const { error: pagesError } = await admin.from("public_assistant_document_pages").insert(pages.map((page) => ({ document_text_id: textRow.id, page_number: page.number, original_text: page.original, cleaned_text: page.cleaned, status: page.status, warnings: page.warnings }))); if (pagesError) throw new Error("document_pages_persist_failed"); return { type: "document", key: doc.id, version, title: String(doc.name), canonicalUrl: safeUrl(String(doc.url)), content: indexedText, pages, fileHash, extractionMethod: method, extractionStatus: "complete" }; }

async function loadSource(admin: ReturnType<typeof createClient>, job: { source_type: Source["type"]; source_key: string; source_version: string }): Promise<Source | null> {
  if (job.source_type === "course") {
    const { data: course } = await admin.from("cms_courses").select("id,slug,code,name,cricos,duration,mode,fees,full_description,entry_requirements,status").eq("id", job.source_key).eq("status", "Published").maybeSingle();
    if (!course) return null;
    const { data: sections } = await admin.from("cms_course_sections").select("title,body").eq("course_id", course.id).order("sort");
    const content = [course.name, course.code, course.cricos, course.duration, course.mode, course.fees, course.full_description, course.entry_requirements, ...(sections ?? []).flatMap((row) => [row.title, row.body])].map((value) => strip(String(value ?? ""))).filter(Boolean).join("\n");
    return { type: "course", key: course.id, version: job.source_version, title: String(course.name), canonicalUrl: `/courses/${course.slug}`, content, courseCode: String(course.code ?? "") };
  }
  if (job.source_type === "page") {
    const { data } = await admin.from("cms_pages").select("id,slug,title,body,status").eq("id", job.source_key).eq("status", "Published").maybeSingle();
    return data ? { type: "page", key: data.id, version: job.source_version, title: data.title, canonicalUrl: safeUrl(`/${String(data.slug).replace(/^\//, "")}`), content: strip(`${data.title}\n${data.body}`) } : null;
  }
  const { data } = await admin.from("cms_documents").select("id,name,description,url,status,assistant_publication_approved,bucket_name,storage_path,mime_type,file_size,file_name,original_file_name").eq("id", job.source_key).eq("status", "Published").eq("assistant_publication_approved", true).maybeSingle();
  return data && safeUrl(String(data.url)) ? extractDocument(admin, data, job.source_version) : null;
}

async function embed(input: string): Promise<{ vector: number[]; tokens: number }> {
  if (!openAiKey) throw new Error("OPENAI_API_KEY is not configured for server-side assistant indexing.");
  const response = await fetch(openAiEndpoint("embeddings"), { method: "POST", signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input, dimensions, encoding_format: "float" }) });
  if (!response.ok) throw new Error(`embedding_provider_${response.status}`);
  const payload = await response.json(); const vector = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== dimensions) throw new Error(`embedding_dimension_mismatch:${Array.isArray(vector) ? vector.length : 0}:${dimensions}`);
  return { vector, tokens: Number(payload?.usage?.total_tokens ?? 0) };
}

async function processOne() {
  if (!workerSecret) return reply({ error: "Worker is not configured." }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: claimed, error } = await admin.rpc("public_assistant_claim_index_job");
  if (error) return reply({ error: "Unable to claim indexing work." }, 500);
  const job = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!job) return reply({ processed: false });
  const fail = async (message: string) => {
    // Every terminal transition is conditioned on the lease minted at claim
    // time. A reclaimed/stale worker therefore cannot overwrite fresh work.
    const { data: accepted } = await admin.rpc("public_assistant_fail_index_job", { p_job: job.id, p_lease: job.lease_token, p_error: message });
    const retry = Boolean(accepted) && Number(job.attempt_count) < 3;
    await admin.from("public_assistant_usage_events").insert({ kind: "index_failure", model, request_key: job.id });
    return reply({ processed: true, retry }, retry ? 202 : 422);
  };
  try {
    const source = await loadSource(admin, job);
    if (!source) {
      await admin.rpc("public_assistant_cancel_index_job", { p_job: job.id, p_lease: job.lease_token });
      return reply({ processed: true, cancelled: true });
    }
    const contentHash = source.fileHash ?? await digest(source.content);
    // Replacement chunks are staged under a new immutable source version.
    // The currently published version remains queryable until finish RPC makes
    // activation and cache invalidation a single database transaction.
    const { data: stored, error: storeError } = await admin.from("public_assistant_sources").upsert({ source_type: source.type, source_key: source.key, canonical_url: source.canonicalUrl, title: source.title, publication_status: "staged", source_version: source.version, content_hash: contentHash }, { onConflict: "source_type,source_key,source_version" }).select("id").single();
    if (storeError || !stored) throw new Error("source_persist_failed");
    // Re-running the same leased job is recoverable: stale partial chunks are
    // replaced only in its unpublished staging version.
    const { error: deleteError } = await admin.from("public_assistant_chunks").delete().eq("source_id", stored.id);
    if (deleteError) throw new Error("chunk_replace_failed");
    let tokens = 0;
    for (const [ordinal, chunk] of chunks(source.content, source.pages).entries()) {
      const result = await embed(chunk.content); tokens += result.tokens;
      const { error: chunkError } = await admin.from("public_assistant_chunks").insert({ source_id: stored.id, ordinal, heading: chunk.heading, content: chunk.content, content_hash: contentHash, page_reference: chunk.pageReference ?? null, course_code: source.courseCode ?? null, embedding: result.vector, embedding_model: model, embedding_dimensions: dimensions });
      if (chunkError) throw new Error("chunk_persist_failed");
    }
    await admin.from("public_assistant_usage_events").insert({ kind: "embedding", model, input_tokens: tokens, request_key: job.id });
    const { data: activated, error: activationError } = await admin.rpc("public_assistant_finish_index_job", { p_job: job.id, p_lease: job.lease_token, p_source: stored.id });
    if (activationError || !activated) throw new Error("stale_or_invalid_lease");
    return reply({ processed: true });
  } catch (error) { return await fail(error instanceof Error ? error.message : "indexing failed"); }
}

Deno.serve((request) => request.method === "POST" && request.headers.get("x-worker-secret") === workerSecret ? processOne() : reply({ error: "Not authorised." }, 401));
