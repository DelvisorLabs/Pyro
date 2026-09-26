import { createHash } from "node:crypto";
import { ProfileSchema, type Profile } from "@pyro/contracts";
import type { DocumentStore } from "./index.js";

export interface PolicyRevision {
  revision: number;
  contentHash: string;
  state: "draft" | "published";
  actorId: string;
  createdAt: string;
  profile: Profile;
}
export interface PolicyRecord extends Profile {
  revisions?: PolicyRevision[];
  archived?: boolean;
}
export class PolicyConflict extends Error { readonly statusCode = 409; }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function policyHash(profile: Profile): string {
  const { createdAt, updatedAt, revision, contentHash, ...configuration } = ProfileSchema.parse(profile);
  return createHash("sha256").update(canonical(configuration)).digest("hex");
}
export function revisionOf(record: PolicyRecord, revision?: number): Profile | undefined {
  if (record.archived) return undefined;
  if (revision === undefined) return ProfileSchema.parse(record);
  return record.revisions?.find((item) => item.revision === revision && item.state === "published")?.profile;
}

// Active policy and immutable history live in one locked PostgreSQL document.
// The same transaction both publishes a revision and updates the active pointer.
export class PolicyStore implements DocumentStore<Profile[]> {
  constructor(readonly records: DocumentStore<PolicyRecord[]>) {}
  async initialize(): Promise<void> {
    await this.records.update((records) => records.map((record) => {
      if (record.revisions?.length) return record;
      const profile = ProfileSchema.parse({ ...record, revision: 1, contentHash: policyHash(record) });
      return { ...profile, revisions: [{ revision: 1, contentHash: profile.contentHash!, state: "published", actorId: "migration", createdAt: profile.updatedAt, profile }] };
    }));
  }
  async read(): Promise<Profile[]> { return (await this.records.read()).filter((p) => !p.archived).map((p) => ProfileSchema.parse(p)); }
  async write(profiles: Profile[]): Promise<void> { await this.update(() => profiles); }
  async update(updater: (current: Profile[]) => Profile[] | Promise<Profile[]>, actorId = "system"): Promise<Profile[]> {
    const records = await this.records.update(async (records) => {
      const next = await updater(records.filter((p) => !p.archived).map((p) => ProfileSchema.parse(p)));
      if (new Set(next.map((p) => p.id)).size !== next.length || new Set(next.map((p) => p.name.trim().toLowerCase())).size !== next.length) throw new PolicyConflict("Policy ID or name already exists.");
      const output = records.map((p) => next.some((n) => n.id === p.id) ? p : { ...p, archived: true });
      for (const candidate of next) {
        const index = records.findIndex((p) => p.id === candidate.id);
        const current = records[index];
        if (current?.archived) throw new PolicyConflict("This policy ID is archived. Choose a new ID.");
        const contentHash = policyHash(candidate);
        if (current?.contentHash === contentHash) continue;
        if (current && candidate.revision !== current.revision) throw new PolicyConflict("Policy changed since it was loaded. Reload before saving.");
        const revision = Math.max(0, ...(current?.revisions ?? []).map((r) => r.revision)) + 1;
        const profile = ProfileSchema.parse({ ...candidate, revision, contentHash });
        const record: PolicyRecord = { ...profile, revisions: [...(current?.revisions ?? []), { revision, contentHash, state: "published", actorId, createdAt: profile.updatedAt, profile }] };
        if (index === -1) output.push(record); else output[index] = record;
      }
      return output;
    });
    return records.filter((p) => !p.archived).map((p) => ProfileSchema.parse(p));
  }
  async draft(id: string, input: unknown, expectedRevision: number, actorId: string): Promise<PolicyRevision> {
    let draft!: PolicyRevision;
    await this.records.update((records) => records.map((record) => {
      if (record.id !== id || record.archived) return record;
      if (record.revision !== expectedRevision) throw new PolicyConflict("Policy changed. Reload before saving a draft.");
      const revision = Math.max(...record.revisions!.map((r) => r.revision)) + 1;
      const profile = ProfileSchema.parse({ ...(input as object), id, createdAt: record.createdAt, updatedAt: new Date().toISOString(), revision });
      profile.contentHash = policyHash(profile);
      draft = { revision, contentHash: profile.contentHash, state: "draft", actorId, createdAt: profile.updatedAt, profile };
      return { ...record, revisions: [...record.revisions!, draft] };
    }));
    if (!draft) throw new PolicyConflict("Policy not found.");
    return draft;
  }
}
