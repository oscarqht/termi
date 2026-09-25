import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {
  DEFAULT_CUSTOM_SCRIPTS,
  loadCustomScripts,
  saveCustomScripts,
  getCustomScriptsFilePath,
  startExecution,
  getExecution,
  listExecutions,
  cancelExecution,
  dismissExecution,
} from '../server/customScriptsManager.js';
import {
  DEFAULT_CUSTOM_SCRIPTS as CLIENT_DEFAULT_SCRIPTS,
  parseCustomScripts,
} from '../src/customScripts.ts';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termi-unit-test-'));
process.env.TERMI_CONFIG_DIR = tempConfigDir;

test('customScriptsManager: DEFAULT_CUSTOM_SCRIPTS contains expected entries', () => {
  assert.ok(Array.isArray(DEFAULT_CUSTOM_SCRIPTS));
  assert.ok(DEFAULT_CUSTOM_SCRIPTS.length >= 3);
  const gitScript = DEFAULT_CUSTOM_SCRIPTS.find((s) => s.id === 'script-git-status-log');
  assert.ok(gitScript);
  assert.equal(gitScript.name, 'Git Status & Recent Commits');
});

test('parseCustomScripts returns defaults when raw is empty or null', () => {
  assert.equal(parseCustomScripts(null).length, CLIENT_DEFAULT_SCRIPTS.length);
  assert.equal(parseCustomScripts('').length, CLIENT_DEFAULT_SCRIPTS.length);
  assert.equal(parseCustomScripts(undefined).length, CLIENT_DEFAULT_SCRIPTS.length);
});

test('parseCustomScripts preserves empty array when user deletes all scripts', () => {
  const resultFromString = parseCustomScripts('[]');
  assert.equal(resultFromString.length, 0);
  assert.deepEqual(resultFromString, []);

  const resultFromArray = parseCustomScripts([]);
  assert.equal(resultFromArray.length, 0);
  assert.deepEqual(resultFromArray, []);
});

test('customScriptsManager: file persistence and empty array preservation', async (t) => {
  const filePath = getCustomScriptsFilePath();
  let backupContent = null;
  const existed = fs.existsSync(filePath);

  if (existed) {
    backupContent = await fsp.readFile(filePath, 'utf8');
  }

  t.after(async () => {
    if (existed && backupContent !== null) {
      await fsp.writeFile(filePath, backupContent, 'utf8');
    }
  });

  // 1. Save empty array (simulates user deleting all scripts)
  await saveCustomScripts([]);
  const afterEmpty = await loadCustomScripts();
  assert.equal(afterEmpty.length, 0, 'Should return empty array when all scripts were removed');

  // 2. Save custom scripts
  const customList = [
    { id: 's1', name: 'Script 1', content: 'echo 1' },
    { id: 's2', name: 'Script 2', content: 'echo 2' },
  ];
  await saveCustomScripts(customList);
  const afterCustom = await loadCustomScripts();
  assert.equal(afterCustom.length, 2);
  assert.equal(afterCustom[0].name, 'Script 1');
  assert.equal(afterCustom[1].content, 'echo 2');

  // 3. Clear all again and verify it stays empty
  await saveCustomScripts([]);
  const afterClearAgain = await loadCustomScripts();
  assert.equal(afterClearAgain.length, 0, 'Should stay empty on subsequent load');

  // 4. Save defaults (simulates Reset to defaults)
  await saveCustomScripts(DEFAULT_CUSTOM_SCRIPTS);
  const afterReset = await loadCustomScripts();
  assert.equal(afterReset.length, DEFAULT_CUSTOM_SCRIPTS.length);
});

test('customScriptsManager: load and save custom scripts', async () => {
  const initial = await loadCustomScripts();
  assert.ok(Array.isArray(initial));

  const testScript = {
    id: `test-script-${Date.now()}`,
    name: 'Echo Test',
    content: 'echo "hello from test"',
    description: 'Unit test script',
  };

  const saved = await saveCustomScripts([testScript, ...initial]);
  assert.ok(saved.some((s) => s.id === testScript.id));

  const reloaded = await loadCustomScripts();
  assert.ok(reloaded.some((s) => s.id === testScript.id));

  // Clean up
  await saveCustomScripts(initial);
});

test('customScriptsManager: execute script and read output', async () => {
  const cwd = os.tmpdir();
  const scriptContent = 'echo "CUSTOM_SCRIPT_RUNNER_OK"';
  const execItem = startExecution({
    cwd,
    scriptName: 'Echo Test',
    scriptContent,
  });

  assert.ok(execItem.executionId);
  assert.equal(execItem.scriptName, 'Echo Test');
  assert.equal(execItem.cwd, cwd);

  // Poll for completion
  let finished = false;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const current = getExecution(execItem.executionId);
    assert.ok(current);
    if (current.status === 'completed' || current.status === 'failed') {
      finished = true;
      assert.equal(current.status, 'completed');
      assert.ok(current.output.includes('CUSTOM_SCRIPT_RUNNER_OK'));
      assert.equal(current.exitCode, 0);
      break;
    }
  }

  assert.ok(finished, 'Execution did not complete within timeout');
  dismissExecution(execItem.executionId);
  assert.equal(getExecution(execItem.executionId), null);
});

test('customScriptsManager: cancel running script', async () => {
  const cwd = os.tmpdir();
  const scriptContent = 'sleep 10';
  const execItem = startExecution({
    cwd,
    scriptName: 'Long Sleep',
    scriptContent,
  });

  assert.ok(execItem.executionId);
  const canceled = cancelExecution(execItem.executionId, true);
  assert.ok(canceled);
  assert.equal(canceled.cancelRequested, true);

  await new Promise((r) => setTimeout(r, 300));
  const current = getExecution(execItem.executionId);
  assert.ok(current);
  assert.ok(current.status === 'canceled' || current.status === 'failed');

  dismissExecution(execItem.executionId);
});

test('customScriptsManager: backup creation and automatic recovery on file loss', async () => {
  const filePath = getCustomScriptsFilePath();
  const bakPath = filePath + '.bak';

  const testList = [
    { id: 'persist-1', name: 'Persist 1', content: 'echo "p1"' },
  ];
  await saveCustomScripts(testList);

  assert.ok(fs.existsSync(filePath), 'custom_scripts.json should exist');
  assert.ok(fs.existsSync(bakPath), 'custom_scripts.json.bak should exist');

  // Simulate accidental file removal or corruption
  await fsp.unlink(filePath);
  assert.ok(!fs.existsSync(filePath));

  // Loading should recover from backup
  const recovered = await loadCustomScripts();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].name, 'Persist 1');
  assert.ok(fs.existsSync(filePath), 'custom_scripts.json should be restored from backup');
});

