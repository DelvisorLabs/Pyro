import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex items-center rounded-control border border-line bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-secondary", className)}
      {...props}
    />
  );
}
