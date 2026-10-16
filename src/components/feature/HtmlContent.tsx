/**
 * Renders CMS-authored rich-text HTML (from cms_pages.body) on the public site.
 *
 * Content is authored by trusted staff in the CMS editor, but we still strip
 * the obvious injection vectors (scripts, inline handlers, iframes, forms and
 * `javascript:` URLs) before injecting so a stray paste can never execute.
 */

const BLOCKED_PAIRED = /<\s*(script|style|iframe|object|embed|form|link|meta)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const BLOCKED_VOID = /<\s*(script|style|iframe|object|embed|form|link|meta)\b[^>]*\/?>/gi;

export function sanitizeHtml(html: string): string {
  return html
    .replace(BLOCKED_PAIRED, "")
    .replace(BLOCKED_VOID, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "");
}

/** Wraps each table in a scroll container so wide tables stay usable on mobile. */
function wrapTables(html: string): string {
  return html.replace(/<table[\s\S]*?<\/table>/gi, (table) => `<div class="cms-table-scroll">${table}</div>`);
}

export default function HtmlContent({ html, className = "" }: { html: string; className?: string }) {
  const safe = wrapTables(sanitizeHtml(html));
  return (
    <div
      className={`cms-content max-w-full text-sm leading-relaxed text-foreground-700 md:text-base ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}