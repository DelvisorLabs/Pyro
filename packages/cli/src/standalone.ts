import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { evaluatePolicy } from "@pyro/classifiers";
import { ClassificationEnvelopeSchema, ProfileSchema, createDefaultApp, createDefaultProviderSettings, type Profile } from "@pyro/contracts";

type LocalOptions = { profileFile?: string; semantic?: boolean; timeout: number; requestId?: string };
export async function standaloneProfiles(): Promise<string[]> {
  return Object.keys(JSON.parse(await readFile(new URL("./profiles.json", import.meta.url), "utf8")));
}
export async function classifyStandalone(body: string, contentType: string, options: LocalOptions) {
  const raw = contentType === "application/json" ? JSON.parse(body) : body;
  const envelope = ClassificationEnvelopeSchema.parse(raw && typeof raw === "object" && !Array.isArray(raw) && "input" in raw ? raw : { input: raw });
  if (options.profileFile && envelope.profile) throw new Error("Choose --profile or --profile-file, not both.");
  const bundled = JSON.parse(await readFile(new URL("./profiles.json", import.meta.url), "utf8")) as Record<string, object>;
  const name = envelope.profile ?? (options.semantic ? "balanced-assistant" : "local-secrets");
  let input: unknown = bundled[name];
  if (options.profileFile) {
    const file = YAML.parse(await readFile(options.profileFile, "utf8"), { maxAliasCount: 50 });
    if (file?.kind && (file.kind !== "Profile" || file.apiVersion !== "pyro/v1")) throw new Error("Expected a pyro/v1 Profile document.");
    input = file?.profile ?? file;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`Unknown bundled profile '${name}'. Use --profile-file for your own YAML/JSON policy, or --remote for server policies.`);
  const now = new Date().toISOString();
  const profile = ProfileSchema.parse({ ...input, createdAt: now, updatedAt: now });
  if (profile.shadowProfileIds.length) throw new Error("Standalone classification does not run shadow policies. Remove shadowProfileIds or use a server.");
  if ((typeof envelope.input === "string" ? envelope.input : JSON.stringify(envelope.input)).length > profile.maxInputChars) throw new Error(`Input exceeds this profile's ${profile.maxInputChars} character limit.`);
  const semantic = profile.detectors.some((d) => d.enabled);
  if (semantic && !options.semantic) throw new Error("This profile sends inputs to TypeSafe. Pass --semantic to authorize the provider call and its charges, or use the local-secrets profile.");
  if (semantic && !process.env.TYPESAFE_API_KEY) throw new Error("Set TYPESAFE_API_KEY for standalone semantic checks. No Docker or Pyro server is needed.");
  const provider = createDefaultProviderSettings();
  // Deliberately use the official endpoint. Server/provider URL settings cannot
  // silently redirect a standalone prompt or provider credential.
  provider.maxRetries = 0;
  const policyHash = hashProfile(profile);
  const result = await evaluatePolicy({ id: randomUUID(), traceId: randomUUID().replaceAll("-", ""), envelope,
    profile: { ...profile, timeoutMs: Math.min(profile.timeoutMs, options.timeout) }, firewallApp: createDefaultApp(), provider, apiKey: async () => process.env.TYPESAFE_API_KEY });
  return { ...result.decision, labels: envelope.labels, requestId: options.requestId, policyHash, execution: "standalone" };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function hashProfile(profile: Profile): string {
  const { createdAt, updatedAt, revision, contentHash, ...configuration } = profile;
  return createHash("sha256").update(canonical(configuration)).digest("hex");
}
