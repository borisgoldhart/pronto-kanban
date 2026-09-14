/** Anchored dropdown panel: click toggles, outside click / Escape closes (same behaviour as the Pronto nav menus). */
import { useEffect, useRef, type ReactNode } from "react";

export function Popover({ open, onClose, anchorClass, children, align = "end", width }: { open: boolean; onClose: () => void; anchorClass?: string; children: ReactNode; align?: "start" | "end"; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  if (!open) return null;
  return <div ref={ref} className={`pk-popover pk-popover--${align} ${anchorClass || ""}`} style={width ? { width } : undefined} role="menu">{children}</div>;
}
