import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "pyro-cli-install-"));
try {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const packed = await exec("npm", ["pack", "-w", manifest.name, "--ignore-scripts", "--json", "--pack-destination", directory], { cwd: root });
  const [{ filename, files }] = JSON.parse(packed.stdout);
  assert.ok(files.some(file => file.path === "dist/specs.json"));
  assert.ok(!files.some(file => file.path.startsWith("test/") || file.path.startsWith("src/")));
  const prefix = join(directory, "install");
  await exec("npm", ["install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", join(directory, filename)], { cwd: directory });
  const executable = join(prefix, "lib", "node_modules", ...manifest.name.split("/"), "dist", "bin.js");
  const { stdout } = await exec(join(prefix, "bin", "pyro"), ["--help"], { cwd: directory });
  assert.match(stdout, /Pyro — classify inputs/);
  const version = await exec(process.execPath, [executable, "--version"], { cwd: directory });
  assert.equal(version.stdout.trim(), manifest.version);
  const spec = await exec(process.execPath, [executable, "spec", "control"], { cwd: directory });
  assert.equal(JSON.parse(spec.stdout).openapi, "3.1.0");
  console.log("Packed CLI installs globally and runs outside the repository.");
} finally { await rm(directory, { recursive: true, force: true }); }
