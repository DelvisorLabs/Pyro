import { useEffect, useState } from "react";
import { Download, LoaderCircle, Play, Plus, Save, Upload } from "lucide-react";
import { semanticCheckCount, type AppRecord, type ClassificationDecision, type PolicyAction, type Profile } from "@pyro/contracts";
import { PageHeader, VerdictBadge } from "@/components/shared";
import { PipelineEditor, OutcomeSelect } from "@/components/PipelineEditor";
import { PolicyTrace } from "@/components/PolicyTrace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useCloud, useCloudModel } from "@/lib/cloud";
import { newPipeline, pipelinePayload } from "@/lib/pipeline-editor";
import { percent } from "@/lib/format";

type Sample = { id: string; input: unknown; expected: PolicyAction; category: string };
const describeError = (error: unknown) => error instanceof Error && "issues" in error ? (error as { issues: Array<{ message: string }> }).issues[0]?.message ?? "Invalid policy." : error instanceof Error ? error.message : "Request failed.";
function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }

export function PlaygroundPage({ onDecision }: { onDecision: () => void }) {
  const cloud = useCloud(), cloudModel = useCloudModel();
  const [profiles, setProfiles] = useState<Profile[]>([]), [apps, setApps] = useState<AppRecord[]>([]);
  const [draft, setDraft] = useState<Profile>(), [isNew, setIsNew] = useState(false), [appId, setAppId] = useState("");
  const [input, setInput] = useState("How do I change my Northstar billing plan?"), [format, setFormat] = useState("text");
  const [decision, setDecision] = useState<ClassificationDecision>(), [testedInput, setTestedInput] = useState<unknown>();
  const [allowPaid, setAllowPaid] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [cases, setCases] = useState<Sample[]>([]), [expected, setExpected] = useState<PolicyAction>("allow");
  const [datasetName, setDatasetName] = useState("Policy regressions"), [retain, setRetain] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string>(), [dirty, setDirty] = useState(false);
  const load = async () => { const [p, a] = await Promise.all([api.get<{ profiles: Profile[] }>("/api/profiles"), api.get<{ apps: AppRecord[] }>("/api/apps")]); setProfiles(p.profiles); setApps(a.apps.filter((item) => item.enabled)); return { p, a }; };
  useEffect(() => { let stopped = false; void load().then(({ p, a }) => { if (!stopped) { setDraft(p.profiles[0]); setAppId(a.apps.find((item) => item.enabled)?.id ?? ""); } }).catch((e) => { if (!stopped) setError(describeError(e)); }).finally(() => { if (!stopped) setLoading(false); }); return () => { stopped = true; }; }, []);
  useEffect(() => { if (!dirty && !cases.length) return; const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty, cases.length]);
  const invalidate = () => { setDecision(undefined); setTestedInput(undefined); setError(""); setMessage(""); };
  const edit = (next: Profile) => { setDraft(next); setDirty(true); invalidate(); };
  const choose = (id: string) => { setIsNew(id === "new"); setDraft(id === "new" ? newPipeline(cloud ? cloudModel : "jev-latest") : structuredClone(profiles.find((p) => p.id === id))); setDirty(false); setCases([]); setRetain(false); setAllowPaid(false); invalidate(); };
  const requestSwitch = (id: string) => dirty || cases.length ? setPendingSwitch(id) : choose(id);
  const work = async (fn: () => Promise<void>) => { setBusy(true); setMessage(""); setError(""); try { await fn(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); } };
  const payload = () => pipelinePayload(draft!);
  const parsedInput = () => format === "json" ? JSON.parse(input) as unknown : input;
  const test = () => work(async () => { setDecision(undefined); setTestedInput(undefined); const value = parsedInput(); const result = await api.post<ClassificationDecision>("/api/playground", { profile: payload(), input: value, appId, allowPaid }); setDecision(result); setTestedInput(value); onDecision(); });
  const publish = () => work(async () => { const body = payload(); const result = isNew ? await api.post<{ profile: Profile }>("/api/profiles", body) : await api.put<{ profile: Profile }>("/api/profiles/" + body.id, body); setDraft(result.profile); setDecision(undefined); setTestedInput(undefined); setIsNew(false); setDirty(false); await load(); setMessage("Published revision " + result.profile.revision + ". Configure application policy bindings in Applications or Policy history."); });
  const semantic = draft ? semanticCheckCount(draft) : 0;
  if (loading) return <p role="status" className="text-sm text-muted">Loading Policy Playground…</p>;
  return <>
    <PageHeader title="Policy Playground" description="Design checks, test a draft, then publish the same policy your application will run." actions={<Button disabled={busy} onClick={() => requestSwitch("new")}><Plus className="size-4" />New pipeline</Button>} />
    {error && <p role="alert" className="mb-4 rounded-control border border-danger bg-danger-surface px-4 py-3 text-sm text-danger">{error}</p>}
    {message && <p role="status" className="mb-4 rounded-control border border-line bg-surface-subtle px-4 py-3 text-sm">{message}</p>}
    {!draft ? <Card><CardContent><p className="text-sm text-muted">Create a pipeline to start designing a policy.</p><Button className="mt-3" onClick={() => choose("new")}>Create pipeline</Button></CardContent></Card> : <fieldset disabled={busy} className="min-w-0 space-y-5">
      <Card><CardContent className="grid gap-4 sm:grid-cols-2"><div><FieldLabel htmlFor="playground-policy">Policy</FieldLabel><Select disabled={busy} value={isNew ? "new" : draft.id} onValueChange={requestSwitch}><SelectTrigger id="playground-policy"><SelectValue /></SelectTrigger><SelectContent>{isNew && <SelectItem value="new">New pipeline (unpublished)</SelectItem>}{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · revision {p.revision ?? 1}</SelectItem>)}</SelectContent></Select></div><div><FieldLabel htmlFor="playground-app">Application rules to include</FieldLabel><Select disabled={busy || cases.length > 0} value={appId} onValueChange={(value) => { setAppId(value); invalidate(); }}><SelectTrigger id="playground-app"><SelectValue placeholder="Choose application" /></SelectTrigger><SelectContent>{apps.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div></CardContent></Card>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card><CardHeader><CardTitle>{draft.pipeline ? "Design the policy" : "Signal-based policy"}</CardTitle><CardDescription>{draft.pipeline ? "Edit this working copy. Tests do not change the active revision." : "This policy uses local rules and risk detectors. Edit those in Policies, or create a new pipeline."}</CardDescription></CardHeader><CardContent className="space-y-5">
          <div><FieldLabel htmlFor="pipeline-name">Policy name</FieldLabel><Input id="pipeline-name" value={draft.name} maxLength={100} onChange={(e) => edit({ ...draft, name: e.target.value })} /></div>
          {draft.pipeline ? <PipelineEditor key={draft.id} pipeline={draft.pipeline} onChange={(pipeline) => edit({ ...draft, pipeline })} /> : <div className="space-y-2 text-sm text-secondary">{draft.localRules.map((r) => <p key={r.id}>{r.name} · {r.enabled ? r.action : "disabled"}</p>)}{draft.detectors.map((d) => <p key={d.id}>{d.name} · {d.enabled ? "semantic detector" : "disabled"}</p>)}</div>}
          <details className="rounded-control border border-line p-3 text-sm"><summary className="cursor-pointer font-medium">Execution settings</summary><div className="mt-4 space-y-4"><div><FieldLabel htmlFor="pipeline-model">Semantic model</FieldLabel><Input id="pipeline-model" disabled={cloud} value={draft.model} onChange={(e) => edit({ ...draft, model: e.target.value })} /></div><div className="grid gap-3 sm:grid-cols-2"><div><FieldLabel htmlFor="pipeline-timeout">Total timeout (ms)</FieldLabel><Input id="pipeline-timeout" type="number" min={250} max={120000} value={draft.timeoutMs} onChange={(e) => edit({ ...draft, timeoutMs: Number(e.target.value) })} /></div><div><FieldLabel htmlFor="pipeline-limit">Input character limit</FieldLabel><Input id="pipeline-limit" type="number" min={128} max={1000000} value={draft.maxInputChars} onChange={(e) => edit({ ...draft, maxInputChars: Number(e.target.value) })} /></div></div></div></details>
          <div className="flex flex-wrap gap-2 border-t border-line pt-4"><Button variant="outline" onClick={() => void work(async () => { const result = await api.post<{ yaml: string }>("/api/playground/export", { profile: payload() }); download(draft.id + ".yaml", result.yaml, "application/yaml"); })}><Download className="size-4" />Export YAML</Button>{!isNew && <Button variant="outline" onClick={() => void work(async () => { const result = await api.post<{ revision: { revision: number } }>("/api/profiles/" + draft.id + "/revisions", { profile: payload(), expectedRevision: draft.revision }); setDirty(false); setMessage("Draft revision " + result.revision.revision + " saved. The active policy is unchanged; manage saved drafts in Policy history."); })}><Save className="size-4" />Save draft</Button>}<Button onClick={() => void publish()}><Upload className="size-4" />{isNew ? "Publish new policy" : "Publish revision"}</Button></div>
          <p className="text-xs leading-5 text-muted">Publishing changes the active policy for applications using its latest revision. Existing pinned revisions remain available. Exported pipelines require a build with pipeline support.</p>
        </CardContent></Card>
        <div className="space-y-5">
          <Card><CardHeader><CardTitle>Try an input</CardTitle><CardDescription>Test this exact draft, including the selected application’s rules. Preview inputs and decisions are not retained.</CardDescription></CardHeader><CardContent className="space-y-4">
            <div><FieldLabel htmlFor="playground-format">Input format</FieldLabel><Select value={format} onValueChange={(value) => { setFormat(value); invalidate(); }}><SelectTrigger id="playground-format"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="text">Plain text</SelectItem><SelectItem value="json">JSON / conversation</SelectItem></SelectContent></Select></div>
            <div><FieldLabel htmlFor="playground-input">Sample input</FieldLabel><Textarea id="playground-input" className="min-h-40" value={input} onChange={(e) => { setInput(e.target.value); invalidate(); }} /></div>
            {semantic > 0 && <div className="flex items-start gap-2.5"><Checkbox id="playground-paid" className="mt-0.5" checked={allowPaid} onCheckedChange={(checked) => setAllowPaid(checked === true)} /><Label htmlFor="playground-paid" className="text-xs font-normal leading-5">Allow this test to send input to the configured semantic provider and incur charges. Up to {semantic} {semantic === 1 ? "check" : "checks"}, plus retries. Mock mode recognizes exact examples only and marks other conditions uncertain.</Label></div>}
            <Button disabled={busy || !input.trim() || !appId || semantic > 0 && !allowPaid} onClick={() => void test()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}Test draft</Button>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Result & executed path</CardTitle></CardHeader><CardContent className="space-y-4" aria-live="polite">
            {!decision ? <p className="py-8 text-sm leading-6 text-muted">Run a test to see each check, its branch and the final outcome.</p> : <><VerdictBadge event={decision} /><p className="text-sm leading-6 text-secondary">{decision.reason}</p>{decision.verdict === "indeterminate" && <p className="text-xs leading-5 text-muted">The result is uncertain or a check failed. It was not treated as a No match.</p>}<PolicyTrace decision={decision} />{!decision.policyTrace && <div className="space-y-2">{decision.detectors.map((d) => <p key={d.id} className="flex justify-between gap-3 text-xs"><span>{d.name}</span><span>{percent(d.probability)}</span></p>)}</div>}<p className="break-all font-mono text-xs text-muted">Tested policy hash: {decision.policyHash}</p><div className="grid items-end gap-3 sm:grid-cols-2"><OutcomeSelect id="case-expected" label="Expected outcome" value={expected} onChange={(v) => setExpected(v as PolicyAction)} /><Button variant="outline" disabled={cases.length >= 100} onClick={() => { setCases((rows) => [...rows, { id: crypto.randomUUID(), input: testedInput, expected, category: "playground" }]); setMessage("Case added. Save or download this regression set before leaving the page."); }}>Add regression case</Button></div></>}
          </CardContent></Card>
          {cases.length > 0 && <Card><CardHeader><CardTitle>Regression set · {cases.length} {cases.length === 1 ? "case" : "cases"}</CardTitle><CardDescription>Compare saved expected outcomes across published revisions in Evaluation lab. These cases stay in memory until saved or downloaded.</CardDescription></CardHeader><CardContent className="space-y-4">
            <div><FieldLabel htmlFor="regression-name">Dataset name</FieldLabel><Input id="regression-name" value={datasetName} maxLength={100} onChange={(e) => setDatasetName(e.target.value)} /></div>
            <div className="flex items-start gap-2.5"><Checkbox id="regression-retain" className="mt-0.5" checked={retain} onCheckedChange={(v) => setRetain(v === true)} /><Label htmlFor="regression-retain" className="text-xs font-normal leading-5">Retain these inputs encrypted for 7 days in this organization. Remove secrets before saving.</Label></div>
            <div className="flex flex-wrap gap-2"><Button disabled={!retain || !datasetName.trim()} onClick={() => void work(async () => { await api.post("/api/datasets", { appId, name: datasetName, jsonl: cases.map((c) => JSON.stringify(c)).join("\n"), retainInputs: true, retentionDays: 7 }); setCases([]); setRetain(false); setMessage("Regression dataset saved. Open Evaluation lab to compare published revisions."); })}>Save dataset version</Button><Button variant="outline" onClick={() => download("policy-regressions.jsonl", cases.map((c) => JSON.stringify(c)).join("\n"), "application/x-ndjson")}>Download JSONL</Button></div>
            <p className="text-xs text-muted">Each save creates a version containing the cases currently in this set.</p>
          </CardContent></Card>}
        </div>
      </div>
    </fieldset>}
    <Dialog open={pendingSwitch !== undefined} onOpenChange={(open) => { if (!open) setPendingSwitch(undefined); }}><DialogContent><DialogHeader><DialogTitle>Switch policy?</DialogTitle><DialogDescription>Your working copy and unsaved regression cases will be discarded.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setPendingSwitch(undefined)}>Keep editing</Button><Button onClick={() => { choose(pendingSwitch!); setPendingSwitch(undefined); }}>Discard and switch</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
