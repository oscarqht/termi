import test from 'node:test';
import assert from 'node:assert/strict';

// Test implementation mirroring slashCommandUtils
function getActiveSlashQuery(text, cursorPos) {
  if (cursorPos <= 0 || cursorPos > text.length) return null;

  const textBeforeCursor = text.slice(0, cursorPos);
  const slashIndex = textBeforeCursor.lastIndexOf('/');
  if (slashIndex === -1) return null;

  if (textBeforeCursor.slice(slashIndex).includes('\n')) return null;

  if (slashIndex > 0) {
    const prevChar = textBeforeCursor[slashIndex - 1];
    if (!/\s/.test(prevChar)) {
      return null;
    }
  }

  const query = textBeforeCursor.slice(slashIndex + 1);
  return {
    slashIndex,
    query,
  };
}

function applySlashPrompt(text, slashIndex, cursorPos, promptContent) {
  const before = text.slice(0, slashIndex);
  const after = text.slice(cursorPos);
  const newText = before + promptContent + after;
  const newCursorPos = before.length + promptContent.length;
  return { newText, newCursorPos };
}

test('getActiveSlashQuery detects single slash at start of text', () => {
  const res = getActiveSlashQuery('/', 1);
  assert.deepEqual(res, { slashIndex: 0, query: '' });
});

test('getActiveSlashQuery detects slash with query at start of line', () => {
  const res = getActiveSlashQuery('/review', 7);
  assert.deepEqual(res, { slashIndex: 0, query: 'review' });
});

test('getActiveSlashQuery supports spaces in query', () => {
  const res = getActiveSlashQuery('/code review', 12);
  assert.deepEqual(res, { slashIndex: 0, query: 'code review' });
});

test('getActiveSlashQuery triggers when preceded by whitespace', () => {
  const text = 'Hello /explain';
  const res = getActiveSlashQuery(text, text.length);
  assert.deepEqual(res, { slashIndex: 6, query: 'explain' });

  const tabText = '\t/explain';
  assert.deepEqual(getActiveSlashQuery(tabText, tabText.length), { slashIndex: 1, query: 'explain' });
});

test('getActiveSlashQuery ignores file paths and URLs', () => {
  // Path: / not preceded by space
  assert.equal(getActiveSlashQuery('foo/bar', 7), null);
  assert.equal(getActiveSlashQuery('https://google.com', 8), null);
  assert.equal(getActiveSlashQuery('/usr/bin/bash', 12), null);
});

test('getActiveSlashQuery ignores completed line on newline', () => {
  const text = '/review\nnext line';
  assert.equal(getActiveSlashQuery(text, text.length), null);
});

test('applySlashPrompt replaces slash and query cleanly with prompt content', () => {
  const original = 'Please check: /rev for me';
  const match = getActiveSlashQuery(original, 18); // right after '/rev'
  assert.ok(match);
  assert.equal(match.slashIndex, 14);
  assert.equal(match.query, 'rev');

  const { newText, newCursorPos } = applySlashPrompt(
    original,
    match.slashIndex,
    18,
    'Review all changes'
  );
  assert.equal(newText, 'Please check: Review all changes for me');
  assert.equal(newCursorPos, 14 + 'Review all changes'.length);
});
