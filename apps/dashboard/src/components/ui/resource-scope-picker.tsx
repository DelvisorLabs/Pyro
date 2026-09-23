import { useId, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { scopeChoices, type ResourceChoice, type ResourceScope } from "@/lib/resource-scope";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./popover";

interface ResourceScopePickerProps {
  id: string;
  label: string;
  singular: string;
  choices: ResourceChoice[];
  value: ResourceScope;
  onChange: (scope: ResourceScope) => void;
  disabled?: boolean;
}

export function ResourceScopePicker({ id, label, singular, choices, value, onChange, disabled }: ResourceScopePickerProps) {
  const [query, setQuery] = useState("");
  const hintId = useId();
  const items = scopeChoices(choices, value, singular);
  const matching = items.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const invalid = !value.all && value.ids.length === 0;
  const summary = value.all ? `All ${label.toLowerCase()}` : value.ids.length === 1 ? items.find((item) => item.id === value.ids[0])?.name : value.ids.length ? `${value.ids.length} ${label.toLowerCase()}` : `Choose ${label.toLowerCase()}`;

  return (
    <div className="min-w-0">
      <Popover onOpenChange={() => setQuery("")}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" disabled={disabled} aria-label={`${label}: ${summary}`} aria-describedby={hintId} aria-invalid={invalid} className="ui-control w-full justify-between font-normal">
            <span className="truncate">{summary}</span><ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent aria-label={`Choose ${label.toLowerCase()}`} className="w-[max(280px,var(--radix-popover-trigger-width))] p-0">
          <label className="flex cursor-pointer items-start gap-2.5 border-b border-line p-3 text-sm">
            <Checkbox className="mt-0.5" checked={value.all} onCheckedChange={(all) => onChange({ all: all === true, ids: [] })} />
            <span>All {label.toLowerCase()}<span className="mt-0.5 block text-xs text-muted">Includes current and future {label.toLowerCase()}.</span></span>
          </label>
          <div className="relative m-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden="true" />
            <Input aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} value={query} onChange={(event) => setQuery(event.target.value)} className="pl-8" />
          </div>
          <div className="max-h-44 overflow-y-auto px-1 pb-1" role="group" aria-label={`Specific ${label.toLowerCase()}`}>
            {matching.map((item) => {
              const checked = !value.all && value.ids.includes(item.id);
              return (
                <label key={item.id} className="flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-2 text-[13px] hover:bg-surface-subtle focus-within:bg-surface-subtle">
                  <Checkbox checked={checked} disabled={!checked && value.ids.length >= 100} onCheckedChange={(selected) => onChange({ all: false, ids: selected === true ? [...(value.all ? [] : value.ids), item.id] : value.ids.filter((id) => id !== item.id) })} />
                  <span className="min-w-0 break-words">{item.name}{item.unavailable && <span className="mt-0.5 block text-xs text-muted">{item.id} · Saved selection; remove if no longer needed.</span>}</span>
                </label>
              );
            })}
            {!matching.length && <p className="px-3 py-5 text-center text-xs text-muted">{query ? `No matching ${label.toLowerCase()}.` : `No ${label.toLowerCase()} available yet.`}</p>}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
            <span className="text-xs text-muted" aria-live="polite">{value.all ? "All included" : `${value.ids.length} selected`}{value.ids.length >= 100 && " · maximum 100"}</span>
            <PopoverClose asChild><Button type="button" size="sm" variant="ghost">Done</Button></PopoverClose>
          </div>
        </PopoverContent>
      </Popover>
      <p id={hintId} className={`mt-1.5 text-xs ${invalid ? "text-danger" : "text-muted"}`}>
        {invalid ? `Select at least one ${singular} or choose All ${label.toLowerCase()}.` : value.all ? `Decisions from any ${singular}.` : `Only decisions from the selected ${value.ids.length === 1 ? singular : label.toLowerCase()}.`}
      </p>
    </div>
  );
}
