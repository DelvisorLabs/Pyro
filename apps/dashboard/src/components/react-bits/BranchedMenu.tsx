import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./BranchedMenu.css";

export interface BranchedMenuChild {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface BranchedMenuItem {
  label: string;
  value?: string;
  children?: BranchedMenuChild[];
}

interface Props {
  items: BranchedMenuItem[];
  defaultOpen?: number | number[];
  activeValue?: string;
  onSelect?: (value: string, item: BranchedMenuChild | BranchedMenuItem) => void;
  width?: number;
  rowHeight?: number;
  indent?: number;
  className?: string;
}

const PAD = 5;
const MARK = 15;
const toSet = (open: number | number[]) => new Set(Array.isArray(open) ? open : open >= 0 ? [open] : []);

export function BranchedMenu({ items, defaultOpen = 0, activeValue = "", onSelect, width = 210, rowHeight = 34, indent = 34, className = "" }: Props) {
  const [open, setOpen] = useState(() => toSet(defaultOpen));
  const navRef = useRef<HTMLElement>(null);
  const heads = useRef<Array<HTMLButtonElement | null>>([]);
  const markerRef = useRef<HTMLSpanElement>(null);
  const activeSection = items.findIndex((item) => item.children?.some((child) => child.value === activeValue));
  const markerShown = activeSection >= 0 && open.has(activeSection);

  useLayoutEffect(() => {
    const marker = markerRef.current;
    const heading = heads.current[activeSection];
    if (!marker) return;
    if (markerShown && heading) marker.style.top = `${heading.offsetTop + (heading.offsetHeight - MARK) / 2}px`;
    marker.toggleAttribute("data-on", Boolean(markerShown && heading));
  }, [activeSection, markerShown, items]);

  const radius = 7;
  const trunk = 12;
  const endX = indent - 7;
  const rowY = (index: number) => PAD + index * rowHeight + rowHeight / 2;
  const branch = (index: number) => `M ${trunk} ${rowY(index) - radius} A ${radius} ${radius} 0 0 0 ${trunk + radius} ${rowY(index)} H ${endX}`;
  const reach = (index: number) => `M ${trunk} 0 V ${rowY(index) - radius} A ${radius} ${radius} 0 0 0 ${trunk + radius} ${rowY(index)} H ${endX}`;
  const length = (index: number) => rowY(index) - radius + (Math.PI * radius) / 2 + (endX - trunk - radius);

  return (
    <nav ref={navRef} className={`branched-menu ${className}`} style={{ "--bm-width": `${width}px`, "--bm-row": `${rowHeight}px`, "--bm-indent": `${indent}px` } as CSSProperties}>
      <span ref={markerRef} className="branched-menu__marker" aria-hidden="true" />
      {items.map((item, index) => {
        const children = item.children;
        const isOpen = children ? open.has(index) : false;
        const leafValue = item.value ?? item.label;
        return (
          <div key={leafValue} className="branched-menu__section" data-open={isOpen ? "" : undefined}>
            <button
              ref={(element) => { heads.current[index] = element; }}
              type="button"
              className="branched-menu__head"
              aria-expanded={children ? isOpen : undefined}
              data-active={!children && leafValue === activeValue ? "" : undefined}
              onClick={() => {
                if (children) setOpen((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
                else onSelect?.(leafValue, item);
              }}
            >
              {item.label}
            </button>
            {children && <div className="branched-menu__body"><div className="branched-menu__fold"><div className="branched-menu__tree" style={{ height: PAD * 2 + children.length * rowHeight }}>
              <svg className="branched-menu__lines" width={indent} height={PAD * 2 + children.length * rowHeight} aria-hidden="true">
                <path className="branched-menu__base" d={`M ${trunk} 0 V ${rowY(children.length - 1) - radius}`} />
                {children.map((child, childIndex) => <path key={child.value} className="branched-menu__base" d={branch(childIndex)} />)}
                {children.map((child, childIndex) => <path key={child.value} className="branched-menu__reach" d={reach(childIndex)} style={{ strokeDasharray: length(childIndex), strokeDashoffset: child.value === activeValue ? 0 : length(childIndex) }} />)}
              </svg>
              {children.map((child) => <button key={child.value} type="button" className="branched-menu__item" data-active={child.value === activeValue ? "" : undefined} tabIndex={isOpen ? 0 : -1} onClick={() => onSelect?.(child.value, child)}>
                {child.icon && <span className="branched-menu__icon" aria-hidden="true">{child.icon}</span>}
                <span>{child.label}</span>
              </button>)}
            </div></div></div>}
          </div>
        );
      })}
    </nav>
  );
}
