import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {
  resolveCwd,
  addRecentCwd,
  removeRecentCwd,
  loadRecentCwds,
  getRecentCwdsFilePath,
} from '../server/recentCwds.js';

test('resolveCwd correctly resolves tilde and empty strings', () => {
  assert.equal(resolveCwd(''), '');
  assert.equal(resolveCwd(null), '');
  assert.equal(resolveCwd('~'), path.resolve(os.homedir()));
  assert.equal(resolveCwd('~/Downloads'), path.resolve(path.join(os.homedir(), 'Downloads')));
});

test('addRecentCwd and removeRecentCwd manage entries', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'termi-test-'));
  try {
    const dirA = path.join(tmpDir, 'dirA');
    const dirB = path.join(tmpDir, 'dirB');
    await fsp.mkdir(dirA);
    await fsp.mkdir(dirB);

    const list1 = await addRecentCwd(dirA);
    assert.ok(list1.includes(dirA));

    const list2 = await addRecentCwd(dirB);
    assert.equal(list2[0], dirB);
    assert.ok(list2.includes(dirA));

    const list3 = await removeRecentCwd(dirA);
    assert.ok(!list3.includes(dirA));
    assert.ok(list3.includes(dirB));

    // Clean up dirB from recents
    await removeRecentCwd(dirB);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});
