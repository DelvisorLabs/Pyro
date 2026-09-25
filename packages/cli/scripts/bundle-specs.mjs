import { readFile, writeFile, chmod } from "node:fs/promises";
import YAML from "yaml";

// Ship the actual API contracts. Runtime installs need neither the monorepo nor a compiler.
const specs = {};
for (const [service, file] of Object.entries({ gateway: "openapi.yaml", control: "control-plane.openapi.yaml" })) {
  specs[service] = YAML.parse(await readFile(new URL(`../../../docs/${file}`, import.meta.url), "utf8"));
}
await writeFile(new URL("../dist/specs.json", import.meta.url), JSON.stringify(specs));
await chmod(new URL("../dist/bin.js", import.meta.url), 0o755);
