import { useState } from "react";
import { ArrowRight, Code2, Download, Search, ShieldCheck } from "lucide-react";
import type { Profile } from "@pyro/contracts";
import { GlideSelect } from "./react-bits/GlideSelect";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { ViewTabs } from "./ui/view-tabs";
import { EmptyState } from "./shared";
import { filterPresets, type PresetFilter, type ProfilePreset } from "@/lib/profile-library";
import { percent } from "@/lib/format";
import { SideSelector } from "./ui/side-selector";

function downloadYaml(preset: ProfilePreset) {
  const url = URL.createObjectURL(new Blob([preset.yaml], { type: "application/yaml" }));
  const link = document.createElement("a");
  link.href = url; link.download = `${preset.profile.id}.yaml`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ProfileLibrary({ presets, loading, error, onRetry, onCustomize }: { presets: ProfilePreset[]; loading: boolean; error?: string; onRetry: () => void; onCustomize: (profile: Profile) => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PresetFilter>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [preview, setPreview] = useState<"policy" | "yaml">("policy");
  const filtered = filterPresets(presets, search, filter);
  const selected = filtered.find(({ profile }) => profile.id === selectedId) ?? filtered[0];
  const profile = selected?.profile;
  const enabledDetectors = profile?.detectors.filter((detector) => detector.enabled) ?? [];
  const enabledRules = profile?.localRules.filter((rule) => rule.enabled) ?? [];

  return <section aria-label="Profile library">
    <div className="mb-5"><h2 className="text-base font-semibold">Curated profiles</h2><p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted">Browse curated profiles, inspect their rules, and customize a copy for your workload.</p></div>
    <div className="mb-5 flex flex-col gap-3 sm:flex-row"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" /><Input aria-label="Search profile library" className="pl-9" placeholder="Search names, rules, or detectors…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><GlideSelect className="sm:w-52" ariaLabel="Profile type" value={filter} onChange={(value) => setFilter(value as PresetFilter)} options={[{ value: "all", label: "All profiles" }, { value: "model", label: "With model detectors" }, { value: "local", label: "Local rules only" }]} /></div>
    {loading ? <Card className="p-6 text-sm text-muted" role="status">Loading profile library…</Card> : error ? <Card className="p-6"><p role="alert" className="text-sm text-danger">{error}</p><Button variant="outline" className="mt-3" onClick={onRetry}>Try again</Button></Card> : !profile || !selected ? <EmptyState title="No matching profiles">Try another search or profile type.</EmptyState> : <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <SideSelector
        label="Library profiles"
        value={profile.id}
        onValueChange={(id) => { setSelectedId(id); setPreview("policy"); }}
        caption={`${filtered.length} ${filtered.length === 1 ? "profile" : "profiles"}`}
        footer="Included with Pyro. Customizing creates a new profile; changes never affect the library."
        items={filtered.map(({ profile: preset }) => {
          const hasModel = preset.detectors.some((detector) => detector.enabled);
          const Icon = hasModel ? ShieldCheck : Code2;
          return { value: preset.id, label: preset.name, icon: <Icon className="size-4" />, meta: hasModel ? "Model detectors" : "Local rules only", description: preset.description };
        })}
      />
      <Card className="min-w-0">
        <CardHeader><div className="flex flex-col items-start justify-between gap-4 sm:flex-row"><div className="w-full min-w-0 flex-1"><CardTitle className="text-base">{profile.name}</CardTitle><CardDescription>{profile.description}</CardDescription></div><Button className="max-sm:w-full" onClick={() => onCustomize(profile)}>Customize profile<ArrowRight className="size-3.5" /></Button></div><div className="mt-4 flex flex-wrap gap-2"><Badge>{enabledDetectors.length ? "Model classification" : "No model calls"}</Badge><Badge>{enabledDetectors.length} detectors</Badge><Badge>{enabledRules.length} local rules</Badge></div></CardHeader>
        <CardContent><div className="flex flex-wrap items-start justify-between gap-2"><ViewTabs label="Profile preview" value={preview} onChange={setPreview} options={[{ value: "policy", label: "Policy details" }, { value: "yaml", label: "YAML source" }]} /><Button variant="ghost" size="sm" className="mt-1" onClick={() => downloadYaml(selected)}><Download className="size-3.5" />Download YAML</Button></div>
          {preview === "yaml" ? <pre tabIndex={0} aria-label="Profile YAML preview" className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-control border border-line bg-surface-subtle p-4 text-xs leading-6">{selected.yaml}</pre> : <div className="space-y-6">
            <dl className="grid grid-cols-2 gap-4 border-b border-line pb-5 sm:grid-cols-3">{[["Review threshold", percent(profile.reviewThreshold, 0)], ["Block threshold", percent(profile.blockThreshold, 0)], ["On provider failure", profile.failMode === "closed" ? "Block request" : "Allow request"], ["Strategy", profile.decisionStrategy.replaceAll("_", " ")], ["Input limit", `${profile.maxInputChars.toLocaleString()} characters`], ["Store input previews", profile.persistInputs ? "Yes" : "No"]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-[13px] font-medium">{value}</dd></div>)}</dl>
            <div><h3 className="mb-3 text-sm font-semibold">Model detectors</h3>{!enabledDetectors.length ? <p className="text-[13px] text-muted">This profile evaluates local rules without calling a model.</p> : <div className="divide-y divide-line">{enabledDetectors.map((detector) => <details key={detector.id} className="py-3 first:pt-0"><summary className="cursor-pointer text-[13px] font-medium">{detector.name}<span className="ml-2 font-normal text-muted">Weight {detector.weight}</span></summary><p className="mt-2 text-xs leading-5 text-muted">{detector.description}</p><p className="mt-2 rounded-control bg-surface-subtle p-3 text-xs leading-5">{detector.question}</p></details>)}</div>}</div>
            <div><h3 className="mb-3 text-sm font-semibold">Local rules</h3>{!enabledRules.length ? <p className="text-[13px] text-muted">No local rules are included. Add your own when customizing.</p> : <div className="space-y-3">{enabledRules.map((rule) => <div key={rule.id} className="rounded-control border border-line p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-[13px]">{rule.name}</strong><span className="text-xs text-muted">{rule.match} · {rule.action} · {percent(rule.risk, 0)}</span></div><p className="mt-1 text-xs leading-5 text-muted">{rule.description}</p><code className="mt-2 block break-all rounded-control bg-surface-subtle p-2 text-xs">{rule.pattern}</code></div>)}</div>}</div>
          </div>}
        </CardContent>
      </Card>
    </div>}
  </section>;
}
