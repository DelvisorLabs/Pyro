import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";

export function HelpTooltip({ children, label = "More information", className }: { children: ReactNode; label?: string; className?: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const show = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const halfWidth = 116;
    setPosition({
      left: Math.max(halfWidth + 8, Math.min(window.innerWidth - halfWidth - 8, rect.left + rect.width / 2)),
      top: rect.top - 8,
    });
  };
  return (
    <span className={cn("inline-flex", className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-describedby={id}
        onMouseEnter={show}
        onMouseLeave={() => setPosition(undefined)}
        onFocus={show}
        onBlur={() => setPosition(undefined)}
        className="inline-flex size-4 items-center justify-center text-neutral-400 outline-none hover:text-neutral-950 focus-visible:text-neutral-950"
      >
        <CircleHelp className="size-3.5" />
      </button>
      {position && createPortal(<span id={id} role="tooltip" style={position} className="pointer-events-none fixed z-[100] line-clamp-2 w-[232px] -translate-x-1/2 -translate-y-full rounded-[2px] bg-neutral-950 px-3 py-2 text-left text-[11px] font-normal normal-case leading-4 tracking-normal text-white shadow-xl">{children}</span>, document.body)}
    </span>
  );
}
