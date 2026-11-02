import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/pages/admin/components/ui";

/** Segmented status filter with counts. `null` counts show a dash until the first load. */
export function StatusTabs<T extends string>({ value, onChange, tabs, label }: {
  value: T; onChange: (value: T) => void; label: string; tabs: Array<{ id: T; label: string; count: number | null }>;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-lg border border-background-300 bg-background-50 p-1">
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button key={tab.label} type="button" role="tab" aria-selected={selected} onClick={() => onChange(tab.id)}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
              selected ? "bg-foreground-900 text-background-50" : "text-foreground-700 hover:bg-background-100"}`}>
            {tab.label}
            <span className={`tabular-nums text-xs ${selected ? "text-background-200" : "text-foreground-500"}`}>{tab.count === null ? "–" : tab.count.toLocaleString()}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Search box that reports its value after a short pause. Escape or the clear button empties it. */
export function SearchBox({ value, onSearch, placeholder, label }: { value: string; onSearch: (value: string) => void; placeholder: string; label: string }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef(onSearch);
  latest.current = onSearch;
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => {
    if (text === value) return;
    const timer = window.setTimeout(() => latest.current(text.trim() ? text : ""), 250);
    return () => window.clearTimeout(timer);
  }, [text, value]);
  return (
    <div className="relative">
      <i className="ri-search-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-foreground-400" aria-hidden="true" />
      <input ref={ref} type="search" aria-label={label} placeholder={placeholder} value={text}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setText(""); }}
        className="w-full rounded-lg border border-background-300 bg-background-50 py-2.5 pl-10 pr-10 text-sm text-foreground-900 placeholder:text-foreground-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 [&::-webkit-search-cancel-button]:hidden" />
      {text ? (
        <button type="button" aria-label="Clear search" onClick={() => { setText(""); ref.current?.focus(); }}
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-foreground-500 hover:bg-background-100 hover:text-foreground-900">
          <i className="ri-close-line text-lg" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** "Showing 1–25 of 4,788" with Previous / Next. */
export function Pager({ page, pageSize, total, loading, onPage }: { page: number; pageSize: number; total: number; loading: boolean; onPage: (page: number) => void }) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-col gap-2 border-t border-background-200 px-4 py-3 text-xs text-foreground-600 sm:flex-row sm:items-center sm:justify-between">
      <span role="status">Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</span>
      {pages > 1 ? (
        <span className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
          <span className="tabular-nums">Page {page} of {pages.toLocaleString()}</span>
          <Button size="sm" variant="outline" disabled={loading || page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
        </span>
      ) : null}
    </div>
  );
}

/** Centered empty or error message inside a card. */
export function ListMessage({ icon, title, text, action }: { icon: string; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <i className={`${icon} text-3xl text-foreground-400`} aria-hidden="true" />
      <p className="mt-2 font-heading text-base font-semibold text-foreground-900">{title}</p>
      <p className="mt-1 text-sm text-foreground-600">{text}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
