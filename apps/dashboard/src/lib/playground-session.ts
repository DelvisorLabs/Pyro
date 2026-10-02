import type { Profile, PolicyAction } from "@pyro/contracts";
export interface RegressionCase { id: string; input: unknown; expected: PolicyAction; category: string }
export interface PlaygroundSession { draft?: Profile; isNew: boolean; appId: string; input: string; format: string; cases: RegressionCase[]; dirty: boolean; draftId: string; savedAt?: string }
const sessions = new Map<string, PlaygroundSession>();
export function readPlaygroundSession(scope: string): PlaygroundSession | undefined {
  if (sessions.has(scope)) return sessions.get(scope);
  try { const value = sessionStorage.getItem(`pyro-policy-work:${scope}`); return value ? { ...JSON.parse(value), input: "", format: "text", cases: [] } : undefined; } catch { return undefined; }
}
export function writePlaygroundSession(scope: string, value: PlaygroundSession) {
  sessions.set(scope, value);
  // Policy configuration survives refresh; raw test inputs remain in memory only.
  const { input, format, cases, ...configuration } = value;
  try { sessionStorage.setItem(`pyro-policy-work:${scope}`, JSON.stringify(configuration)); } catch { /* The unload guard still protects unsaved work. */ }
}
export function clearPlaygroundSessions() { sessions.clear(); for (const key of Object.keys(sessionStorage)) if (key.startsWith("pyro-policy-work:")) sessionStorage.removeItem(key); }
