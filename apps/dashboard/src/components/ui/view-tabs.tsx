import { cn } from "@/lib/utils";

export function ViewTabs<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; count?: number }>; onChange: (value: T) => void }) {
  return <nav aria-label={label} className="mb-6 flex max-w-full gap-5 overflow-x-auto border-b border-line sm:gap-6">
    {options.map((option) => <button key={option.value} type="button" aria-current={option.value === value ? "page" : undefined} onClick={() => onChange(option.value)} className={cn("flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-0 py-3 text-[13px] transition-colors focus-visible:-outline-offset-2", option.value === value ? "border-accent font-semibold text-foreground" : "border-transparent text-muted hover:text-foreground")}>{option.label}{option.count !== undefined && <span className="text-xs font-normal text-muted">{option.count}</span>}</button>)}
  </nav>;
}
