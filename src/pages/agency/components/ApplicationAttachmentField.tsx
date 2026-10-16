import { useRef, useState } from "react";
import type { AppField } from "@/data/applicationForms";
import { MAX_DOCUMENT_BYTES, type DocumentRow } from "@/pages/agency/lib/portalApplications";
import { extractionStatus } from "@/pages/agency/lib/documentAttachments";

interface Props {
  field: AppField;
  documents: DocumentRow[];
  disabled: boolean;
  busyDocumentId: string;
  onUpload: (files: FileList | null) => Promise<void>;
  onPreview: (document: DocumentRow) => Promise<void>;
  onExtract: (document: DocumentRow) => Promise<void>;
  onDelete: (document: DocumentRow) => Promise<void>;
}

function extractionLabel(state: string): string {
  if (state === "queued") return "Starting AI extraction";
  if (state === "processing") return "Reading document";
  if (state === "unreviewed") return "Ready for review";
  if (state === "no_fields") return "No fields found";
  if (state === "failed") return "Extraction failed";
  if (state === "cancelled") return "Extraction cancelled";
  return state;
}

function extractionDetail(document: DocumentRow, state: string): string | null {
  const extraction = document.metadata.extraction as { source?: { queuedAt?: unknown; startedAt?: unknown }; error?: { message?: unknown } } | undefined;
  if (state === "failed" && typeof extraction?.error?.message === "string") return extraction.error.message;
  if (state !== "queued" && state !== "processing") return null;
  const timestamp = extraction?.source?.startedAt ?? extraction?.source?.queuedAt ?? document.createdAt;
  const started = new Date(String(timestamp)).getTime();
  if (!Number.isFinite(started)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  return state === "queued" ? `Queued ${seconds}s ago` : `Processing for ${seconds}s`;
}

export default function ApplicationAttachmentField({ field, documents, disabled, busyDocumentId, onUpload, onPreview, onExtract, onDelete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<DocumentRow | null>(null);
  const [error, setError] = useState("");
  const allowAdditional = Boolean(field.multiple);

  const upload = async (files: FileList | null) => {
    setError("");
    try { await onUpload(files); if (inputRef.current) inputRef.current.value = ""; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Document upload failed."); }
  };

  const deleteDocument = async () => {
    if (!deleteCandidate) return;
    setError("");
    try { await onDelete(deleteCandidate); setDeleteCandidate(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Document deletion failed."); }
  };

  const preview = async (document: DocumentRow) => {
    setError("");
    try { await onPreview(document); } catch (cause) { setError(cause instanceof Error ? cause.message : "Document preview failed."); }
  };

  const extract = async (document: DocumentRow) => {
    setError("");
    try { await onExtract(document); } catch (cause) { setError(cause instanceof Error ? cause.message : "Extraction request failed."); }
  };

  return (
    <div className="space-y-2">
      {documents.map((document) => {
        const state = extractionStatus(document.metadata);
        const detail = extractionDetail(document, state);
        const working = busyDocumentId === document.id;
        const pending = state === "queued" || state === "processing";
        return (
          <div key={document.id} className="flex flex-col gap-2 rounded-md border border-background-200 bg-background-100/70 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <i className="ri-file-shield-2-line mt-0.5 shrink-0 text-primary-600" aria-hidden="true" />
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-foreground-900">{document.filename}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-foreground-600">
                  <span>Review: {document.reviewState}</span><span>Extraction: {extractionLabel(state)}</span>
                </p>
                {detail ? <p className={state === "failed" ? "mt-1 text-[11px] text-primary-800" : "mt-1 text-[11px] text-foreground-500"}>{detail}</p> : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" title="Preview document" disabled={working} onClick={() => void preview(document)} className="rounded p-2 text-foreground-700 hover:bg-background-200 disabled:opacity-50"><i className="ri-eye-line" aria-hidden="true" /><span className="sr-only">Preview {document.filename}</span></button>
              <button type="button" title={pending ? "Extraction is already running" : "Extract or retry"} disabled={disabled || working || pending} onClick={() => void extract(document)} className="rounded p-2 text-primary-700 hover:bg-primary-100 disabled:opacity-50"><i className={working ? "ri-loader-4-line animate-spin" : "ri-refresh-line"} aria-hidden="true" /><span className="sr-only">Extract or retry {document.filename}</span></button>
              <button type="button" title="Delete document" disabled={disabled || working} onClick={() => setDeleteCandidate(document)} className="rounded p-2 text-primary-700 hover:bg-primary-100 disabled:opacity-50"><i className="ri-delete-bin-line" aria-hidden="true" /><span className="sr-only">Delete {document.filename}</span></button>
            </div>
          </div>
        );
      })}

      {documents.length === 0 || allowAdditional ? (
        <div>
          <input ref={inputRef} id={`portal-file-${field.name}`} name={field.name} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple={field.multiple} disabled={disabled} onChange={(event) => void upload(event.target.files)} className="w-full cursor-pointer rounded-md border border-dashed border-background-300 bg-background-50 px-3.5 py-2.5 text-sm text-foreground-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60" />
          <p className="mt-1 text-[11px] text-foreground-500">PDF, JPG or PNG only; maximum {Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB per file.</p>
        </div>
      ) : null}

      {error ? <p className="text-xs text-primary-800" role="alert">{error}</p> : null}
      {deleteCandidate ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-attachment-title"><div className="w-full max-w-md rounded-lg bg-background-50 p-5 shadow-xl"><h3 id="delete-attachment-title" className="font-heading font-bold text-foreground-950">Delete document?</h3><p className="mt-2 text-sm text-foreground-600">Delete <strong>{deleteCandidate.filename}</strong> from this editable application? Retained or submitted documents cannot be deleted.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDeleteCandidate(null)} className="rounded-md border border-background-300 px-3 py-2 text-sm font-semibold">Cancel</button><button type="button" disabled={busyDocumentId === deleteCandidate.id} onClick={() => void deleteDocument()} className="rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-background-50 disabled:opacity-50">{busyDocumentId === deleteCandidate.id ? "Deleting…" : "Delete permanently"}</button></div></div></div> : null}
    </div>
  );
}
