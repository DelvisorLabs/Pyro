import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { PolicyExecutionDenied } from "@pyro/classifiers";
import type { UserRecord } from "@pyro/contracts";
import { openDatabase, encryptText, type Database, type DocumentStore } from "@pyro/storage";
import type { CloudConfig } from "./config.js";

export type Role = "owner" | "admin" | "operator" | "reviewer" | "viewer";
export interface Account { id: string; email: string; username: string; passwordHash: string; verified: boolean; disabled?: boolean; createdAt: string }
export interface Organization { id: string; name: string; status: "active" | "suspended" | "deleted"; createdAt: string; erasedAt?: string }
export interface Membership { orgId: string; userId: string; role: Role; appIds: string[]; rawPreviews: boolean; disabled?: boolean }
export interface Session { hash: string; userId: string; orgId?: string; expiresAt: number }
export interface Token { hash: string; userId: string; kind: "verify" | "reset"; expiresAt: number }
export interface Invitation { hash: string; orgId: string; email: string; role: Exclude<Role,"owner">; appIds: string[]; rawPreviews: boolean; expiresAt: number }
export interface IdentityState { accounts: Account[]; organizations: Organization[]; memberships: Membership[]; sessions: Session[]; tokens: Token[]; invitations: Invitation[]; migrated: boolean }
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
const derive = promisify(scrypt);
export async function passwordHash(password: string) { const salt = randomBytes(16).toString("hex"); return `${salt}:${(await derive(password, salt, 64) as Buffer).toString("hex")}`; }
export async function verifyPassword(password: string, stored: string) { const [salt, hex] = stored.split(":"); if (!salt || !hex) return false; const result = await derive(password, salt, 64) as Buffer; const expected = Buffer.from(hex, "hex"); return result.length === expected.length && timingSafeEqual(result, expected); }
export class CloudError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
export function projectUser(account: Account, member?: Membership): UserRecord {
  return { id: account.id, username: account.username, createdAt: account.createdAt,
    role: member?.role === "owner" ? "admin" : member?.role ?? "viewer", appIds: member?.appIds ?? [], rawPreviews: member?.rawPreviews ?? false,
    organizationId: member?.orgId, organizationRole: member?.role, cloud: true, disabled: Boolean(account.disabled || member?.disabled) };
}
export class CloudStore {
  readonly identity: DocumentStore<IdentityState>;
  constructor(readonly platform: Database, readonly config: CloudConfig) {
    this.identity = platform.document("cloud_identity", () => ({ accounts: [], organizations: [], memberships: [], sessions: [], tokens: [], invitations: [], migrated: false }));
  }
  async migrateLegacy() {
    if ((await this.identity.read()).migrated) return;
    const legacy = await openDatabase(this.config.databaseUrl);
    try {
      const users = await legacy.document<UserRecord[]>("users", () => []).read();
      const adminHash = this.config.legacyAdminPassword ? await passwordHash(this.config.legacyAdminPassword) : undefined;
      await this.identity.update((state) => {
        if (state.migrated) return state;
        if (users.length) {
          const owner = users.find((u) => u.username === "admin" && !u.disabled) ?? users.find((u) => u.role === "admin" && !u.disabled);
          if (!owner) throw new CloudError(409, "Legacy migration requires an active administrator to become the organization owner.");
          state.organizations.push({ id: "default", name: "Default organization", status: "active", createdAt: new Date().toISOString() });
          for (const user of users) {
            const password = user.passwordHash ?? (user.username === "admin" ? adminHash : undefined);
            // SSO-only legacy identities require a recovery/invitation before cloud password access.
            state.accounts.push({ id: user.id, username: user.username.toLowerCase(), email: user.username.includes("@") ? user.username.toLowerCase() : "", passwordHash: password ?? "", verified: true, disabled: user.disabled, createdAt: user.createdAt });
            state.memberships.push({ orgId: "default", userId: user.id, role: user.id === owner.id ? "owner" : user.role ?? "viewer", appIds: user.appIds ?? [], rawPreviews: user.rawPreviews ?? false, disabled: user.disabled });
          }
        }
        state.migrated = true; return state;
      });
    } finally { await legacy.close(); }
  }
  async resolve(rawToken?: string, selectedOrg?: string) {
    const state = await this.identity.read();
    const session = rawToken && state.sessions.find((s) => s.hash === hash(rawToken) && s.expiresAt > Date.now());
    const account = session && state.accounts.find((a) => a.id === session.userId && a.verified && !a.disabled);
    if (!session || !account) throw new CloudError(401, "Sign in to continue.");
    const orgId = selectedOrg ?? session.orgId;
    const membership = state.memberships.find((m) => m.userId === account.id && m.orgId === orgId && !m.disabled);
    const organization = membership && state.organizations.find((o) => o.id === orgId && o.status === "active");
    if (orgId && (!membership || !organization)) throw new CloudError(403, "Organization access is unavailable.");
    return { account, session, membership, organization, state, user: { ...projectUser(account, membership), cloudModel: this.config.providerModel } };
  }
  async assertActive(orgId: string) {
    if (!(await this.identity.read()).organizations.some((o) => o.id === orgId && o.status === "active")) throw new CloudError(403, "Organization is suspended or deleted.");
  }
  async eventBudget(orgId: string, bytes = 0) {
    // Conservative admission, not filesystem accounting: failed writes are not refunded.
    // This bounds retained event growth even when local rules require no inference credits.
    const month = new Date().toISOString().slice(0, 7);
    const document = this.platform.document("cloud_event_budget", () => ({ month, total: 0, organizations: {} as Record<string, number> }));
    const check = (state: { month: string; total: number; organizations: Record<string, number> }) => {
      if (state.month !== month) { state.month = month; state.total = 0; state.organizations = {}; }
      if (state.total + bytes >= 5_000_000_000 || (state.organizations[orgId] ?? 0) + bytes >= 500_000_000) throw new PolicyExecutionDenied("Cloud event storage allowance reached. Contact support.", 429);
      return state;
    };
    if (!bytes) { check(await document.read()); return; }
    if (bytes > 64_000) throw new PolicyExecutionDenied("Decision record exceeds the cloud size limit. Reduce metadata or application rules.", 413);
    await document.update((state) => { check(state); state.total += bytes; state.organizations[orgId] = (state.organizations[orgId] ?? 0) + bytes; return state; });
  }
  async members(orgId: string) {
    const state = await this.identity.read();
    return state.memberships.filter((m) => m.orgId === orgId).flatMap((m) => { const account = state.accounts.find((a) => a.id === m.userId && !a.disabled); return account ? [projectUser(account, m)] : []; });
  }
  async mail(to: string, subject: string, text: string) {
    if (this.config.emailMode === "outbox") {
      await this.platform.document<Array<{ id: string; createdAt: string; message: import("@pyro/contracts").StoredSecret }>>("email_outbox", () => []).update((rows) => [...rows.slice(-99), { id: randomUUID(), createdAt: new Date().toISOString(), message: encryptText(JSON.stringify({ to, subject, text }), this.config.secret) }]); return;
    }
    // Cap outbound email separately from inference spend, including verification spam.
    await this.platform.document("email_budget", () => ({ day: "", sent: 0 })).update((state) => {
      const day = new Date().toISOString().slice(0, 10); if (state.day !== day) { state.day = day; state.sent = 0; }
      if (state.sent >= 100) throw new CloudError(429, "Email capacity reached. Please try again tomorrow.");
      state.sent++; return state;
    });
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${this.config.emailKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: this.config.emailFrom, to, subject, text }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new CloudError(503, "Email delivery is temporarily unavailable. Please retry.");
  }
}
