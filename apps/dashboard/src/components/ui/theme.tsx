import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, readPreferences, type DashboardPreferences } from "@/lib/preferences";

const PreferencesContext = createContext<{
  preferences: DashboardPreferences;
  updatePreferences: (changes: Partial<DashboardPreferences>) => void;
  resetPreferences: () => void;
}>({ preferences: DEFAULT_PREFERENCES, updatePreferences: () => {}, resetPreferences: () => {} });

export const useDashboardPreferences = () => useContext(PreferencesContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(() => {
    try { return readPreferences(localStorage.getItem(PREFERENCES_KEY), localStorage.getItem("pyro-theme")); }
    catch { return DEFAULT_PREFERENCES; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const theme = preferences.theme === "system" ? systemDark ? "dark" : "light" : preferences.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = preferences.density;
    document.documentElement.dataset.motion = preferences.reduceMotion ? "reduce" : "system";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#050505" : "#fafafa");
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); localStorage.setItem("pyro-theme", preferences.theme); } catch { /* Preferences remain usable without storage. */ }
  }, [preferences, systemDark]);
  return <PreferencesContext.Provider value={{ preferences, updatePreferences: (changes) => setPreferences((current) => ({ ...current, ...changes })), resetPreferences: () => setPreferences({ ...DEFAULT_PREFERENCES }) }}>{children}</PreferencesContext.Provider>;
}
