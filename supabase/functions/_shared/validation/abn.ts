export function normalizeAbn(value: string): string { return String(value ?? '').replace(/\s/g, ''); }
export function validateAbn(value: string): string {
  const abn = normalizeAbn(value);
  if (!abn) return 'Enter the business ABN.';
  if (!/^\d{11}$/.test(abn)) return 'ABN must contain 11 digits.';
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  return [...abn].reduce((sum, digit, i) => sum + (Number(digit) - (i === 0 ? 1 : 0)) * weights[i], 0) % 89 === 0 ? '' : 'Enter a valid ABN; its check digits do not match.';
}
export interface AgencyAbnDetails {
  abn: string; legalName: string; businessNames: string[]; entityType: string;
  abnStatus: string; gstStatus: string; state: string; postcode: string; sourceUrl: string;
}
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
export function parseAgencyAbnPage(html: string, abn: string): AgencyAbnDetails {
  if (validateAbn(abn)) throw new Error('Invalid ABN.');
  const heading = plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  if (!/current details for ABN/i.test(heading) || !heading.replace(/\s/g, '').includes(abn)) throw new Error('The government register did not return this ABN. Check the number or try again later.');
  const fields = new Map<string, string>();
  for (const row of html.matchAll(/<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) fields.set(plain(row[1]).replace(/:$/, ''), plain(row[2]));
  const legalName = fields.get('Entity name'); const status = fields.get('ABN status');
  if (!legalName || !status) throw new Error('The government register is temporarily unavailable. Try again shortly.');
  const location = (fields.get('Main business location') ?? '').match(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s+(\d{4})\b/);
  const businessNames: string[] = [];
  for (const table of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    if (!/Business name\(s\)/i.test(plain(table[1].match(/<caption[^>]*>([\s\S]*?)<\/caption>/i)?.[1] ?? ''))) continue;
    for (const row of table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => plain(cell[1]));
      if (cells.length === 2 && /\b\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b/.test(cells[1])) businessNames.push(cells[0]);
    }
  }
  return { abn, legalName, businessNames, entityType: fields.get('Entity type') ?? '', abnStatus: status,
    gstStatus: fields.get('Goods & Services Tax (GST)') ?? '', state: location?.[1] ?? '', postcode: location?.[2] ?? '',
    sourceUrl: `https://abr.business.gov.au/ABN/View?abn=${abn}` };
}
export async function lookupAgencyAbn(value: string, request: typeof fetch = fetch): Promise<AgencyAbnDetails> {
  const abn = normalizeAbn(value); const problem = validateAbn(abn); if (problem) throw new Error(problem);
  const response = await request(`https://abr.business.gov.au/ABN/View?abn=${abn}`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('ABN Lookup is temporarily unavailable. Please try again later.');
  return parseAgencyAbnPage(await response.text(), abn);
}
