import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * QuickBooks-style picker: type to search, pick with mouse or keyboard, and when nothing fits
 * choose "+ Add new “…”" to create the record in a small popup without leaving the screen.
 */
export interface QuickPickOption {
  id: string;
  label: string;
  /** Second line, e.g. code, email or place. */
  meta?: string;
  /** Short tag on the right, e.g. "Inactive". */
  tag?: string;
  disabled?: boolean;
}

export default function QuickPick({
  label,
  value,
  onChange,
  search,
  placeholder = "Type to search…",
  addLabel,
  onAddNew,
  disabled,
  required,
  hint,
  error,
  autoFocus,
  emptyText = "No matches.",
  clearable = true,
  minChars = 0,
  initialText = "",
}: {
  label?: string;
  value: QuickPickOption | null;
  onChange: (option: QuickPickOption | null) => void;
  /** Returns options for the typed text. Called debounced; stale results are ignored. */
  search: (query: string) => Promise<QuickPickOption[]>;
  placeholder?: string;
  /** Noun used in the add row: "business" gives "Add new business". */
  addLabel?: string;
  /** Opens the create popup. Receives what the user typed so the popup can prefill it. */
  onAddNew?: (typed: string) => void;
  disabled?: boolean;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  autoFocus?: boolean;
  emptyText?: string;
  clearable?: boolean;
  minChars?: number;
  /** Text already in the box when nothing is chosen, e.g. what was typed in the picker that opened a popup. */
  initialText?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value?.label ?? initialText);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<QuickPickOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState("");
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const searchRef = useRef(search);
  searchRef.current = search;

  // Show the chosen record's name when the value changes from outside (e.g. after "Add new").
  useEffect(() => { if (value) setText(value.label); }, [value]);

  const query = value && text === value.label ? "" : text.trim();

  useEffect(() => {
    if (!open) return;
    if (query.length < minChars) { setRows([]); setLoading(false); return; }
    const run = ++seq.current;
    setLoading(true);
    setFailed("");
    const timer = window.setTimeout(() => {
      searchRef.current(query)
        .then((r) => { if (run === seq.current) { setRows(r); setActive(0); } })
        .catch((e) => { if (run === seq.current) { setRows([]); setFailed(e instanceof Error ? e.message : "Search failed."); } })
        .finally(() => { if (run === seq.current) setLoading(false); });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query, open, minChars]);

  const showAdd = Boolean(onAddNew) && !loading;
  const addIndex = rows.length; // the add row sits after the results
  const count = rows.length + (showAdd ? 1 : 0);

  const choose = (o: QuickPickOption) => {
    if (o.disabled) return;
    onChange(o);
    setText(o.label);
    setOpen(false);
  };
  const addNew = () => {
    setOpen(false);
    onAddNew?.(query);
  };

  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setOpen(false); if (value) setText(value.label); } }}>
      {label ? (
        <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-foreground-800">
          {label}{required ? <span className="ml-0.5 text-primary-600">*</span> : null}
        </label>
      ) : null}
      <div className="relative">
        <i className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" aria-hidden="true" />
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          value={text}
          placeholder={placeholder}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={Boolean(error)}
          aria-activedescendant={open && count ? `${id}-o${active}` : undefined}
          onFocus={(e) => { setOpen(true); e.currentTarget.select(); }}
          onChange={(e) => { setText(e.target.value); setOpen(true); if (value) onChange(null); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(count - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter" && open) {
              e.preventDefault();
              if (active < rows.length && rows[active]) choose(rows[active]);
              else if (showAdd && active === addIndex) addNew();
            } else if (e.key === "Escape") { setOpen(false); if (value) setText(value.label); }
          }}
          className={`w-full rounded-md border bg-background-50 py-2 pl-9 ${value && clearable ? "pr-9" : "pr-3"} text-sm text-foreground-950 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-400/40 disabled:bg-background-100 disabled:text-foreground-500 ${error ? "border-red-500" : "border-background-300 focus:border-primary-500"}`}
        />
        {value && clearable && !disabled ? (
          <button type="button" aria-label="Clear" onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(null); setText(""); setOpen(true); inputRef.current?.focus(); }}
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-foreground-400 hover:bg-background-100 hover:text-foreground-800">
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-1 text-xs font-medium text-red-700">{error}</p> : hint ? <p className="mt-1 text-xs text-foreground-500">{hint}</p> : null}

      {open && !disabled ? (
        <div className="absolute z-[95] mt-1 w-full overflow-hidden rounded-lg border border-background-200 bg-background-50 shadow-xl ring-1 ring-foreground-950/5">
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {loading ? <li className="flex items-center gap-2 px-3 py-2.5 text-sm text-foreground-500"><i className="ri-loader-4-line animate-spin" aria-hidden="true" />Searching…</li> : null}
            {!loading && failed ? <li className="px-3 py-2.5 text-sm text-red-700">{failed}</li> : null}
            {!loading && !failed && rows.length === 0 ? (
              <li className="px-3 py-2.5 text-sm text-foreground-500">{query.length < minChars ? `Type at least ${minChars} letters…` : query ? emptyText : "Start typing to search."}</li>
            ) : null}
            {!loading ? rows.map((o, i) => (
              <li key={o.id} id={`${id}-o${i}`} role="option" aria-selected={i === active} aria-disabled={o.disabled}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(o)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-primary-50" : ""} ${o.disabled ? "cursor-not-allowed opacity-50" : ""}`}>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground-900">{o.label}</span>
                  {o.meta ? <span className="block truncate text-xs text-foreground-500">{o.meta}</span> : null}
                </span>
                {o.tag ? <span className="shrink-0 rounded-full bg-background-200 px-2 py-0.5 text-[11px] font-medium text-foreground-600">{o.tag}</span> : null}
                {value?.id === o.id ? <i className="ri-check-line shrink-0 text-primary-600" aria-hidden="true" /> : null}
              </li>
            )) : null}
          </ul>
          {showAdd ? (
            <button type="button" id={`${id}-o${addIndex}`} role="option" aria-selected={active === addIndex}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(addIndex)} onClick={addNew}
              className={`flex w-full items-center gap-2 border-t border-background-200 px-3 py-2.5 text-left text-sm font-semibold text-primary-700 ${active === addIndex ? "bg-primary-50" : "hover:bg-primary-50"}`}>
              <i className="ri-add-circle-line text-base" aria-hidden="true" />
              {query ? <>Add new {addLabel ?? ""} <span className="truncate font-normal text-foreground-800">“{query}”</span></> : <>Add new {addLabel ?? ""}</>}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
