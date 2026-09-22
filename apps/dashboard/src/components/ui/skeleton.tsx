import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("rounded-[2px] bg-neutral-200 motion-safe:animate-pulse", className)} {...props} />;
}
