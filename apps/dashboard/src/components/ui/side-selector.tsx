import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SideSelectorItem {
  value: string;
  label: string;
  icon?: ReactNode;
  meta?: ReactNode;
  description?: string;
}

interface SideSelectorProps {
  label: string;
  items: SideSelectorItem[];
  value?: string;
  onValueChange: (value: string) => void;
  caption?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function SideSelector({ label, items, value, onValueChange, caption, footer, className }: SideSelectorProps) {
  return <div className={cn("min-w-0", className)}>
    {caption && <p className="mb-2 text-xs text-muted" role="status">{caption}</p>}
    <div role="group" aria-label={label} className="max-h-[480px] overflow-y-auto rounded-panel border border-line bg-surface">
      {items.map((item) => <button
        key={item.value}
        type="button"
        aria-pressed={item.value === value}
        onClick={() => onValueChange(item.value)}
        className={cn("flex w-full items-start gap-3 border-b border-l-2 border-b-line px-4 py-4 text-left last:border-b-0 focus-visible:-outline-offset-2", item.value === value ? "border-l-accent bg-surface-subtle" : "border-l-transparent hover:bg-surface-subtle")}
      >
        {item.icon && <span aria-hidden="true" className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-muted">{item.icon}</span>}
        <span className="min-w-0">
          <strong className="block break-words text-[13px]">{item.label}</strong>
          {item.meta && <span className="mt-1 block text-xs text-muted">{item.meta}</span>}
          {item.description && <span className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{item.description}</span>}
        </span>
      </button>)}
    </div>
    {footer && <p className="mt-3 text-xs leading-5 text-muted">{footer}</p>}
  </div>;
}
