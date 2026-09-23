import { ProfileSchema, type Profile } from "@pyro/contracts";

export interface ProfilePreset { profile: Profile; yaml: string }
export type PresetFilter = "all" | "model" | "local";

export function readPresets(value: unknown): ProfilePreset[] {
  if (!Array.isArray(value)) throw new Error("Could not read the profile library.");
  return value.map((item) => {
    if (!item || typeof item.yaml !== "string") throw new Error("A library profile is missing its YAML source.");
    return { profile: ProfileSchema.parse(item.profile), yaml: item.yaml };
  });
}

export function filterPresets(presets: ProfilePreset[], search: string, filter: PresetFilter): ProfilePreset[] {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return presets.filter(({ profile }) => {
    const usesModel = profile.detectors.some((detector) => detector.enabled);
    if (filter === "model" && !usesModel || filter === "local" && usesModel) return false;
    const text = [profile.name, profile.description, ...profile.detectors.flatMap((d) => [d.name, d.description]), ...profile.localRules.flatMap((r) => [r.name, r.description, r.match])].join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
