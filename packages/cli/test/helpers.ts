import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type RequestListener } from "node:http";
import type { TestContext } from "node:test";

export const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
export async function temporary(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), "pyro-cli-test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
export function invoke(args: string[], options: { config: string; input?: string; env?: NodeJS.ProcessEnv; executable?: string; cwd?: string }) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("PYRO_")) delete env[key];
  const child = spawn(process.execPath, [options.executable ?? bin, "--config", options.config, ...args], {
    env: { ...env, ...options.env }, stdio: ["pipe", "pipe", "pipe"], cwd: options.cwd,
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", value => { stdout += value; });
  child.stderr.on("data", value => { stderr += value; });
  child.stdin.on("error", () => {});
  child.stdin.end(options.input ?? "");
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`CLI did not exit: ${args.join(" ")}`)); }, 15_000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
  });
}
export async function server(t: TestContext, handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  return { server, url: `http://127.0.0.1:${address.port}` };
}
export async function sessionConfig(path: string, controlUrl: string, gatewayUrl = controlUrl) {
  await writeFile(path, JSON.stringify({ version: 1, gatewayUrl, controlUrl, sessions: { [controlUrl]: { token: "test-session", expiresAt: Date.now() + 60_000 } } }));
}
