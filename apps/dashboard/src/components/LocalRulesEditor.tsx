import { Plus, Trash2 } from "lucide-react";
import { LocalRuleSchema, type LocalRule } from "@pyro/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function LocalRulesEditor({ rules, onChange }: { rules: LocalRule[]; onChange: (rules: LocalRule[]) => void }) {
  const update = (index: number, changes: Partial<LocalRule>) => onChange(rules.map((rule, i) => i === index ? { ...rule, ...changes } : rule));
  return <section className="space-y-3">
    <div className="flex items-start justify-between gap-4"><div><Label>Local rules</Label><p className="mt-1 text-xs text-muted">Run alongside application rules before the model. Block takes priority, then highest risk. Regex uses RE2 syntax.</p></div><Button variant="outline" size="sm" disabled={rules.length >= 100} onClick={() => onChange([...rules, { id: `rule_${crypto.randomUUID().slice(0, 8)}`, name: "", description: "", enabled: true, scope: "all_text", match: "contains", pattern: "", caseSensitive: false, action: "review", risk: .8 }])}><Plus className="size-4" />Add rule</Button></div>
    {rules.length === 0 && <p className="border border-dashed p-4 text-sm text-muted">No profile rules. Application rules still apply.</p>}
    {rules.map((rule, index) => { const parsed = LocalRuleSchema.safeParse(rule); return <div key={index} className="space-y-3 border p-4">
      <div className="flex items-center gap-3"><Switch aria-label={`Enable rule ${index + 1}`} checked={rule.enabled} onCheckedChange={(enabled) => update(index, { enabled })} /><Input aria-label="Rule name" placeholder="Rule name" value={rule.name} onChange={(e) => update(index, { name: e.target.value })} /><Button variant="ghost" size="icon" aria-label={`Remove rule ${index + 1}`} onClick={() => onChange(rules.filter((_, i) => i !== index))}><Trash2 className="size-4" /></Button></div>
      <Input aria-label="Rule ID" value={rule.id} onChange={(e) => update(index, { id: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Select value={rule.scope} onValueChange={(scope: LocalRule["scope"]) => update(index, { scope })}><SelectTrigger aria-label="Inspect"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all_text">All text</SelectItem><SelectItem value="raw_json">Raw JSON</SelectItem><SelectItem value="tool_name">Tool names</SelectItem></SelectContent></Select>
        <Select value={rule.match} onValueChange={(match: LocalRule["match"]) => update(index, { match })}><SelectTrigger aria-label="Match type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="contains">Contains</SelectItem><SelectItem value="equals">Exact match</SelectItem><SelectItem value="regex">Regex (RE2)</SelectItem></SelectContent></Select>
        <Select value={rule.action} onValueChange={(action: LocalRule["action"]) => update(index, { action })}><SelectTrigger aria-label="Rule action"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="review">Review</SelectItem><SelectItem value="block">Block</SelectItem></SelectContent></Select>
      </div>
      <Input aria-label="Pattern" className="font-mono" placeholder={rule.match === "regex" ? "Pattern without / delimiters" : "Text to match"} value={rule.pattern} onChange={(e) => update(index, { pattern: e.target.value })} />
      <div className="flex items-center justify-between gap-4"><label className="flex items-center gap-2 text-sm"><Switch checked={rule.caseSensitive} onCheckedChange={(caseSensitive) => update(index, { caseSensitive })} />Case sensitive</label><label className="flex items-center gap-2 text-sm">Risk<Input aria-label="Rule risk" className="w-24" type="number" min="0" max="1" step="0.01" value={rule.risk} onChange={(e) => update(index, { risk: Number(e.target.value) })} /></label></div>
      <Input aria-label="Rule description" placeholder="Description (optional)" value={rule.description} onChange={(e) => update(index, { description: e.target.value })} />
      {!parsed.success && <p role="alert" className="text-sm text-danger">{parsed.error.issues[0]?.message}</p>}
    </div>; })}
  </section>;
}
