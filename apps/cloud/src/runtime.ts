import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildGateway } from "@pyro/gateway/app";
import { buildControlPlane } from "@pyro/control-plane/app";
import { openDatabase, type Database } from "@pyro/storage";
import { createDefaultProviderSettings, createDefaultProfile, type ApiKeyRecord, type StoredIntegration } from "@pyro/contracts";
import type { Billing } from "./billing.js";
import { hash, CloudError, type CloudStore } from "./store.js";
export interface Runtime { gateway: FastifyInstance; control: FastifyInstance; database: Database; close(): Promise<void> }
/** Fixed organization instances deliberately isolate every legacy cache, queue and
 * event emitter. PostgreSQL pools are shared; no per-customer servers are created. */
export class Runtimes {
  private instances = new Map<string, Promise<Runtime>>();
  constructor(readonly store: CloudStore, readonly billing: Billing) {}
  async get(orgId: string): Promise<Runtime> {
    await this.store.assertActive(orgId);
    let runtime = this.instances.get(orgId);
    if (!runtime) {
      runtime = this.create(orgId).catch((error) => { this.instances.delete(orgId); throw error; });
      this.instances.set(orgId, runtime);
    }
    return runtime;
  }
  private async create(orgId: string): Promise<Runtime> {
    const config = this.store.config;
    const database = await openDatabase(config.databaseUrl, orgId);
    let gateway: FastifyInstance | undefined, control: FastifyInstance | undefined;
    try {
    const internalKey = `internal_${createHmac("sha256", config.secret).update(`playground:${orgId}`).digest("hex")}`;
    await database.document<ApiKeyRecord[]>("api_keys", () => []).update((keys) => [...keys.filter((k) => k.id !== "cloud-playground"), {
      id: "cloud-playground", name: "Dashboard playground", prefix: "internal", hash: hash(internalKey), appId: "default", createdAt: new Date().toISOString(),
    }]);
    await database.document("provider_settings", createDefaultProviderSettings).write({ ...createDefaultProviderSettings(), mode: config.providerMode, endpoint: config.providerEndpoint, model: config.providerModel });
    await database.document("profiles", () => [{ ...createDefaultProfile(), model: config.providerModel }]).update((profiles) => profiles);
    // A self-hosted private-network webhook must never resume inside cloud infrastructure.
    await database.document<StoredIntegration[]>("integrations", () => []).update((rows) => rows.map((row) => row.allowPrivateNetwork ? { ...row, enabled: false, allowPrivateNetwork: false } : row));
    const providerHooks = this.billing.hooks(orgId);
    gateway = await buildGateway({ organizationId: orgId, databaseUrl: config.databaseUrl, host: "127.0.0.1", port: 0,
      controlPlaneSecret: config.secret, typesafeApiKey: config.providerKey, bootstrapApiKey: internalKey,
      queueConcurrency: 2, queueMaxDepth: 20, defaultTimeoutMs: 8000, providerHooks, authorizeWork: async () => { await this.store.assertActive(orgId); await this.store.eventBudget(orgId); }, beforePersist: (event) => this.store.eventBudget(orgId, Buffer.byteLength(JSON.stringify(event))) });
      control = await buildControlPlane({ organizationId: orgId, databaseUrl: config.databaseUrl, host: "127.0.0.1", port: 0,
        controlPlaneSecret: config.secret, adminPassword: "disabled-cloud-login", gatewayInternalUrl: "http://127.0.0.1:0", gatewayApiKey: internalKey,
        typesafeApiKey: config.providerKey, typesafeEndpoint: config.providerEndpoint, typesafeModel: config.providerModel, providerHooks,
        resolveUser: async (request) => (await this.store.resolve(request.cookies.pf_session, orgId)).user,
        validateProfile: (profile) => { if (profile.detectors.some((d) => d.enabled) && profile.model !== config.providerModel) throw new CloudError(400, `Cloud semantic policies must use ${config.providerModel}.`); },
        documentLimits: { apps: { count: 20, bytes: 2_000_000 }, profiles: { count: 100, bytes: 10_000_000 }, api_keys: { count: 101, bytes: 200_000 }, integrations: { count: 10, bytes: 100_000 }, evaluation_datasets: { count: 20, bytes: 15_000_000 }, evaluation_runs: { count: 100, bytes: 30_000_000 } },
        listUsers: () => this.store.members(orgId),
        authorizeEvaluation: async (userId, appId) => {
          await this.store.assertActive(orgId);
          const user = (await this.store.members(orgId)).find((u) => u.id === userId && !u.disabled);
          if (!user || !(user.role === "admin" || user.role === "operator" && user.appIds?.includes(appId))) throw new CloudError(403, "Evaluation permission was revoked.");
        },
        gatewayHealth: async () => (await gateway!.inject({ url: "/v1/health" })).json(),
        classify: async (body) => { const response = await gateway!.inject({ method: "POST", url: "/v1/classify", headers: { authorization: `Bearer ${internalKey}` }, payload: body as object }); return { status: response.statusCode, body: response.json() }; },
      });
      await gateway.ready(); await control.ready();
      return { gateway, control, database, close: async () => { await control!.close(); await gateway!.close(); await database.close(); } };
    } catch (error) { await control?.close(); await gateway?.close(); await database.close(); throw error; }
  }
  async retire(orgId: string) { const value = this.instances.get(orgId); if (value) { this.instances.delete(orgId); await (await value).close(); } }
  async close() { for (const id of [...this.instances.keys()]) await this.retire(id); }
  async authenticateKey(raw?: string) {
    if (!raw || raw.startsWith("internal_")) throw new CloudError(401, "A valid Pyro API key is required.");
    const orgId = /^pyro_([a-f0-9-]{36}|default)_/.exec(raw)?.[1] ?? "default";
    if (!orgId) throw new CloudError(401, "A valid Pyro API key is required.");
    const runtime = await this.get(orgId);
    const key = (await runtime.database.document<ApiKeyRecord[]>("api_keys", () => []).read()).find((k) => !k.revokedAt && k.hash === hash(raw));
    if (!key) throw new CloudError(401, "A valid Pyro API key is required.");
    return { orgId, runtime, key };
  }
}
