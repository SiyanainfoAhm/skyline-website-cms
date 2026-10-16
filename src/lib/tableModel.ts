/**
 * Structured table model for the CMS table editor.
 *
 * The Registered Agents listing is a CMS page whose body is authored HTML.
 * Rather than mutating a contentEditable blob (which silently loses the caret
 * and the "active" cell on every re-render), we parse the table out of the body
 * into a small, ordered model, edit the model, and serialise it back to HTML.
 *
 * Storage stays exactly where it was — inside `cms_pages.body` — so no schema
 * migration and no second source of truth. Each row/column carries a stable
 * identifier (`data-row-id` / `data-col-id`) and its position in the markup is
 * the explicit order, so reordering survives a save/reload round-trip.
 */

export interface TableColumn {
  id: string;
  label: string;
}

export interface TableRow {
  id: string;
  /** Cell content keyed by column id — cell values always travel with their column. */
  cells: Record<string, string>;
}

export interface TableModel {
  columns: TableColumn[];
  rows: TableRow[];
}

export interface ParsedBody {
  /** Authored HTML before the table (preserved verbatim). */
  before: string;
  /** Authored HTML after the table (preserved verbatim). */
  after: string;
  model: TableModel;
}

/* ------------------------------------------------------------------ Helpers */

export function uid(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`;
}

const escapeText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (value: string): string => escapeText(value).replace(/"/g, "&quot;");

/** Strips only the obviously dangerous bits from a cell's authored HTML. */
function sanitizeCellHtml(html: string): string {
  return (html ?? "")
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "");
}

const cellText = (html: string): string => (html ?? "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

/* ------------------------------------------------------------------ Parsing */

export function emptyModel(): TableModel {
  return { columns: [], rows: [] };
}

export function parseBody(html: string): ParsedBody {
  const source = html ?? "";
  if (typeof document === "undefined") {
    return { before: source, after: "", model: emptyModel() };
  }
  const tpl = document.createElement("template");
  tpl.innerHTML = source;
  const table = tpl.content.querySelector("table");
  if (!table) {
    return { before: source, after: "", model: emptyModel() };
  }

  let before = "";
  let after = "";
  let seen = false;
  Array.from(tpl.content.childNodes).forEach((node) => {
    if (node === table) {
      seen = true;
      return;
    }
    const chunk =
      node.nodeType === 1 ? (node as HTMLElement).outerHTML : (node as Text).textContent ?? "";
    if (seen) after += chunk;
    else before += chunk;
  });

  const rows = Array.from(table.querySelectorAll("tr"));
  const headerRow = rows.find((r) => r.querySelector("th")) ?? null;
  const hasHeader = Boolean(headerRow);
  const firstRow = headerRow ?? rows[0] ?? null;

  const width = rows.reduce((max, r) => Math.max(max, r.cells.length), 0);

  const columns: TableColumn[] = [];
  for (let i = 0; i < width; i += 1) {
    const headCell = firstRow && hasHeader ? firstRow.cells[i] : null;
    const label = headCell ? cellText(headCell.innerHTML) : "";
    columns.push({
      id: headCell?.getAttribute("data-col-id") || uid("col"),
      label: label || `Column ${i + 1}`,
    });
  }

  const dataRows = hasHeader ? rows.filter((r) => r !== headerRow) : rows;
  const modelRows: TableRow[] = dataRows.map((tr) => {
    const cells: Record<string, string> = {};
    columns.forEach((col, i) => {
      const cell = tr.cells[i];
      cells[col.id] = cell ? cell.innerHTML.trim() : "";
    });
    return { id: tr.getAttribute("data-row-id") || uid("row"), cells };
  });

  return { before, after, model: { columns, rows: modelRows } };
}

/* --------------------------------------------------------------- Serialising */

export function serializeTable(model: TableModel): string {
  if (model.columns.length === 0) return "";
  const head = model.columns
    .map((col) => `<th data-col-id="${escapeAttr(col.id)}">${escapeText(col.label)}</th>`)
    .join("");
  const body = model.rows
    .map((row) => {
      const cells = model.columns
        .map((col) => `<td data-col-id="${escapeAttr(col.id)}">${sanitizeCellHtml(row.cells[col.id] ?? "")}</td>`)
        .join("");
      return `<tr data-row-id="${escapeAttr(row.id)}">${cells}</tr>`;
    })
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function serializeBody(before: string, model: TableModel, after: string): string {
  return `${before}${serializeTable(model)}${after}`;
}

/* ------------------------------------------------------------------ Row ops */

export function insertRowAt(model: TableModel, index: number): TableModel {
  const at = Math.max(0, Math.min(index, model.rows.length));
  const cells: Record<string, string> = {};
  model.columns.forEach((col) => {
    cells[col.id] = "";
  });
  const row: TableRow = { id: uid("row"), cells };
  const rows = [...model.rows];
  rows.splice(at, 0, row);
  return { ...model, rows };
}

export function deleteRowById(model: TableModel, rowId: string): TableModel {
  return { ...model, rows: model.rows.filter((r) => r.id !== rowId) };
}

export function moveRow(model: TableModel, rowId: string, toIndex: number): TableModel {
  const from = model.rows.findIndex((r) => r.id === rowId);
  if (from === -1) return model;
  const to = Math.max(0, Math.min(toIndex, model.rows.length - 1));
  if (from === to) return model;
  const rows = [...model.rows];
  const [row] = rows.splice(from, 1);
  rows.splice(to, 0, row);
  return { ...model, rows };
}

export function nudgeRow(model: TableModel, rowId: string, delta: number): TableModel {
  const from = model.rows.findIndex((r) => r.id === rowId);
  if (from === -1) return model;
  return moveRow(model, rowId, from + delta);
}

export function swapRows(model: TableModel, aId: string, bId: string): TableModel {
  const a = model.rows.findIndex((r) => r.id === aId);
  const b = model.rows.findIndex((r) => r.id === bId);
  if (a === -1 || b === -1 || a === b) return model;
  const rows = [...model.rows];
  const tmp = rows[a];
  rows[a] = rows[b];
  rows[b] = tmp;
  return { ...model, rows };
}

/* --------------------------------------------------------------- Column ops */

export function insertColumnAt(model: TableModel, index: number): TableModel {
  const at = Math.max(0, Math.min(index, model.columns.length));
  const col: TableColumn = { id: uid("col"), label: `Column ${model.columns.length + 1}` };
  const columns = [...model.columns];
  columns.splice(at, 0, col);
  const rows = model.rows.map((row) => ({ ...row, cells: { ...row.cells, [col.id]: "" } }));
  return { columns, rows };
}

export function deleteColumnById(model: TableModel, colId: string): TableModel {
  const columns = model.columns.filter((c) => c.id !== colId);
  const rows = model.rows.map((row) => {
    const cells = { ...row.cells };
    delete cells[colId];
    return { ...row, cells };
  });
  return { columns, rows };
}

export function renameColumn(model: TableModel, colId: string, label: string): TableModel {
  return { ...model, columns: model.columns.map((c) => (c.id === colId ? { ...c, label } : c)) };
}

export function moveColumn(model: TableModel, colId: string, toIndex: number): TableModel {
  const from = model.columns.findIndex((c) => c.id === colId);
  if (from === -1) return model;
  const to = Math.max(0, Math.min(toIndex, model.columns.length - 1));
  if (from === to) return model;
  const columns = [...model.columns];
  const [col] = columns.splice(from, 1);
  columns.splice(to, 0, col);
  // Cell values are keyed by column id, so reordering the column list moves the
  // whole column (header + every cell value) in one step.
  return { ...model, columns };
}

export function nudgeColumn(model: TableModel, colId: string, delta: number): TableModel {
  const from = model.columns.findIndex((c) => c.id === colId);
  if (from === -1) return model;
  return moveColumn(model, colId, from + delta);
}

export function swapColumns(model: TableModel, aId: string, bId: string): TableModel {
  const a = model.columns.findIndex((c) => c.id === aId);
  const b = model.columns.findIndex((c) => c.id === bId);
  if (a === -1 || b === -1 || a === b) return model;
  const columns = [...model.columns];
  const tmp = columns[a];
  columns[a] = columns[b];
  columns[b] = tmp;
  return { ...model, columns };
}

/* --------------------------------------------------------------- Validation */

export function isColumnPopulated(model: TableModel, colId: string): boolean {
  return model.rows.some((row) => cellText(row.cells[colId] ?? "") !== "");
}

export function isRowPopulated(row: TableRow): boolean {
  return Object.values(row.cells).some((value) => cellText(value) !== "");
}