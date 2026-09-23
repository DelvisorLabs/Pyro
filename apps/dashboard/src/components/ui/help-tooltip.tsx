import { useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { cn } from "@/lib/utils";

export function HelpTooltip({ children, label = "More information", className }: { children: ReactNode; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button type="button" aria-label={label} onClick={() => setOpen(true)} className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-subtle hover:text-foreground focus-visible:text-foreground", className)}>
            <CircleHelp className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
