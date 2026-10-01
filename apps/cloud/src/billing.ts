import { randomUUID } from "node:crypto";
import { jevRequest, PolicyExecutionDenied, type ProviderHooks } from "@pyro/classifiers";
import type { DocumentStore } from "@pyro/storage";
import { CloudError, type CloudStore } from "./store.js";
interface CreditAccount { balance: number; consumed: number }
interface LedgerEntry { id: string; orgId: string; credits: number; kind: "grant" | "usage"; at: number; reference: string }
interface MeterState { accounts: Record<string, CreditAccount>; charged: Record<string, number>; entries: LedgerEntry[]; grants: Record<string, true>; month: string; reservedMicros: number; attempts: number; reportedMicros: number; reportedInputTokens: number; reportedOutputTokens: number; reportedCalls: number }
export interface Order { id: string; orgId: string; amount: number; currency: "INR"; credits: number; paid?: boolean }
export class Billing {
  readonly meter: DocumentStore<MeterState>;
  readonly orders: DocumentStore<Order[]>;
  constructor(readonly store: CloudStore) {
    this.meter = store.platform.document("cloud_metering", () => ({ accounts: {}, charged: {}, entries: [], grants: {}, month: "", reservedMicros: 0, attempts: 0, reportedMicros: 0, reportedInputTokens: 0, reportedOutputTokens: 0, reportedCalls: 0 }));
    this.orders = store.platform.document("billing_orders", () => []);
  }
  async grant(orgId: string, credits: number, reference: string) {
    if (!Number.isSafeInteger(credits) || credits <= 0 || credits > 10_000_000) throw new CloudError(400, "Invalid credit amount.");
    await this.store.assertActive(orgId);
    await this.meter.update((state) => {
      if (state.grants[reference]) return state;
      state.grants[reference] = true;
      const account = state.accounts[orgId] ??= { balance: 0, consumed: 0 };
      account.balance += credits;
      state.entries.push({ id: randomUUID(), orgId, credits, kind: "grant", at: Date.now(), reference });
      return state;
    });
  }
  async summary(orgId: string) {
    const state = await this.meter.read();
    const storage = await this.store.platform.document("cloud_event_budget", () => ({ month: "", total: 0, organizations: {} as Record<string, number> })).read();
    return { ...(state.accounts[orgId] ?? { balance: 0, consumed: 0 }), entries: state.entries.filter((e) => e.orgId === orgId).slice(-100).reverse(),
      eventStorage: { usedBytes: storage.month === new Date().toISOString().slice(0, 7) ? storage.organizations[orgId] ?? 0 : 0, limitBytes: 500_000_000 },
      unit: "One credit per started 2,000 UTF-8 bytes of the complete semantic provider request. Local-only decisions are free. Provider retries do not debit customer credits again.",
      checkoutAvailable: Boolean(this.store.config.razorpayKey && this.store.config.razorpaySecret && this.store.config.razorpayWebhookSecret),
      pack: { credits: this.store.config.packCredits, amount: this.store.config.packPricePaise, currency: "INR" } };
  }
  hooks(orgId: string): ProviderHooks {
    return { before: async (input) => {
      await this.store.assertActive(orgId);
      if (input.profile.model !== this.store.config.providerModel) throw new PolicyExecutionDenied(`This policy uses an unsupported cloud model. Publish a revision using ${this.store.config.providerModel}.`);
      input.provider.endpoint = this.store.config.providerEndpoint;
      const bytes = Buffer.byteLength(JSON.stringify(jevRequest(input)), "utf8");
      const credits = Math.max(1, Math.ceil(bytes / 2000));
      // Byte count is a deliberately conservative input-token bound. Reserve on every
      // attempt, including retries/recovered leases; never release uncertain charges.
      const cost = input.provider.mode === "mock" ? 0 : Math.ceil(bytes * this.store.config.providerPricePerMillion);
      const reference = `${orgId}:${input.id}`;
      await this.meter.update((state) => {
        const month = new Date().toISOString().slice(0, 7);
        if (state.month !== month) { state.month = month; state.reservedMicros = 0; state.attempts = 0; state.reportedMicros = 0; state.reportedInputTokens = 0; state.reportedOutputTokens = 0; state.reportedCalls = 0; }
        const account = state.accounts[orgId] ??= { balance: 0, consumed: 0 };
        const firstAttempt = state.charged[reference] === undefined;
        if (firstAttempt && account.balance < credits) throw new PolicyExecutionDenied("Organization credits exhausted. Add credits before retrying.");
        if (state.reservedMicros + cost > this.store.config.monthlyProviderBudgetMicros) throw new PolicyExecutionDenied("Platform inference budget reached. Contact support.");
        if (firstAttempt) {
          account.balance -= credits; account.consumed += credits; state.charged[reference] = Date.now();
          state.entries.push({ id: randomUUID(), orgId, credits: -credits, kind: "usage", at: Date.now(), reference: input.id });
        }
        state.reservedMicros += cost; state.attempts++;
        // Cover both short classification jobs and evaluations retained for up to 30 days.
        for (const [key, at] of Object.entries(state.charged)) if (at < Date.now() - 31 * 86400_000) delete state.charged[key];
        state.entries = state.entries.filter((e) => e.kind === "grant" || e.at > Date.now() - 30 * 86400_000);
        return state;
      });
    }, after: async (_input, usage) => {
      // Keep provider-reported amounts distinct from conservative admission reservations.
      // Unknown amounts remain unknown; a successful response never refunds a reservation.
      if (!usage) return;
      await this.meter.update((state) => {
        const nonnegative = (value?: number) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
        state.reportedCalls = (state.reportedCalls ?? 0) + 1;
        state.reportedInputTokens = (state.reportedInputTokens ?? 0) + nonnegative(usage.inputTokens);
        state.reportedOutputTokens = (state.reportedOutputTokens ?? 0) + nonnegative(usage.outputTokens);
        state.reportedMicros = (state.reportedMicros ?? 0) + (usage.cost?.currency === "USD" ? Math.ceil(nonnegative(usage.cost.amount) * 1_000_000) : 0);
        return state;
      });
    } };
  }
}
