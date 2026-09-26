import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "pyro-cli-install-"));
try {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const packed = await exec("pnpm", ["--filter", manifest.name, "--config.ignore-scripts=true", "pack", "--json", "--pack-destination", directory], { cwd: root });
  const { filename, files } = JSON.parse(packed.stdout);
  assert.ok(files.some(file => file.path === "dist/specs.json"));
  assert.ok(!files.some(file => file.path.startsWith("test/") || file.path.startsWith("src/")));
  const pnpmHome = join(directory, "pnpm");
  const bin = join(pnpmHome, "bin");
  await mkdir(bin, { recursive: true });
  const options = { cwd: directory, env: { ...process.env, PNPM_HOME: pnpmHome, PATH: `${bin}${delimiter}${process.env.PATH}` } };
  await exec("pnpm", ["add", "--global", "--ignore-scripts", "--global-dir", join(directory, "global"), "--global-bin-dir", bin, resolve(directory, filename)], options);
  const executable = join(bin, "pyro");
  const { stdout } = await exec(executable, ["--help"], options);
  assert.match(stdout, /Pyro/);
  const version = await exec(executable, ["--version"], options);
  assert.equal(version.stdout.trim(), manifest.version);
  const cleanEnv = { ...options.env };
  for (const key of Object.keys(cleanEnv)) if (key.startsWith("PYRO_") || key === "TYPESAFE_API_KEY") delete cleanEnv[key];
  const localOptions = { ...options, env: { ...cleanEnv, PYRO_CONFIG: join(directory, "fresh-config.json") } };
  for (const [input, action] of [["hello", "allow"], ["-----BEGIN PRIVATE KEY-----", "block"]]) {
    const result = await exec(executable, ["classify", "--local", "--", input], localOptions);
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.action, action); assert.equal(decision.execution, "standalone");
  }
  const doctor = await exec(executable, ["doctor", "--local"], localOptions);
  assert.equal(JSON.parse(doctor.stdout).serverRequired, false);
  const spec = await exec(executable, ["spec", "control"], options);
  assert.equal(JSON.parse(spec.stdout).openapi, "3.1.0");
  console.log("Packed CLI installs globally and classifies outside the repository without Docker or a server.");
} finally { await rm(directory, { recursive: true, force: true }); }
