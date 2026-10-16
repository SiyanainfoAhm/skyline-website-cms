import { useEffect, useRef, useState, type MouseEvent } from "react";

/**
 * Lightweight rich-text editor used across the CMS for long-form content.
 * Provides a Word-document style toolbar (headings, fonts, sizes, bold/italic,
 * lists, alignment, links and images) and returns HTML via onChange.
 */

const FONTS = [
  { label: "Default", value: "" },
  { label: "Sora", value: "Sora" },
  { label: "Inter", value: "Inter" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
];

const SIZES = [
  { label: "Small", value: "2" },
  { label: "Normal", value: "3" },
  { label: "Large", value: "5" },
  { label: "Huge", value: "6" },
];

type ToolButton = { icon: string; command: string; arg?: string; label: string };

const TEXT_TOOLS: ToolButton[] = [
  { icon: "ri-bold", command: "bold", label: "Bold" },
  { icon: "ri-italic", command: "italic", label: "Italic" },
  { icon: "ri-underline", command: "underline", label: "Underline" },
  { icon: "ri-strikethrough", command: "strikeThrough", label: "Strikethrough" },
];

const LIST_TOOLS: ToolButton[] = [
  { icon: "ri-list-unordered", command: "insertUnorderedList", label: "Bullet list" },
  { icon: "ri-list-ordered", command: "insertOrderedList", label: "Numbered list" },
];

const ALIGN_TOOLS: ToolButton[] = [
  { icon: "ri-align-left", command: "justifyLeft", label: "Align left" },
  { icon: "ri-align-center", command: "justifyCenter", label: "Align center" },
  { icon: "ri-align-right", command: "justifyRight", label: "Align right" },
];

const BLOCK_OPTIONS = [
  { label: "Paragraph", value: "p" },
  { label: "Heading 2", value: "h2" },
  { label: "Heading 3", value: "h3" },
  { label: "Heading 4", value: "h4" },
  { label: "Quote", value: "blockquote" },
];

const selectClass =
  "h-8 cursor-pointer rounded border border-background-300 bg-background-50 px-2 text-xs text-foreground-800 focus:border-primary-400 focus:outline-none";

export default function RichTextEditor({
  value,
  onChange,
  placeholder = "Start writing…",
  minHeight = 220,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [imgOpen, setImgOpen] = useState(false);
  const [imgUrl, setImgUrl] = useState("");
  const [focused, setFocused] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value ?? "")) {
      ref.current.innerHTML = value ?? "";
    }
    // Keep the table toolbar in sync when content is loaded/saved externally.
    setHasTable(Boolean(ref.current?.querySelector("table")));
  }, [value]);

  const emit = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const exec = (command: string, arg?: string) => {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, arg);
    ref.current?.focus();
    emit();
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current && ref.current.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0);
    }
  };

  const restoreSelection = () => {
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const stop = (e: MouseEvent) => e.preventDefault();

  const applyLink = () => {
    restoreSelection();
    const url = linkUrl.trim();
    if (url) document.execCommand("createLink", false, /^(https?:|mailto:|tel:|\/)/.test(url) ? url : `https://${url}`);
    setLinkOpen(false);
    setLinkUrl("");
    emit();
  };

  const applyImage = () => {
    restoreSelection();
    const url = imgUrl.trim();
    if (url) document.execCommand("insertImage", false, url);
    setImgOpen(false);
    setImgUrl("");
    emit();
  };

  /* ------------------------------------------------------------ tables */
  // The table toolbar is DOM-driven and tracks the "active" table so Add Row /
  // Add Column always have a target — even right after inserting a table, or
  // when reopening saved content (where there is no live cell selection).

  const tableStateRef = useRef<{ table: HTMLTableElement; cell: HTMLTableCellElement | null } | null>(null);
  const [hasTable, setHasTable] = useState(false);

  const currentCell = (): HTMLTableCellElement | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node: Node | null = sel.anchorNode;
    while (node && node !== ref.current) {
      if (node instanceof HTMLTableCellElement) return node;
      node = node.parentNode;
    }
    return null;
  };

  const tableFrom = (node: Node | null): HTMLTableElement | null => {
    let cursor: Node | null = node;
    while (cursor && cursor !== ref.current) {
      if (cursor instanceof HTMLTableElement) return cursor;
      cursor = cursor.parentNode;
    }
    return null;
  };

  /** Remembers the caret's table so the toolbar always edits the intended one. */
  const syncActiveTable = () => {
    const cell = currentCell();
    if (!cell) return;
    const table = tableFrom(cell);
    if (!table) return;
    tableStateRef.current = { table, cell };
    setHasTable(true);
  };

  /** Resolves the table to act on: caret cell → last used → last in the editor. */
  const resolveTable = (): { table: HTMLTableElement; cell: HTMLTableCellElement | null } | null => {
    const cell = currentCell();
    if (cell) {
      const table = tableFrom(cell);
      if (table) {
        tableStateRef.current = { table, cell };
        setHasTable(true);
        return { table, cell };
      }
    }
    const stored = tableStateRef.current;
    if (stored && ref.current?.contains(stored.table)) return stored;
    const last = (ref.current?.querySelector("table") as HTMLTableElement | null) ?? null;
    if (last) {
      const firstCell = last.querySelector("th,td") as HTMLTableCellElement | null;
      tableStateRef.current = { table: last, cell: firstCell };
      setHasTable(true);
      return { table: last, cell: firstCell };
    }
    return null;
  };

  const columnIndex = (cell: HTMLTableCellElement | null, table: HTMLTableElement): number => {
    if (cell) return cell.cellIndex;
    const firstRow = table.rows[0];
    return firstRow ? Math.max(firstRow.cells.length - 1, 0) : 0;
  };

  const insertTable = () => {
    const el = ref.current;
    if (!el) return;
    const rows = Math.max(1, Math.min(20, tableRows));
    const cols = Math.max(1, Math.min(12, tableCols));

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (let c = 0; c < cols; c += 1) {
      const th = document.createElement("th");
      th.textContent = `Header ${c + 1}`;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (let r = 1; r < rows; r += 1) {
      const tr = document.createElement("tr");
      for (let c = 0; c < cols; c += 1) {
        const td = document.createElement("td");
        td.innerHTML = "&nbsp;";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    const para = document.createElement("p");
    para.innerHTML = "<br>";

    el.focus();
    const sel = window.getSelection();
    let range: Range | null = null;
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) range = sel.getRangeAt(0);
    if (range) {
      range.deleteContents();
      range.insertNode(para);
      range.insertNode(table);
    } else {
      el.appendChild(table);
      el.appendChild(para);
    }

    const firstCell = table.querySelector("th,td") as HTMLTableCellElement | null;
    tableStateRef.current = { table, cell: firstCell };
    setHasTable(true);
    emit();
  };

  const addRow = (after: boolean) => {
    const resolved = resolveTable();
    if (!resolved) return;
    const { table, cell } = resolved;
    const refRow =
      cell?.parentElement instanceof HTMLTableRowElement ? cell.parentElement : table.rows[table.rows.length - 1];
    if (!refRow) return;
    const newRow = document.createElement("tr");
    for (let i = 0; i < refRow.cells.length; i += 1) {
      const td = document.createElement("td");
      td.innerHTML = "&nbsp;";
      newRow.appendChild(td);
    }
    if (after) refRow.after(newRow);
    else refRow.before(newRow);
    tableStateRef.current = { table, cell: newRow.cells[0] ?? null };
    setHasTable(true);
    emit();
  };

  const deleteRow = () => {
    const resolved = resolveTable();
    if (!resolved) return;
    const { table, cell } = resolved;
    const row =
      cell?.parentElement instanceof HTMLTableRowElement ? cell.parentElement : table.rows[table.rows.length - 1];
    if (!row) return;
    const parent = row.parentElement;
    row.remove();
    if (parent instanceof HTMLTableSectionElement && parent.rows.length === 0) parent.remove();
    if (table.rows.length === 0) {
      table.remove();
      tableStateRef.current = null;
      setHasTable(false);
    }
    emit();
  };

  const addColumn = (after: boolean) => {
    const resolved = resolveTable();
    if (!resolved) return;
    const { table, cell } = resolved;
    const index = columnIndex(cell, table);
    Array.from(table.rows).forEach((row) => {
      const refCell = row.cells[index] ?? row.cells[row.cells.length - 1];
      if (!refCell) return;
      const isHeader = refCell.tagName === "TH";
      const next = document.createElement(isHeader ? "th" : "td");
      if (isHeader) next.textContent = "Header";
      else next.innerHTML = "&nbsp;";
      if (after) refCell.after(next);
      else refCell.before(next);
    });
    setHasTable(true);
    emit();
  };

  const deleteColumn = () => {
    const resolved = resolveTable();
    if (!resolved) return;
    const { table, cell } = resolved;
    const index = columnIndex(cell, table);
    if (table.rows[0] && table.rows[0].cells.length <= 1) {
      table.remove();
      tableStateRef.current = null;
      setHasTable(false);
      emit();
      return;
    }
    Array.from(table.rows).forEach((row) => {
      if (row.cells[index]) row.cells[index].remove();
    });
    emit();
  };

  const deleteTable = () => {
    const resolved = resolveTable();
    if (!resolved) return;
    resolved.table.remove();
    tableStateRef.current = null;
    setHasTable(false);
    emit();
  };

  return (
    <div className="overflow-hidden rounded-md border border-background-300 bg-background-50">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-background-200 bg-background-100 px-2 py-1.5">
        <button type="button" onMouseDown={stop} onClick={() => exec("undo")} aria-label="Undo" title="Undo" className="flex h-8 w-8 items-center justify-center rounded text-foreground-600 hover:bg-background-200">
          <i className="ri-arrow-go-back-line" aria-hidden="true" />
        </button>
        <button type="button" onMouseDown={stop} onClick={() => exec("redo")} aria-label="Redo" title="Redo" className="flex h-8 w-8 items-center justify-center rounded text-foreground-600 hover:bg-background-200">
          <i className="ri-arrow-go-forward-line" aria-hidden="true" />
        </button>

        <span className="mx-1 h-5 w-px bg-background-300" aria-hidden="true" />

        <select
          aria-label="Text style"
          className={selectClass}
          defaultValue="p"
          onMouseDown={saveSelection}
          onChange={(e) => {
            restoreSelection();
            exec("formatBlock", e.target.value);
          }}
        >
          {BLOCK_OPTIONS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Font family"
          className={selectClass}
          defaultValue=""
          onMouseDown={saveSelection}
          onChange={(e) => {
            restoreSelection();
            if (e.target.value) exec("fontName", e.target.value);
          }}
        >
          {FONTS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Font size"
          className={selectClass}
          defaultValue="3"
          onMouseDown={saveSelection}
          onChange={(e) => {
            restoreSelection();
            exec("fontSize", e.target.value);
          }}
        >
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <span className="mx-1 h-5 w-px bg-background-300" aria-hidden="true" />

        {TEXT_TOOLS.map((tool) => (
          <button key={tool.command} type="button" onMouseDown={stop} onClick={() => exec(tool.command)} aria-label={tool.label} title={tool.label} className="flex h-8 w-8 items-center justify-center rounded text-foreground-600 hover:bg-background-200">
            <i className={tool.icon} aria-hidden="true" />
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-background-300" aria-hidden="true" />

        {LIST_TOOLS.map((tool) => (
          <button key={tool.command} type="button" onMouseDown={stop} onClick={() => exec(tool.command)} aria-label={tool.label} title={tool.label} className="flex h-8 w-8 items-center justify-center rounded text-foreground-600 hover:bg-background-200">
            <i className={tool.icon} aria-hidden="true" />
          </button>
        ))}
        {ALIGN_TOOLS.map((tool) => (
          <button key={tool.command} type="button" onMouseDown={stop} onClick={() => exec(tool.command)} aria-label={tool.label} title={tool.label} className="flex h-8 w-8 items-center justify-center rounded text-foreground-600 hover:bg-background-200">
            <i className={tool.icon} aria-hidden="true" />
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-background-300" aria-hidden="true" />

        <button
          type="button"
          onMouseDown={(e) => {
            saveSelection();
            e.preventDefault();
          }}
          onClick={() => setLinkOpen((v) => !v)}
          aria-label="Insert link"
          title="Insert link"
          className="flex h-8 w-8 items-center justify-center rounded text-foreground-600 hover:bg-background-200"
        >
          <i className="ri-link" aria-hidden="true" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            saveSelection();
            e.preventDefault();
          }}
          onClick={() => setImgOpen((v) => !v)}
          aria-label="Insert image"
          title="Insert image"
          className="flex h-8 w-8 items-center justify-center rounded text-foreground-600 hover:bg-background-200"
        >
          <i className="ri-image-add-line" aria-hidden="true" />
        </button>
        <button type="button" onMouseDown={stop} onClick={() => exec("removeFormat")} aria-label="Clear formatting" title="Clear formatting" className="flex h-8 w-8 items-center justify-center rounded text-foreground-600 hover:bg-background-200">
          <i className="ri-format-clear" aria-hidden="true" />
        </button>
        <button
          type="button"
          onMouseDown={stop}
          onClick={() => setTableOpen((v) => !v)}
          aria-label="Table"
          title="Insert or edit a table"
          className="flex h-8 w-8 items-center justify-center rounded text-foreground-600 hover:bg-background-200"
        >
          <i className="ri-table-2" aria-hidden="true" />
        </button>
      </div>

      {/* Link / image insert rows */}
      {linkOpen ? (
        <div className="flex items-center gap-2 border-b border-background-200 bg-primary-50 px-2 py-2">
          <i className="ri-link text-foreground-500" aria-hidden="true" />
          <input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyLink()}
            placeholder="https://example.com"
            className="flex-1 rounded border border-background-300 bg-background-50 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none"
          />
          <button type="button" onClick={applyLink} className="rounded bg-primary-500 px-2.5 py-1 text-xs font-medium text-background-50">
            Add link
          </button>
        </div>
      ) : null}
      {imgOpen ? (
        <div className="flex items-center gap-2 border-b border-background-200 bg-primary-50 px-2 py-2">
          <i className="ri-image-line text-foreground-500" aria-hidden="true" />
          <input
            autoFocus
            value={imgUrl}
            onChange={(e) => setImgUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyImage()}
            placeholder="Image URL https://…"
            className="flex-1 rounded border border-background-300 bg-background-50 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none"
          />
          <button type="button" onClick={applyImage} className="rounded bg-primary-500 px-2.5 py-1 text-xs font-medium text-background-50">
            Insert
          </button>
        </div>
      ) : null}

      {tableOpen ? (
        <div className="border-b border-background-200 bg-primary-50 px-2 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground-600">Table</span>
            <input
              type="number"
              min={1}
              max={20}
              value={tableRows}
              onChange={(e) => setTableRows(Number(e.target.value) || 1)}
              aria-label="Rows"
              className="w-14 rounded border border-background-300 bg-background-50 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none"
            />
            <span className="text-xs text-foreground-500">&times;</span>
            <input
              type="number"
              min={1}
              max={12}
              value={tableCols}
              onChange={(e) => setTableCols(Number(e.target.value) || 1)}
              aria-label="Columns"
              className="w-14 rounded border border-background-300 bg-background-50 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none"
            />
            <button type="button" onClick={insertTable} className="rounded bg-primary-500 px-2.5 py-1 text-xs font-medium text-background-50">
              Insert table
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-background-200 pt-2">
            <span className="mr-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-foreground-500">
              <i className="ri-table-2" aria-hidden="true" />
              {hasTable ? "Edit table" : "No table yet"}
            </span>
            <button type="button" disabled={!hasTable} onMouseDown={stop} onClick={() => addRow(false)} className="rounded border border-background-300 bg-background-50 px-2 py-1 text-xs text-foreground-700 hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-40">Add row &uarr;</button>
            <button type="button" disabled={!hasTable} onMouseDown={stop} onClick={() => addRow(true)} className="rounded border border-background-300 bg-background-50 px-2 py-1 text-xs text-foreground-700 hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-40">Add row &darr;</button>
            <button type="button" disabled={!hasTable} onMouseDown={stop} onClick={() => addColumn(false)} className="rounded border border-background-300 bg-background-50 px-2 py-1 text-xs text-foreground-700 hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-40">Add col &larr;</button>
            <button type="button" disabled={!hasTable} onMouseDown={stop} onClick={() => addColumn(true)} className="rounded border border-background-300 bg-background-50 px-2 py-1 text-xs text-foreground-700 hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-40">Add col &rarr;</button>
            <button type="button" disabled={!hasTable} onMouseDown={stop} onClick={deleteRow} className="rounded border border-background-300 bg-background-50 px-2 py-1 text-xs text-foreground-700 hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-40">Delete row</button>
            <button type="button" disabled={!hasTable} onMouseDown={stop} onClick={deleteColumn} className="rounded border border-background-300 bg-background-50 px-2 py-1 text-xs text-foreground-700 hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-40">Delete column</button>
            <button type="button" disabled={!hasTable} onMouseDown={stop} onClick={deleteTable} className="rounded border border-background-300 bg-background-50 px-2 py-1 text-xs text-primary-700 hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-40">Delete table</button>
            <span className="ml-1 text-[11px] text-foreground-400">Tip: click a cell first to target that row/column.</span>
          </div>
        </div>
      ) : null}

      {/* Editable area */}
      <div className="relative">
        {(!value || value === "<p></p>") && !focused ? (
          <span className="pointer-events-none absolute left-3 top-3 text-sm text-foreground-400">{placeholder}</span>
        ) : null}
        <div
          ref={ref}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="Rich text editor"
          suppressContentEditableWarning
          onInput={emit}
          onMouseUp={syncActiveTable}
          onKeyUp={syncActiveTable}
          onBlur={() => {
            setFocused(false);
            emit();
          }}
          onFocus={() => setFocused(true)}
          className="rte-content px-3 py-3 text-sm leading-relaxed text-foreground-900 outline-none"
          style={{ minHeight }}
        />
      </div>
    </div>
  );
}