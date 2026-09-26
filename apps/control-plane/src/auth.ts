import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { SessionRecord, UserRecord } from "@pyro/contracts";
import type { DocumentStore } from "@pyro/storage";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyAdminPassword(candidate: string, configuredPassword: string): boolean {
  const left = createHash("sha256").update(candidate).digest();
  const right = createHash("sha256").update(configuredPassword).digest();
  return timingSafeEqual(left, right);
}

export async function ensureAdmin(users: DocumentStore<UserRecord[]>): Promise<UserRecord> {
  let admin!: UserRecord;
  await users.update((current) => {
    const existing = current.find((user) => user.username === "admin");
    admin = existing ? { ...existing, role: "admin" } : { id: randomUUID(), username: "admin", role: "admin", createdAt: new Date().toISOString() };
    return existing ? current.map((u) => u.id === admin.id ? admin : u) : [...current, admin];
  });
  return admin;
}

export async function createSession(
  sessions: DocumentStore<SessionRecord[]>,
  userId: string,
): Promise<{ token: string; record: SessionRecord }> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const record: SessionRecord = {
    id: randomUUID(),
    userId,
    tokenHash: sha256(token),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
  };
  await sessions.update((current) => [
    ...current.filter((item) => new Date(item.expiresAt).getTime() > Date.now()),
    record,
  ]);
  return { token, record };
}

export async function sessionUserId(
  sessions: DocumentStore<SessionRecord[]>,
  token: string | undefined,
): Promise<string | undefined> {
  if (!token) return undefined;
  const tokenHash = sha256(token);
  return (await sessions.read()).find(
    (session) => session.tokenHash === tokenHash && new Date(session.expiresAt).getTime() > Date.now(),
  )?.userId;
}
