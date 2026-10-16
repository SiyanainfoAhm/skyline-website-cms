import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile("supabase/functions/portal-document-extract/index.ts", "utf8");

assert.match(worker, /inputMime === "application\/pdf"/);
assert.match(worker, /type: "input_file", filename: doc\.filename, file_data: dataUrl/);
assert.match(worker, /type: "input_image", image_url: dataUrl, detail: "high"/);
assert.doesNotMatch(worker, /content: \[\{ type: "input_file", filename: doc\.filename, file_data:/);

console.log("document extraction request contract: PDFs use input_file; JPEG/PNG use input_image");
