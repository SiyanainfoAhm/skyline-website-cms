import { Children, cloneElement, createElement, isValidElement, useId, type HTMLAttributes, type ReactNode, type TableHTMLAttributes } from "react";

type ElementProps = HTMLAttributes<HTMLElement> & { children?: ReactNode; colSpan?: number; scope?: string; headers?: string; "data-label"?: string };

function textLabel(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (!isValidElement<ElementProps>(child) || child.props["aria-hidden"]) return "";
    return textLabel(child.props.children);
  }).filter(Boolean).join(" ").trim();
}

function hasControl(node: ReactNode): boolean {
  return Children.toArray(node).some(child => isValidElement<ElementProps>(child)
    && (["button", "input", "select"].includes(String(child.type)) || hasControl(child.props.children)));
}

/** Shared display table. Keep native rows, controls and handlers; derive mobile labels from column headers. */
export default function ResponsiveTable({ children, className = "", ...props }: TableHTMLAttributes<HTMLTableElement>) {
  const id = useId();
  const sections = Children.toArray(children);
  const head = sections.find(node => isValidElement(node) && node.type === "thead");
  const headerRow = isValidElement<ElementProps>(head)
    ? Children.toArray(head.props.children).find(node => isValidElement(node) && node.type === "tr") : undefined;
  const columns = isValidElement<ElementProps>(headerRow) ? Children.toArray(headerRow.props.children) : [];
  const labels = columns.map(textLabel);
  const headerIds = columns.map((node, index) => isValidElement<ElementProps>(node) && node.props.id || `${id}-column-${index}`);

  const renderRow = (node: ReactNode, header: boolean): ReactNode => {
    if (!isValidElement<ElementProps>(node) || node.type !== "tr") return node;
    let column = 0;
    return cloneElement(node, { role: "row" }, Children.toArray(node.props.children).map(cell => {
      if (!isValidElement<ElementProps>(cell) || (cell.type !== "td" && cell.type !== "th")) return cell;
      const index = column;
      column += cell.props.colSpan ?? 1;
      if (header) return cloneElement(cell, { id: headerIds[index], scope: cell.props.scope ?? "col", role: "columnheader", "aria-label": labels[index] });
      const spanning = (cell.props.colSpan ?? 1) > 1;
      return cloneElement(cell, {
        role: cell.type === "th" ? "rowheader" : "cell",
        headers: cell.props.headers ?? headerIds.slice(index, column).join(" "),
        "data-label": spanning ? undefined : cell.props["data-label"] ?? labels[index],
        className: `${cell.props.className ?? ""}${spanning ? " data-table-message" : ""}`,
      });
    }));
  };

  const sorting = columns.some(hasControl) ? createElement("div", { className: "data-table-sorting", "aria-label": "Table sorting" },
    columns.map((column, index) => isValidElement<ElementProps>(column) && hasControl(column)
      ? createElement("div", { key: headerIds[index] }, column.props.children) : null)) : null;
  const content = sections.map(section => {
    if (!isValidElement<ElementProps>(section) || !["thead", "tbody", "tfoot"].includes(String(section.type))) return section;
    return cloneElement(section, { role: "rowgroup" }, Children.map(section.props.children, row => renderRow(row, section.type === "thead")));
  });
  return createElement("div", { className: "data-table-frame" }, sorting,
    createElement("table", { ...props, role: "table", className: `data-table ${className}` }, content));
}

