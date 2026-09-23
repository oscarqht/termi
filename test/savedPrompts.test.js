import test from 'node:test';
import assert from 'node:assert/strict';

// Mirroring the storage and parsing logic for SavedPrompt
const DEFAULT_SAVED_PROMPTS = [
  {
    id: 'prompt-code-review',
    title: 'Code Review',
    content:
      'Review the recent git changes for potential bugs, security vulnerabilities, edge cases, and performance regressions. Provide prioritized, actionable feedback.',
  },
  {
    id: 'prompt-explain-error',
    title: 'Explain Error',
    content:
      'Analyze the error above in detail: explain why it occurred, identify the root cause, and provide the exact steps or code fix required to resolve it.',
  },
  {
    id: 'prompt-git-summary',
    title: 'Git Diff & Commit Message',
    content:
      'Inspect git status and staged diffs. Summarize the key changes made and propose a clean, conventional commit message with a short description.',
  },
  {
    id: 'prompt-plan-next-steps',
    title: 'Plan Next Steps',
    content:
      'Evaluate our current progress against requirements, list any remaining work or risks, and propose a concise step-by-step plan for what to tackle next.',
  },
];

function parseSavedPrompts(raw) {
  if (!raw) return DEFAULT_SAVED_PROMPTS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SAVED_PROMPTS;
    const valid = parsed
      .map((item, idx) => ({
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `prompt-${idx}`,
        title: typeof item.title === 'string' ? item.title.trim() : '',
        content: typeof item.content === 'string' ? item.content : '',
      }))
      .filter((p) => p.title.length > 0 || p.content.trim().length > 0);
    return valid.length > 0 ? valid : DEFAULT_SAVED_PROMPTS;
  } catch {
    return DEFAULT_SAVED_PROMPTS;
  }
}

test('parseSavedPrompts returns defaults when raw is empty or null', () => {
  assert.equal(parseSavedPrompts(null).length, DEFAULT_SAVED_PROMPTS.length);
  assert.equal(parseSavedPrompts('').length, DEFAULT_SAVED_PROMPTS.length);
  assert.equal(parseSavedPrompts(undefined).length, DEFAULT_SAVED_PROMPTS.length);
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
