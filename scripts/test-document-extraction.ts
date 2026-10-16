import assert from "node:assert/strict";
import test from "node:test";
import { formatExtractionCandidates, hasLegacyExtractionOnly, reprocessedExtractionMetadata } from "../src/pages/agency/lib/documentExtraction.ts";

const legacy = { kind: "licence", extractedAt: "2026-10-14T08:44:58.506Z", extractedFields: ["dob"] };

test("legacy names are unavailable values, not an extraction", () => {
  assert.equal(hasLegacyExtractionOnly(legacy), true);
});

test("reprocessing preserves historical metadata and starts unreviewed", () => {
  const metadata = reprocessedExtractionMetadata(legacy, { dob: "2001-02-03" }, "2026-10-14T10:00:00.000Z");
  assert.equal(metadata.kind, "licence");
  assert.deepEqual(metadata.extractedFields, ["dob"]);
  assert.deepEqual((metadata.extraction as { extracted: unknown }).extracted, { dob: "2001-02-03" });
  assert.equal((metadata.extraction as { status: string }).status, "unreviewed");
});

test("persisted reprocess envelope survives reload and keeps confirmation separate from OCR", () => {
  const metadata = reprocessedExtractionMetadata(legacy, { dob: "2001-02-03" }, "2026-10-14T10:00:00.000Z");
  const extraction = metadata.extraction as { extracted: Record<string, string>; confirmed: Record<string, string>; status: string };
  const reloaded = JSON.parse(JSON.stringify(metadata)) as typeof metadata;
  assert.deepEqual((reloaded.extraction as typeof extraction).extracted, { dob: "2001-02-03" });
  assert.deepEqual((reloaded.extraction as typeof extraction).confirmed, {});
  assert.equal((reloaded.extraction as typeof extraction).status, "unreviewed");
});

test("failed retry preserves confirmed values and mirrors safe diagnostics", () => {
  const prior = { ...legacy, extraction: { extracted: { dob: "2001-02-03" }, confirmed: { dob: "2001-02-03" }, status: "confirmed", source: { engine: "tesseract.js", parser: "parseDocument", extractedAt: "x" } } };
  const metadata = reprocessedExtractionMetadata(prior, {}, "2026-10-14T10:00:00.000Z", { pagesProcessed: 1, recognizedCharacterCount: 0 });
  const extraction = metadata.extraction as { confirmed: Record<string, string>; status: string };
  assert.deepEqual(extraction.confirmed, { dob: "2001-02-03" });
  assert.equal(extraction.status, "confirmed");
  assert.equal((metadata.diagnostics as { pagesProcessed: number }).pagesProcessed, 1);
});

test("passport candidates retain all persisted fields and format wizard values", () => {
  const fields = formatExtractionCandidates({
    first_name: "Mihir", middle_name: "Kumar", last_name: "Example", dob: "03/02/2001",
    gender: "M", nationality: "Indian", birth_country: "India", passport_number: "A1234567", passport_expiry: "2032-12-31",
  });
  assert.deepEqual(fields, {
    first_name: "Mihir", middle_name: "Kumar", last_name: "Example", dob: "2001-02-03",
    gender: "Male", nationality: "India", birth_country: "India", passport_number: "A1234567", passport_expiry: "2032-12-31",
  });
});

test("normalises supported aliases and document-specific field names", () => {
  assert.deepEqual(formatExtractionCandidates({
    passport_issuing_country: "USA", citizenship: "GBR", nationality: "IND",
    birth_country: "Viet Nam", au_state: "New South Wales", address_type: "Australian Address",
    gender: "F",
  }), {
    issuing_country: "United States", citizenship: "United Kingdom", nationality: "India",
    birth_country: "Viet Nam", au_state: "NSW", address_type: "Australian Address", gender: "Female",
  });
});

test("unrecognised select candidates are retained for manual correction only", () => {
  assert.deepEqual(formatExtractionCandidates({ nationality: "Atlantis", gender: "X", au_state: "North", address_type: "Local" }), {});
});

test("English scores retain component notation without score conversion", () => {
  assert.deepEqual(formatExtractionCandidates({
    english_type: "IELTS General Training", english_score: "7.0", english_components: "L 7.5, R 7.0, W 6.5, S 7.0",
  }), {
    english_type: "IELTS General Training", english_score: "7.0 (Overall) · L 7.5, R 7.0, W 6.5, S 7.0",
  });
});

test("English test aliases select the actual wizard options", () => {
  assert.deepEqual(formatExtractionCandidates({ english_type: "TOEFL iBT" }), { english_type: "TOEFL iBT" });
  assert.deepEqual(formatExtractionCandidates({ english_type: "Pearson PTE" }), { english_type: "PTE Academic" });
});
