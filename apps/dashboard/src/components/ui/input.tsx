import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "ui-control flex h-9 w-full min-w-0 px-3 file:mr-3 file:border-0 file:bg-transparent file:py-1.5 file:text-xs file:font-semibold file:text-foreground",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
