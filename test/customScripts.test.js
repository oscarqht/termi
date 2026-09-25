import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CUSTOM_SCRIPTS,
  parseCustomScripts,
} from '../src/customScripts.ts';

test('parseCustomScripts returns defaults when raw is empty or null', () => {
  assert.equal(parseCustomScripts(null).length, DEFAULT_CUSTOM_SCRIPTS.length);
  assert.equal(parseCustomScripts('').length, DEFAULT_CUSTOM_SCRIPTS.length);
  assert.equal(parseCustomScripts(undefined).length, DEFAULT_CUSTOM_SCRIPTS.length);
});

test('parseCustomScripts preserves empty array when user deletes all scripts', () => {
  const resultFromString = parseCustomScripts('[]');
  assert.equal(resultFromString.length, 0);
  assert.deepEqual(resultFromString, []);

  const resultFromArray = parseCustomScripts([]);
  assert.equal(resultFromArray.length, 0);
  assert.deepEqual(resultFromArray, []);
});
