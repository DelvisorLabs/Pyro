import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseDocument, stringify } from "yaml";
import { policyHash } from "@pyro/storage";
import { ProfileSchema, type Profile } from "@pyro/contracts";

export function parseProfileYaml(source: string): Profile {
  if (Buffer.byteLength(source) > 256_000) throw new Error("Profile YAML must be at most 256 KB.");
  const document = parseDocument(source, { uniqueKeys: true, customTags: [] });
  if (document.errors.length) throw new Error(document.errors[0]!.message);
  if (document.warnings.length) throw new Error(document.warnings[0]!.message);
  const value = document.toJS({ maxAliasCount: 0 });
  if (!value || value.apiVersion !== "pyro/v1" || value.kind !== "Profile" || !value.profile || typeof value.profile !== "object") {
    throw new Error("Expected apiVersion: pyro/v1, kind: Profile, and a profile object.");
  }
  const now = new Date().toISOString();
  const parsed = ProfileSchema.safeParse({ ...value.profile, createdAt: now, updatedAt: now });
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  if (parsed.data.shadowProfileIds.length) throw new Error("Portable profiles cannot reference shadow profiles. Configure shadows after import.");
  return parsed.data;
}

export function exportProfileYaml(profile: Profile): string {
  const { createdAt: _created, updatedAt: _updated, ...policy } = profile;
  return stringify({ apiVersion: "pyro/v1", kind: "Profile", profile: { ...policy, shadowProfileIds: [], contentHash: policyHash({ ...profile, shadowProfileIds: [] }) } });
}

export async function loadPresetProfiles(): Promise<Array<{ profile: Profile; yaml: string }>> {
  const directory = fileURLToPath(new URL("../../../profiles/", import.meta.url));
  const names = (await readdir(directory)).filter((name) => /\.ya?ml$/.test(name)).sort();
  const presets = await Promise.all(names.map(async (name) => {
    const yaml = await readFile(`${directory}/${name}`, "utf8");
    return { profile: parseProfileYaml(yaml), yaml };
  }));
  if (new Set(presets.map((preset) => preset.profile.id)).size !== presets.length) throw new Error("Preset IDs must be unique.");
  return presets;
}
