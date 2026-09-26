import { build } from 'esbuild';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import YAML from 'yaml';
// Runtime users get a self-contained engine, with no workspace packages,
// compiler, native addon, service or installation lifecycle script required.
await build({ entryPoints: ['src/standalone.ts'], outfile: 'dist/standalone.js', bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: false, banner: { js: "import { createRequire as createStandaloneRequire } from 'node:module'; const require = createStandaloneRequire(import.meta.url);" } });
const profiles = {};
for (const name of await readdir(new URL('../../../profiles/', import.meta.url))) {
  if (!name.endsWith('.yaml')) continue;
  const document = YAML.parse(await readFile(new URL(`../../../profiles/${name}`, import.meta.url), 'utf8'));
  profiles[document.profile.id] = document.profile;
}
await writeFile(new URL('../dist/profiles.json', import.meta.url), JSON.stringify(profiles));
// Preserve full notices for the dependencies embedded in the standalone bundle.
const { createRequire } = await import('node:module');
const { dirname } = await import('node:path');
const { existsSync } = await import('node:fs');
let notices = 'Third-party dependencies bundled into the Pyro standalone CLI\n';
for (const [name, manifest] of [['yaml', '../package.json'], ['zod', '../package.json'], ['re2js', '../../classifiers/package.json']]) {
  const require = createRequire(new URL(manifest, import.meta.url));
  let directory = dirname(require.resolve(name));
  while (!existsSync(`${directory}/package.json`)) directory = dirname(directory);
  const metadata = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
  notices += `\n\n${metadata.name} ${metadata.version}\n\n${await readFile(`${directory}/LICENSE`, 'utf8')}`;
}
await writeFile(new URL('../dist/THIRD_PARTY_NOTICES.txt', import.meta.url), notices);
