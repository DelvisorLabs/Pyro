export interface DashboardPreferences {
  theme: "light" | "dark" | "system";
  density: "comfortable" | "compact";
  reduceMotion: boolean;
  liveUpdates: boolean;
  decisionToasts: boolean;
  timeDisplay: "relative" | "absolute";
}

export const PREFERENCES_KEY = "pyro-dashboard-preferences";
export const DEFAULT_PREFERENCES: DashboardPreferences = {
  theme: "light", density: "comfortable", reduceMotion: false,
  liveUpdates: true, decisionToasts: true, timeDisplay: "relative",
};

export function readPreferences(source: string | null, legacyTheme?: string | null): DashboardPreferences {
  let stored: Record<string, unknown> = {};
  try { const value = JSON.parse(source ?? "{}"); if (value && typeof value === "object" && !Array.isArray(value)) stored = value; } catch { /* Invalid browser storage falls back to defaults. */ }
  const theme = stored.theme ?? legacyTheme;
  return {
    theme: theme === "dark" || theme === "system" ? theme : "light",
    density: stored.density === "compact" ? "compact" : "comfortable",
    reduceMotion: stored.reduceMotion === true,
    liveUpdates: typeof stored.liveUpdates === "boolean" ? stored.liveUpdates : true,
    decisionToasts: typeof stored.decisionToasts === "boolean" ? stored.decisionToasts : true,
    timeDisplay: stored.timeDisplay === "absolute" ? "absolute" : "relative",
  };
}
