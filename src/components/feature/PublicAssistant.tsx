import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/pages/admin/lib/supabase";

type Answer = { answer: string; sources: Array<{ title: string; url: string }> };
const suggestions = ["Which courses are available?", "How do I apply?", "How can I contact SLIT?"];
const REQUEST_TIMEOUT_MS = 20_000;

type FunctionError = { message: string; retryAfterMs: number | null };

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

async function functionError(error: unknown): Promise<FunctionError> {
  // supabase-js returns a FunctionsHttpError for non-2xx Edge Function
  // responses. Its body lives on `context`, rather than `data`.
  const context = error && typeof error === "object" && "context" in error
    ? (error as { context?: unknown }).context
    : undefined;
  if (context && typeof context === "object" && "json" in context && typeof (context as { json?: unknown }).json === "function") {
    try {
      const body = await (context as { json: () => Promise<unknown> }).json();
      const retryAfter = "headers" in context && (context as { headers?: Headers }).headers instanceof Headers
        ? parseRetryAfter((context as { headers: Headers }).headers.get("Retry-After"))
        : null;
      if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
        return { message: (body as { error: string }).error, retryAfterMs: retryAfter };
      }
    } catch {
      // The transport error message below is the safe fallback for malformed bodies.
    }
  }
  return { message: error instanceof Error ? error.message : "The assistant is unavailable right now.", retryAfterMs: null };
}

/** Public, read-only assistant. It sends no application or document data. */
export default function PublicAssistant() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastFailedQuestion, setLastFailedQuestion] = useState("");
  const [retryUntil, setRetryUntil] = useState(0);
  const inFlight = useRef(false);
  const activeRequest = useRef(0);
  const cancelActive = useRef<(() => void) | undefined>(undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    activeRequest.current += 1;
    cancelActive.current?.();
    if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
  }, []);

  const beginRetryCooldown = (delay: number) => {
    const until = Date.now() + delay;
    setRetryUntil(until);
    if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(() => setRetryUntil(0), delay);
  };

  const submitQuestion = async (submittedQuestion: string) => {
    // Capture first: `question` can change while the request is in flight.
    const trimmedQuestion = submittedQuestion.trim();
    if (!trimmedQuestion) {
      setError("Please enter a question.");
      return;
    }
    if (inFlight.current) return;
    if (retryUntil > Date.now()) {
      setError(`Please wait ${Math.ceil((retryUntil - Date.now()) / 1_000)} seconds before asking another question.`);
      return;
    }
    // State updates are asynchronous: this ref prevents double-clicks and
    // Enter+click/suggestion-tap races from creating another logical request.
    inFlight.current = true;
    const requestId = activeRequest.current + 1;
    activeRequest.current = requestId;
    setQuestion("");
    setBusy(true);
    setError("");
    let timeout: number | undefined;
    try {
      const invoke = supabase.functions.invoke("public-assistant", {
        body: { question: trimmedQuestion },
      });
      const timeoutError = new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error("assistant_timeout")), REQUEST_TIMEOUT_MS);
      });
      const cancellation = new Promise<never>((_, reject) => {
        cancelActive.current = () => reject(new Error("assistant_cancelled"));
      });
      const { data, error: invokeError } = await Promise.race([invoke, timeoutError, cancellation]);
      if (requestId !== activeRequest.current) return;
      if (invokeError) throw invokeError;
      if (!data?.answer) {
        const message = typeof data?.error === "string" ? data.error : "The assistant is unavailable right now.";
        throw new Error(message);
      }
      setAnswer({ answer: String(data.answer), sources: Array.isArray(data.sources) ? data.sources : [] });
      setLastFailedQuestion("");
    } catch (cause) {
      if (requestId !== activeRequest.current || (cause instanceof Error && cause.message === "assistant_cancelled")) return;
      const { message, retryAfterMs } = await functionError(cause);
      if (retryAfterMs !== null) beginRetryCooldown(retryAfterMs);
      setLastFailedQuestion(trimmedQuestion);
      setError(cause instanceof Error && cause.message === "assistant_timeout" ? "The assistant took too long to respond. Please try again." : message);
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (requestId === activeRequest.current) {
        cancelActive.current = undefined;
        inFlight.current = false;
        setBusy(false);
      }
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitQuestion(question);
  };

  const toggleWidget = () => {
    if (open) {
      // The SDK version in this app does not expose an AbortSignal. Invalidate
      // the logical request so a late response cannot alter a closed/reopened widget.
      activeRequest.current += 1;
      cancelActive.current?.();
      cancelActive.current = undefined;
      inFlight.current = false;
      setBusy(false);
    }
    setOpen((value) => !value);
  };
  return <>
    <button type="button" aria-expanded={open} aria-controls="public-assistant" onClick={toggleWidget} className="fixed bottom-6 left-6 z-40 rounded-full bg-primary-500 px-4 py-3 text-sm font-semibold text-background-50 shadow-lg hover:bg-primary-600">Ask SLIT</button>
    {open ? <section id="public-assistant" aria-label="SLIT website assistant" className="fixed bottom-20 left-4 z-50 flex h-[min(38rem,calc(100vh-6rem))] w-[min(32rem,calc(100vw-2rem))] flex-col rounded-xl border border-background-200 bg-background-50 p-4 shadow-xl">
      <div className="shrink-0 border-b border-background-200 pb-3">
        <h2 className="font-heading text-base font-bold text-foreground-950">SLIT website assistant</h2>
        <p className="mt-1 text-xs text-foreground-600">Answers use published SLIT information. Please do not share personal or application details.</p>
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="flex flex-wrap gap-2">{suggestions.map((item) => <button key={item} type="button" onClick={() => void submitQuestion(item)} className="rounded-full border border-background-300 px-2.5 py-1 text-xs text-foreground-700 hover:border-primary-400">{item}</button>)}</div>
      {busy ? <div role="status" aria-live="polite" className="mt-4 flex items-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-800"><i className="ri-quill-pen-line animate-pulse text-base" aria-hidden="true" />Generating<span className="animate-pulse">...</span></div> : null}
      {answer ? <div className="mt-3 rounded-md bg-background-100 p-3 text-sm text-foreground-800"><p>{answer.answer}</p>{answer.sources.length ? <ul className="mt-2 space-y-1">{answer.sources.map((source) => <li key={source.url}><a className="text-primary-700 underline" href={source.url}>{source.title}</a></li>)}</ul> : null}</div> : null}
      {error ? <p role="status" className="mt-3 text-xs text-primary-800">{error} {lastFailedQuestion ? <button type="button" onClick={() => void submitQuestion(lastFailedQuestion)} className="ml-1 underline">Retry</button> : null} Please use the contact page for help.</p> : null}
      </div>
      <form className="mt-3 flex shrink-0 gap-2 border-t border-background-200 pt-3" onSubmit={handleSubmit}><input aria-label="Ask a question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} className="min-w-0 flex-1 rounded-md border border-background-300 px-2 py-2 text-sm" /><button disabled={busy || retryUntil > Date.now()} className="inline-flex items-center gap-1.5 rounded-md bg-primary-500 px-3 text-sm font-semibold text-background-50 disabled:opacity-50"><i className="ri-pencil-line" aria-hidden="true" />{busy ? "Generating..." : "Ask"}</button></form>
    </section> : null}
  </>;
}
