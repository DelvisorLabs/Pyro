import { useEffect, useState, type ReactNode } from "react";
import type { ProviderSettings } from "@pyro/contracts";
import { PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";

interface ProviderResponse { settings: ProviderSettings; apiKeyConfigured: boolean; apiKeySource?: string | null }

function SettingLabel({ children, help, htmlFor }: { children: ReactNode; help: string; htmlFor?: string }) {
  return <div className="flex items-center gap-1.5"><Label htmlFor={htmlFor}>{children}</Label><HelpTooltip label={`About ${String(children)}`}>{help}</HelpTooltip></div>;
}

export function SettingsPage() {
  const [state, setState] = useState<ProviderResponse>();
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { void api.get<ProviderResponse>("/api/settings/provider").then(setState); }, []);
  const save = async () => {
    if (!state) return; setError(undefined); setSaved(false);
    try {
      const result = await api.put<ProviderResponse>("/api/settings/provider", { ...state.settings, apiKey: apiKey || undefined });
      setState({ ...state, ...result }); setApiKey(""); setSaved(true); setTimeout(() => setSaved(false), 2_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save settings."); }
  };
  if (!state) return <><PageHeader title="Settings" description="Loading provider configuration." /></>;
  return (
    <>
      <PageHeader title="Settings" description="Configure the classifier provider used by the gateway." />
      <div className="max-w-3xl space-y-4">
        <Card><CardHeader><div className="flex items-start justify-between"><div><CardTitle>Classifier provider</CardTitle><CardDescription>The configured model evaluates every enabled detector in one structured request.</CardDescription></div><Badge className={state.apiKeyConfigured || state.settings.mode === "mock" ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-400 bg-neutral-100 text-neutral-800"}>{state.settings.mode === "mock" ? "local mock" : state.apiKeyConfigured ? `key: ${state.apiKeySource}` : "key missing"}</Badge></div></CardHeader><CardContent className="space-y-5">
          <div className="space-y-2"><SettingLabel htmlFor="provider-mode" help="Hosted mode sends requests to the configured classifier endpoint. Local pattern mock is intended only for development and integration tests.">Mode</SettingLabel><Select value={state.settings.mode} onValueChange={(mode: "jev" | "mock") => setState({ ...state, settings: { ...state.settings, mode } })}><SelectTrigger id="provider-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="jev">Hosted classifier</SelectItem><SelectItem value="mock">Local pattern mock</SelectItem></SelectContent></Select><p className="text-xs text-neutral-500">Mock mode is only for local integration testing; it is not a production classifier.</p></div>
          <div className="space-y-2"><SettingLabel htmlFor="provider-endpoint" help="The HTTPS endpoint Pyro calls for hosted classification requests.">Endpoint</SettingLabel><Input id="provider-endpoint" value={state.settings.endpoint} onChange={(event) => setState({ ...state, settings: { ...state.settings, endpoint: event.target.value } })} /></div>
          <div className="space-y-2"><SettingLabel htmlFor="provider-model" help="The model used when a protection profile does not specify a different model.">Default model</SettingLabel><Input id="provider-model" value={state.settings.model} onChange={(event) => setState({ ...state, settings: { ...state.settings, model: event.target.value } })} /></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><SettingLabel htmlFor="provider-max-retries" help="How many times Pyro retries a failed hosted-classifier request before applying the profile's fail mode.">Maximum retries</SettingLabel><Input id="provider-max-retries" type="number" min="0" max="5" value={state.settings.maxRetries} onChange={(event) => setState({ ...state, settings: { ...state.settings, maxRetries: Number(event.target.value) } })} /></div><div className="space-y-2"><SettingLabel htmlFor="provider-retry-backoff" help="The initial delay between retries. Later retries use progressively longer delays.">Retry backoff (ms)</SettingLabel><Input id="provider-retry-backoff" type="number" min="0" max="10000" value={state.settings.retryBackoffMs} onChange={(event) => setState({ ...state, settings: { ...state.settings, retryBackoffMs: Number(event.target.value) } })} /></div></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><SettingLabel htmlFor="provider-circuit-threshold" help="The number of consecutive provider failures that opens the circuit and temporarily stops upstream calls.">Circuit failure threshold</SettingLabel><Input id="provider-circuit-threshold" type="number" min="1" max="100" value={state.settings.circuitBreakerFailureThreshold} onChange={(event) => setState({ ...state, settings: { ...state.settings, circuitBreakerFailureThreshold: Number(event.target.value) } })} /></div><div className="space-y-2"><SettingLabel htmlFor="provider-circuit-reset" help="How long an open circuit waits before allowing a trial request to the provider.">Circuit reset (ms)</SettingLabel><Input id="provider-circuit-reset" type="number" min="1000" max="600000" value={state.settings.circuitBreakerResetMs} onChange={(event) => setState({ ...state, settings: { ...state.settings, circuitBreakerResetMs: Number(event.target.value) } })} /></div></div>
          <div className="space-y-2"><SettingLabel htmlFor="provider-key" help="The bearer credential used for hosted classifier calls. Leaving this blank keeps the current key.">Provider API key</SettingLabel><Input id="provider-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={state.apiKeyConfigured ? "Configured — enter a value to replace" : "Enter API key"} /><p className="text-xs leading-5 text-neutral-500">Dashboard-entered keys are encrypted before being stored in PostgreSQL. Environment keys take precedence.</p></div>
          {error && <div className="border border-neutral-500 bg-neutral-100 px-3 py-2 text-sm text-neutral-900">{error}</div>}
          <Button onClick={() => void save()}>{saved ? "Saved" : "Save settings"}</Button>
        </CardContent></Card>
      </div>
    </>
  );
}
