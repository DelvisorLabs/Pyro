import assert from 'node:assert/strict';
import test from 'node:test';
import { newPipeline, pipelinePayload } from '../src/lib/pipeline-editor.js';
import { filterPresets } from '../src/lib/profile-library.js';

test('editing normalizes lines at the boundary without erasing condition branches or input state', () => {
  const draft = newPipeline('managed-model');
  const word = draft.pipeline!.steps[0]; if (word?.type !== 'text') throw new Error('Missing text fixture');
  word.words = [' idiot', 'stupid ', ''];
  const condition = draft.pipeline!.steps[1]; if (condition?.type !== 'semantic') throw new Error('Missing condition');
  condition.positiveExamples.push('');
  const result = pipelinePayload(draft);
  assert.equal(result.model, 'managed-model');
  assert.deepEqual(result.pipeline!.steps[0].type === 'text' && result.pipeline!.steps[0].words, ['idiot', 'stupid']);
  assert.equal(word.words.length, 3, 'normalization must not mutate editor state');
  assert.equal(result.pipeline!.steps[1].onMatch, 'allow');
  assert.equal(result.pipeline!.onUncertain, 'review');
  condition.yesThreshold = condition.noThreshold;
  assert.throws(() => pipelinePayload(draft), /Yes threshold/);
});
test('policy library counts semantic pipeline conditions and finds named checks', () => {
  const presets = [{ profile: newPipeline(), yaml: 'fixture' }];
  assert.equal(filterPresets(presets, 'company scope', 'model').length, 1);
  assert.equal(filterPresets(presets, '', 'local').length, 0);
});
