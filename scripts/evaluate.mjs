import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { ProfileSchema, createDefaultApp, createDefaultProviderSettings } from '../packages/contracts/dist/index.js';
import { evaluatePolicy, evaluationReport } from '../packages/classifiers/dist/index.js';
import { policyHash } from '../packages/storage/dist/index.js';
const require = createRequire(new URL('../apps/control-plane/package.json', import.meta.url));
const YAML = require('yaml');
const { values } = parseArgs({ options: { dataset: { type: 'string', default: 'evaluations/local-smoke.jsonl' }, profile: { type: 'string', default: 'profiles/local-secrets.yaml' }, output: { type: 'string' }, 'allow-paid': { type: 'boolean', default: false }, 'min-accuracy': { type: 'string', default: '1' }, 'max-false-positive-rate': { type: 'string', default: '0' } } });
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const epoch = new Date(0).toISOString();
const profile = ProfileSchema.parse({ ...YAML.parse(await readFile(values.profile, 'utf8')).profile, createdAt: epoch, updatedAt: epoch });
const cases = (await readFile(values.dataset, 'utf8')).split(/\r?\n/).filter((s) => s.trim()).map((s) => JSON.parse(s));
if (!cases.length || cases.length > 500 || new Set(cases.map((c) => c.id)).size !== cases.length || cases.some((c) => !c.id || c.input === undefined || !['allow', 'review', 'block'].includes(c.expected))) throw new Error('Use 1–500 labeled cases with unique IDs.');
const semantic = profile.detectors.some((d) => d.enabled);
if (semantic && (!values['allow-paid'] || !process.env.TYPESAFE_API_KEY)) throw new Error('Semantic evaluation requires --allow-paid and TYPESAFE_API_KEY. Inputs leave this host and provider charges may apply.');
const provider = { ...createDefaultProviderSettings(epoch), maxRetries: 0, ...(process.env.TYPESAFE_ENDPOINT ? { endpoint: process.env.TYPESAFE_ENDPOINT } : {}) };
const application = createDefaultApp(epoch);
const rows = [];
for (const sample of cases) {
  if (JSON.stringify(sample.input).length > profile.maxInputChars) throw new Error(`Case ${sample.id} exceeds the policy input limit.`);
  const { decision } = await evaluatePolicy({ id: sample.id, envelope: { input: sample.input }, profile, traceId: 'evaluation', firewallApp: application, provider, apiKey: async () => process.env.TYPESAFE_API_KEY });
  delete decision.metadata;
  rows.push({ caseId: sample.id, category: sample.category ?? 'general', expected: sample.expected, revision: profile.revision ?? 1, profileId: profile.id, inputHash: hash(sample.input), decision });
}
const report = { generatedAt: new Date().toISOString(), purpose: semantic ? 'Synthetic semantic evaluation; not representative production evidence.' : 'Local rule regression smoke test; not semantic attack-detection evidence.', datasetHash: hash(cases), policyHash: policyHash(profile), provider: semantic ? provider : 'no external calls', modelVersion: semantic ? profile.model : 'local-rules', sampleCount: cases.length, report: evaluationReport(rows), rows };
const encoded = JSON.stringify(report, null, 2) + '\n';
if (values.output) await writeFile(values.output, encoded); else process.stdout.write(encoded);
const stats = Object.values(report.report.policies)[0];
const minimum = Number(values['min-accuracy']), maximum = Number(values['max-false-positive-rate']);
if (![minimum, maximum].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Regression budgets must be between zero and one.');
if (stats.accuracy < minimum || stats.falsePositiveRate === null || stats.falsePositiveRate > maximum || stats.indeterminate > 0) { process.stderr.write('Evaluation regression budget exceeded.\n'); process.exitCode = 1; }
