import { useId } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { PolicyPipeline, PolicyStep } from "@pyro/contracts";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Switch } from "./ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function OutcomeSelect({ id, label, value, onChange, continuing = false, safeOnly = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void; continuing?: boolean; safeOnly?: boolean;
}) {
  return <div className="min-w-0"><FieldLabel htmlFor={id}>{label}</FieldLabel><Select value={value} onValueChange={onChange}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent>
    {continuing && <SelectItem value="continue">Continue to next check</SelectItem>}
    {!safeOnly && <SelectItem value="allow">Allow</SelectItem>}<SelectItem value="review">Review</SelectItem><SelectItem value="block">Block</SelectItem>
  </SelectContent></Select></div>;
}

export function PipelineEditor({ pipeline, onChange }: { pipeline: PolicyPipeline; onChange: (pipeline: PolicyPipeline) => void }) {
  const prefix = useId();
  const replace = (index: number, step: PolicyStep) => onChange({ ...pipeline, steps: pipeline.steps.map((s, i) => i === index ? step : s) });
  const move = (index: number, offset: number) => { const steps = [...pipeline.steps]; [steps[index], steps[index + offset]] = [steps[index + offset]!, steps[index]!]; onChange({ ...pipeline, steps }); };
  const add = (type: "text" | "semantic") => {
    const common = { id: `check_${crypto.randomUUID().slice(0, 8)}`, name: type === "text" ? "Text check" : "Semantic condition", onMatch: "block" as const, onNoMatch: "continue" as const };
    const step: PolicyStep = type === "text" ? { ...common, type, match: "contains", pattern: "", words: [], caseSensitive: false }
      : { ...common, type, question: "", context: "", positiveExamples: [], negativeExamples: [], noThreshold: 0.2, yesThreshold: 0.8 };
    onChange({ ...pipeline, steps: [...pipeline.steps, step] });
  };
  return <div className="space-y-4">
    <p className="text-xs leading-5 text-muted">Checks run from top to bottom. Yes means the text pattern or semantic condition matches. A terminal outcome skips the remaining checks.</p>
    <ol className="space-y-3" aria-label="Ordered policy checks">{pipeline.steps.map((step, index) => {
      const id = `${prefix}-${step.id}`;
      return <li key={step.id} className="min-w-0 rounded-control border border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-subtle px-3 py-2">
          <div className="flex min-w-0 items-center gap-2"><span className="text-xs font-mono text-muted">{index + 1}</span><Badge>{step.type === "text" ? "Text check" : "Semantic condition"}</Badge></div>
          <div className="flex gap-1"><Button variant="ghost" size="icon" aria-label={`Move ${step.name} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="size-3.5" /></Button><Button variant="ghost" size="icon" aria-label={`Move ${step.name} down`} disabled={index === pipeline.steps.length - 1} onClick={() => move(index, 1)}><ArrowDown className="size-3.5" /></Button><Button variant="ghost" size="icon" aria-label={`Remove ${step.name}`} disabled={pipeline.steps.length === 1} onClick={() => onChange({ ...pipeline, steps: pipeline.steps.filter((_, i) => i !== index) })}><Trash2 className="size-3.5" /></Button></div>
        </div>
        <div className="space-y-4 p-3">
          <div><FieldLabel htmlFor={`${id}-name`}>Check name</FieldLabel><Input id={`${id}-name`} maxLength={100} value={step.name} onChange={(e) => replace(index, { ...step, name: e.target.value })} /></div>
          {step.type === "text" ? <>
            <div><FieldLabel htmlFor={`${id}-match`}>Match type</FieldLabel><Select value={step.match} onValueChange={(value) => replace(index, { ...step, match: value as typeof step.match })}><SelectTrigger id={`${id}-match`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="contains">Contains text</SelectItem><SelectItem value="equals">Equals text</SelectItem><SelectItem value="word_list">Whole-word list</SelectItem><SelectItem value="regex">Regular expression (RE2)</SelectItem></SelectContent></Select></div>
            {step.match === "word_list" ? <div><FieldLabel htmlFor={`${id}-words`}>Words, separated by commas</FieldLabel><Input id={`${id}-words`} value={step.words.join(",")} onChange={(e) => replace(index, { ...step, words: e.target.value.split(",") })} /><p className="mt-1 text-xs text-muted">Whole Unicode words; each entry uses letters, numbers or underscores.</p></div>
              : <div><FieldLabel htmlFor={`${id}-pattern`}>{step.match === "regex" ? "RE2 pattern" : "Text to match"}</FieldLabel><Input id={`${id}-pattern`} maxLength={500} value={step.pattern} onChange={(e) => replace(index, { ...step, pattern: e.target.value })} /></div>}
            <div className="flex items-center justify-between gap-3"><FieldLabel htmlFor={`${id}-case`}>Case sensitive</FieldLabel><Switch id={`${id}-case`} checked={step.caseSensitive} onCheckedChange={(checked) => replace(index, { ...step, caseSensitive: checked })} /></div>
          </> : <>
            <div><FieldLabel htmlFor={`${id}-question`}>Condition to answer Yes or No</FieldLabel><Textarea id={`${id}-question`} maxLength={2000} value={step.question} placeholder="Is this request about our products or account support?" onChange={(e) => replace(index, { ...step, question: e.target.value })} /></div>
            <div><FieldLabel htmlFor={`${id}-context`}>Policy context</FieldLabel><Textarea id={`${id}-context`} maxLength={4000} value={step.context} placeholder="Define your company, supported topics and exclusions." onChange={(e) => replace(index, { ...step, context: e.target.value })} /></div>
            <div className="grid gap-3 sm:grid-cols-2">{(["positiveExamples", "negativeExamples"] as const).map((key) => <div key={key}><FieldLabel htmlFor={`${id}-${key}`}>{key === "positiveExamples" ? "Yes examples" : "No examples"}</FieldLabel><Textarea id={`${id}-${key}`} value={step[key].join("\n")} placeholder="One example per line" onChange={(e) => replace(index, { ...step, [key]: e.target.value.split("\n") })} /></div>)}</div>
            <div className="grid gap-3 sm:grid-cols-2"><div><FieldLabel htmlFor={`${id}-no`}>No at or below</FieldLabel><Input id={`${id}-no`} type="number" min={0} max={1} step={0.05} value={step.noThreshold} onChange={(e) => replace(index, { ...step, noThreshold: Number(e.target.value) })} /></div><div><FieldLabel htmlFor={`${id}-yes`}>Yes at or above</FieldLabel><Input id={`${id}-yes`} type="number" min={0} max={1} step={0.05} value={step.yesThreshold} onChange={(e) => replace(index, { ...step, yesThreshold: Number(e.target.value) })} /></div></div>
            <p className="text-xs leading-5 text-muted">Scores between these thresholds are uncertain. Examples guide the hosted classifier; they do not train a new model.</p>
          </>}
          <div className="grid gap-3 sm:grid-cols-2"><OutcomeSelect id={`${id}-yes-branch`} label="Yes / match" value={step.onMatch} continuing onChange={(value) => replace(index, { ...step, onMatch: value as typeof step.onMatch })} /><OutcomeSelect id={`${id}-no-branch`} label="No / no match" value={step.onNoMatch} continuing onChange={(value) => replace(index, { ...step, onNoMatch: value as typeof step.onNoMatch })} /></div>
        </div>
      </li>;
    })}</ol>
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={pipeline.steps.length >= 16} onClick={() => add("text")}><Plus className="size-3.5" />Add text check</Button><Button variant="outline" size="sm" disabled={pipeline.steps.length >= 16} onClick={() => add("semantic")}><Plus className="size-3.5" />Add semantic condition</Button></div>
    <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-3"><OutcomeSelect id={`${prefix}-end`} label="If all checks continue" value={pipeline.otherwise} onChange={(value) => onChange({ ...pipeline, otherwise: value as PolicyPipeline["otherwise"] })} /><OutcomeSelect id={`${prefix}-unknown`} label="If uncertain" value={pipeline.onUncertain} safeOnly onChange={(value) => onChange({ ...pipeline, onUncertain: value as PolicyPipeline["onUncertain"] })} /><OutcomeSelect id={`${prefix}-error`} label="If a check fails" value={pipeline.onError} safeOnly onChange={(value) => onChange({ ...pipeline, onError: value as PolicyPipeline["onError"] })} /></div>
  </div>;
}
