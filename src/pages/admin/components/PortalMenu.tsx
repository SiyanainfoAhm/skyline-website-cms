import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A dropdown menu rendered into a portal at the document body.
 *
 * The CMS table editor lives inside horizontally/vertically scrollable
 * containers (`overflow-x-auto` / `overflow-y-auto`), which clip ordinary
 * absolutely-positioned menus. Rendering through a portal with `position: fixed`
 * guarantees the row/column action menus are always fully visible and clickable,
 * no matter where the table is scrolled.
 */
interface Props {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: "start" | "end";
}

export default function PortalMenu({ anchor, onClose, children, width = 232, align = "end" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const reposition = useCallback(() => {
    if (!anchor || !ref.current) return;
    const rect = anchor.getBoundingClientRect();
    const menuH = ref.current.offsetHeight;
    const menuW = ref.current.offsetWidth || width;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = rect.bottom + 6;
    if (top + menuH > vh - 8) {
      const flipped = rect.top - menuH - 6;
      top = flipped >= 8 ? flipped : Math.max(8, vh - menuH - 8);
    }

    let left = align === "end" ? rect.right - menuW : rect.left;
    left = Math.max(8, Math.min(left, vw - menuW - 8));

    setPos({ top, left });
  }, [anchor, align, width]);

  useLayoutEffect(() => {
    reposition();
    const id = window.requestAnimationFrame(reposition);
    return () => window.cancelAnimationFrame(id);
  }, [reposition, children]);

  useEffect(() => {
    const onMove = () => reposition();
    document.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [reposition]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (ref.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        visibility: pos ? "visible" : "hidden",
        zIndex: 90,
      }}
      className="max-h-[70vh] overflow-y-auto rounded-md border border-background-200 bg-background-50 py-1 shadow-xl"
    >
      {children}
    </div>,
    document.body,
  );
}