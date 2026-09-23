import type { Integration } from "@pyro/contracts";
import { scopeFromIds, scopeIds, type ResourceScope } from "./resource-scope";

export interface WebhookDraft {
  id?: string;
  name: string;
  url: string;
  enabled: boolean;
  actions: Integration["actions"];
  minimumRisk: string;
  allowPrivateNetwork: boolean;
  applications: ResourceScope;
  profiles: ResourceScope;
}

export function createWebhookDraft(webhook?: Integration): WebhookDraft {
  return {
    id: webhook?.id, name: webhook?.name ?? "", url: "", enabled: webhook?.enabled ?? true,
    actions: [...(webhook?.actions ?? ["review", "block"])], minimumRisk: String(webhook?.minimumRisk ?? 0),
    allowPrivateNetwork: webhook?.allowPrivateNetwork ?? false,
    applications: scopeFromIds(webhook?.appIds ?? []), profiles: scopeFromIds(webhook?.profileIds ?? []),
  };
}

export function webhookDraftError(draft: WebhookDraft): string | undefined {
  if (!draft.name.trim()) return "Enter a name for this webhook.";
  if (!draft.id && !draft.url.trim()) return "Enter a destination URL.";
  if (!draft.actions.length) return "Choose at least one decision action.";
  const risk = Number(draft.minimumRisk);
  if (!draft.minimumRisk.trim() || !Number.isFinite(risk) || risk < 0 || risk > 1) return "Minimum risk must be a number from 0 to 1.";
  try { scopeIds(draft.applications); scopeIds(draft.profiles); } catch (error) { return (error as Error).message; }
}

export function webhookPayload(draft: WebhookDraft) {
  const error = webhookDraftError(draft);
  if (error) throw new Error(error);
  return {
    name: draft.name.trim(), url: draft.url.trim(), type: "webhook" as const, enabled: draft.enabled,
    actions: [...draft.actions], minimumRisk: Number(draft.minimumRisk), allowPrivateNetwork: draft.allowPrivateNetwork,
    appIds: scopeIds(draft.applications), profileIds: scopeIds(draft.profiles),
  };
}
