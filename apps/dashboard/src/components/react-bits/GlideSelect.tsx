import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import "./GlideSelect.css";

export interface GlideOption { value: string; label: ReactNode; tag?: string }
interface Props {
  options: Array<string | GlideOption>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string, option: GlideOption) => void;
  placeholder?: string;
  showTags?: boolean;
  size?: "sm" | "md" | "lg";
  menuWidth?: number;
  placement?: "top" | "bottom";
  align?: "left" | "right";
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

const SIZES = { sm: { chip: 30, row: 29, font: 12 }, md: { chip: 36, row: 33, font: 13 }, lg: { chip: 42, row: 38, font: 14 } };
const norm = (option: string | GlideOption): GlideOption => typeof option === "string" ? { value: option, label: option } : option;

export function GlideSelect({ options, value, defaultValue, onChange, placeholder = "Select…", showTags = true, size = "md", menuWidth = 190, placement = "bottom", align = "left", disabled = false, ariaLabel = "Select", className = "" }: Props) {
  const items = options.map(norm);
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const selected = items.findIndex((item) => item.value === current);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [side, setSide] = useState(placement);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const id = useId();
  const metrics = SIZES[size];
  const step = metrics.row + 1;

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !rootRef.current) return;
    const root = rootRef.current.getBoundingClientRect();
    const required = menuRef.current.offsetHeight + 6;
    setSide(placement === "bottom" && root.bottom + required > window.innerHeight ? "top" : placement === "top" && root.top - required < 0 ? "bottom" : placement);
  }, [open, placement]);

  useLayoutEffect(() => {
    const pill = pillRef.current;
    if (!pill || !open || active === null) return;
    pill.style.transform = `translateY(${active * step}px)`;
    pill.style.opacity = "1";
  }, [active, open, step]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);

  const pick = (index: number) => {
    const option = items[index];
    if (!option) return;
    if (value === undefined) setInner(option.value);
    if (option.value !== current) onChange?.(option.value, option);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const keyDown = (event: React.KeyboardEvent) => {
    if (!open && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); setActive(selected >= 0 ? selected : 0); setOpen(true); return;
    }
    if (!open) return;
    const currentIndex = active ?? Math.max(0, selected);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(Math.max(0, Math.min(items.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)))); }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); setActive(event.key === "Home" ? 0 : items.length - 1); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(currentIndex); }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
  };

  const optionAt = (event: ReactPointerEvent<HTMLDivElement>) => Number((event.target as HTMLElement).closest<HTMLElement>("[data-index]")?.dataset.index);
  return (
    <div ref={rootRef} className={`glide-select ${className}`} data-disabled={disabled ? "" : undefined} style={{ "--gs-chip": `${metrics.chip}px`, "--gs-row": `${metrics.row}px`, "--gs-font": `${metrics.font}px`, "--gs-menu-width": `${menuWidth}px` } as CSSProperties}>
      <button ref={triggerRef} type="button" role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={`${id}-list`} disabled={disabled} className="glide-select__trigger" onClick={() => { setActive(selected >= 0 ? selected : 0); setOpen((currentOpen) => !currentOpen); }} onKeyDown={keyDown}>
        <span className="glide-select__label" data-empty={selected < 0 ? "" : undefined}>{selected >= 0 ? items[selected]!.label : placeholder}</span>
        <span className="glide-select__chevron" aria-hidden="true"><HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} /></span>
      </button>
      {open && <div ref={menuRef} className="glide-select__menu" data-side={side} data-align={align}>
        <div id={`${id}-list`} role="listbox" aria-label={ariaLabel} className="glide-select__list" onPointerMove={(event) => { const index = optionAt(event); if (Number.isFinite(index)) setActive(index); }} onPointerLeave={() => setActive(selected >= 0 ? selected : null)}>
          <span ref={pillRef} className="glide-select__pill" aria-hidden="true" />
          {items.map((item, index) => <div key={item.value} id={`${id}-${index}`} role="option" aria-selected={index === selected} data-index={index} className="glide-select__option" onPointerDown={(event) => event.preventDefault()} onClick={() => pick(index)}>
            <span className="glide-select__name">{item.label}</span>
            {showTags && item.tag && <span className="glide-select__tag">{item.tag}</span>}
            <span className="glide-select__check" data-on={index === selected ? "" : undefined} aria-hidden="true"><HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2.2} /></span>
          </div>)}
        </div>
      </div>}
    </div>
  );
}
