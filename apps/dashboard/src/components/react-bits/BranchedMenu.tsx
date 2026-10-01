import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
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

export function BranchedMenu({ items, defaultOpen = 0, activeValue = "", onSelect, width, rowHeight = 34, className = "", ariaLabel = "Main navigation" }: Props) {
  const id = useId();
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

  const link = (item: BranchedMenuChild | BranchedMenuItem) => {
    const value = item.value ?? item.label;
    const active = value === activeValue;
    return <button type="button" className="branched-menu__item" aria-current={active ? "page" : undefined} data-active={active ? "" : undefined} onClick={() => onSelect?.(value, item)}>
      {item.icon && <span className="branched-menu__icon" aria-hidden="true">{item.icon}</span>}
      <span className="branched-menu__label">{item.label}</span>
    </button>;
  };

  return (
    <nav aria-label={ariaLabel} className={`branched-menu ${className}`} style={{ "--bm-width": width ? `${width}px` : "100%", "--bm-row": `${rowHeight}px` } as CSSProperties}>
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
