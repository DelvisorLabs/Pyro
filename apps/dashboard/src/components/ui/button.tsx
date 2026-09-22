import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[2px] border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "border-neutral-950 bg-neutral-950 text-white hover:bg-neutral-800",
        outline: "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-600 hover:bg-neutral-100",
        ghost: "border-transparent bg-transparent text-neutral-600 hover:bg-neutral-200/70 hover:text-neutral-950",
        danger: "border-neutral-950 bg-white text-neutral-950 hover:bg-neutral-950 hover:text-white",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
        icon: "size-9 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";
