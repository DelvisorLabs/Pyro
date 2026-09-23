import { useState, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface GlideOption { value: string; label: ReactNode; tag?: string }
interface Props {
  options: Array<string | GlideOption>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string, option: GlideOption) => void;
  placeholder?: string;
  showTags?: boolean;
  size?: "sm" | "md" | "lg";
  menuWidth?: number;
  placement?: "top" | "bottom";
  align?: "left" | "right";
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  ariaDescribedBy?: string;
  className?: string;
}

// Keep the React Bits option API, using the shared portalled dropdown for
// consistent focus, keyboard navigation and collision handling inside dialogs.
export function GlideSelect({ options, value, defaultValue, onChange, placeholder = "Select…", showTags = true, size = "md", menuWidth, placement = "bottom", align = "left", disabled = false, ariaLabel = "Select", id, ariaDescribedBy, className }: Props) {
  const items = options.map((item) => typeof item === "string" ? { value: item, label: item } : item);
  const [inner, setInner] = useState(defaultValue ?? "");
  return <div className={cn("min-w-0", className)}><Select value={value ?? inner} disabled={disabled} onValueChange={(next) => {
    const option = items.find((item) => item.value === next);
    if (!option) return;
    setInner(next); onChange?.(next, option);
  }}>
    <SelectTrigger id={id} aria-label={ariaLabel} aria-describedby={ariaDescribedBy} className={cn(size === "sm" && "h-8 text-xs", size === "lg" && "h-10")}><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent side={placement} align={align === "left" ? "start" : "end"} style={menuWidth ? { minWidth: `max(${menuWidth}px, var(--radix-select-trigger-width))`, maxWidth: "calc(100vw - 32px)" } : undefined}>
      {items.map((item) => <SelectItem key={item.value} value={item.value} textValue={typeof item.label === "string" ? item.label : undefined}><span className="flex items-center justify-between gap-6"><span>{item.label}</span>{showTags && item.tag && <span className="text-xs text-muted">{item.tag}</span>}</span></SelectItem>)}
    </SelectContent>
  </Select></div>;
}
