import { useEffect, useRef, useState } from "react";
import { isReadableFile } from "@/lib/ocrFile";
import { SCAN_CONFIG, type ScanType } from "@/lib/docScan";

type Props = {
  type: ScanType;
  /** Name of an existing upload field in the form to read from (no extra upload needed). */
  source?: string;
  /** Name of an existing upload field the chosen file should also be copied into. */
  target?: string;
  onExtract: (values: Record<string, string>) => void;
};

export default function DocumentScanWidget({ type, source, target, onExtract }: Props) {
  const config = SCAN_CONFIG[type];
  const containerRef = useRef<HTMLDivElement>(null);
  const ownInputRef = useRef<HTMLInputElement>(null);
  const onExtractRef = useRef(onExtract);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "error"; text?: string }>({ kind: "idle" });

  onExtractRef.current = onExtract;

  const hasOwnPicker = !source;

  const findInput = (name: string): HTMLInputElement | null =>
    containerRef.current?.closest("form")?.querySelector<HTMLInputElement>(`input[name="${name}"]`) ?? null;

  /** Mirrors the file picked here into the real upload field further down the form. */
  const propagateToTarget = (file: File) => {
    if (!target) return;
    const input = findInput(target);
    if (!input) return;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {
      /* Older browsers without DataTransfer — the applicant can attach the file manually. */
    }
  };

  /** Reads a chosen document and writes whatever it can into the form — no extra click needed. */
  const runScan = async (file: File) => {
    if (!isReadableFile(file)) {
      setStatus({
        kind: "error",
        text: "Auto-read works on photos (JPG or PNG) and PDFs. Please attach your document as one of those.",
      });
      return;
    }

    setBusy(true);
    setProgress(0);
    setStatus({ kind: "idle" });

    try {
      const { recognizeImage } = await import("@/lib/ocr");
      const { parseDocument } = await import("@/lib/docScan");
      const text = await recognizeImage(file, (value) => setProgress(Math.round(value * 100)));
      const parsed = parseDocument(type, text);
      const count = Object.keys(parsed).length;
      if (count === 0) {
        setStatus({ kind: "error", text: "We couldn’t read this document. Please type the details in manually." });
        return;
      }
      onExtractRef.current(parsed);
      setStatus({
        kind: "ok",
        text: `Auto-filled ${count} field${count === 1 ? "" : "s"}. Please review and edit anything that looks off.`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Scanning failed. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  /** Reads the file the applicant just attached to the linked upload field. */
  const readLinkedFile = (input: HTMLInputElement) => {
    const file = input.files?.[0] ?? null;
    setStatus({ kind: "idle" });
    if (file) void runScan(file);
  };

  // Own picker: read as soon as a photo is chosen.
  const handleOwnFileChange = () => {
    const file = ownInputRef.current?.files?.[0] ?? null;
    setFileName(file?.name ?? "");
    setStatus({ kind: "idle" });
    if (file) {
      propagateToTarget(file);
      void runScan(file);
    }
  };

  // Linked to an existing upload field: auto-read whenever that field changes.
  useEffect(() => {
    if (!source) return undefined;
    const input = findInput(source);
    if (!input) return undefined;
    const handler = () => readLinkedFile(input);
    input.addEventListener("change", handler);
    return () => input.removeEventListener("change", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, type]);

  return (
    <div ref={containerRef} className="rounded-lg border border-primary-200 bg-primary-50/60 p-3.5 md:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-100 text-primary-700">
            <i className={`${config.icon} text-lg`} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground-900">{config.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-foreground-600">
              {hasOwnPicker
                ? config.hint
                : "Attach your document in the field below — we read it automatically the moment you add the file."}
            </p>
          </div>
        </div>

        {hasOwnPicker ? (
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-4 py-2 text-xs font-semibold text-background-50 transition-colors hover:bg-primary-600 sm:w-auto">
              <i className={busy ? "ri-loader-4-line animate-spin" : "ri-upload-2-line"} aria-hidden="true" />
              {busy ? `Reading… ${progress}%` : fileName ? "Change photo" : "Upload photo"}
              <input
                ref={ownInputRef}
                type="file"
                accept="image/*"
                onChange={handleOwnFileChange}
                disabled={busy}
                className="sr-only"
              />
            </label>
          </div>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-700">
            <i className={busy ? "ri-loader-4-line animate-spin" : "ri-magic-line"} aria-hidden="true" />
            {busy ? `Reading… ${progress}%` : "Auto-reads on upload"}
          </span>
        )}
      </div>

      {hasOwnPicker && fileName ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-foreground-600">
          <i className="ri-attachment-2" aria-hidden="true" />
          {fileName}
        </p>
      ) : null}

      {status.kind !== "idle" ? (
        <p
          className={`mt-3 flex items-start gap-2 text-xs ${status.kind === "ok" ? "text-accent-900" : "text-primary-800"}`}
          role="status"
        >
          <i
            className={status.kind === "ok" ? "ri-checkbox-circle-line mt-px" : "ri-alert-line mt-px"}
            aria-hidden="true"
          />
          <span>{status.text}</span>
        </p>
      ) : null}
    </div>
  );
}
