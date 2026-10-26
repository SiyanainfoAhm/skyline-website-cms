import assert from "node:assert/strict";
import test from "node:test";
import { isEditableApplicationStatus } from "../src/pages/agency/lib/applicationAccess.ts";
import { availableActions, csvCell, EXPORT_COLUMNS, exportCsv, EXCEPTION_TEXT, normaliseCoeNumber, registrationChecklist, registrationWarning, validateCorrection, verifyBlockers } from "../src/pages/agency/lib/registrationWorkbench.ts";

test("only database-editable portal statuses enable draft UI", () => {
  assert.equal(isEditableApplicationStatus("draft"), true);
  assert.equal(isEditableApplicationStatus("action_required"), true);
  assert.equal(isEditableApplicationStatus("submitted"), false);
  assert.equal(isEditableApplicationStatus("under_review"), false);
  assert.equal(isEditableApplicationStatus("enrolled"), false);
});

test("completion and submission-date lookalikes never affect editability", () => {
  // The helper deliberately receives status only: 0%, 3%, an absent date, and
  // document extraction state are presentation data, not authorisation input.
  assert.equal(isEditableApplicationStatus("draft"), true);
});

// ---- P08-02 manual registration workbench (REG-REGISTER browser validation, export minimization) ----
test("registration: CoE numbers are normalised and malformed values are refused before any request", () => {
  assert.deepEqual(normaliseCoeNumber("  e0000000001 "), { ok: true, value: "E0000000001" });
  for (const bad of ["", "abc", "E 0000000001", "E000000000000000000001", "E0000000001!", "<script>1</script>"]) assert.equal(normaliseCoeNumber(bad).ok, false, bad);
});

test("registration: the warning covers coe_issued and enrolled without a verified registration, and nothing else", () => {
  assert.equal(registrationWarning("coe_issued", null), true);
  assert.equal(registrationWarning("enrolled", "lodged"), true);
  assert.equal(registrationWarning("enrolled", "cancelled"), true);
  assert.equal(registrationWarning("coe_issued", "verified"), false);
  assert.equal(registrationWarning("offer_accepted", null), false);
  assert.equal(registrationWarning("under_review", null), false);
});

test("registration: offered actions follow the lifecycle and a cancelled registration only allows a new one", () => {
  assert.deepEqual(availableActions(null), ["create"]);
  assert.deepEqual(availableActions("cancelled"), ["create"]);
  assert.deepEqual(availableActions("draft"), ["lodge", "cancel"]);
  assert.deepEqual(availableActions("lodged"), ["verify", "cancel"]);
  assert.deepEqual(availableActions("verified"), ["cancel"]);
});

test("registration: coe_issued is shown as distinct from a verified registration in the checklist", () => {
  const items = registrationChecklist({ applicationStatus: "coe_issued", state: "draft", evidenceCount: 0, coeNumber: null });
  const done = Object.fromEntries(items.map((i) => [i.key, i.done]));
  assert.deepEqual(done, { status: true, lodged: false, evidence: false, coe: false, verified: false });
  assert.match(items[0].label, /not a registration/);
});

test("registration: verification is blocked client-side for every reason the database would refuse it", () => {
  const ok = { applicationStatus: "coe_issued", state: "lodged" as const, evidenceCount: 1, coeNumber: null, coeInput: "E0000000001" };
  assert.deepEqual(verifyBlockers(ok), []);
  assert.equal(verifyBlockers({ ...ok, state: "draft" }).length, 1);
  assert.equal(verifyBlockers({ ...ok, applicationStatus: "offer_accepted" }).length, 1);
  assert.equal(verifyBlockers({ ...ok, evidenceCount: 0 }).length, 1);
  assert.equal(verifyBlockers({ ...ok, coeInput: "x" }).length, 1);
  assert.equal(verifyBlockers({ ...ok, state: "draft", applicationStatus: "offer_accepted", evidenceCount: 0, coeInput: "" }).length, 4);
});

test("registration: the export writes only the fixed minimal columns and neutralises spreadsheet formulas", () => {
  assert.deepEqual([...EXPORT_COLUMNS], ["reference", "studentName", "intake", "courses", "applicationStatus", "registrationState", "coeNumber", "lodgedAt", "verifiedAt"]);
  const csv = exportCsv([{ reference: "A-1", studentName: "=HYPERLINK(\"http://evil\")", intake: "2027-02", courses: "BSB50; CHC30", applicationStatus: "enrolled", registrationState: "verified", coeNumber: "E0000000001",
    lodgedAt: null, verifiedAt: "2026-10-26", passportNumber: "X1234567", email: "student@example.test", documentId: "d-1" }]);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "Reference,Student,Intake,Courses,Application status,Registration state,CoE number,Lodged,Verified");
  assert.ok(!csv.includes("X1234567") && !csv.includes("student@example.test") && !csv.includes("d-1"), "fields outside the export columns are dropped");
  assert.ok(lines[1].includes("\"'=HYPERLINK(\"\"http://evil\"\")\""), lines[1]);
  assert.equal(csvCell("a,b"), "\"a,b\"");
  for (const lead of ["=1+1", "+1", "-1", "@SUM(A1)"]) assert.ok(csvCell(lead).startsWith("'"), lead);
});

test("registration: every reconciliation exception has a label and an explanation, and corrections are validated before sending", () => {
  assert.deepEqual(Object.keys(EXCEPTION_TEXT).sort(), ["enrolled_without_verified", "lodged_stale", "possible_duplicate", "verified_application_closed"]);
  for (const entry of Object.values(EXCEPTION_TEXT)) assert.ok(entry.label.length > 5 && entry.explanation.length > 20);
  assert.deepEqual(validateCorrection("E0000000001", "e0000000050", "External record differs"), []);
  assert.equal(validateCorrection("E0000000001", "e0000000001", "same").length, 1, "an unchanged number is refused");
  assert.equal(validateCorrection("E0000000001", "bad!", "reason").length, 1);
  assert.equal(validateCorrection("E0000000001", "E0000000050", "  ").length, 1);
  assert.equal(validateCorrection(null, "", "").length, 2);
});

// ---- CMS layout limits, colours, menu sync and local drafts ----
import { FOOTER_LIMITS, NAV_LIMITS, validateFooterLinks, validateNavigation } from "../src/config/cmsLimits.ts";
import { contrastLevel, contrastWithWhite, normaliseHex, DEFAULT_PRIMARY_HEX } from "../src/lib/colour.ts";
import { syncPageNavigation } from "../src/lib/pageNav.ts";
import { clearDraft, draftKey, readDraft, writeDraft } from "../src/pages/admin/lib/draftStore.ts";

const link = (n: number, label = `Link ${n}`) => ({ label, to: `/p${n}` });
const navItem = (n: number, label = `Item ${n}`, children = 0) => ({ id: `n${n}`, label, to: `/n${n}`, visible: true, children: Array.from({ length: children }, (_, i) => ({ id: `c${n}-${i}`, label: `Child ${i}`, to: `/c${i}`, external: false, visible: true })) });

test("footer links: at most 8 per column and 30-character labels", () => {
  assert.deepEqual(validateFooterLinks([{ title: "Quick links", links: Array.from({ length: FOOTER_LIMITS.maxLinksPerColumn }, (_, i) => link(i)) }]), []);
  assert.equal(validateFooterLinks([{ title: "Quick links", links: Array.from({ length: 9 }, (_, i) => link(i)) }]).length, 1);
  assert.equal(validateFooterLinks([{ title: "Student links", links: [link(1, "x".repeat(FOOTER_LIMITS.maxLabelLength + 1))] }]).length, 1);
  assert.equal(validateFooterLinks([{ title: "Student links", links: [{ label: "", to: "/a" }] }]).length, 1);
  assert.deepEqual(validateFooterLinks([{ title: "Quick links", links: undefined }]), []);
});

test("navigation: 7 top-level items, 6 per dropdown, 22-character labels", () => {
  assert.deepEqual(validateNavigation(Array.from({ length: NAV_LIMITS.maxTopLevel }, (_, i) => navItem(i, "x".repeat(NAV_LIMITS.maxLabelLength), NAV_LIMITS.maxChildren))), []);
  assert.equal(validateNavigation(Array.from({ length: 8 }, (_, i) => navItem(i))).length, 1);
  assert.equal(validateNavigation([navItem(1, "Parent", 7)]).length, 1);
  assert.equal(validateNavigation([navItem(1, "y".repeat(23))]).length, 1);
});

test("colour helpers: hex normalising and the white-text contrast check", () => {
  assert.equal(normaliseHex("#ABC"), "#aabbcc");
  assert.equal(normaliseHex("ea6619"), "#ea6619");
  assert.equal(normaliseHex("#12345"), null);
  assert.equal(contrastLevel("#000000"), "good");
  assert.equal(contrastLevel("#ffffff"), "poor");
  assert.equal(contrastLevel(DEFAULT_PRIMARY_HEX), "large-only");
  assert.ok(contrastWithWhite("#ffffff") < 1.1);
});

test("a published page marked 'Show in main menu' reaches the menu; the switch, a new URL and deletion keep it consistent", () => {
  const page = { name: "Scholarships", slug: "scholarships", status: "Published", inNav: true };
  const base = [navItem(1, "Home")];
  const added = syncPageNavigation(base, page);
  assert.deepEqual(added.map((i) => [i.label, i.to]), [["Home", "/n1"], ["Scholarships", "/scholarships"]]);
  assert.equal(syncPageNavigation(added, page).length, 2, "already present: no duplicate");
  assert.equal(syncPageNavigation(base, { ...page, status: "Draft" }).length, 1, "a draft page is not added");
  assert.equal(syncPageNavigation(added, { ...page, slug: "grants" }, "scholarships")[1].to, "/grants", "the menu follows a changed URL");
  assert.equal(syncPageNavigation(added, { ...page, inNav: false }).length, 1, "switch off removes it");
  const nested = [{ ...navItem(1, "Study", 0), to: "/scholarships", children: [{ id: "k", label: "More", to: "/more", external: false, visible: true }] }];
  const cleared = syncPageNavigation(nested, { ...page, inNav: false });
  assert.deepEqual([cleared.length, cleared[0].to, cleared[0].children.length], [1, "", 1], "a dropdown parent with children is kept, only its link is cleared");
  const full = Array.from({ length: NAV_LIMITS.maxTopLevel }, (_, i) => navItem(i));
  assert.throws(() => syncPageNavigation(full, page), /already has 7 items/);
});

test("local drafts round-trip, are keyed per tenant, editor and record, and survive unavailable storage", () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) };
  const key = draftKey("school.example", "footer", "footer");
  assert.notEqual(key, draftKey("other.example", "footer", "footer"));
  assert.notEqual(key, draftKey("school.example", "course", "footer"));
  assert.equal(readDraft(key, storage), null);
  assert.equal(writeDraft(key, { about: "Unsaved text" }, storage), true);
  assert.deepEqual(readDraft<{ about: string }>(key, storage)?.value, { about: "Unsaved text" });
  clearDraft(key, storage);
  assert.equal(readDraft(key, storage), null);
  memory.set(key, "{not json");
  assert.equal(readDraft(key, storage), null, "a corrupt draft is ignored");
  assert.equal(writeDraft(key, { huge: "x".repeat(2_000_000) }, storage), false, "an oversized draft is skipped, not thrown");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(readDraft(key, broken), null);
  assert.equal(writeDraft(key, {}, broken), false);
  assert.doesNotThrow(() => clearDraft(key, broken));
});

// ---- footer logos, header preview model and stored-draft listing ----
import { footerLogos, LEGACY_ACKNOWLEDGEMENT_LOGO, LEGACY_FOOTER_LOGO } from "../src/config/brandFallbacks.ts";
import { previewNavigation } from "../src/pages/admin/lib/previewModels.ts";
import { listDrafts } from "../src/pages/admin/lib/draftStore.ts";

test("footer logos: the settings logo wins; the legacy images are only a fallback for the legacy site", () => {
  assert.deepEqual(footerLogos("https://cdn.example/logo.png", false), { main: "https://cdn.example/logo.png", acknowledgement: "https://cdn.example/logo.png" });
  assert.deepEqual(footerLogos("https://cdn.example/logo.png", true), { main: "https://cdn.example/logo.png", acknowledgement: "https://cdn.example/logo.png" });
  assert.deepEqual(footerLogos("  ", false), { main: LEGACY_FOOTER_LOGO, acknowledgement: LEGACY_ACKNOWLEDGEMENT_LOGO });
  assert.deepEqual(footerLogos("", true), { main: "", acknowledgement: "" }, "a tenant never shows the legacy images");
});

test("header preview shows what the public header would build: visible items and children with a label only", () => {
  const nav = previewNavigation([
    { id: "a", label: "About", to: "/about", visible: true, children: [{ id: "a1", label: "Team", to: "/team", external: false, visible: true }, { id: "a2", label: "", to: "/x", external: false, visible: true }, { id: "a3", label: "Hidden", to: "/h", external: false, visible: false }] },
    { id: "b", label: "Hidden item", to: "/b", visible: false, children: [] },
    { id: "c", label: "  ", to: "/c", visible: true, children: [] },
    { id: "d", label: "Contact", to: "", visible: true, children: [] },
  ]);
  assert.deepEqual(nav, [{ label: "About", to: "/about", external: false, children: [{ label: "Team", to: "/team" }] }, { label: "Contact", to: undefined, external: false }]);
});

test("stored drafts of one editor are listed newest first and never mix editors or tenants", () => {
  const data = new Map<string, string>();
  const storage = { get length() { return data.size; }, key: (i: number) => [...data.keys()][i] ?? null, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  data.set(draftKey("t", "page", "new"), JSON.stringify({ value: { a: 1 }, savedAt: 100 }));
  data.set(draftKey("t", "page", "p-2"), JSON.stringify({ value: { a: 2 }, savedAt: 300 }));
  data.set(draftKey("t", "seo", "s-1"), JSON.stringify({ value: {}, savedAt: 500 }));
  data.set(draftKey("other", "page", "p-9"), JSON.stringify({ value: {}, savedAt: 900 }));
  data.set(draftKey("t", "page", "broken"), "{nope");
  assert.deepEqual(listDrafts("t", "page", storage).map((d) => d.recordId), ["p-2", "new"]);
  assert.deepEqual(listDrafts("t", "faq", storage), []);
  assert.deepEqual(listDrafts("t", "page", null), []);
});
