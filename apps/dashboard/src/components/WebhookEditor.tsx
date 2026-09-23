import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ResourceChoice } from "@/lib/resource-scope";
import { webhookDraftError, type WebhookDraft } from "@/lib/webhook-form";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { FieldLabel } from "./ui/field";
import { HelpTooltip } from "./ui/help-tooltip";
import { Input } from "./ui/input";
import { ResourceScopePicker } from "./ui/resource-scope-picker";
import { Switch } from "./ui/switch";

interface WebhookEditorProps {
  initialDraft: WebhookDraft;
  busy: boolean;
  error?: string;
  onSave: (draft: WebhookDraft) => Promise<void>;
  onCancel: () => void;
}

export function WebhookEditor({ initialDraft, busy, error, onSave, onCancel }: WebhookEditorProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [apps, setApps] = useState<ResourceChoice[]>([]);
  const [profiles, setProfiles] = useState<ResourceChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(undefined);
    void Promise.all([
      api.get<{ apps: ResourceChoice[] }>("/api/apps"),
      api.get<{ profiles: ResourceChoice[] }>("/api/profiles"),
    ]).then(([appResult, profileResult]) => {
      if (active) { setApps(appResult.apps); setProfiles(profileResult.profiles); }
    }).catch(() => {
      if (active) setLoadError("Could not load applications and profiles. Your selections have been kept.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadVersion]);

  const invalidRisk = !draft.minimumRisk.trim() || !Number.isFinite(Number(draft.minimumRisk)) || Number(draft.minimumRisk) < 0 || Number(draft.minimumRisk) > 1;
  const invalid = webhookDraftError(draft);

  return (
    <form className="flex max-h-[calc(90vh-2px)] flex-col" onSubmit={(event) => { event.preventDefault(); if (!invalid && !busy && !loading && !loadError) void onSave(draft); }}>
      <DialogHeader className="shrink-0 py-4">
        <DialogTitle>{draft.id ? "Edit webhook" : "Add webhook"}</DialogTitle>
        <DialogDescription>Choose where to send decisions and which ones to include.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto">
      <fieldset disabled={busy} className="min-w-0 space-y-4 px-6 py-4">
        <div>
          <FieldLabel htmlFor="webhook-name" help="A name to help you recognize this webhook in the dashboard. It does not change delivery.">Name</FieldLabel>
          <Input id="webhook-name" required maxLength={100} value={draft.name} placeholder="e.g. Production alerts" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </div>
        <div>
          <FieldLabel htmlFor="webhook-url" help="The endpoint on your server that receives an HTTP POST with a signed JSON decision. Use HTTPS unless you enable private network / HTTP access below.">Destination URL</FieldLabel>
          <Input id="webhook-url" type="url" autoComplete="off" required={!draft.id} maxLength={2048} placeholder={draft.id ? "Leave blank to keep the saved URL" : "https://your-server.com/webhooks/pyro"} value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} aria-describedby="webhook-url-hint" />
          <p id="webhook-url-hint" className="mt-1.5 text-xs text-muted">Stored encrypted. Prompt text is never included in webhook payloads.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-[1.4fr_1fr]">
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium"><span className="inline-flex items-center gap-1.5">Decision actions<HelpTooltip label="About decision actions">Choose which outcomes send a notification. Allow means the request passed, Review means it was flagged, and Block means the policy rejected it. Choose at least one.</HelpTooltip></span></legend>
            <div className="flex flex-wrap gap-4 pt-1.5">
              {(["allow", "review", "block"] as const).map((action) => (
                <label key={action} className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <Checkbox checked={draft.actions.includes(action)} onCheckedChange={(checked) => setDraft({ ...draft, actions: checked === true ? [...draft.actions, action] : draft.actions.filter((value) => value !== action) })} />
                  {action[0]!.toUpperCase() + action.slice(1)}
                </label>
              ))}
            </div>
            {!draft.actions.length && <p className="mt-2 text-xs text-danger">Choose at least one action.</p>}
          </fieldset>
          <div>
            <FieldLabel htmlFor="webhook-risk" help="Only send decisions whose risk score is at least this value. The scale is 0–1: 0 adds no risk filter; 0.8 includes scores of 0.8 and above. This does not change your policy thresholds.">Minimum risk</FieldLabel>
            <Input id="webhook-risk" type="number" min="0" max="1" step="any" required value={draft.minimumRisk} aria-invalid={invalidRisk} aria-describedby="webhook-risk-hint" onChange={(event) => setDraft({ ...draft, minimumRisk: event.target.value })} />
            <p id="webhook-risk-hint" className={`mt-1.5 text-xs ${invalidRisk ? "text-danger" : "text-muted"}`}>{invalidRisk ? "Enter a number from 0 to 1." : "0–1 · 0 includes every risk score."}</p>
          </div>
        </div>
        <div className="border-t border-line pt-3">
          <p className="mb-3 text-xs text-muted">A decision must match the action, minimum risk and both scopes below.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <FieldLabel htmlFor="webhook-applications" help="Limit notifications to requests from specific applications. Choose names from the checklist. All applications includes applications you create later.">Applications</FieldLabel>
              <ResourceScopePicker id="webhook-applications" label="Applications" singular="application" choices={apps} value={draft.applications} onChange={(applications) => setDraft({ ...draft, applications })} disabled={loading || Boolean(loadError) || busy} />
            </div>
            <div className="min-w-0">
              <FieldLabel htmlFor="webhook-profiles" help="Limit notifications to decisions made by specific protection profiles. All profiles includes profiles you create later. This filter does not attach a profile to an application.">Profiles</FieldLabel>
              <ResourceScopePicker id="webhook-profiles" label="Profiles" singular="profile" choices={profiles} value={draft.profiles} onChange={(profiles) => setDraft({ ...draft, profiles })} disabled={loading || Boolean(loadError) || busy} />
            </div>
          </div>
          {loading && <p role="status" className="mt-2 text-xs text-muted">Loading applications and profiles…</p>}
          {loadError && <div className="mt-2 flex items-center gap-3"><p role="alert" className="text-xs text-danger">{loadError}</p><Button type="button" variant="outline" size="sm" onClick={() => setLoadVersion((value) => value + 1)}>Try again</Button></div>}
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-line pt-3">
          <div>
            <FieldLabel htmlFor="webhook-private-network" help="Allows delivery to private or local addresses and permits unencrypted HTTP. Enable only for a receiver you trust, such as a local development server. Otherwise, Pyro requires a public HTTPS endpoint.">Allow private network / HTTP</FieldLabel>
            <p className="text-xs text-muted">For local development or internal receivers.</p>
          </div>
          <Switch id="webhook-private-network" checked={draft.allowPrivateNetwork} onCheckedChange={(allowPrivateNetwork) => setDraft({ ...draft, allowPrivateNetwork })} />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </fieldset>
      </div>
      <DialogFooter className="shrink-0 py-3">
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy || loading || Boolean(loadError) || Boolean(invalid)}>{busy ? "Saving…" : "Save webhook"}</Button>
      </DialogFooter>
    </form>
  );
}
