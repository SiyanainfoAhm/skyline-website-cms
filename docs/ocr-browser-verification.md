# Browser OCR verification protocol

Status: **NOT EXECUTED**. This repository has no Playwright/Cypress browser
runner or configured non-production Supabase test account. Do not treat this
file as a passing test result.

## Synthetic fixture set

Create the following **non-sensitive**, high-resolution fixtures before a
browser run. Use invented names, numbers, addresses and institutions only.

| Fixture | Format | Expected parser fields |
| --- | --- | --- |
| `passport-mrz.png` | PNG | passport number, name, DOB, nationality, expiry from MRZ |
| `au-driving-licence-address.png` | PNG | Australian street, suburb, state and postcode |
| `overseas-address-zh.png` | PNG | Chinese address characters retained as OCR text |
| `overseas-address-ko.png` | PNG | Korean address characters retained as OCR text |
| `ielts-result.png` | PNG | test type, date, overall/components and reference |
| `pte-result.png` | PNG | test type, date, score and reference |
| `toefl-result.png` | PNG | test type, date, score and reference |
| `academic-certificate.png` | PNG | institution, award, programme, year, grade and scale |
| `transcript-two-pages.pdf` | PDF | two rendered pages; award and grade/scale on either page |

The fixture generator must produce both normal and deliberately difficult
(blurred/skewed) copies, but acceptance measurements must report the exact
fixture version and expected text. Never invent an accuracy percentage.

## Repeatable manual browser run

1. Start the Vite app, sign in with an authorised non-production Agent and
   create an `is_test` application.
2. For each language selector (`eng`, `msa`, `chi_sim`, `chi_tra`, `kor`),
   upload its matching fixture and record whether Tesseract initialization
   succeeds. The UI downloads models from the configured public lang path.
3. Upload every fixture through the document wizard. For the transcript, check
   that both pages are rendered and read. Capture console/network failures.
4. Confirm an academic record, edit a value, reload, and verify the original
   extraction and corrected confirmation remain on that document. Add a second
   certificate and verify both remain independent.
5. Record exact/partial/missing field values and elapsed time in a test report.
   Only report pass/fail after this browser run has happened.

## Supabase persistence and RLS protocol

Run using authorised, separate non-production accounts only. Inspect requests
and rows (not service-role impersonation) for: private object creation,
document metadata, persisted extraction/confirmation, idempotent retry,
failed-upload rollback, reload, cross-agent denial, cross-agency denial and
deactivated-user denial. Do not run against student applications.
