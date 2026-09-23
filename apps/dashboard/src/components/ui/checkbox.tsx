import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

// shadcn/ui's Radix checkbox, using the dashboard's shared colour tokens.
export const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(
  ({ className, checked, ...props }, ref) => (
    <CheckboxPrimitive.Root ref={ref} checked={checked} className={cn("peer grid size-4 shrink-0 place-content-center rounded-[3px] border border-line-strong bg-surface outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-inverse data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-inverse", className)} {...props}>
      <CheckboxPrimitive.Indicator className="grid place-content-center text-current">
        {checked === "indeterminate" ? <Minus className="size-3" /> : <Check className="size-3" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
);
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
