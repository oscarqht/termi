import test from 'node:test';
import assert from 'node:assert/strict';

// Simple JS mirror or transpile check
function normalizePath(p, defaultDir = '') {
  const normDefault = (defaultDir || '').trim().replace(/\/+$/, '');
  let s = (p || '').trim();
  if (!s) s = normDefault;
  if (normDefault && (s === '~' || s.startsWith('~/') || s.startsWith('~\\'))) {
    s = normDefault + s.slice(1);
  }
  s = s.replace(/\\/g, '/');
  s = s.replace(/\/+/g, '/');
  if (s.length > 1 && s.endsWith('/')) {
    s = s.replace(/\/+$/, '');
  }
  return s;
}

function isSameCwd(a, b, defaultDir = '') {
  const normA = normalizePath(a, defaultDir);
  const normB = normalizePath(b, defaultDir);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  return normA.toLowerCase() === normB.toLowerCase();
}

test('normalizePath handles various formats', () => {
  assert.equal(normalizePath('/Users/alice/repo', '/Users/alice'), '/Users/alice/repo');
  assert.equal(normalizePath('/Users/alice/repo/', '/Users/alice'), '/Users/alice/repo');
  assert.equal(normalizePath('~/repo', '/Users/alice'), '/Users/alice/repo');
  assert.equal(normalizePath('~/repo/', '/Users/alice'), '/Users/alice/repo');
  assert.equal(normalizePath('', '/Users/alice'), '/Users/alice');
  assert.equal(normalizePath('~', '/Users/alice'), '/Users/alice');
  assert.equal(normalizePath('/', '/Users/alice'), '/');
  assert.equal(normalizePath('///a//b///', '/Users/alice'), '/a/b');
});

test('isSameCwd accurately matches equivalent working directories', () => {
  const defaultDir = '/Users/tangqh';

  // Exact match
  assert.ok(isSameCwd('/Users/tangqh/projects/termi', '/Users/tangqh/projects/termi', defaultDir));

  // Trailing slashes
  assert.ok(isSameCwd('/Users/tangqh/projects/termi/', '/Users/tangqh/projects/termi', defaultDir));
  assert.ok(isSameCwd('/Users/tangqh/projects/termi', '/Users/tangqh/projects/termi/', defaultDir));

  // Tilde expansion
  assert.ok(isSameCwd('~/projects/termi', '/Users/tangqh/projects/termi', defaultDir));
  assert.ok(isSameCwd('/Users/tangqh/projects/termi', '~/projects/termi', defaultDir));

  // Empty cwd matching defaultDir
  assert.ok(isSameCwd('', '/Users/tangqh', defaultDir));
  assert.ok(isSameCwd('~', '/Users/tangqh', defaultDir));
  assert.ok(isSameCwd('', '~', defaultDir));

  // Case insensitivity
  assert.ok(isSameCwd('/users/tangqh/projects/termi', '/Users/tangqh/projects/termi', defaultDir));

  // Different paths
  assert.ok(!isSameCwd('/Users/tangqh/projects/termi', '/Users/tangqh/projects/other', defaultDir));
  assert.ok(!isSameCwd('/Users/tangqh/projects/termi', '', defaultDir));
});
