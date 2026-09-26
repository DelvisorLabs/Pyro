import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { LocalRuleSchema, type LocalRule } from "@pyro/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function LocalRulesEditor({ rules, onChange }: { rules: LocalRule[]; onChange: (rules: LocalRule[]) => void }) {
  const instanceId = useId();
  const update = (index: number, changes: Partial<LocalRule>) => onChange(rules.map((rule, i) => i === index ? { ...rule, ...changes } : rule));
  return <section className="space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">Local rules</h3><p className="mt-1 text-xs leading-5 text-muted">Run alongside application rules before the model. Block takes priority, then highest risk. Regex uses RE2 syntax.</p></div><Button variant="outline" size="sm" disabled={rules.length >= 100} onClick={() => onChange([...rules, { id: `rule_${crypto.randomUUID().slice(0, 8)}`, name: "", description: "", enabled: true, scope: "all_text", match: "contains", pattern: "", caseSensitive: false, action: "review", risk: .8 }])}><Plus className="size-4" />Add rule</Button></div>
    {rules.length === 0 && <p className="rounded-control border border-dashed border-line-strong bg-surface-subtle p-4 text-[13px] text-muted">No profile rules. Application rules still apply.</p>}
    {rules.map((rule, index) => {
      const parsed = LocalRuleSchema.safeParse(rule);
      const prefix = `${instanceId}-rule-${index}`;
      return <Card key={index}>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><CardTitle>Rule {index + 1}</CardTitle><div className="flex items-center gap-3"><Switch aria-label={`Enable rule ${index + 1}`} checked={rule.enabled} onCheckedChange={(enabled) => update(index, { enabled })} /><Button variant="ghost" size="icon" className="size-8" aria-label={`Remove rule ${index + 1}`} onClick={() => onChange(rules.filter((_, i) => i !== index))}><Trash2 className="size-4" /></Button></div></CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2"><div><FieldLabel htmlFor={`${prefix}-name`}>Rule name</FieldLabel><Input id={`${prefix}-name`} placeholder="Rule name" value={rule.name} onChange={(event) => update(index, { name: event.target.value })} /></div><div><FieldLabel htmlFor={`${prefix}-id`}>Rule ID</FieldLabel><Input id={`${prefix}-id`} value={rule.id} onChange={(event) => update(index, { id: event.target.value })} /></div></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><FieldLabel htmlFor={`${prefix}-scope`}>Inspect</FieldLabel><Select value={rule.scope} onValueChange={(scope: LocalRule["scope"]) => update(index, { scope })}><SelectTrigger id={`${prefix}-scope`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all_text">All text</SelectItem><SelectItem value="raw_json">Raw JSON</SelectItem><SelectItem value="tool_name">Tool names</SelectItem></SelectContent></Select></div>
            <div><FieldLabel htmlFor={`${prefix}-match`}>Match type</FieldLabel><Select value={rule.match} onValueChange={(match: LocalRule["match"]) => update(index, { match })}><SelectTrigger id={`${prefix}-match`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="contains">Contains</SelectItem><SelectItem value="equals">Exact match</SelectItem><SelectItem value="regex">Regex (RE2)</SelectItem></SelectContent></Select></div>
            <div><FieldLabel htmlFor={`${prefix}-action`}>Rule action</FieldLabel><Select value={rule.action} onValueChange={(action: LocalRule["action"]) => update(index, { action })}><SelectTrigger id={`${prefix}-action`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="review">Review</SelectItem><SelectItem value="block">Block</SelectItem></SelectContent></Select></div>
          </div>
          <div><FieldLabel htmlFor={`${prefix}-pattern`}>Pattern</FieldLabel><Input id={`${prefix}-pattern`} className="font-mono text-xs" placeholder={rule.match === "regex" ? "Pattern without / delimiters" : "Text to match"} value={rule.pattern} onChange={(event) => update(index, { pattern: event.target.value })} /></div>
          <div className="grid items-end gap-4 sm:grid-cols-2"><div><FieldLabel htmlFor={`${prefix}-risk`}>Risk</FieldLabel><Input id={`${prefix}-risk`} type="number" min="0" max="1" step="0.01" value={rule.risk} onChange={(event) => update(index, { risk: Number(event.target.value) })} /></div><div className="flex min-h-9 items-center gap-2.5"><Switch id={`${prefix}-case`} checked={rule.caseSensitive} onCheckedChange={(caseSensitive) => update(index, { caseSensitive })} /><Label htmlFor={`${prefix}-case`}>Case sensitive</Label></div></div>
          <div><FieldLabel htmlFor={`${prefix}-description`}>Description <span className="font-normal text-muted">(optional)</span></FieldLabel><Input id={`${prefix}-description`} value={rule.description} onChange={(event) => update(index, { description: event.target.value })} /></div>
          {!parsed.success && <p role="alert" className="text-xs text-danger">{parsed.error.issues[0]?.message}</p>}
        </CardContent>
      </Card>;
    })}
  </section>;
}
