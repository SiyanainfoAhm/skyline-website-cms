import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface PickOption {
  id: string;
  label: string;
  /** Second line: email, place, code. */
  meta?: string;
  /** Right-hand badge, e.g. a status. */
  tag?: ReactNode;
}

/**
 * Type to search, pick with mouse or keyboard. When nothing fits, the last row offers
 * "Add “typed text”" so the record can be created without leaving the form.
 */
export default function SearchPick({
  label,
  placeholder,
  search,
  onPick,
  onAddNew,
  addNoun,
  disabled,
  autoFocus,
  resetKey,
  searchWhenEmpty = false,
  openOnMount = false,
}: {
  label: string;
  placeholder: string;
  search: (q: string) => Promise<PickOption[]>;
  onPick: (option: PickOption) => void;
  onAddNew?: (typed: string) => void;
  /** "business", "agent": shown as "Add new business “…”". */
  addNoun: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Change to re-run the search (e.g. a parent filter changed). */
  resetKey?: string;
  /** Load options on focus when an empty query is meaningful, such as a scoped team list. */
  searchWhenEmpty?: boolean;
  /** Show the dropdown immediately when the picker is mounted. */
  openOnMount?: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(openOnMount);
  const [options, setOptions] = useState<PickOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const query = q.trim();
    if (!query && !searchWhenEmpty) {
      setOptions([]);
      setLoading(false);
      setFailed(false);
      setActive(0);
      return () => { live = false; };
    }
    setLoading(true);
    setFailed(false);
    const timer = window.setTimeout(() => {
      search(query)
        .then((rows) => { if (live) { setOptions(rows); setActive(0); } })
        .catch(() => { if (live) { setOptions([]); setFailed(true); } })
        .finally(() => { if (live) setLoading(false); });
    }, 220);
    return () => { live = false; window.clearTimeout(timer); };
  }, [q, open, search, resetKey, searchWhenEmpty]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const typed = q.trim();
  const exact = options.some((o) => o.label.trim().toLowerCase() === typed.toLowerCase());
  const showAdd = Boolean(onAddNew && typed && !exact && !loading);
  const count = options.length + (showAdd ? 1 : 0);

  const choose = (index: number) => {
    if (index < options.length) { onPick(options[index]); setQ(""); setOpen(false); }
    else if (showAdd && onAddNew) { onAddNew(typed); setQ(""); setOpen(false); }
  };

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-foreground-800">{label}</label>
      <div className="relative">
        <i className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" aria-hidden="true" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          autoFocus={autoFocus}
          disabled={disabled}
          value={q}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, count - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && open && count) { e.preventDefault(); choose(active); }
            else if (e.key === "Escape") setOpen(false);
          }}
          className="w-full rounded-md border border-background-300 bg-background-50 py-2 pl-9 pr-3 text-sm text-foreground-950 placeholder:text-foreground-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 disabled:bg-background-100"
        />
      </div>
      {open && !disabled ? (
        <ul id={`${id}-list`} role="listbox" className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-background-200 bg-background-50 py-1 shadow-lg">
          {loading && options.length === 0 ? <li className="px-3 py-2.5 text-sm text-foreground-500">Searching…</li> : null}
          {failed ? <li className="px-3 py-2.5 text-sm text-red-700">Search did not load. Type again to retry.</li> : null}
          {!loading && !failed && options.length === 0 && !showAdd ? (
            <li className="px-3 py-2.5 text-sm text-foreground-500">{typed ? "No matches." : `Start typing a ${addNoun} name.`}</li>
          ) : null}
          {options.map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === active}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(i); }}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 ${i === active ? "bg-primary-50" : ""}`}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground-900">{o.label}</span>
                {o.meta ? <span className="block truncate text-xs text-foreground-500">{o.meta}</span> : null}
              </span>
              {o.tag ? <span className="shrink-0">{o.tag}</span> : null}
            </li>
          ))}
          {showAdd ? (
            <li role="option" aria-selected={active === options.length}
              onMouseEnter={() => setActive(options.length)} onMouseDown={(e) => { e.preventDefault(); choose(options.length); }}
              className={`flex cursor-pointer items-center gap-2 border-t border-background-200 px-3 py-2.5 text-sm font-semibold text-primary-700 ${active === options.length ? "bg-primary-50" : ""}`}>
              <i className="ri-add-line" aria-hidden="true" />Add new {addNoun} “{typed}”
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
