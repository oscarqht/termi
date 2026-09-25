import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {
  DEFAULT_CUSTOM_SCRIPTS,
  loadCustomScripts,
  saveCustomScripts,
  startExecution,
  getExecution,
  listExecutions,
  cancelExecution,
  dismissExecution,
} from '../server/customScriptsManager.js';

test('customScriptsManager: DEFAULT_CUSTOM_SCRIPTS contains expected entries', () => {
  assert.ok(Array.isArray(DEFAULT_CUSTOM_SCRIPTS));
  assert.ok(DEFAULT_CUSTOM_SCRIPTS.length >= 3);
  const gitScript = DEFAULT_CUSTOM_SCRIPTS.find((s) => s.id === 'script-git-status-log');
  assert.ok(gitScript);
  assert.equal(gitScript.name, 'Git Status & Recent Commits');
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
