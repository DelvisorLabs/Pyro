import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProfile } from '@pyro/contracts';
import { editProfile, profilePayload } from '../src/lib/profile-editor.js';

test('editing an ID and removing an earlier detector preserve the remaining row identity', () => {
  const original = createDefaultProfile();
  const draft = editProfile(original);
  const detector = draft.detectors[1]!;
  const key = detector.editorKey;
  for (const letter of 'custom_detector') {
    draft.detectors[1] = { ...draft.detectors[1]!, id: draft.detectors[1]!.id + letter };
    assert.equal(draft.detectors[1]!.editorKey, key);
  }
  draft.detectors.shift();
  assert.equal(draft.detectors[0]!.editorKey, key);
  assert.equal(new Set(draft.detectors.map(d => d.editorKey)).size, draft.detectors.length);
  const payload = profilePayload(draft);
  assert.ok(payload.detectors.every(d => !('editorKey' in d)));
  assert.equal(original.detectors.length, createDefaultProfile().detectors.length);
  assert.equal(original.detectors[1]?.id, detector.id);
});
