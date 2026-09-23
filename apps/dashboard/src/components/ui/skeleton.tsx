import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("rounded-control bg-surface-hover motion-safe:animate-pulse", className)} {...props} />;
}
