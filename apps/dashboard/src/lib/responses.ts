import { ProfileSchema, type ClassificationEvent, type Profile } from "@pyro/contracts";

// Apply schema defaults to records from servers that predate profile-local rules.
export function readProfiles(profiles: unknown): Profile[] {
  const parsed = ProfileSchema.array().safeParse(profiles);
  if (!parsed.success) throw new Error("Could not read protection profiles. Check that the control plane is up to date.");
  return parsed.data;
}

export function readActivity(data: { events: ClassificationEvent[]; total?: number; labelKeys?: string[] }) {
  if (!Array.isArray(data.events)) throw new Error("Could not read activity. Check that the control plane is up to date.");
  return {
    events: data.events.map(readEvent),
    total: data.total ?? data.events.length,
    labelKeys: (data.labelKeys ?? []).filter((key) => typeof key === "string" && key.length > 0),
  };
}

export function readEvent(event: ClassificationEvent): ClassificationEvent {
  if (!event || typeof event.id !== "string") throw new Error("Could not read this request trace.");
  return { ...event, detectors: Array.isArray(event.detectors) ? event.detectors : [] };
}
