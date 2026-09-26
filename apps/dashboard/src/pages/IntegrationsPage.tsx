import { WebhookDeliveries } from "@/components/WebhookDeliveries";
import { WebhookEditor } from "@/components/WebhookEditor";
import { createWebhookDraft, webhookPayload, type WebhookDraft } from "@/lib/webhook-form";
import { useEffect, useState } from "react";
import type { Delivery, Integration } from "@pyro/contracts";
import { PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useDashboardPreferences } from "@/components/ui/theme";
import { api } from "@/lib/api";

type PublicIntegration = Integration & { destinationHost: string; hasSigningSecret: boolean };
export function IntegrationsPage() {
  const { preferences } = useDashboardPreferences();
  const [integrations, setIntegrations] = useState<PublicIntegration[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [editing, setEditing] = useState<WebhookDraft>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [busy, setBusy] = useState(false);
  const load = async () => { const [a, b] = await Promise.all([api.get<{ integrations: PublicIntegration[] }>("/api/integrations"), api.get<{ deliveries: Delivery[] }>("/api/integration-deliveries")]); setIntegrations(a.integrations); setDeliveries(b.deliveries); };
  useEffect(() => { void load().catch((e) => setError(e.message)); const timer = preferences.liveUpdates ? setInterval(() => { void load().catch((e) => setError(e.message)); }, 5_000) : undefined; return () => { if (timer !== undefined) clearInterval(timer); }; }, [preferences.liveUpdates]);
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(undefined); setNotice(undefined); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); } finally { setBusy(false); } };
  const save = (draft: WebhookDraft) => act(async () => {
    const value = webhookPayload(draft);
    const result = draft.id
      ? await api.put<{ signingSecret?: string }>(`/api/integrations/${draft.id}`, value)
      : await api.post<{ signingSecret?: string }>("/api/integrations", value);
    setEditing(undefined);
    if (result.signingSecret) setSecret(result.signingSecret);
    setNotice("Webhook saved.");
  });
  return <>
    <PageHeader title="Webhooks" description="Send filtered decisions to your HTTP receiver with signed JSON payloads. Delivery runs in the background with retries and a persistent history." actions={<Button onClick={() => { setError(undefined); setEditing(createWebhookDraft()); }}>Add webhook</Button>} />
    {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}{notice && <p role="status" className="mb-4 text-sm">{notice}</p>}
    {integrations.length > 0 && <div className="mb-6 grid gap-4 lg:grid-cols-2">{integrations.map((item) => <Card key={item.id}><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>{item.name}</CardTitle><Switch disabled={busy} aria-label={`Enable ${item.name}`} checked={item.enabled} onCheckedChange={(enabled) => void act(async () => { await api.put(`/api/integrations/${item.id}`, { enabled }); })} /></div><p className="text-sm text-muted">Signed webhook · {item.destinationHost}</p></CardHeader><CardContent><p className="text-sm">{item.actions.join(" / ")} · minimum risk {item.minimumRisk} · {item.appIds.length ? `${item.appIds.length} selected ${item.appIds.length === 1 ? "application" : "applications"}` : "all applications"}</p><label className="mt-3 flex items-center gap-3 text-sm"><Switch disabled={busy} checked={item.reviewResolutions ?? false} onCheckedChange={(reviewResolutions) => void act(async () => { await api.put(`/api/integrations/${item.id}`, { reviewResolutions }); })} />Signed review resolution callbacks</label><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setError(undefined); setEditing(createWebhookDraft(item)); }}>Edit</Button><Button size="sm" variant="outline" disabled={busy || !item.enabled} onClick={() => void act(async () => { await api.post(`/api/integrations/${item.id}/test`); setNotice("Test queued. Check delivery history below."); })}>Send test</Button>{item.type === "webhook" && <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm("Rotate the signing secret? Update your receiver to use the new secret.")) void act(async () => { const result = await api.post<{ signingSecret: string }>(`/api/integrations/${item.id}/rotate-secret`); setSecret(result.signingSecret); }); }}>Rotate secret</Button>}<Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`Delete ${item.name}? Pending deliveries will stop.`)) void act(async () => { await api.delete(`/api/integrations/${item.id}`); }); }}>Delete</Button></div></CardContent></Card>)}</div>}
    {!integrations.length && <p className="mb-6 border border-dashed p-6 text-sm text-muted">No webhooks yet. Add your receiver, then send a test.</p>}
    <WebhookDeliveries deliveries={deliveries} webhooks={integrations} busy={busy} onRefresh={() => void act(async () => {})} onRetry={(id) => void act(async () => { await api.post(`/api/integration-deliveries/${id}/retry`); })} />
    <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !busy) setEditing(undefined); }}>
      <DialogContent className="overflow-clip" onOpenAutoFocus={(event) => { event.preventDefault(); document.getElementById("webhook-name")?.focus(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
        {editing && <WebhookEditor key={editing.id ?? "new"} initialDraft={editing} busy={busy} error={error} onSave={save} onCancel={() => setEditing(undefined)} />}
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(secret)} onOpenChange={(open) => !open && setSecret(undefined)}><DialogContent><DialogHeader><DialogTitle>Save your signing secret</DialogTitle></DialogHeader><div className="space-y-3 px-6 py-4"><p className="text-sm">Shown once. Use this to verify X-Pyro-Signature at your receiver.</p><Input aria-label="Signing secret" readOnly value={secret ?? ""} onFocus={(e) => e.target.select()} /></div><DialogFooter><Button onClick={() => setSecret(undefined)}>Done</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
