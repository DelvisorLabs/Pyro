import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, Plus, Settings2, Trash2 } from "lucide-react";
import { LocalRulesSchema, type Profile } from "@pyro/contracts";
import { ProfileLibrary } from "@/components/ProfileLibrary";
import { ViewTabs } from "@/components/ui/view-tabs";
import { readPresets, type ProfilePreset } from "@/lib/profile-library";
import { LocalRulesEditor } from "@/components/LocalRulesEditor";
import { CometDial } from "@/components/react-bits/CometDial";
import { GlideSelect } from "@/components/react-bits/GlideSelect";
import { PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { FieldLabel, FieldError } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { percent } from "@/lib/format";
import { readProfiles } from "@/lib/responses";
import { editProfile, editorDetector, profilePayload, type EditorProfile } from "@/lib/profile-editor";

function cloneProfile(profile: Profile): EditorProfile {
  return editProfile(profile);
}

function createProfileDraft(): EditorProfile {
  const now = new Date().toISOString();
  return {
    id: "pending",
    name: "",
    description: "",
    model: "",
    reviewThreshold: 0.55,
    blockThreshold: 0.82,
    decisionStrategy: "maximum",
    minimumReviewSignals: 1,
    minimumBlockSignals: 1,
    failMode: "closed",
    maxInputChars: 100_000,
    timeoutMs: 8_000,
    persistInputs: false,
    notifyOn: [],
    shadowProfileIds: [],
    detectors: [],
    localRules: [],
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function nextProfileId(name: string, profiles: Profile[]): string {
  const base = normalizeName(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56) || "policy";
  let id = base;
  for (let suffix = 2; profiles.some((profile) => profile.id === id); suffix += 1) id = `${base}-${suffix}`;
  return id;
}

const invalidControl = "border-danger focus:border-danger focus:ring-danger";

function validateProfile(profile: Profile | undefined, profiles: Profile[], serverError?: string): Record<string, string> {
  if (!profile) return {};
  const errors: Record<string, string> = {};
  const required = (key: string, value: string, maximum: number) => {
    if (!value.trim()) errors[key] = "Required.";
    else if (value.length > maximum) errors[key] = `Must be ${maximum} characters or fewer.`;
  };
  const integerRange = (key: string, value: number, minimum: number, maximum: number) => {
    if (!Number.isInteger(value) || value < minimum || value > maximum) errors[key] = `Enter a whole number from ${minimum} to ${maximum}.`;
  };
  const numberRange = (key: string, value: number | undefined, minimum: number, maximum: number, optional = false) => {
    if (optional && value === undefined) return;
    if (value === undefined || !Number.isFinite(value) || value < minimum || value > maximum) errors[key] = `Enter a value from ${minimum} to ${maximum}.`;
  };

  required("name", profile.name, 100);
  if (profiles.some((item) => item.id !== profile.id && normalizeName(item.name) === normalizeName(profile.name))) errors.name = "A policy with this name already exists.";
  if (serverError?.toLocaleLowerCase().includes("name")) errors.name = serverError;
  if (profile.description.length > 500) errors.description = "Must be 500 characters or fewer.";
  required("model", profile.model, 200);
  numberRange("reviewThreshold", profile.reviewThreshold, 0, 1);
  numberRange("blockThreshold", profile.blockThreshold, 0, 1);
  if (profile.reviewThreshold > profile.blockThreshold) errors.reviewThreshold = "Cannot exceed the block threshold.";
  integerRange("maxInputChars", profile.maxInputChars, 128, 1_000_000);
  integerRange("timeoutMs", profile.timeoutMs, 250, 120_000);
  if (profile.detectors.length === 0 && profile.localRules.length === 0) errors.detectors = "Add at least one detector or local rule.";
  const rules = LocalRulesSchema.safeParse(profile.localRules);
  if (!rules.success) errors.localRules = rules.error.issues[0]?.message ?? "Invalid local rules.";
  if (profile.decisionStrategy === "signal_count" && profile.detectors.length > 0) {
    integerRange("minimumReviewSignals", profile.minimumReviewSignals, 1, profile.detectors.length);
    integerRange("minimumBlockSignals", profile.minimumBlockSignals, 1, profile.detectors.length);
  }

  const detectorIds = new Set<string>();
  profile.detectors.forEach((detector, index) => {
    const prefix = `detectors.${index}`;
    required(`${prefix}.name`, detector.name, 100);
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(detector.id)) errors[`${prefix}.id`] = "Use 2–64 lowercase letters, numbers, underscores, or hyphens.";
    else if (detectorIds.has(detector.id)) errors[`${prefix}.id`] = "Detector IDs must be unique.";
    detectorIds.add(detector.id);
    if (detector.description.length > 500) errors[`${prefix}.description`] = "Must be 500 characters or fewer.";
    if (detector.question.trim().length < 8) errors[`${prefix}.question`] = "Enter at least 8 characters.";
    else if (detector.question.length > 2_000) errors[`${prefix}.question`] = "Must be 2,000 characters or fewer.";
    numberRange(`${prefix}.weight`, detector.weight, 0.1, 2);
    numberRange(`${prefix}.reviewThreshold`, detector.reviewThreshold, 0, 1, true);
    numberRange(`${prefix}.blockThreshold`, detector.blockThreshold, 0, 1, true);
    if (detector.reviewThreshold !== undefined && detector.blockThreshold !== undefined && detector.reviewThreshold > detector.blockThreshold) errors[`${prefix}.reviewThreshold`] = "Cannot exceed the block override.";
  });
  return errors;
}

export function ProfilesPage() {
  const [view, setView] = useState<"profiles" | "library">("profiles");
  const [presets, setPresets] = useState<ProfilePreset[]>([]);
  const [presetLoading, setPresetLoading] = useState(true);
  const [presetError, setPresetError] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [yaml, setYaml] = useState("");
  const [importError, setImportError] = useState<string>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<EditorProfile>();
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [expandedDetector, setExpandedDetector] = useState<number | null>(null);

  const load = () => api.get<{ profiles: Profile[] }>("/api/profiles").then((data) => setProfiles(readProfiles(data.profiles)));
  const loadPresets = () => {
    setPresetLoading(true); setPresetError(undefined);
    void api.get<{ presets: unknown }>("/api/profile-presets").then((data) => setPresets(readPresets(data.presets))).catch((reason) => setPresetError(reason.message)).finally(() => setPresetLoading(false));
  };
  useEffect(() => { void load().catch((e) => setError(e.message)); loadPresets(); }, []);
  const validation = useMemo(() => validateProfile(editing, profiles, error), [editing, profiles, error]);
  const formIsValid = Object.keys(validation).length === 0;

  const beginEditing = (profile: Profile) => {
    setEditing(cloneProfile(profile));
    setIsNew(false);
    setError(undefined);
    setExpandedDetector(null);
  };

  const createProfile = () => {
    setEditing(createProfileDraft());
    setIsNew(true);
    setError(undefined);
    setExpandedDetector(null);
  };

  const save = async () => {
    if (!editing) return;
    if (!formIsValid) return;
    setSaving(true);
    setError(undefined);
    try {
      if (isNew) await api.post("/api/profiles", profilePayload(editing));
      else await api.put(`/api/profiles/${editing.id}`, profilePayload(editing));
      await load();
      setEditing(undefined);
      setView("profiles");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(`Delete profile “${id}”?`)) return;
    await api.delete(`/api/profiles/${id}`);
    await load();
  };

  const updateDetector = (index: number, changes: Partial<Profile["detectors"][number]>) => {
    if (!editing) return;
    const detectors = [...editing.detectors];
    detectors[index] = { ...detectors[index]!, ...changes };
    setEditing({ ...editing, detectors });
  };

  return (
    <>
      <PageHeader title="Protection profiles" description="Tune thresholds, failure behavior, limits, and the semantic detectors evaluated in parallel." actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setImporting(true); setImportError(undefined); }}>Import YAML</Button><Button onClick={createProfile}><Plus className="size-4" />New profile</Button></div>} />
      {error && !editing && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
      <ViewTabs label="Profile views" value={view} onChange={setView} options={[{ value: "profiles", label: "Your profiles", count: profiles.length }, { value: "library", label: "Profile library", count: presets.length }]} />
      {view === "library" ? <ProfileLibrary presets={presets} loading={presetLoading} error={presetError} onRetry={loadPresets} onCustomize={(profile) => {
        let name = profile.name;
        for (let suffix = 1; profiles.some((item) => normalizeName(item.name) === normalizeName(name)); suffix += 1) name = `${profile.name} copy${suffix === 1 ? "" : ` ${suffix}`}`;
        setEditing({ ...cloneProfile(profile), id: nextProfileId(name, profiles), name });
        setIsNew(true); setError(undefined); setExpandedDetector(null);
      }} /> : <div className="grid gap-3 lg:grid-cols-2">
        {profiles.map((profile) => <Card key={profile.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div><div className="flex items-center gap-2"><CardTitle>{profile.name}</CardTitle>{profile.id === "default" && <span className="border-l border-line-strong pl-2 text-xs font-medium text-muted">Default</span>}</div><CardDescription>{profile.description || "No description"}</CardDescription></div>
            <div className="flex gap-1"><a className="inline-flex size-9 items-center justify-center" href={`/control/api/profiles/${profile.id}/export`} aria-label={`Export ${profile.name}`}><Download className="size-4" /></a><Button variant="ghost" size="icon" aria-label={`Edit ${profile.name}`} onClick={() => beginEditing(profile)}><Settings2 className="size-4" /></Button>{profile.id !== "default" && <Button variant="ghost" size="icon" aria-label={`Delete ${profile.name}`} onClick={() => void remove(profile.id)}><Trash2 className="size-4" /></Button>}</div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 border-b border-line pb-4"><div><span className="field-caption text-muted">Review</span><strong className="mt-1 block text-lg">{percent(profile.reviewThreshold, 0)}</strong></div><div><span className="field-caption text-muted">Block</span><strong className="mt-1 block text-lg">{percent(profile.blockThreshold, 0)}</strong></div><div><span className="field-caption text-muted">Detectors</span><strong className="mt-1 block text-lg">{profile.detectors.filter((item) => item.enabled).length}</strong></div></div>
            <div className="mt-4 flex flex-wrap gap-1.5">{profile.localRules.map((rule) => <Badge key={`rule:${rule.id}`}>{rule.name} · {rule.match}</Badge>)}{profile.detectors.filter((item) => item.enabled).map((item) => <Badge key={item.id} className="normal-case tracking-normal">{item.name}</Badge>)}</div>
          </CardContent>
        </Card>)}
      </div>}

      <Dialog open={importing} onOpenChange={setImporting}><DialogContent className="flex flex-col overflow-hidden"><DialogHeader><DialogTitle>Import a profile</DialogTitle><DialogDescription>Choose or paste a pyro/v1 YAML file. You can review and edit the profile before saving.</DialogDescription></DialogHeader><div className="min-h-0 space-y-3 overflow-y-auto px-6 py-4"><Input type="file" accept=".yaml,.yml" aria-label="Profile YAML file" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 256_000) { setImportError("Profile YAML must be at most 256 KB."); return; } void file.text().then(setYaml).catch(() => setImportError("Could not read file.")); }} /><Textarea aria-label="Profile YAML" className="min-h-64 font-mono text-xs" value={yaml} onChange={(event) => setYaml(event.target.value)} />{importError && <p role="alert" className="text-sm text-danger">{importError}</p>}</div><DialogFooter><Button variant="outline" onClick={() => setImporting(false)}>Cancel</Button><Button disabled={!yaml.trim() || saving} onClick={async () => { setSaving(true); try { const data = await api.post<{ profile: Profile }>("/api/profiles/preview", { yaml }); setEditing({ ...cloneProfile(data.profile), id: nextProfileId(data.profile.name, profiles) }); setIsNew(true); setError(undefined); setImporting(false); } catch (e) { setImportError(e instanceof Error ? e.message : "Invalid YAML."); } finally { setSaving(false); } }}>Review profile</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent className="flex max-h-[90vh] w-[min(900px,calc(100vw-32px))] flex-col overflow-hidden">
          <DialogHeader className="shrink-0 pr-12">
            <DialogTitle>{isNew ? "Create protection policy" : "Edit protection policy"}</DialogTitle>
            <DialogDescription>{isNew ? "Review the settings, detectors and local rules before creating your profile." : "Saved changes apply immediately."}</DialogDescription>
          </DialogHeader>

          {editing && <div className="scrollbar-thin min-h-0 flex-1 space-y-6 overflow-y-scroll px-6 py-5">
            <div className="space-y-2">
              <FieldLabel htmlFor="profile-name" required invalid={Boolean(validation.name)}>Name</FieldLabel>
              <Input
                id="profile-name"
                autoFocus={isNew}
                value={editing.name}
                aria-invalid={Boolean(validation.name)}
                aria-describedby={validation.name ? "profile-name-error" : undefined}
                className={validation.name ? invalidControl : undefined}
                onChange={(event) => {
                  const name = event.target.value;
                  setEditing({ ...editing, name, id: isNew ? nextProfileId(name, profiles) : editing.id });
                  setError(undefined);
                }}
              />
              <FieldError id="profile-name-error" message={validation.name} />
            </div>
            <div className="space-y-2"><FieldLabel htmlFor="profile-description" invalid={Boolean(validation.description)}>Description</FieldLabel><Input id="profile-description" value={editing.description} aria-invalid={Boolean(validation.description)} className={validation.description ? invalidControl : undefined} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /><FieldError message={validation.description} /></div>
            <div className="space-y-2"><FieldLabel htmlFor="profile-model" required invalid={Boolean(validation.model)}>Model</FieldLabel><Input id="profile-model" value={editing.model} aria-invalid={Boolean(validation.model)} className={validation.model ? invalidControl : undefined} onChange={(event) => setEditing({ ...editing, model: event.target.value })} /><FieldError message={validation.model} /></div>

            <div className="grid gap-4 border-y border-line bg-surface-subtle/60 py-4 sm:grid-cols-[150px_150px_1fr]">
              <div className="flex flex-col items-center"><FieldLabel required invalid={Boolean(validation.reviewThreshold)} className="mb-1">Review threshold</FieldLabel><CometDial className={validation.reviewThreshold ? "ring-1 ring-danger" : ""} value={Math.round(editing.reviewThreshold * 100)} size={132} label="Review threshold" onChange={(value) => setEditing({ ...editing, reviewThreshold: value / 100 })} /><FieldError message={validation.reviewThreshold} /></div>
              <div className="flex flex-col items-center"><FieldLabel required invalid={Boolean(validation.blockThreshold)} className="mb-1">Block threshold</FieldLabel><CometDial className={validation.blockThreshold ? "ring-1 ring-danger" : ""} value={Math.round(editing.blockThreshold * 100)} size={132} label="Block threshold" onChange={(value) => setEditing({ ...editing, blockThreshold: value / 100 })} /><FieldError message={validation.blockThreshold} /></div>
              <div className="space-y-2 self-center px-4 sm:px-0"><FieldLabel required>Fail mode</FieldLabel><GlideSelect className="w-full" value={editing.failMode} onChange={(value) => setEditing({ ...editing, failMode: value as "open" | "closed" })} options={[{ value: "closed", label: "Closed — block", tag: "Safer" }, { value: "open", label: "Open — allow", tag: "Available" }]} ariaLabel="Fail mode" menuWidth={220} /></div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><FieldLabel required>Decision strategy</FieldLabel><GlideSelect className="w-full" value={editing.decisionStrategy} onChange={(value) => setEditing({ ...editing, decisionStrategy: value as Profile["decisionStrategy"] })} options={[{ value: "maximum", label: "Maximum signal" }, { value: "weighted_average", label: "Weighted average" }, { value: "signal_count", label: "Signal count" }]} ariaLabel="Decision strategy" menuWidth={230} /></div><div className="space-y-2"><Label>Shadow policy</Label><GlideSelect className="w-full" value={editing.shadowProfileIds[0] ?? "none"} onChange={(value) => setEditing({ ...editing, shadowProfileIds: value === "none" ? [] : [value] })} options={[{ value: "none", label: "None" }, ...profiles.filter((item) => item.id !== editing.id).map((item) => ({ value: item.id, label: item.name }))]} ariaLabel="Shadow policy" menuWidth={230} /></div></div>
            {editing.decisionStrategy === "signal_count" && <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><FieldLabel required invalid={Boolean(validation.minimumReviewSignals)}>Signals required for review</FieldLabel><Input type="number" min="1" max={editing.detectors.length} aria-invalid={Boolean(validation.minimumReviewSignals)} className={validation.minimumReviewSignals ? invalidControl : undefined} value={editing.minimumReviewSignals} onChange={(event) => setEditing({ ...editing, minimumReviewSignals: Number(event.target.value) })} /><FieldError message={validation.minimumReviewSignals} /></div><div className="space-y-2"><FieldLabel required invalid={Boolean(validation.minimumBlockSignals)}>Signals required to block</FieldLabel><Input type="number" min="1" max={editing.detectors.length} aria-invalid={Boolean(validation.minimumBlockSignals)} className={validation.minimumBlockSignals ? invalidControl : undefined} value={editing.minimumBlockSignals} onChange={(event) => setEditing({ ...editing, minimumBlockSignals: Number(event.target.value) })} /><FieldError message={validation.minimumBlockSignals} /></div></div>}
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><FieldLabel required invalid={Boolean(validation.maxInputChars)}>Maximum input characters</FieldLabel><Input type="number" min="128" max="1000000" aria-invalid={Boolean(validation.maxInputChars)} className={validation.maxInputChars ? invalidControl : undefined} value={editing.maxInputChars} onChange={(event) => setEditing({ ...editing, maxInputChars: Number(event.target.value) })} /><FieldError message={validation.maxInputChars} /></div><div className="space-y-2"><FieldLabel required invalid={Boolean(validation.timeoutMs)}>Timeout (milliseconds)</FieldLabel><Input type="number" min="250" max="120000" aria-invalid={Boolean(validation.timeoutMs)} className={validation.timeoutMs ? invalidControl : undefined} value={editing.timeoutMs} onChange={(event) => setEditing({ ...editing, timeoutMs: Number(event.target.value) })} /><FieldError message={validation.timeoutMs} /></div></div>

            <div className="flex items-center justify-between gap-4 border border-line bg-surface-subtle p-3"><div><div className="flex items-center gap-1.5"><Label>Persist input previews</Label><HelpTooltip>Stores up to 1,000 input characters. Leave off for sensitive traffic.</HelpTooltip></div><p className="mt-0.5 text-xs text-muted">Event metadata and hashes are retained either way.</p></div><Switch checked={editing.persistInputs} onCheckedChange={(checked) => setEditing({ ...editing, persistInputs: checked })} /></div>
            <div className="border border-line bg-surface-subtle p-3"><Label>Live notifications</Label><p className="mt-0.5 text-xs text-muted">Choose which actions should be surfaced to connected dashboard users.</p><div className="mt-3 flex gap-5">{(["review", "block"] as const).map((action) => <label className="flex items-center gap-2 text-sm capitalize" key={action}><Switch checked={editing.notifyOn.includes(action)} onCheckedChange={(checked) => setEditing({ ...editing, notifyOn: checked ? [...new Set([...editing.notifyOn, action])] : editing.notifyOn.filter((item) => item !== action) })} />{action}</label>)}</div></div>

            <LocalRulesEditor rules={editing.localRules} onChange={(localRules) => setEditing({ ...editing, localRules })} />
            <FieldError message={validation.localRules} />
            {!editing.detectors.some((detector) => detector.enabled) && <p className="border bg-surface-subtle p-3 text-sm">No semantic detectors are enabled. Requests that match no local rule will be allowed without a model call.</p>}
            <div>
              <div className="mb-3 flex items-end justify-between gap-3"><div><div className="flex items-center gap-1.5"><Label>Detectors</Label><HelpTooltip>Each detector returns one risk signal for the policy.</HelpTooltip></div><p className="mt-1 text-xs text-muted">Add only the signals this profile should evaluate.</p></div><Button type="button" variant="outline" size="sm" onClick={() => { const index = editing.detectors.length; setEditing({ ...editing, detectors: [...editing.detectors, editorDetector({ id: `custom_${Date.now().toString(36)}`, name: "", description: "", question: "", enabled: true, weight: 1 })] }); setExpandedDetector(index); }}><Plus className="size-3.5" />Add detector</Button></div>
              <div className="space-y-2">
                {editing.detectors.length === 0 && <div className="border border-dashed border-line-strong bg-surface px-5 py-7 text-center"><p className="text-sm font-medium text-secondary">No detectors added</p><p className="mt-1 text-xs text-muted">Add a detector and define the signal this profile should evaluate.</p></div>}
                {editing.detectors.map((detector, index) => {
                  const expanded = expandedDetector === index;
                  const prefix = `detectors.${index}`;
                  const detectorInvalid = Object.keys(validation).some((key) => key.startsWith(`${prefix}.`));
                  return <div className={`border bg-surface ${detectorInvalid ? "border-danger" : "border-line"}`} key={detector.editorKey}>
                    <div className="flex min-h-14 items-center gap-2 px-3">
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left" aria-expanded={expanded} onClick={() => setExpandedDetector(expanded ? null : index)}><ChevronDown className={`size-4 shrink-0 text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} /><span className="min-w-0"><strong className="block truncate text-sm font-medium">{detector.name || "Untitled detector"}</strong><span className="mt-0.5 block truncate text-xs text-muted">{detector.description || detector.id}</span></span></button>
                      <Switch aria-label={`${detector.enabled ? "Disable" : "Enable"} ${detector.name}`} checked={detector.enabled} onCheckedChange={(enabled) => updateDetector(index, { enabled })} />
                      <Button type="button" variant="ghost" size="icon" onClick={() => { setEditing({ ...editing, detectors: editing.detectors.filter((_, itemIndex) => itemIndex !== index) }); setExpandedDetector(null); }} aria-label={`Remove ${detector.name || "detector"}`}><Trash2 className="size-4" /></Button>
                    </div>
                    {expanded && <div className="grid gap-4 border-t border-line bg-surface-subtle/50 p-4">
                      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><FieldLabel help="Shown in decisions and activity." required invalid={Boolean(validation[`${prefix}.name`])} className="text-xs">Name</FieldLabel><Input aria-label="Detector name" className={`h-8 ${validation[`${prefix}.name`] ? invalidControl : ""}`} aria-invalid={Boolean(validation[`${prefix}.name`])} value={detector.name} onChange={(event) => updateDetector(index, { name: event.target.value })} /><FieldError message={validation[`${prefix}.name`]} /></div><div className="space-y-1.5"><FieldLabel help="Stable identifier used in API results." required invalid={Boolean(validation[`${prefix}.id`])} className="text-xs">ID</FieldLabel><Input aria-label="Detector ID" className={`h-8 text-xs ${validation[`${prefix}.id`] ? invalidControl : ""}`} aria-invalid={Boolean(validation[`${prefix}.id`])} value={detector.id} onChange={(event) => updateDetector(index, { id: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_") })} /><FieldError message={validation[`${prefix}.id`]} /></div></div>
                      <div className="space-y-1.5"><FieldLabel help="Short explanation shown to operators." invalid={Boolean(validation[`${prefix}.description`])} className="text-xs">Description</FieldLabel><Input className={`h-8 ${validation[`${prefix}.description`] ? invalidControl : ""}`} aria-invalid={Boolean(validation[`${prefix}.description`])} value={detector.description} onChange={(event) => updateDetector(index, { description: event.target.value })} /><FieldError message={validation[`${prefix}.description`]} /></div>
                      <div className="space-y-2"><FieldLabel help="Question sent to the decision model." required invalid={Boolean(validation[`${prefix}.question`])} className="text-xs">Question</FieldLabel><Textarea className={`min-h-20 font-sans text-xs leading-5 ${validation[`${prefix}.question`] ? invalidControl : ""}`} aria-invalid={Boolean(validation[`${prefix}.question`])} value={detector.question} onChange={(event) => updateDetector(index, { question: event.target.value })} /><FieldError message={validation[`${prefix}.question`]} /></div>
                      <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-2"><FieldLabel help="Scales this signal in weighted policies." required invalid={Boolean(validation[`${prefix}.weight`])} className="text-xs">Risk weight</FieldLabel><Input type="number" min="0.1" max="2" step="0.1" className={validation[`${prefix}.weight`] ? invalidControl : undefined} aria-invalid={Boolean(validation[`${prefix}.weight`])} value={detector.weight} onChange={(event) => updateDetector(index, { weight: Number(event.target.value) })} /><FieldError message={validation[`${prefix}.weight`]} /></div><div className="space-y-2"><FieldLabel help="Optional review threshold for this detector." invalid={Boolean(validation[`${prefix}.reviewThreshold`])} className="text-xs">Review override</FieldLabel><Input type="number" min="0" max="1" step="0.01" className={validation[`${prefix}.reviewThreshold`] ? invalidControl : undefined} aria-invalid={Boolean(validation[`${prefix}.reviewThreshold`])} placeholder={String(editing.reviewThreshold)} value={detector.reviewThreshold ?? ""} onChange={(event) => updateDetector(index, { reviewThreshold: event.target.value === "" ? undefined : Number(event.target.value) })} /><FieldError message={validation[`${prefix}.reviewThreshold`]} /></div><div className="space-y-2"><FieldLabel help="Optional block threshold for this detector." invalid={Boolean(validation[`${prefix}.blockThreshold`])} className="text-xs">Block override</FieldLabel><Input type="number" min="0" max="1" step="0.01" className={validation[`${prefix}.blockThreshold`] ? invalidControl : undefined} aria-invalid={Boolean(validation[`${prefix}.blockThreshold`])} placeholder={String(editing.blockThreshold)} value={detector.blockThreshold ?? ""} onChange={(event) => updateDetector(index, { blockThreshold: event.target.value === "" ? undefined : Number(event.target.value) })} /><FieldError message={validation[`${prefix}.blockThreshold`]} /></div></div>
                    </div>}
                  </div>;
                })}
                <FieldError message={validation.detectors} />
              </div>
            </div>
            {error && !validation.name && <div className="border border-line-strong bg-surface-subtle px-3 py-2 text-sm text-foreground">{error}</div>}
          </div>}

          <DialogFooter className="shrink-0 bg-surface"><Button variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button><Button onClick={() => void save()} disabled={saving || !formIsValid}>{saving ? "Saving" : isNew ? "Create policy" : "Save policy"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
