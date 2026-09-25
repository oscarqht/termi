import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SAVED_PROMPTS,
  parseSavedPrompts,
} from '../src/savedPrompts.ts';

test('parseSavedPrompts returns defaults when raw is empty or null', () => {
  assert.equal(parseSavedPrompts(null).length, DEFAULT_SAVED_PROMPTS.length);
  assert.equal(parseSavedPrompts('').length, DEFAULT_SAVED_PROMPTS.length);
  assert.equal(parseSavedPrompts(undefined).length, DEFAULT_SAVED_PROMPTS.length);
});

test('parseSavedPrompts preserves empty array when user deletes all prompts', () => {
  const resultFromString = parseSavedPrompts('[]');
  assert.equal(resultFromString.length, 0);
  assert.deepEqual(resultFromString, []);

  const resultFromArray = parseSavedPrompts([]);
  assert.equal(resultFromArray.length, 0);
  assert.deepEqual(resultFromArray, []);
});

test('parseSavedPrompts handles invalid JSON gracefully', () => {
  assert.equal(parseSavedPrompts('{ invalid json }').length, DEFAULT_SAVED_PROMPTS.length);
  assert.equal(parseSavedPrompts('12345').length, DEFAULT_SAVED_PROMPTS.length);
  assert.equal(parseSavedPrompts('{"title":"test"}').length, DEFAULT_SAVED_PROMPTS.length);
});

test('parseSavedPrompts parses valid array of prompts', () => {
  const custom = [
    { id: 'custom-1', title: 'My Custom Prompt', content: 'Do something cool' },
    { id: 'custom-2', title: 'Another Prompt', content: 'Multi\nline\nprompt' },
  ];
  const parsed = parseSavedPrompts(JSON.stringify(custom));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, 'custom-1');
  assert.equal(parsed[0].title, 'My Custom Prompt');
  assert.equal(parsed[1].content, 'Multi\nline\nprompt');
});

test('parseSavedPrompts filters out empty items and auto-assigns id if missing', () => {
  const mixed = [
    { title: '', content: '' },
    { title: 'Valid Prompt', content: 'Some content' },
    { content: 'Content only without title' },
  ];
  const parsed = parseSavedPrompts(JSON.stringify(mixed));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].title, 'Valid Prompt');
  assert.ok(parsed[0].id.startsWith('prompt-'));
  assert.equal(parsed[1].title, '');
  assert.equal(parsed[1].content, 'Content only without title');
});
