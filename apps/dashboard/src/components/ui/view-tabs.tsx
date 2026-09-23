import { cn } from "@/lib/utils";

export function ViewTabs<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; count?: number }>; onChange: (value: T) => void }) {
  return <nav aria-label={label} className="mb-6 flex gap-6 border-b border-line">
    {options.map((option) => <button key={option.value} type="button" aria-current={option.value === value ? "page" : undefined} onClick={() => onChange(option.value)} className={cn("-mb-px flex items-center gap-2 border-b-2 px-0 py-3 text-[13px] transition-colors", option.value === value ? "border-accent font-semibold text-foreground" : "border-transparent text-muted hover:text-foreground")}>{option.label}{option.count !== undefined && <span className="text-xs font-normal text-muted">{option.count}</span>}</button>)}
  </nav>;
}
