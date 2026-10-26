// P05-02 Azure adapter contract (REG-DOC / REG-JOBS). Deterministic mocks only:
// the global fetch is replaced so any accidental network use fails, and the
// adapter receives an injected fake Azure plus a fake clock/sleep.
import assert from "node:assert/strict";
import test from "node:test";
import { buildExtractionEnvelope, type ExtractionCategory, type ExtractionRequest, type ExtractionSuccess } from "../supabase/functions/_shared/document-extraction/contract.ts";
import { createAzureProvider } from "../supabase/functions/_shared/document-extraction/azure.ts";
import { createDocumentExtractionProvider } from "../supabase/functions/_shared/document-extraction/select.ts";

const realFetch = globalThis.fetch;
globalThis.fetch = (() => { throw new Error("Network is forbidden in Azure adapter tests"); }) as typeof fetch;
test.after(() => { globalThis.fetch = realFetch; });

const ENDPOINT = "https://skyline-test.cognitiveservices.azure.com";
const KEY = "synthetic-azure-key-0001";
const RESULT = "11111111-2222-3333-4444-555555555555";
const pdf = new TextEncoder().encode("%PDF-1.4\nsynthetic\n%%EOF");
const req = (category: ExtractionCategory, extra: Partial<ExtractionRequest> = {}): ExtractionRequest => ({
  bytes: pdf, mimeType: "application/pdf", filename: "synthetic.pdf", category, jobId: "job-1", attempt: 1, signal: new AbortController().signal, ...extra,
});

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null };
type Step = Response | ((call: Call) => Response | Promise<Response> | Error);
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const accepted = (retryAfter?: string, model = "prebuilt-idDocument") => new Response(null, { status: 202, headers: { "Operation-Location": `${ENDPOINT}/documentintelligence/documentModels/${model}/analyzeResults/${RESULT}?api-version=2024-11-30`, ...(retryAfter ? { "Retry-After": retryAfter } : {}) } });
const running = (retryAfter?: string) => json({ status: "running" }, 200, retryAfter ? { "Retry-After": retryAfter } : {});
const field = (value: Record<string, unknown>, page = 1, confidence?: number) => ({ content: "printed", ...value, ...(confidence === undefined ? {} : { confidence }), boundingRegions: [{ pageNumber: page, polygon: [] }] });
const passportDoc = (docType = "idDocument.passport") => ({
  docType, fields: {
    FirstName: field({ type: "string", valueString: "Asha" }, 1, 0.98), LastName: field({ type: "string", valueString: "Testperson" }, 1, 0.97),
    DateOfBirth: field({ type: "date", valueDate: "1999-04-05" }), Sex: field({ type: "string", valueString: "F" }),
    DocumentNumber: field({ type: "string", valueString: "X1234567" }, 1, 0.91), DateOfExpiration: field({ type: "date", valueDate: "2031-08-09" }),
    Nationality: field({ type: "countryRegion", valueCountryRegion: "IND" }), CountryRegion: field({ type: "countryRegion", valueCountryRegion: "IND" }),
  },
});
const succeeded = (documents: unknown[], modelId = "prebuilt-idDocument") => json({ status: "succeeded", analyzeResult: { apiVersion: "2024-11-30", modelId, pages: [{ pageNumber: 1 }], documents } });

function harness(steps: Step[], extra: { modelMap?: Record<string, string>; maxPolls?: number; totalTimeoutMs?: number } = {}) {
  const calls: Call[] = []; const sleeps: number[] = []; let clock = 1_000_000; let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(url), method: init?.method ?? "GET", headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), body: typeof init?.body === "string" ? init.body : null };
    calls.push(call);
    const step = steps[Math.min(i++, steps.length - 1)];
    const result = typeof step === "function" ? await step(call) : step.clone();
    if (result instanceof Error) throw result;
    return result;
  }) as typeof fetch;
  const provider = createAzureProvider({
    endpoint: ENDPOINT, apiKey: KEY, modelMap: { Passport: "prebuilt-idDocument", "Driving Licence": "prebuilt-idDocument", ...(extra.modelMap ?? {}) },
    fetch: fetchImpl, now: () => clock, sleep: async (ms: number, signal: AbortSignal) => { if (signal.aborted) return; sleeps.push(ms); clock += ms; },
    ...(extra.maxPolls ? { maxPolls: extra.maxPolls } : {}), ...(extra.totalTimeoutMs ? { totalTimeoutMs: extra.totalTimeoutMs } : {}),
  });
  return { provider, calls, sleeps };
}
const ok = (outcome: Awaited<ReturnType<ReturnType<typeof harness>["provider"]["extract"]>>) => { assert.equal(outcome.ok, true, JSON.stringify(outcome)); return outcome as ExtractionSuccess; };
const bad = (outcome: Awaited<ReturnType<ReturnType<typeof harness>["provider"]["extract"]>>) => { assert.equal(outcome.ok, false, JSON.stringify(outcome)); return outcome as Extract<typeof outcome, { ok: false }>; };

test("endpoint must be https on an Azure Cognitive Services host with no credentials, path or query", () => {
  const make = (endpoint: string) => () => createAzureProvider({ endpoint, apiKey: KEY, modelMap: {} });
  for (const endpoint of ["http://skyline-test.cognitiveservices.azure.com", "https://example.com", "https://evil.com/.cognitiveservices.azure.com", "https://user:pw@skyline-test.cognitiveservices.azure.com", "https://skyline-test.cognitiveservices.azure.com/path", "https://skyline-test.cognitiveservices.azure.com/?x=1", "not a url", "https://cognitiveservices.azure.com.evil.com"]) {
    assert.throws(make(endpoint), /EF_AZURE_DOCUMENT_ENDPOINT/, endpoint);
  }
  assert.doesNotThrow(make(ENDPOINT));
  assert.doesNotThrow(make(`${ENDPOINT}/`));
});

test("accepted, polled, succeeded: exact request, mapped candidates, evidence, receipt and no credentials in output", async () => {
  const { provider, calls, sleeps } = harness([accepted(), running(), running(), () => succeeded([passportDoc()])]);
  const outcome = ok(await provider.extract(req("Passport")));
  const post = calls[0];
  assert.equal(post.method, "POST");
  assert.equal(post.url, `${ENDPOINT}/documentintelligence/documentModels/prebuilt-idDocument:analyze?_overload=analyzeDocument&api-version=2024-11-30`);
  assert.equal(post.headers["Ocp-Apim-Subscription-Key"], KEY);
  assert.equal(post.headers["Content-Type"], "application/json");
  assert.deepEqual(Object.keys(JSON.parse(post.body!)), ["base64Source"]);
  assert.equal(JSON.parse(post.body!).base64Source, btoa(String.fromCharCode(...pdf)));
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.slice(1).map((c) => c.url), Array(3).fill(`${ENDPOINT}/documentintelligence/documentModels/prebuilt-idDocument/analyzeResults/${RESULT}?api-version=2024-11-30`));
  assert.ok(calls.slice(1).every((c) => c.method === "GET" && c.body === null && c.headers["Ocp-Apim-Subscription-Key"] === KEY));
  assert.deepEqual(sleeps, [2000, 5000, 13000]);
  assert.equal(outcome.operationId, RESULT);
  assert.equal(outcome.categoryMismatch, false);
  assert.deepEqual(outcome.fields, { first_name: "Asha", last_name: "Testperson", dob: "1999-04-05", gender: "Female", passport_number: "X1234567", passport_expiry: "2031-08-09" });
  assert.deepEqual(outcome.confidence, { first_name: 0.98, last_name: 0.97, passport_number: 0.91 });
  assert.ok(outcome.evidence.some((e) => e.field === "passport_number" && e.page === 1 && e.source === "Azure DocumentNumber"));
  assert.ok(outcome.warnings.some((w) => /country/i.test(w)), "unconverted country codes must be disclosed, not guessed");
  assert.equal(outcome.usage.model, "prebuilt-idDocument");
  assert.equal(outcome.usage.apiVersion, "2024-11-30");
  assert.ok(!JSON.stringify(outcome).includes(KEY));
  const envelope = buildExtractionEnvelope(provider, outcome, "t");
  assert.equal(envelope.source.engine, "azure-document-intelligence");
  assert.equal(envelope.status, "unreviewed");
});

test("the accepted operation id is reported before polling so a retry can reuse it", async () => {
  const order: string[] = [];
  const { provider } = harness([accepted(), (c) => { order.push(`poll:${c.method}`); return succeeded([passportDoc()]); }]);
  ok(await provider.extract(req("Passport", { onOperationAccepted: async (id) => { order.push(`accepted:${id}`); } })));
  assert.deepEqual(order, [`accepted:${RESULT}`, "poll:GET"]);
});

test("a failing receipt hook never loses the analysis", async () => {
  const { provider } = harness([accepted(), succeeded([passportDoc()])]);
  ok(await provider.extract(req("Passport", { onOperationAccepted: async () => { throw new Error("db down"); } })));
});

test("a retry with a stored operation id polls it and never submits the document again", async () => {
  const { provider, calls } = harness([() => succeeded([passportDoc()])]);
  const outcome = ok(await provider.extract(req("Passport", { resumeOperationId: RESULT })));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(outcome.operationId, RESULT);
});

test("a stored operation that Azure no longer has falls back to exactly one fresh submission", async () => {
  const { provider, calls } = harness([() => json({ error: { code: "NotFound", message: "x" } }, 404), accepted(), succeeded([passportDoc()])]);
  ok(await provider.extract(req("Passport", { resumeOperationId: RESULT })));
  assert.deepEqual(calls.map((c) => c.method), ["GET", "POST", "GET"]);
});

test("a malformed stored operation id is ignored rather than interpolated into a URL", async () => {
  const { provider, calls } = harness([accepted(), succeeded([passportDoc()])]);
  ok(await provider.extract(req("Passport", { resumeOperationId: "../../other?x=1" })));
  assert.equal(calls[0].method, "POST");
  assert.ok(calls.every((c) => !c.url.includes("other")));
});

test("Retry-After is honoured within bounds and polling never runs faster than every two seconds", async () => {
  const { provider, sleeps } = harness([accepted("7"), running("1"), running("999"), succeeded([passportDoc()])]);
  ok(await provider.extract(req("Passport")));
  assert.deepEqual(sleeps, [7000, 2000, 34000]);
  assert.ok(sleeps.every((ms) => ms >= 2000));
});

test("polling is bounded by a total deadline and a poll cap", async () => {
  const deadline = harness([accepted(), running()], { totalTimeoutMs: 30_000 });
  const timeout = bad(await deadline.provider.extract(req("Passport")));
  assert.deepEqual([timeout.code, timeout.retryable], ["timeout", true]);
  assert.ok(deadline.sleeps.reduce((a, b) => a + b, 0) <= 30_000);
  const capped = harness([accepted(), running()], { maxPolls: 3, totalTimeoutMs: 10 * 60_000 });
  const cap = bad(await capped.provider.extract(req("Passport")));
  assert.deepEqual([cap.code, cap.retryable], ["timeout", true]);
  assert.equal(capped.calls.filter((c) => c.method === "GET").length, 3);
});

test("HTTP failures map to typed codes and never echo credentials, endpoint or provider text", async () => {
  const cases: [number, string, boolean][] = [[429, "rate_limit", true], [500, "provider", true], [503, "provider", true], [400, "validation", false], [413, "validation", false], [415, "validation", false], [401, "provider", false], [403, "provider", false]];
  for (const [status, code, retryable] of cases) {
    const { provider } = harness([() => json({ error: { code: "X", message: "SECRET DOCUMENT TEXT Asha Testperson" } }, status)]);
    const outcome = bad(await provider.extract(req("Passport")));
    assert.deepEqual([outcome.code, outcome.retryable], [code, retryable], String(status));
    const text = JSON.stringify(outcome);
    assert.ok(!text.includes(KEY) && !text.includes("cognitiveservices") && !text.includes("Testperson"), text);
  }
});

test("transient poll errors are retried a bounded number of times then reported retryable", async () => {
  const flaky = harness([accepted(), () => json({}, 503), () => json({}, 429), succeeded([passportDoc()])]);
  ok(await flaky.provider.extract(req("Passport")));
  const dead = harness([accepted(), () => json({}, 503)]);
  const outcome = bad(await dead.provider.extract(req("Passport")));
  assert.deepEqual([outcome.code, outcome.retryable], ["provider", true]);
  assert.ok(dead.calls.length <= 5);
});

test("network errors and abort are distinguished", async () => {
  const net = harness([() => new Error("socket hang up secret-host")]);
  const outcome = bad(await net.provider.extract(req("Passport")));
  assert.deepEqual([outcome.code, outcome.retryable], ["network", true]);
  assert.ok(!outcome.message.includes("secret-host"));
  const timeoutError = Object.assign(new Error("t"), { name: "TimeoutError" });
  const slow = bad(await harness([() => timeoutError]).provider.extract(req("Passport")));
  assert.deepEqual([slow.code, slow.retryable], ["timeout", true]);
});

test("malformed and unexpected responses are retryable schema errors", async () => {
  const notJson = bad(await harness([accepted(), () => new Response("<html>", { status: 200 })]).provider.extract(req("Passport")));
  assert.deepEqual([notJson.code, notJson.retryable], ["schema", true]);
  const weird = bad(await harness([accepted(), () => json({ status: "mystery" })]).provider.extract(req("Passport")));
  assert.equal(weird.code, "schema");
  const noOp = bad(await harness([() => new Response(null, { status: 202 })]).provider.extract(req("Passport")));
  assert.equal(noOp.code, "schema");
  const ok200 = bad(await harness([() => json({ status: "succeeded" }, 200)]).provider.extract(req("Passport")));
  assert.equal(ok200.code, "schema");
  const noFields = bad(await harness([accepted(), () => json({ status: "succeeded", analyzeResult: { modelId: "prebuilt-idDocument" } })]).provider.extract(req("Passport")));
  assert.equal(noFields.code, "schema");
});

test("a failed analysis is permanent for invalid content and retryable otherwise", async () => {
  const invalid = bad(await harness([accepted(), () => json({ status: "failed", error: { code: "InvalidContent", message: "bad pdf" } })]).provider.extract(req("Passport")));
  assert.deepEqual([invalid.code, invalid.retryable], ["validation", false]);
  const other = bad(await harness([accepted(), () => json({ status: "failed", error: { code: "InternalServerError", message: "oops" } })]).provider.extract(req("Passport")));
  assert.deepEqual([other.code, other.retryable], ["provider", true]);
});

test("an Operation-Location on another host is refused and the key is never sent there", async () => {
  const evil = () => new Response(null, { status: 202, headers: { "Operation-Location": `https://evil.example/documentintelligence/documentModels/prebuilt-idDocument/analyzeResults/${RESULT}?api-version=2024-11-30` } });
  const { provider, calls } = harness([evil, succeeded([passportDoc()])]);
  const outcome = bad(await provider.extract(req("Passport")));
  assert.equal(outcome.retryable, false);
  assert.equal(calls.length, 1);
  assert.ok(calls.every((c) => c.url.startsWith(ENDPOINT)));
  const traversal = () => new Response(null, { status: 202, headers: { "Operation-Location": `${ENDPOINT}/documentintelligence/documentModels/prebuilt-idDocument/analyzeResults/..%2F..%2Fadmin` } });
  assert.equal(bad(await harness([traversal]).provider.extract(req("Passport"))).retryable, false);
});

test("model and category mismatch: wrong document type supplies no fields; wrong model is rejected; unmapped category never calls Azure", async () => {
  const licence = ok(await harness([accepted(), succeeded([passportDoc("idDocument.driverLicense")])]).provider.extract(req("Passport")));
  assert.equal(licence.categoryMismatch, true);
  assert.deepEqual(buildExtractionEnvelope(createAzureProvider({ endpoint: ENDPOINT, apiKey: KEY, modelMap: {} }), licence, "t").extracted, {});
  const unknown = ok(await harness([accepted(), succeeded([passportDoc("idDocument.nationalIdentityCard")])]).provider.extract(req("Passport")));
  assert.equal(unknown.categoryMismatch, true);
  const wrongModel = bad(await harness([accepted(), succeeded([passportDoc()], "some-other-model")]).provider.extract(req("Passport")));
  assert.deepEqual([wrongModel.code, wrongModel.retryable], ["schema", false]);
  const none = harness([accepted()]);
  const unmapped = bad(await none.provider.extract(req("Visa")));
  assert.deepEqual([unmapped.code, unmapped.retryable], ["validation", false]);
  assert.equal(none.calls.length, 0);
});

test("empty analysis is a successful no_fields outcome", async () => {
  const outcome = ok(await harness([accepted(), succeeded([])]).provider.extract(req("Passport")));
  assert.deepEqual(outcome.fields, {});
  assert.ok(outcome.warnings.length > 0);
  assert.equal(buildExtractionEnvelope(createAzureProvider({ endpoint: ENDPOINT, apiKey: KEY, modelMap: {} }), outcome, "t").status, "no_fields");
});

test("driving licence maps a structured Australian address and keeps unstructured text out", async () => {
  const doc = { docType: "idDocument.driverLicense", fields: {
    FirstName: field({ type: "string", valueString: "Asha" }), LastName: field({ type: "string", valueString: "Testperson" }), DateOfBirth: field({ type: "date", valueDate: "1999-04-05" }),
    Address: field({ type: "address", valueAddress: { streetAddress: "1 Example Street", city: "Sydney", state: "NSW", postalCode: "2000", countryRegion: "AUS" } }),
  } };
  const outcome = ok(await harness([accepted(), succeeded([doc])]).provider.extract(req("Driving Licence")));
  assert.deepEqual(outcome.fields, { first_name: "Asha", last_name: "Testperson", dob: "1999-04-05", address_type: "Australian Address", au_street: "1 Example Street", au_suburb: "Sydney", au_state: "NSW", au_zip: "2000" });
  const plain = { docType: "idDocument.driverLicense", fields: { Address: field({ type: "string", valueString: "1 Example St Sydney NSW" }) } };
  const text = ok(await harness([accepted(), succeeded([plain])]).provider.extract(req("Driving Licence")));
  assert.deepEqual(text.fields, {});
  assert.ok(text.warnings.some((w) => /address/i.test(w)));
});

test("custom models map only fields named with the application's identifiers", async () => {
  const doc = { docType: "english-test-v1", fields: {
    english_type: field({ type: "string", valueString: "IELTS Academic" }, 1, 0.9), english_score: field({ type: "string", valueString: "7.0" }), english_date: field({ type: "date", valueDate: "2026-02-03" }),
    secret_notes: field({ type: "string", valueString: "ignore me" }), first_name: field({ type: "string", valueString: "Asha" }, 2),
  } };
  const outcome = ok(await harness([accepted(undefined, "english-test-v1"), succeeded([doc], "english-test-v1")], { modelMap: { "English Test": "english-test-v1" } }).provider.extract(req("English Test")));
  assert.deepEqual(outcome.fields, { english_type: "IELTS Academic", english_score: "7.0", english_date: "2026-02-03", first_name: "Asha" });
  assert.equal(outcome.evidence.find((e) => e.field === "first_name")?.page, 2);
  assert.ok(!("secret_notes" in outcome.fields));
});

test("out-of-range confidence is dropped, never manufactured or clamped", async () => {
  const doc = passportDoc(); (doc.fields.FirstName as Record<string, unknown>).confidence = 1.7;
  const outcome = ok(await harness([accepted(), succeeded([doc])]).provider.extract(req("Passport")));
  assert.equal(outcome.confidence, undefined);
});

test("cancellation before and during work returns a non-retryable cancelled outcome", async () => {
  const controller = new AbortController(); controller.abort();
  const before = harness([accepted()]);
  const first = bad(await before.provider.extract(req("Passport", { signal: controller.signal })));
  assert.deepEqual([first.code, first.retryable], ["cancelled", false]);
  assert.equal(before.calls.length, 0);
  const live = new AbortController();
  const during = harness([accepted(), () => { live.abort(); return running(); }, succeeded([passportDoc()])]);
  const second = bad(await during.provider.extract(req("Passport", { signal: live.signal })));
  assert.deepEqual([second.code, second.retryable], ["cancelled", false]);
});

test("provider selection: default stays OpenAI, Azure needs its own complete valid configuration, the mock is unreachable", () => {
  const openAi = createDocumentExtractionProvider({ OPENAI_API_KEY: "k", OPENAI_DOCUMENT_MODEL: "m" });
  assert.equal(openAi.provider?.id, "openai-responses");
  assert.equal(createDocumentExtractionProvider({ OPENAI_API_KEY: "k", OPENAI_DOCUMENT_MODEL: "m", EF_DOCUMENT_EXTRACTION_PROVIDER: "openai" }).provider?.id, "openai-responses");
  const missing = createDocumentExtractionProvider({ EF_DOCUMENT_EXTRACTION_PROVIDER: "azure", OPENAI_API_KEY: "k", OPENAI_DOCUMENT_MODEL: "m" });
  assert.equal(missing.provider, null);
  assert.deepEqual(missing.unavailable?.variables, ["EF_AZURE_DOCUMENT_ENDPOINT", "EF_AZURE_DOCUMENT_API_KEY", "EF_AZURE_DOCUMENT_MODEL"]);
  assert.equal(missing.unavailable?.code, "configuration_unavailable");
  const full = { EF_DOCUMENT_EXTRACTION_PROVIDER: "azure", EF_AZURE_DOCUMENT_ENDPOINT: ENDPOINT, EF_AZURE_DOCUMENT_API_KEY: KEY, EF_AZURE_DOCUMENT_MODEL: "prebuilt-idDocument" };
  const azure = createDocumentExtractionProvider(full);
  assert.equal(azure.provider?.id, "azure-document-intelligence");
  assert.match(azure.provider!.model, /2024-11-30/);
  const badEndpoint = createDocumentExtractionProvider({ ...full, EF_AZURE_DOCUMENT_ENDPOINT: "https://example.com" });
  assert.deepEqual([badEndpoint.provider, badEndpoint.unavailable?.code, badEndpoint.unavailable?.variables], [null, "configuration_invalid", ["EF_AZURE_DOCUMENT_ENDPOINT"]]);
  const badMap = createDocumentExtractionProvider({ ...full, EF_AZURE_DOCUMENT_MODEL_MAP: "{nope" });
  assert.deepEqual([badMap.unavailable?.code, badMap.unavailable?.variables], ["configuration_invalid", ["EF_AZURE_DOCUMENT_MODEL_MAP"]]);
  const badCategory = createDocumentExtractionProvider({ ...full, EF_AZURE_DOCUMENT_MODEL_MAP: JSON.stringify({ Hologram: "m1" }) });
  assert.equal(badCategory.unavailable?.code, "configuration_invalid");
  const badVersion = createDocumentExtractionProvider({ ...full, EF_AZURE_DOCUMENT_API_VERSION: "latest" });
  assert.deepEqual(badVersion.unavailable?.variables, ["EF_AZURE_DOCUMENT_API_VERSION"]);
  const mapped = createDocumentExtractionProvider({ ...full, EF_AZURE_DOCUMENT_MODEL_MAP: JSON.stringify({ "English Test": "english-test-v1" }) });
  assert.equal(mapped.provider?.id, "azure-document-intelligence");
  for (const value of ["mock", "MOCK", "azure ", "unknown"]) {
    const result = createDocumentExtractionProvider({ ...full, EF_DOCUMENT_EXTRACTION_PROVIDER: value });
    assert.equal(result.provider, null, value);
    assert.deepEqual(result.unavailable?.variables, ["EF_DOCUMENT_EXTRACTION_PROVIDER"], value);
  }
  assert.ok(!JSON.stringify(badEndpoint).includes("example.com") && !JSON.stringify(missing).includes(KEY));
});
