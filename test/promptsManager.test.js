import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_SAVED_PROMPTS,
  loadSavedPrompts,
  saveSavedPrompts,
  getPromptsFilePath,
} from '../server/promptsManager.js';

test('promptsManager: file persistence and empty array preservation', async (t) => {
  const filePath = getPromptsFilePath();
  let backupContent = null;
  const existed = fs.existsSync(filePath);

  if (existed) {
    backupContent = await fsp.readFile(filePath, 'utf8');
  }

  t.after(async () => {
    // Restore original file
    if (existed && backupContent !== null) {
      await fsp.writeFile(filePath, backupContent, 'utf8');
    }
  });

  // 1. Save empty array (simulates user deleting all prompts)
  await saveSavedPrompts([]);
  const afterEmpty = await loadSavedPrompts();
  assert.equal(afterEmpty.length, 0, 'Should return empty array when all prompts were removed');

  // 2. Save custom prompts
  const customList = [
    { id: 'p1', title: 'Test 1', content: 'Do test 1' },
    { id: 'p2', title: 'Test 2', content: 'Do test 2' },
  ];
  await saveSavedPrompts(customList);
  const afterCustom = await loadSavedPrompts();
  assert.equal(afterCustom.length, 2);
  assert.equal(afterCustom[0].title, 'Test 1');
  assert.equal(afterCustom[1].content, 'Do test 2');

  // 3. Clear all again and verify it stays empty
  await saveSavedPrompts([]);
  const afterClearAgain = await loadSavedPrompts();
  assert.equal(afterClearAgain.length, 0, 'Should stay empty on subsequent load');

  // 4. Save default starter prompts (simulates "Reset to defaults")
  await saveSavedPrompts(DEFAULT_SAVED_PROMPTS);
  const afterReset = await loadSavedPrompts();
  assert.equal(afterReset.length, DEFAULT_SAVED_PROMPTS.length);
  assert.equal(afterReset[0].id, DEFAULT_SAVED_PROMPTS[0].id);
});
