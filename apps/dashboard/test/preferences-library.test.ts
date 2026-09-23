import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProfile } from '@pyro/contracts';
import { DEFAULT_PREFERENCES, readPreferences } from '../src/lib/preferences.js';
import { filterPresets, readPresets } from '../src/lib/profile-library.js';

test('browser preferences survive serialization and migrate the previous theme', () => {
  assert.equal(readPreferences(null, 'dark').theme, 'dark');
  const selected = { theme: 'system', density: 'compact', reduceMotion: true, liveUpdates: false, decisionToasts: false, timeDisplay: 'absolute' } as const;
  assert.deepEqual(readPreferences(JSON.stringify(selected), 'light'), selected);
  assert.equal(readPreferences('{"theme":"light"}', 'dark').theme, 'light');
});

test('corrupt, outdated or incorrectly typed preferences use safe defaults', () => {
  for (const source of ['{invalid', 'null', '[]', '12', '{"theme":"sepia","density":{},"liveUpdates":"false","decisionToasts":0,"reduceMotion":"yes","timeDisplay":"utc"}']) {
    assert.deepEqual(readPreferences(source), DEFAULT_PREFERENCES);
  }
});

test('the library searches policy contents and filters by enabled model detectors', () => {
  const model = { profile: createDefaultProfile(), yaml: 'model source' };
  const local = { profile: { ...createDefaultProfile(), id: 'local', name: 'Local credentials', description: 'Regex checks for secrets', detectors: createDefaultProfile().detectors.map(d => ({ ...d, enabled: false })) }, yaml: 'local source' };
  assert.deepEqual(filterPresets([model, local], '', 'model'), [model]);
  assert.deepEqual(filterPresets([model, local], '  LOCAL secrets  ', 'local'), [local]);
  assert.deepEqual(filterPresets([model, local], 'exfiltration', 'model'), [model]);
  assert.deepEqual(filterPresets([model, local], 'not-present', 'all'), []);
});

test('library responses apply profile defaults and reject missing YAML', () => {
  const profile = createDefaultProfile();
  const { localRules: _rules, ...legacy } = profile;
  assert.deepEqual(readPresets([{ profile: legacy, yaml: 'source' }])[0]?.profile.localRules, []);
  assert.throws(() => readPresets({}), /Could not read/);
  assert.throws(() => readPresets([{ profile }]), /YAML source/);
});
