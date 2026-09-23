import { useEffect, useState, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ProviderSettings } from "@pyro/contracts";
import { PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GlideSelect } from "@/components/react-bits/GlideSelect";
import { Switch } from "@/components/ui/switch";
import { ViewTabs } from "@/components/ui/view-tabs";
import { useDashboardPreferences } from "@/components/ui/theme";
import type { DashboardPreferences } from "@/lib/preferences";
import { api } from "@/lib/api";

interface ProviderResponse { settings: ProviderSettings; apiKeyConfigured: boolean; apiKeySource?: string | null }

function SettingLabel({ children, help, htmlFor }: { children: ReactNode; help: string; htmlFor?: string }) {
  return <div className="flex items-center gap-1.5"><Label htmlFor={htmlFor}>{children}</Label><HelpTooltip label={`About ${String(children)}`}>{help}</HelpTooltip></div>;
}

function ProviderSettingsPanel() {
  const [state, setState] = useState<ProviderResponse>();
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = () => { setLoading(true); setError(undefined); void api.get<ProviderResponse>("/api/settings/provider").then(setState).catch((reason) => setError(reason.message)).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!state || saving) return; setError(undefined); setSaved(false); setSaving(true);
    try {
      const result = await api.put<ProviderResponse>("/api/settings/provider", { ...state.settings, apiKey: apiKey || undefined });
      setState({ ...state, ...result }); setApiKey(""); setSaved(true); setTimeout(() => setSaved(false), 2_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save settings."); }
    finally { setSaving(false); }
  };
  if (!state) return <Card className="p-5"><p className="text-sm text-muted" role="status">{loading ? "Loading provider configuration…" : error || "Could not load provider configuration."}</p>{!loading && <Button className="mt-3" variant="outline" onClick={load}>Try again</Button>}</Card>;
  return (
    <>
      <div className="max-w-3xl space-y-4">
        <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Classifier provider</CardTitle><CardDescription>The configured model evaluates every enabled detector in one structured request.</CardDescription></div><Badge className={state.apiKeyConfigured || state.settings.mode === "mock" ? "border-accent bg-accent text-inverse" : "border-line-strong bg-surface-subtle text-secondary"}>{state.settings.mode === "mock" ? "local mock" : state.apiKeyConfigured ? `key: ${state.apiKeySource}` : "key missing"}</Badge></div></CardHeader><CardContent className="space-y-5">
          <div className="space-y-2"><SettingLabel htmlFor="provider-mode" help="Hosted mode sends requests to the configured classifier endpoint. Local pattern mock is intended only for development and integration tests.">Mode</SettingLabel><Select value={state.settings.mode} onValueChange={(mode: "jev" | "mock") => setState({ ...state, settings: { ...state.settings, mode } })}><SelectTrigger id="provider-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="jev">Hosted classifier</SelectItem><SelectItem value="mock">Local pattern mock</SelectItem></SelectContent></Select><p className="text-xs text-muted">Mock mode is only for local integration testing; it is not a production classifier.</p></div>
          <div className="space-y-2"><SettingLabel htmlFor="provider-endpoint" help="The HTTPS endpoint Pyro calls for hosted classification requests.">Endpoint</SettingLabel><Input id="provider-endpoint" value={state.settings.endpoint} onChange={(event) => setState({ ...state, settings: { ...state.settings, endpoint: event.target.value } })} /></div>
          <div className="space-y-2"><SettingLabel htmlFor="provider-model" help="The model used when a protection profile does not specify a different model.">Default model</SettingLabel><Input id="provider-model" value={state.settings.model} onChange={(event) => setState({ ...state, settings: { ...state.settings, model: event.target.value } })} /></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><SettingLabel htmlFor="provider-max-retries" help="How many times Pyro retries a failed hosted-classifier request before applying the profile's fail mode.">Maximum retries</SettingLabel><Input id="provider-max-retries" type="number" min="0" max="5" value={state.settings.maxRetries} onChange={(event) => setState({ ...state, settings: { ...state.settings, maxRetries: Number(event.target.value) } })} /></div><div className="space-y-2"><SettingLabel htmlFor="provider-retry-backoff" help="The initial delay between retries. Later retries use progressively longer delays.">Retry backoff (ms)</SettingLabel><Input id="provider-retry-backoff" type="number" min="0" max="10000" value={state.settings.retryBackoffMs} onChange={(event) => setState({ ...state, settings: { ...state.settings, retryBackoffMs: Number(event.target.value) } })} /></div></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><SettingLabel htmlFor="provider-circuit-threshold" help="The number of consecutive provider failures that opens the circuit and temporarily stops upstream calls.">Circuit failure threshold</SettingLabel><Input id="provider-circuit-threshold" type="number" min="1" max="100" value={state.settings.circuitBreakerFailureThreshold} onChange={(event) => setState({ ...state, settings: { ...state.settings, circuitBreakerFailureThreshold: Number(event.target.value) } })} /></div><div className="space-y-2"><SettingLabel htmlFor="provider-circuit-reset" help="How long an open circuit waits before allowing a trial request to the provider.">Circuit reset (ms)</SettingLabel><Input id="provider-circuit-reset" type="number" min="1000" max="600000" value={state.settings.circuitBreakerResetMs} onChange={(event) => setState({ ...state, settings: { ...state.settings, circuitBreakerResetMs: Number(event.target.value) } })} /></div></div>
          <div className="space-y-2"><SettingLabel htmlFor="provider-key" help="The bearer credential used for hosted classifier calls. Leaving this blank keeps the current key.">Provider API key</SettingLabel><Input id="provider-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={state.apiKeyConfigured ? "Configured — enter a value to replace" : "Enter API key"} /><p className="text-xs leading-5 text-muted">Dashboard-entered keys are encrypted before being stored in PostgreSQL. Environment keys take precedence.</p></div>
          {error && <div className="border border-line-strong bg-surface-subtle px-3 py-2 text-sm text-foreground">{error}</div>}
          <Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : saved ? "Saved" : "Save provider settings"}</Button>
        </CardContent></Card>
      </div>
    </>
  );
}


function PreferenceRow({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return <div className="flex flex-col gap-3 border-b border-line py-5 first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
    <div className="min-w-0"><Label htmlFor={id}>{title}</Label><p id={`${id}-hint`} className="mt-1 max-w-md text-xs leading-5 text-muted">{description}</p></div>
    <div className="shrink-0 sm:w-56">{children}</div>
  </div>;
}

export function SettingsPage() {
  const [view, setView] = useState<"dashboard" | "provider">("dashboard");
  const { preferences, updatePreferences, resetPreferences } = useDashboardPreferences();
  return <>
    <PageHeader title="Settings" description="Personalize your dashboard and configure the classifier." />
    <ViewTabs label="Settings sections" value={view} onChange={setView} options={[{ value: "dashboard", label: "Dashboard" }, { value: "provider", label: "Classifier provider" }]} />
    {view === "provider" ? <ProviderSettingsPanel /> : <div className="max-w-3xl space-y-5">
      <Card><CardHeader><CardTitle>Appearance</CardTitle><CardDescription>A quieter workspace, tuned to you.</CardDescription></CardHeader><CardContent>
        <PreferenceRow id="appearance-theme" title="Theme" description="Choose a theme or follow your system appearance.">
          <div id="appearance-theme" role="group" aria-label="Theme" className="grid grid-cols-3 gap-2">{([{ value: "light", label: "Light", icon: Sun }, { value: "dark", label: "Dark", icon: Moon }, { value: "system", label: "System", icon: Monitor }] as const).map(({ value, label, icon: Icon }) => <Button key={value} variant={preferences.theme === value ? "default" : "outline"} className="h-auto flex-col gap-1.5 px-2 py-3 text-xs" aria-label={`${label} theme`} aria-pressed={preferences.theme === value} onClick={() => updatePreferences({ theme: value })}><Icon className="size-4" />{label}</Button>)}</div>
        </PreferenceRow>
        <PreferenceRow id="table-density" title="Table density" description="Use tighter rows in Activity, API keys and delivery history."><GlideSelect id="table-density" ariaDescribedBy="table-density-hint" ariaLabel="Table density" value={preferences.density} onChange={(density) => updatePreferences({ density: density as DashboardPreferences["density"] })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} /></PreferenceRow>
        <PreferenceRow id="reduce-motion" title="Reduce motion" description="Minimize menu and interface transitions. Your system’s reduced motion preference is always respected."><Switch id="reduce-motion" aria-describedby="reduce-motion-hint" checked={preferences.reduceMotion} onCheckedChange={(reduceMotion) => updatePreferences({ reduceMotion })} /></PreferenceRow>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Live activity</CardTitle><CardDescription>Control how new decisions appear in this dashboard.</CardDescription></CardHeader><CardContent>
        <PreferenceRow id="live-updates" title="Live updates" description="Keep charts, usage, Activity and delivery history up to date. Reload the page for fresh data when this is off."><Switch id="live-updates" aria-describedby="live-updates-hint" checked={preferences.liveUpdates} onCheckedChange={(liveUpdates) => updatePreferences({ liveUpdates })} /></PreferenceRow>
        <PreferenceRow id="decision-toasts" title="Decision notifications" description="Show in-app banners for decisions your profiles flag for notification. Webhooks are unaffected."><Switch id="decision-toasts" aria-describedby="decision-toasts-hint" checked={preferences.decisionToasts} onCheckedChange={(decisionToasts) => updatePreferences({ decisionToasts })} /></PreferenceRow>
        <PreferenceRow id="activity-time" title="Activity timestamps" description="Show elapsed time or the full date and time in your local timezone."><GlideSelect id="activity-time" ariaDescribedBy="activity-time-hint" ariaLabel="Activity timestamps" value={preferences.timeDisplay} onChange={(timeDisplay) => updatePreferences({ timeDisplay: timeDisplay as DashboardPreferences["timeDisplay"] })} options={[{ value: "relative", label: "Relative · 5m ago" }, { value: "absolute", label: "Date and time" }]} /></PreferenceRow>
      </CardContent></Card>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted">Preferences save automatically in this browser.</p><Button variant="outline" size="sm" onClick={resetPreferences}>Reset dashboard preferences</Button></div>
    </div>}
  </>;
}
