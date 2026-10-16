import assert from "node:assert/strict";
import test from "node:test";
import { isEditableApplicationStatus } from "../src/pages/agency/lib/applicationAccess.ts";

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
