import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const require = createRequire(new URL('../apps/control-plane/package.json', import.meta.url));
const YAML = require('yaml');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(version)) throw new Error('Invalid release version.');
const directory = resolve(`artifacts/pyro-${version}`);
await mkdir(directory, { recursive: true });
const compose = YAML.parse(await readFile('docker-compose.yml', 'utf8'));
const digests = process.env.RELEASE_IMAGE_DIGESTS ? JSON.parse(await readFile(process.env.RELEASE_IMAGE_DIGESTS, 'utf8')) : {};
for (const target of ['gateway', 'control-plane', 'dashboard']) {
  delete compose.services[target].build;
  const digest = digests[target];
  if (digest && !/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid container digest.');
  compose.services[target].image = `ghcr.io/delvisorlabs/pyro-${target}${digest ? '@' + digest : ':' + version}`;
}
await writeFile(`${directory}/compose.yaml`, YAML.stringify(compose));
for (const [from, to] of [['.env.example', '.env.example'], ['LICENSE', 'LICENSE'], ['NOTICE', 'NOTICE'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'], ['CHANGELOG.md', 'CHANGELOG.md'], ['docs/deployment.md', 'DEPLOYMENT.md']]) await copyFile(from, `${directory}/${to}`);
await mkdir(`${directory}/profiles`, { recursive: true });
for (const name of await readdir('profiles')) await copyFile(`profiles/${name}`, `${directory}/profiles/${name}`);
execFileSync('pnpm', ['--filter', '@delvisor/pyro', '--config.ignore-scripts=true', 'pack', '--pack-destination', directory], { stdio: 'inherit' });
const provenance = { version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), images: digests, note: Object.keys(digests).length ? 'Container digests are pinned.' : 'Preparation only. Images must be published before this compose file can be used.' };
await writeFile(`${directory}/release.json`, JSON.stringify(provenance, null, 2) + '\n');
const entries = await readdir(directory, { recursive: true, withFileTypes: true });
const sums = [];
for (const entry of entries) if (entry.isFile() && entry.name !== 'SHA256SUMS') {
  const path = resolve(entry.parentPath ?? entry.path, entry.name);
  const relative = path.slice(directory.length + 1);
  sums.push(`${createHash('sha256').update(await readFile(path)).digest('hex')}  ${relative}`);
}
await writeFile(`${directory}/SHA256SUMS`, sums.sort().join('\n') + '\n');
console.log(`Prepared ${directory}`);
