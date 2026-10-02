import { z } from "zod";
import type { CloudStore } from "./store.js";
import { CloudError } from "./store.js";

const positive = (max: number) => z.number().int().min(1).max(max);
export const PlanSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,49}$/), name: z.string().trim().min(1).max(100),
  concurrency: positive(64).default(2), queueDepth: positive(10000).default(20),
  durableQueueDepth: positive(10000).default(20),
  playgroundConcurrency: positive(32).default(2), playgroundRequestsPerMinute: positive(10000).default(30),
  evaluationConcurrency: positive(16).default(1), evaluationQueueDepth: positive(1000).default(20),
  requestsPerMinute: positive(100000).default(120), monthlyRequests: positive(100000000).default(100000),
  monthlyCredits: z.number().int().min(0).max(10000000).default(0),
  monthlyCreditLimit: z.number().int().min(0).max(100000000).default(1000000),
  eventStorageBytes: positive(5000000000).default(500000000),
}).strict().refine(p => p.monthlyCredits <= p.monthlyCreditLimit, "Included monthly credits cannot exceed the monthly credit limit.");
export type Plan = z.infer<typeof PlanSchema>;
export const defaultPlan = () => PlanSchema.parse({ id: "beta", name: "Beta" });
interface PlansState { plans: Plan[]; assignments: Record<string, string> }
export class Plans {
  readonly document;
  constructor(readonly store: CloudStore) { this.document = store.platform.document<PlansState>("cloud_plans", () => ({ plans: [defaultPlan()], assignments: {} })); }
  async effective(orgId: string) {
    const state = await this.document.read();
    const id = state.assignments[orgId] ?? "beta";
    const plan = state.plans.find(p => p.id === id);
    if (!plan) throw new CloudError(503, "Organization plan is unavailable. Contact support.");
    return PlanSchema.parse(plan);
  }
  async save(value: unknown) {
    const plan = PlanSchema.parse(value);
    await this.document.update(s => ({ ...s, plans: [...s.plans.filter(p => p.id !== plan.id), plan] }));
    return plan;
  }
  async assign(orgId: string, planId: string) {
    await this.store.assertActive(orgId);
    await this.document.update(s => { if (!s.plans.some(p => p.id === planId)) throw new CloudError(404, "Plan not found."); s.assignments[orgId] = planId; return s; });
  }
  async admitRequest(orgId: string) {
    const plan = await this.effective(orgId), month = new Date().toISOString().slice(0, 7);
    await this.store.platform.document("cloud_request_usage", () => ({ month, organizations: {} as Record<string, number> })).update(s => {
      if (s.month !== month) { s.month = month; s.organizations = {}; }
      const used = s.organizations[orgId] ?? 0;
      if (used >= plan.monthlyRequests) throw new CloudError(429, "Monthly request allowance reached. Contact your organization owner.");
      s.organizations[orgId] = used + 1; return s;
    });
  }
}
