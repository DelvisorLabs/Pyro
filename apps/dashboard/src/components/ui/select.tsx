import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import "@/components/react-bits/GlideSelect.css";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>>(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger ref={ref} className={cn("glide-select__trigger ui-control flex h-9 w-full min-w-0 items-center justify-between gap-2 overflow-hidden px-3 text-left [&>span:first-child]:min-w-0 [&>span:first-child]:overflow-hidden [&>span:first-child]:text-ellipsis [&>span:first-child]:whitespace-nowrap", className)} {...props}>
      {children}<SelectPrimitive.Icon className="glide-select__chevron shrink-0 opacity-60"><ChevronDown className="size-4 text-muted" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  ),
);
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectContent = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Content>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>>(
  ({ className, children, ...props }, ref) => <SelectPrimitive.Portal>
    <SelectPrimitive.Content ref={ref} position="popper" sideOffset={5} className={cn("glide-select__menu ui-popover z-[80] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-32px)] overflow-hidden p-1", className)} {...props}>
      <GlideViewport>{children}</GlideViewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>,
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

// Restore the React Bits sliding highlight while retaining Radix's keyboard,
// focus, scrolling and portal handling. Track the real highlighted option.
function GlideViewport({ children }: { children: React.ReactNode }) {
  const viewport = React.useRef<HTMLDivElement>(null);
  const pill = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const list = viewport.current;
    const highlight = pill.current;
    if (!list || !highlight) return;
    const update = () => {
      const option = list.querySelector<HTMLElement>('[role="option"][data-highlighted]');
      highlight.style.opacity = option ? "1" : "0";
      if (option) { highlight.style.height = `${option.offsetHeight}px`; highlight.style.transform = `translateY(${option.offsetTop}px)`; }
    };
    const observer = new MutationObserver(update);
    observer.observe(list, { attributes: true, subtree: true, attributeFilter: ["data-highlighted"], childList: true });
    update();
    return () => observer.disconnect();
  }, []);
  return <SelectPrimitive.Viewport ref={viewport} className="glide-select__list"><span ref={pill} className="glide-select__pill" aria-hidden="true" />{children}</SelectPrimitive.Viewport>;
}

export const SelectItem = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Item>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Item ref={ref} className={cn("glide-select__option relative flex cursor-default select-none items-center rounded-control min-h-8 py-1.5 pl-3 pr-8 text-[13px] outline-none data-[highlighted]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-45", className)} {...props}>
      <span className="absolute right-2 flex size-4 items-center justify-center"><SelectPrimitive.ItemIndicator><Check className="size-3.5" /></SelectPrimitive.ItemIndicator></span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  ),
);
SelectItem.displayName = SelectPrimitive.Item.displayName;
