import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useState } from "react";
import { Boxes, Pencil, Plus, Save, Trash2 } from "lucide-react";
import type { AppRecord, LocalRule, Profile } from "@pyro/contracts";
import { EmptyState, PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { SideSelector } from "@/components/ui/side-selector";

type ManagedApp = AppRecord & { activeKeyCount: number };

function cloneApp(record: ManagedApp): ManagedApp {
  return { ...record, allowedProfileIds: [...record.allowedProfileIds], localRules: record.localRules.map((rule) => ({ ...rule })) };
}

export function AppsPage() {
  const [apps, setApps] = useState<ManagedApp[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<ManagedApp>();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [message, setMessage] = useState<string>();
  const [ruleDialog, setRuleDialog] = useState<{ index?: number; rule: LocalRule }>();

  const load = async (preferredId?: string) => {
    const [appResult, profileResult] = await Promise.all([
      api.get<{ apps: ManagedApp[] }>("/api/apps"),
      api.get<{ profiles: Profile[] }>("/api/profiles"),
    ]);
    setApps(appResult.apps);
    setProfiles(profileResult.profiles);
    const id = preferredId ?? selectedId ?? appResult.apps[0]?.id;
    const selected = appResult.apps.find((record) => record.id === id) ?? appResult.apps[0];
    setSelectedId(selected?.id);
    setEditing(selected ? cloneApp(selected) : undefined);
  };

  useEffect(() => { void load(); }, []);

  const select = (record: ManagedApp) => {
    setSelectedId(record.id);
    setEditing(cloneApp(record));
    setMessage(undefined);
  };

  const save = async () => {
    if (!editing) return;
    setMessage(undefined);
    try {
      await api.put(`/api/apps/${editing.id}`, editing);
      await load(editing.id);
      setMessage("Application saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save application.");
    }
  };

  const create = async () => {
    try {
      const result = await api.post<{ app: AppRecord }>("/api/apps", { name: newName, description: newDescription });
      setCreateOpen(false); setNewName(""); setNewDescription("");
      await load(result.app.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create application.");
    }
  };

  const remove = async () => {
    if (!editing || !window.confirm(`Delete ${editing.name}? Its historical usage will be retained.`)) return;
    try { await api.delete(`/api/apps/${editing.id}`); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete application."); }
  };

  const addRule = () => setRuleDialog({
    rule: {
      id: `rule_${Date.now()}`,
      name: "New local rule",
      description: "",
      enabled: true,
      scope: "all_text",
      match: "contains",
      pattern: "",
      caseSensitive: false,
      action: "review",
      risk: 0.8,
    },
  });

  const saveRule = () => {
    if (!ruleDialog || !editing || !ruleDialog.rule.name.trim() || !ruleDialog.rule.pattern.trim()) return;
    const rules = [...editing.localRules];
    if (ruleDialog.index === undefined) rules.push(ruleDialog.rule);
    else rules[ruleDialog.index] = ruleDialog.rule;
    setEditing({ ...editing, localRules: rules });
    setRuleDialog(undefined);
  };

  return (
    <>
      <PageHeader title="Applications" description="Isolate policies, local rules, API keys, traffic limits, and usage by application." actions={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4" />New app</Button>} />
      {!apps.length ? <EmptyState title="No applications">Create an application to define how a workload should be protected.</EmptyState> : <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <SideSelector
          label="Applications"
          value={selectedId}
          onValueChange={(id) => { const record = apps.find((app) => app.id === id); if (record) select(record); }}
          caption={`${apps.length} ${apps.length === 1 ? "application" : "applications"}`}
          items={apps.map((record) => ({
            value: record.id,
            label: record.name,
            icon: <Boxes className="size-4" />,
            meta: `${record.activeKeyCount} active ${record.activeKeyCount === 1 ? "key" : "keys"} · ${record.enabled ? "Enabled" : "Disabled"}`,
            description: record.description,
          }))}
        />
        {editing && <div className="space-y-4">
          <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Application settings</CardTitle><CardDescription>Defaults apply to every API key assigned to this application.</CardDescription></div><div className="flex items-center gap-2"><Badge>{editing.id}</Badge><Switch checked={editing.enabled} onCheckedChange={(enabled) => setEditing({ ...editing, enabled })} /></div></div></CardHeader><CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label>Name</Label><Input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></div><div className="space-y-2"><Label>Requests per minute</Label><Input type="number" min="1" value={editing.rateLimitPerMinute ?? ""} onChange={(event) => setEditing({ ...editing, rateLimitPerMinute: event.target.value ? Number(event.target.value) : undefined })} placeholder="Unlimited" /></div></div>
            <div className="space-y-2"><Label>Description</Label><Textarea className="min-h-20" value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></div>
            <div className="space-y-2"><Label>Default policy</Label><Select value={editing.defaultProfileId} onValueChange={(defaultProfileId) => setEditing({ ...editing, defaultProfileId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Allowed policies</Label><p className="mt-1 text-xs text-muted">No selection means every policy. Selecting policies constrains both the app and its API keys.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{profiles.map((profile) => { const checked = editing.allowedProfileIds.includes(profile.id); return <label key={profile.id} className="flex items-center gap-2 border border-line px-3 py-2 text-sm"><Checkbox checked={checked} onCheckedChange={(checked) => setEditing({ ...editing, allowedProfileIds: checked === true ? [...editing.allowedProfileIds, profile.id] : editing.allowedProfileIds.filter((id) => id !== profile.id) })} />{profile.name}</label>; })}</div></div>
          </CardContent></Card>

          <Card><CardHeader className="px-4 py-3"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><CardTitle className="text-sm">Local rules</CardTitle><CardDescription className="max-w-2xl text-xs leading-5">Fast checks for known patterns. A match can send a request to review or block it immediately.</CardDescription></div><Button size="sm" variant="outline" onClick={addRule}><Plus className="size-3.5" />Add rule</Button></div></CardHeader><CardContent className="p-0">{editing.localRules.length === 0 ? <p className="px-4 py-8 text-center text-xs text-muted">No local rules. Requests continue to semantic classification.</p> : <div className="divide-y divide-line">{editing.localRules.map((rule, index) => <div key={`${rule.id}-${index}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-subtle"><Switch checked={rule.enabled} onCheckedChange={(enabled) => setEditing({ ...editing, localRules: editing.localRules.map((item, itemIndex) => itemIndex === index ? { ...item, enabled } : item) })} aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="truncate text-sm font-medium">{rule.name}</strong><Badge className="shrink-0">{rule.action}</Badge></div><p className="mt-0.5 truncate text-xs text-muted"><code>{rule.pattern}</code> · {rule.scope === "all_text" ? "all text" : rule.scope === "raw_json" ? "raw JSON" : "tool names"} · risk {rule.risk.toFixed(2)}</p></div><Button variant="ghost" size="icon" className="size-8" onClick={() => setRuleDialog({ index, rule: { ...rule } })} aria-label={`Edit ${rule.name}`}><Pencil className="size-3.5" /></Button><Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing({ ...editing, localRules: editing.localRules.filter((_, itemIndex) => itemIndex !== index) })} aria-label={`Delete ${rule.name}`}><Trash2 className="size-3.5" /></Button></div>)}</div>}</CardContent></Card>
          {message && <div className="border border-line-strong bg-surface-subtle px-4 py-3 text-sm text-foreground">{message}</div>}
          <div className="flex justify-between"><Button variant="danger" disabled={editing.id === "default"} onClick={() => void remove()}><Trash2 className="size-4" />Delete app</Button><Button onClick={() => void save()}><Save className="size-4" />Save application</Button></div>
        </div>}
      </div>}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Create application</DialogTitle><DialogDescription>A starter set of local rules and the default protection policy will be applied.</DialogDescription></DialogHeader><div className="space-y-4 px-6 py-5"><div className="space-y-2"><Label>Name</Label><Input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Customer support agent" /></div><div className="space-y-2"><Label>Description</Label><Input value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="Production support workload" /></div></div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={!newName.trim()} onClick={() => void create()}>Create app</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(ruleDialog)} onOpenChange={(open) => !open && setRuleDialog(undefined)}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{ruleDialog?.index === undefined ? "Add local rule" : "Edit local rule"}</DialogTitle><DialogDescription>Match a known pattern before the request reaches semantic classification.</DialogDescription></DialogHeader>{ruleDialog && <div className="space-y-4 px-6 py-5"><div><FieldLabel help="Used in activity records when this rule matches.">Name</FieldLabel><Input autoFocus value={ruleDialog.rule.name} onChange={(event) => setRuleDialog({ ...ruleDialog, rule: { ...ruleDialog.rule, name: event.target.value } })} /></div><div><div className="flex items-start justify-between gap-3"><FieldLabel help="Literal text or an RE2 regular expression, depending on Match.">Pattern</FieldLabel><label className="flex items-center gap-2 text-xs text-muted"><Switch checked={ruleDialog.rule.caseSensitive} onCheckedChange={(caseSensitive) => setRuleDialog({ ...ruleDialog, rule: { ...ruleDialog.rule, caseSensitive } })} />Case sensitive</label></div><Input className="font-mono text-xs" value={ruleDialog.rule.pattern} onChange={(event) => setRuleDialog({ ...ruleDialog, rule: { ...ruleDialog.rule, pattern: event.target.value } })} placeholder="Text to match" /></div><div className="grid gap-4 sm:grid-cols-2"><div><FieldLabel help="The request section this rule searches.">Inspect</FieldLabel><Select value={ruleDialog.rule.scope} onValueChange={(scope: LocalRule["scope"]) => setRuleDialog({ ...ruleDialog, rule: { ...ruleDialog.rule, scope } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all_text">All text fields</SelectItem><SelectItem value="raw_json">Raw JSON payload</SelectItem><SelectItem value="tool_name">Tool names only</SelectItem></SelectContent></Select></div><div><FieldLabel help="Find within text, or require an exact match.">Match</FieldLabel><Select value={ruleDialog.rule.match} onValueChange={(match: LocalRule["match"]) => setRuleDialog({ ...ruleDialog, rule: { ...ruleDialog.rule, match } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="contains">Contains text</SelectItem><SelectItem value="equals">Exact match</SelectItem><SelectItem value="regex">Regex (RE2)</SelectItem></SelectContent></Select></div><div><FieldLabel help="Review flags the request; Block rejects it.">Decision</FieldLabel><Select value={ruleDialog.rule.action} onValueChange={(action: LocalRule["action"]) => setRuleDialog({ ...ruleDialog, rule: { ...ruleDialog.rule, action } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="review">Send to review</SelectItem><SelectItem value="block">Block request</SelectItem></SelectContent></Select></div><div><FieldLabel help="Risk score recorded for a match.">Risk</FieldLabel><Input type="number" min="0" max="1" step="0.01" value={ruleDialog.rule.risk} onChange={(event) => setRuleDialog({ ...ruleDialog, rule: { ...ruleDialog.rule, risk: Number(event.target.value) } })} /></div></div><div><FieldLabel help="Optional context for administrators.">Internal note</FieldLabel><Input value={ruleDialog.rule.description} onChange={(event) => setRuleDialog({ ...ruleDialog, rule: { ...ruleDialog.rule, description: event.target.value } })} placeholder="Optional context for administrators" /></div></div>}<DialogFooter><Button variant="outline" onClick={() => setRuleDialog(undefined)}>Cancel</Button><Button disabled={!ruleDialog?.rule.name.trim() || !ruleDialog?.rule.pattern.trim()} onClick={saveRule}>Save rule</Button></DialogFooter></DialogContent></Dialog>
    </>
  );
}
