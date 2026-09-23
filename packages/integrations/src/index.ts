import { createHmac, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
import type { ClassificationEvent, Delivery, StoredIntegration, WebhookEvent } from "@pyro/contracts";
import { decryptText, type Database } from "@pyro/storage";

export function validateDestination(value: string, allowPrivateNetwork: boolean): URL {
  const url = new URL(value);
  if (url.username || url.password || url.hash || value.length > 2_048) throw new Error("Use a URL without credentials or a fragment (maximum 2,048 characters).");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowPrivateNetwork)) throw new Error("HTTPS is required. Explicitly enable private networking for local HTTP receivers.");
  return url;
}

export function isPublicAddress(value: string): boolean {
  let address = ipaddr.parse(value);
  if (address.kind() === "ipv6" && (address as ipaddr.IPv6).isIPv4MappedAddress()) address = (address as ipaddr.IPv6).toIPv4Address();
  return address.range() === "unicast";
}

export function deliveryFor(integrationId: string, payload: WebhookEvent): Delivery {
  const now = new Date().toISOString();
  return { id: randomUUID(), integrationId, eventId: payload.id, createdAt: now, status: "pending", attempts: 0, nextAttemptAt: now, payload };
}

export function decisionDeliveries(event: ClassificationEvent, integrations: StoredIntegration[]): Delivery[] {
  const payload: WebhookEvent = {
    id: event.id, type: "decision.created", createdAt: event.createdAt,
    // Deliberate allowlist: never send prompts, previews, metadata, labels, keys or upstream errors.
    data: { id: event.id, profileId: event.profileId, appId: event.appId, action: event.action,
      verdict: event.verdict, risk: event.risk, provider: event.provider, latencyMs: event.latencyMs,
      traceId: event.traceId, failed: Boolean(event.error) },
  };
  return integrations.filter((i) => i.type === "webhook" && i.enabled && i.actions.includes(event.action) && event.risk >= i.minimumRisk
    && (!i.profileIds.length || i.profileIds.includes(event.profileId))
    && (!i.appIds.length || i.appIds.includes(event.appId ?? "default")))
    .map((i) => deliveryFor(i.id, payload));
}

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export interface SendResult { status: number; retryAfterMs?: number }
export type Transport = (url: URL, body: string, headers: Record<string, string>, allowPrivate: boolean) => Promise<SendResult>;

export const sendHttp: Transport = async (url, body, headers, allowPrivate) => {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(host, { all: true }),
    new Promise<never>((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new Error("DNS lookup timed out.")), 3_000); }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || (!allowPrivate && addresses.some((a) => !isPublicAddress(a.address)))) throw new Error("Destination is not a public address.");
  const address = addresses.find((candidate) => candidate.family === 4) ?? addresses[0]!;
  return new Promise((resolve, reject) => {
    // Pin the validated DNS result. Redirects are never followed.
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: "POST", headers: { ...headers, "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      family: address.family, signal: AbortSignal.timeout(5_000),
    }, (response) => {
      const retryAfter = response.headers["retry-after"];
      const raw = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
      const delay = raw ? (/^\d+$/.test(raw) ? Number(raw) * 1_000 : Date.parse(raw) - Date.now()) : undefined;
      response.destroy();
      resolve({ status: response.statusCode ?? 500, retryAfterMs: delay && Number.isFinite(delay) ? Math.min(3_600_000, Math.max(0, delay)) : undefined });
    });
    request.on("error", reject);
    request.end(body);
  });
};

export class DeliveryWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(private readonly database: Database, private readonly encryptionSecret: string, private readonly transport: Transport = sendHttp) {}
  start(onError: (error: unknown) => void): void {
    this.timer = setInterval(() => { void this.tick().catch(onError); }, 1_000);
    this.timer.unref();
  }
  async stop(): Promise<void> { clearInterval(this.timer); await this.running; }
  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async run(): Promise<void> {
    const deliveries = await this.database.deliveries.claim(8);
    if (!deliveries.length) return;
    const integrations = await this.database.document<StoredIntegration[]>("integrations", () => []).read();
    await Promise.all(deliveries.map(async (delivery) => {
      const integration = integrations.find((i) => i.id === delivery.integrationId);
      if (!integration?.enabled || integration.type !== "webhook" || !integration.signingSecret) {
        await this.database.deliveries.finish({ ...delivery, status: "failed", error: "Webhook was disabled, deleted, or has an unsupported configuration." }); return;
      }
      if (delivery.attempts > 5) {
        await this.database.deliveries.finish({ ...delivery, status: "failed", error: "Delivery attempts exhausted after worker recovery." }); return;
      }
      let status: number | undefined;
      let delay: number | undefined;
      let permanent = false;
      try {
        const destination = validateDestination(decryptText(integration.destination, this.encryptionSecret), integration.allowPrivateNetwork);
        const body = JSON.stringify(delivery.payload);
        const timestamp = String(Math.floor(Date.now() / 1_000));
        const headers: Record<string, string> = { "user-agent": "Pyro-Webhooks/1", "x-pyro-delivery-id": delivery.id, "x-pyro-timestamp": timestamp, "x-pyro-event": delivery.payload.type };
        if (integration.signingSecret) headers["x-pyro-signature"] = signWebhook(decryptText(integration.signingSecret, this.encryptionSecret), timestamp, body);
        const result = await this.transport(destination, body, headers, integration.allowPrivateNetwork);
        status = result.status;
        delay = result.retryAfterMs;
        if (status >= 200 && status < 300) {
          await this.database.deliveries.finish({ ...delivery, status: "delivered", lastStatus: status, error: undefined }); return;
        }
        permanent = status < 500 && ![408, 425, 429].includes(status);
      } catch { /* Never persist receiver URLs, secret paths, or response bodies in error records. */ }
      const exhausted = delivery.attempts >= 5 || permanent;
      await this.database.deliveries.finish({ ...delivery, status: exhausted ? "failed" : "pending", lastStatus: status,
        nextAttemptAt: new Date(Date.now() + Math.max(delay ?? 0, Math.min(60_000, 1_000 * 2 ** delivery.attempts))).toISOString(),
        error: status ? `Receiver returned HTTP ${status}.` : "Delivery failed: check destination, network access and TLS." });
    }));
  }
}
