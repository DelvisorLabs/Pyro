import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex items-center rounded-[2px] border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-neutral-700", className)}
      {...props}
    />
  );
}
