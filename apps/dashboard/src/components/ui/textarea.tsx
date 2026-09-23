import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "ui-control flex min-h-28 w-full resize-y px-3 py-2.5 leading-6",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
