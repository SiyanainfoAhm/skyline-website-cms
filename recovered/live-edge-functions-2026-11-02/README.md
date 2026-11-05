# Edge Function code recovered from the live Supabase project (2 Nov 2026)

These files are exact copies of the Edge Functions deployed on project `xcpydisstlvtvcsqnjob`, taken with the
Supabase "get function" API because they were never pushed to GitHub. They are kept here, outside
`supabase/functions/`, because the website shares some of these files and the matching website changes
(the `pdf-lib` and `@pdf-lib/fontkit` dependencies, `src/pages/agency/lib/applicationPdf.ts`, updated tests) also
exist only on the machine that deployed them. Moving these files into `supabase/functions/` without those changes
breaks the website build.

Live functions and what is here:

| Function | Live version | Compared with GitHub |
|---|---|---|
| address-search | 4 | Missing from GitHub. Recovered. |
| guest-documents | 3 | Missing from GitHub. Recovered. |
| portal-application-delete | 2 | Missing from GitHub. Recovered. |
| portal-document-extract | 28 | index.ts and run.ts identical; contract, select, openai, azure newer; validation/countries.ts and validation/extraction-fields.ts new. Recovered. |
| notification-delivery | 15 | index.ts, delivery.ts, submission-pdf.ts, identifiers.ts newer; pdf-layout, pdf-fonts, pdf-form, pdf-form-layout, document-expiry new. Recovered. |
| portal-admin-users | 17 | Same as GitHub. |
| cms-admin-users, portal-document-delete, public-assistant, public-assistant-index | | Deployed before GitHub's last change to them; not recovered. |

Not recoverable from Supabase: `notification-delivery/deno.json` (its import map, which maps `pdf-lib` and
`@pdf-lib/fontkit`). Without it these functions cannot be redeployed from the repo.
