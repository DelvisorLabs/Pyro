import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProfile, type ClassificationEvent } from '@pyro/contracts';
import { readActivity, readEvent, readProfiles } from '../src/lib/responses.js';

test('profiles from the previous API get local-rule defaults without losing policy settings', () => {
  const { localRules: _rules, ...legacy } = createDefaultProfile();
  const [profile] = readProfiles([{ ...legacy, blockThreshold: .93 }]);
  assert.deepEqual(profile?.localRules, []);
  assert.deepEqual(profile?.detectors, legacy.detectors);
  assert.equal(profile?.blockThreshold, .93);
  assert.equal('localRules' in legacy, false);
});
test('activity supports historical traces with no detector array or label catalog', () => {
  const event = { id: 'historical', labels: { tenant: 'test' } } as unknown as ClassificationEvent;
  const result = readActivity({ events: [event] });
  assert.deepEqual(result.labelKeys, []);
  assert.deepEqual(result.events[0]?.detectors, []);
  assert.deepEqual(result.events[0]?.labels, event.labels);
  assert.equal(result.total, 1);
  assert.deepEqual(readActivity({ events: [], labelKeys: ['', 'tenant'] }).labelKeys, ['tenant']);
});
test('invalid responses become actionable load errors instead of render failures', () => {
  assert.throws(() => readProfiles(undefined), /control plane/);
  assert.throws(() => readProfiles([{}]), /protection profiles/);
  assert.throws(() => readActivity({} as never), /activity/);
  assert.throws(() => readEvent(undefined as never), /request trace/);
});
