import type { Detector, Profile } from "@pyro/contracts";

export type EditorDetector = Detector & { editorKey: string };
export type EditorProfile = Omit<Profile, "detectors"> & { detectors: EditorDetector[] };

export function editorDetector(detector: Detector): EditorDetector {
  return { ...detector, editorKey: crypto.randomUUID() };
}

export function editProfile(profile: Profile): EditorProfile {
  const copy = structuredClone(profile);
  return { ...copy, detectors: copy.detectors.map(editorDetector) };
}

export function profilePayload(profile: EditorProfile): Profile {
  return { ...profile, detectors: profile.detectors.map(({ editorKey: _key, ...detector }) => detector) };
}
