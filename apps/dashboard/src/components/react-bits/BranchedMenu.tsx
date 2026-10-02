import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import "./BranchedMenu.css";

export interface BranchedMenuChild {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface BranchedMenuItem {
  label: string;
  value?: string;
  icon?: ReactNode;
  children?: BranchedMenuChild[];
}

interface Props {
  items: BranchedMenuItem[];
  defaultOpen?: number | number[];
  activeValue?: string;
  onSelect?: (value: string, item: BranchedMenuChild | BranchedMenuItem) => void;
  width?: number;
  rowHeight?: number;
  className?: string;
  ariaLabel?: string;
}

const sectionKey = (item: BranchedMenuItem) => item.value ?? item.label;
type Highlight = { left: number; top: number; width: number; height: number; visible: boolean };

export function BranchedMenu({ items, defaultOpen = 0, activeValue = "", onSelect, width, rowHeight = 34, className = "", ariaLabel = "Main navigation" }: Props) {
  const id = useId();
  const menu = useRef<HTMLElement>(null);
  const links = useRef(new Map<string, HTMLButtonElement>());
  const [hovered, setHovered] = useState<string>();
  const [highlight, setHighlight] = useState<Highlight>();
  const activeSection = items.find((item) => item.children?.some((child) => child.value === activeValue));
  const activeKey = activeSection && sectionKey(activeSection);
  // Section identities survive role filtering and organization changes.
  const [open, setOpen] = useState(() => {
    const indices = Array.isArray(defaultOpen) ? defaultOpen : [defaultOpen];
    return new Set([...items.filter((_, index) => indices.includes(index)).map(sectionKey), ...(activeKey ? [activeKey] : [])]);
  });

  useEffect(() => {
    if (activeKey) setOpen((current) => current.has(activeKey) ? current : new Set(current).add(activeKey));
  }, [activeKey, activeValue]);

  // One background follows the pointer; the active row has its own fill.
  // Measure the rendered layout so it also works across mobile columns and folds.
  useLayoutEffect(() => {
    const root = menu.current;
    if (!root) return;
    const measure = () => {
      const button = hovered === undefined ? undefined : links.current.get(hovered);
      if (!button || !button.getClientRects().length || button.closest("[inert]")) {
        // Keep the last position so the next hovered row still slides into place.
        setHighlight((previous) => previous?.visible ? { ...previous, visible: false } : previous);
        return;
      }
      const bounds = root.getBoundingClientRect();
      const row = button.getBoundingClientRect();
      const next = { left: row.left - bounds.left, top: row.top - bounds.top, width: row.width, height: row.height, visible: true };
      setHighlight((previous) => previous?.visible && previous.left === next.left && previous.top === next.top && previous.width === next.width && previous.height === next.height ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const section of root.querySelectorAll(".branched-menu__section")) observer.observe(section);
    return () => observer.disconnect();
  }, [hovered, open, items]);

  const link = (item: BranchedMenuChild | BranchedMenuItem) => {
    const value = item.value ?? item.label;
    const active = value === activeValue;
    return <button
      ref={(element) => { if (element) links.current.set(value, element); else links.current.delete(value); }}
      type="button"
      className="branched-menu__item"
      aria-current={active ? "page" : undefined}
      data-active={active ? "" : undefined}
      data-highlighted={value === hovered ? "" : undefined}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") setHovered(value); }}
      onPointerLeave={() => setHovered(undefined)}
      onClick={() => onSelect?.(value, item)}
    >
      {item.icon && <span className="branched-menu__icon" aria-hidden="true">{item.icon}</span>}
      <span className="branched-menu__label">{item.label}</span>
    </button>;
  };

  return (
    <nav
      ref={menu}
      aria-label={ariaLabel}
      className={`branched-menu ${className}`}
      onPointerLeave={() => setHovered(undefined)}
      style={{ "--bm-width": width ? `${width}px` : "100%", "--bm-row": `${rowHeight}px` } as CSSProperties}
    >
      {highlight && <span className="branched-menu__highlight" data-visible={highlight.visible ? "" : undefined} aria-hidden="true" style={{ width: highlight.width, height: highlight.height, transform: `translate3d(${highlight.left}px, ${highlight.top}px, 0)` }} />}
      {items.map((item, index) => {
        const children = item.children;
        const key = sectionKey(item);
        if (!children) return <div key={key}>{link(item)}</div>;
        const isOpen = open.has(key);
        const bodyId = `${id}-section-${index}`;
        return (
          <div key={key} className="branched-menu__section" data-open={isOpen ? "" : undefined}>
            <button
              type="button"
              className="branched-menu__head"
              aria-expanded={isOpen}
              aria-controls={bodyId}
              onPointerEnter={(event) => { if (event.pointerType !== "touch") setHovered(undefined); }}
              onClick={() => setOpen((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
            >
              <span>{item.label}</span>
              <span className="branched-menu__divider" aria-hidden="true" />
              <ChevronDown className="branched-menu__chevron" size={12} aria-hidden="true" />
            </button>
            <div id={bodyId} className="branched-menu__body" inert={!isOpen} aria-hidden={!isOpen}>
              <div className="branched-menu__fold"><ul className="branched-menu__items">
                {children.map((child) => <li key={child.value}>{link(child)}</li>)}
              </ul></div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
