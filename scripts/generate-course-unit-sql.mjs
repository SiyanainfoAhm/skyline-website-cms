// Generates the deterministic, duplicate-safe SQL payload from the committed
// static source. It performs no network or database operations.
import { readFile } from "node:fs/promises";

const source = await readFile("src/data/courseUnits.ts", "utf8");
const blocks = [...source.matchAll(/^  "([^"\r\n]+)": \[\r?\n([\s\S]*?)^  \],?$/gm)];
const rows = [];
for (const block of blocks) {
  for (const [sort, unit] of [...block[2].matchAll(/^    \["([^"]+)", "([^"]+)", "([^"]+)"\],?$/gm)].entries()) {
    rows.push([block[1], unit[1], unit[2], unit[3], sort]);
  }
}
if (blocks.length !== 13 || rows.length !== 264) throw new Error(`Expected 13 courses / 264 units; found ${blocks.length} / ${rows.length}.`);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const values = rows.map((row) => `(${row.slice(0, 4).map(quote).join(", ")}, ${row[4]})`).join(",\n");
console.log(`with source(slug, code, name, category, sort) as (values\n${values}\n), matched as (\n  select c.id as course_id, s.code, s.name, s.category, s.sort\n  from source s join public.cms_courses c on c.slug = s.slug\n), inserted as (\n  insert into public.cms_course_units (id, course_id, code, name, category, sort)\n  select 'unit-' || course_id || '-' || (sort + 1)::text || '-' || regexp_replace(code, '[^A-Za-z0-9]+', '-', 'g'), course_id, code, name, category, sort\n  from matched\n  on conflict (course_id, code) where code <> '' do nothing\n  returning id\n)\nselect (select count(*) from source) as source_units, (select count(*) from matched) as matched_units, (select count(*) from inserted) as inserted_units;`);
