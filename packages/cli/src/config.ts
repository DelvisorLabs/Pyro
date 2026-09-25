import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Config = {
  version: 1; gatewayUrl?: string; controlUrl?: string; timeout?: number;
  sessions?: Record<string, { token: string; expiresAt: number }>;
};
export type GlobalOptions = { config?: string; gatewayUrl?: string; controlUrl?: string; timeout?: string; json?: boolean };

export function configPath(options: GlobalOptions): string {
  return options.config ?? process.env.PYRO_CONFIG ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pyro", "config.json");
}

export function normalizeUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Server URL must be an absolute HTTP or HTTPS URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Server URL must use HTTP or HTTPS without credentials, a query or a fragment.");
  }
  return url.href.replace(/\/+$/, "");
}

export async function readConfig(path: string): Promise<Config> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Config;
    if (value?.version !== 1 || (value.sessions && (typeof value.sessions !== "object" || Array.isArray(value.sessions)))) {
      throw new Error("Unsupported config format.");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 };
    throw new Error(`Cannot read CLI config at ${path}.`, { cause: error });
  }
}

export async function writeConfig(path: string, config: Config): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export function settings(options: GlobalOptions, config: Config) {
  const timeout = Number(options.timeout ?? process.env.PYRO_TIMEOUT_MS ?? config.timeout ?? 130_000);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new Error("Timeout must be a positive integer in milliseconds (at most 2147483647).");
  return {
    gateway: normalizeUrl(options.gatewayUrl ?? process.env.PYRO_GATEWAY_URL ?? config.gatewayUrl ?? "http://localhost:8080"),
    control: normalizeUrl(options.controlUrl ?? process.env.PYRO_CONTROL_URL ?? config.controlUrl ?? "http://localhost:8081"),
    timeout,
  };
}
