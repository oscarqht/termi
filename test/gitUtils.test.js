import test from 'node:test';
import assert from 'node:assert/strict';

function filterValidBranches(branches) {
  return (branches || []).filter(
    (b) =>
      typeof b === 'string' &&
      b.trim() !== '' &&
      b !== 'origin' &&
      b !== 'HEAD' &&
      !b.endsWith('/HEAD') &&
      !b.includes('->')
  );
}

function normalizeBranchName(raw) {
  if (!raw) return '';
  let str = raw.trim();
  str = str.replace(/[\\/]+/g, '/');
  str = str.toLowerCase();
  str = str.replace(/[^a-z0-9/._-]+/g, '-');
  str = str.replace(/-+/g, '-');
  str = str.replace(/\.+/g, '.');
  str = str
    .split('/')
    .map((seg) => seg.replace(/^[-.]+|[-.]+$/g, ''))
    .filter(Boolean)
    .join('/');
  return str;
}

test('filterValidBranches removes "origin", "HEAD", remote HEAD pointers, and empty values', () => {
  const branches = [
    'main',
    'origin',
    'HEAD',
    'origin/HEAD',
    'upstream/HEAD',
    'origin/main -> origin/HEAD',
    'feat/login',
    '',
    null,
    undefined,
  ];

  const filtered = filterValidBranches(branches);
  assert.deepEqual(filtered, ['main', 'feat/login']);
  assert.ok(!filtered.includes('origin'));
  assert.ok(!filtered.includes('HEAD'));
});

test('normalizeBranchName sanitizes branch names correctly', () => {
  assert.equal(normalizeBranchName(''), '');
  assert.equal(normalizeBranchName('   '), '');
  assert.equal(normalizeBranchName('feat/add-login'), 'feat/add-login');
  assert.equal(normalizeBranchName('FEAT//New_Feature#123...'), 'feat/new_feature-123');
});
