import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execSync } from 'node:child_process';

export const DEFAULT_CUSTOM_SCRIPTS = [
  {
    id: 'script-git-status-log',
    name: 'Git Status & Recent Commits',
    description: 'Inspect status and recent commit history in current directory',
    content: `#!/usr/bin/env bash
set -e

if [ -d .git ] || git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "=== Git Status ==="
  git status --short
  echo ""
  echo "=== Recent Commits ==="
  git log --oneline -n 7
else
  echo "Not a git repository."
fi
`,
  },
  {
    id: 'script-disk-usage',
    name: 'Directory Disk Usage',
    description: 'Display top disk space consumers in current folder',
    content: `#!/usr/bin/env bash
echo "=== Top items by disk usage in $(pwd) ==="
if command -v du >/dev/null 2>&1; then
  du -sh * 2>/dev/null | sort -hr | head -n 10
else
  ls -lh
fi
`,
  },
  {
    id: 'script-quick-test',
    name: 'Run Project Tests',
    description: 'Auto-detect package.json, Cargo.toml or Makefile and run test suite',
    content: `#!/usr/bin/env bash
set -e

if [ -f "package.json" ]; then
  echo "Detected package.json. Running npm test..."
  npm test
elif [ -f "Cargo.toml" ]; then
  echo "Detected Cargo.toml. Running cargo test..."
  cargo test
elif [ -f "Makefile" ]; then
  echo "Detected Makefile. Running make test..."
  make test
elif [ -f "go.mod" ]; then
  echo "Detected Go project. Running go test ./..."
  go test ./...
else
  echo "No recognized test runner found in $(pwd)"
fi
`,
  },
  {
    id: 'script-system-info',
    name: 'System & Tool Environment',
    description: 'Show OS info, tool versions, and active paths',
    content: `#!/usr/bin/env bash
echo "=== System Summary ==="
uname -a
echo ""
echo "=== PATH & Developer Tools ==="
for cmd in node npm git cargo rustc python3 go docker; do
  if command -v $cmd >/dev/null 2>&1; then
    printf "%-10s %s (%s)\n" "$cmd" "$($cmd --version 2>&1 | head -n 1)" "$(which $cmd)"
  fi
done
`,
  },
];

export function getCustomScriptsFilePath() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'termi', 'custom_scripts.json');
  }
  const home = os.homedir();
  return path.join(home, '.config', 'termi', 'custom_scripts.json');
}

export async function loadCustomScripts() {
  const filePath = getCustomScriptsFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      await saveCustomScripts(DEFAULT_CUSTOM_SCRIPTS);
      return DEFAULT_CUSTOM_SCRIPTS;
    }
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((item, idx) => ({
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `script-${idx}`,
        name: typeof item.name === 'string' ? item.name.trim() : '',
        content: typeof item.content === 'string' ? item.content : '',
        description: typeof item.description === 'string' ? item.description.trim() : undefined,
      }));
    }
    return DEFAULT_CUSTOM_SCRIPTS;
  } catch (err) {
    console.warn('[termi] Error reading custom scripts file:', err.message);
    return DEFAULT_CUSTOM_SCRIPTS;
  }
}

export async function saveCustomScripts(scripts) {
  const filePath = getCustomScriptsFilePath();
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });

  const valid = (Array.isArray(scripts) ? scripts : []).map((item, idx) => ({
    id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `script-${Date.now()}-${idx}`,
    name: typeof item.name === 'string' ? item.name.trim() : '',
    content: typeof item.content === 'string' ? item.content : '',
    description: typeof item.description === 'string' && item.description.trim() ? item.description.trim() : undefined,
  }));

  const json = JSON.stringify(valid, null, 2);
  const tempPath = path.join(dir, `custom_scripts.tmp.${crypto.randomUUID()}`);
  await fsp.writeFile(tempPath, json, 'utf8');
  await fsp.rename(tempPath, filePath);
  return valid;
}

export function getAugmentedPath() {
  const isWindows = process.platform === 'win32';
  const delimiter = path.delimiter;
  const homeDir = os.homedir();
  const candidateDirs = [];

  if (!isWindows) {
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const shellPath = execSync(`${shell} -l -c 'echo -n "$PATH"'`, {
        encoding: 'utf-8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (shellPath) {
        for (const p of shellPath.split(':')) {
          if (p) candidateDirs.push(p);
        }
      }
    } catch {}

    candidateDirs.push(
      path.join(homeDir, '.bun', 'bin'),
      path.join(homeDir, '.cargo', 'bin'),
      path.join(homeDir, '.local', 'bin'),
      path.join(homeDir, 'Library', 'pnpm'),
      path.join(homeDir, '.pnpm'),
      path.join(homeDir, '.deno', 'bin'),
      path.join(homeDir, '.config', 'yarn', 'global', 'node_modules', '.bin'),
      path.join(homeDir, '.yarn', 'bin'),
      path.join(homeDir, '.fnm', 'current', 'bin'),
      path.join(homeDir, '.volta', 'bin'),
      path.join(homeDir, '.asdf', 'shims'),
      path.join(homeDir, '.asdf', 'bin')
    );

    const nvmVersionsDir = path.join(homeDir, '.nvm', 'versions', 'node');
    try {
      if (fs.existsSync(nvmVersionsDir)) {
        const versions = fs.readdirSync(nvmVersionsDir);
        versions.sort();
        for (let i = versions.length - 1; i >= 0; i--) {
          candidateDirs.push(path.join(nvmVersionsDir, versions[i], 'bin'));
        }
      }
    } catch {}

    candidateDirs.push(
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin'
    );
  } else {
    candidateDirs.push(
      path.join(homeDir, '.bun', 'bin'),
      path.join(homeDir, '.cargo', 'bin'),
      path.join(homeDir, 'AppData', 'Local', 'pnpm'),
      path.join(homeDir, 'AppData', 'Roaming', 'npm'),
      'C:\\Program Files\\Git\\bin',
      'C:\\Program Files\\Git\\usr\\bin',
      'C:\\Program Files\\nodejs'
    );
  }

  const existingPath = process.env.PATH || '';
  if (existingPath) {
    for (const p of existingPath.split(delimiter)) {
      if (p) candidateDirs.push(p);
    }
  }

  const seen = new Set();
  const finalDirs = [];
  for (const dir of candidateDirs) {
    if (!dir) continue;
    const normalized = path.normalize(dir);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (fs.existsSync(normalized)) {
      finalDirs.push(normalized);
    }
  }

  return finalDirs.join(delimiter);
}

export function getAugmentedEnv() {
  return {
    ...process.env,
    PATH: getAugmentedPath(),
  };
}

// ----------------- Execution State & Runner -----------------

const executions = new Map();
const MAX_OUTPUT_LENGTH = 500_000;
const FINISHED_EXECUTION_TTL_MS = 30 * 60 * 1000;

function cleanupFinishedExecutions() {
  const now = Date.now();
  for (const [id, execution] of executions.entries()) {
    if (execution.status === 'running' || execution.status === 'starting') continue;
    if (!execution.finishedAt) continue;
    const finishedAtMs = new Date(execution.finishedAt).getTime();
    if (Number.isNaN(finishedAtMs)) continue;
    if (now - finishedAtMs > FINISHED_EXECUTION_TTL_MS) {
      executions.delete(id);
    }
  }
}

function appendOutput(execution, text) {
  execution.output += text;
  if (execution.output.length > MAX_OUTPUT_LENGTH) {
    execution.output = execution.output.slice(execution.output.length - MAX_OUTPUT_LENGTH);
  }
}

function toResponsePayload(execution) {
  return {
    executionId: execution.id,
    cwd: execution.cwd,
    scriptName: execution.scriptName,
    scriptContent: execution.scriptContent,
    status: execution.status,
    cancelRequested: execution.cancelRequested,
    output: execution.output,
    exitCode: execution.exitCode,
    signal: execution.signal,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
  };
}

function killProcessGroup(child, signal = 'SIGTERM') {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F']);
    } catch {}
  } else {
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {}
    }
  }
}

export function listExecutions() {
  cleanupFinishedExecutions();
  return Array.from(executions.values()).map(toResponsePayload);
}

export function getExecution(executionId) {
  cleanupFinishedExecutions();
  const execution = executions.get(executionId);
  return execution ? toResponsePayload(execution) : null;
}

export function dismissExecution(executionId) {
  const execution = executions.get(executionId);
  if (execution) {
    if (execution.status === 'running' && execution.process) {
      killProcessGroup(execution.process, 'SIGKILL');
      try {
        execution.process.stdout?.destroy();
        execution.process.stderr?.destroy();
      } catch {}
      execution.process = null;
    }
    executions.delete(executionId);
  }
  return true;
}

export function cancelExecution(executionId, force = false) {
  const execution = executions.get(executionId);
  if (!execution) return null;

  if (execution.status === 'running' && execution.process) {
    execution.cancelRequested = true;
    if (force) {
      appendOutput(execution, '\n[info] Force termination requested...\n');
      killProcessGroup(execution.process, 'SIGKILL');
      setTimeout(() => {
        if (execution.status === 'running') {
          if (execution.process) {
            try {
              execution.process.stdout?.destroy();
              execution.process.stderr?.destroy();
            } catch {}
            execution.process = null;
          }
          execution.status = 'canceled';
          execution.finishedAt = new Date().toISOString();
        }
      }, 200);
    } else {
      appendOutput(execution, '\n[info] Terminating process...\n');
      killProcessGroup(execution.process, 'SIGTERM');

      setTimeout(() => {
        if (execution.status === 'running' && execution.process) {
          appendOutput(execution, '\n[info] Process did not terminate after 2s, escalating to SIGKILL...\n');
          killProcessGroup(execution.process, 'SIGKILL');
          setTimeout(() => {
            if (execution.status === 'running') {
              if (execution.process) {
                try {
                  execution.process.stdout?.destroy();
                  execution.process.stderr?.destroy();
                } catch {}
                execution.process = null;
              }
              execution.status = 'canceled';
              execution.finishedAt = new Date().toISOString();
            }
          }, 400);
        }
      }, 2000);
    }
  }

  return toResponsePayload(execution);
}

export function startExecution({ cwd, scriptName, scriptContent }) {
  cleanupFinishedExecutions();

  const targetCwd = cwd || os.homedir();
  if (!fs.existsSync(targetCwd)) {
    throw new Error(`Directory not found: ${targetCwd}`);
  }
  if (!fs.statSync(targetCwd).isDirectory()) {
    throw new Error(`Target path is not a directory: ${targetCwd}`);
  }

  const executionId = crypto.randomUUID();
  const child = spawn('bash', ['-s'], {
    cwd: targetCwd,
    env: getAugmentedEnv(),
    stdio: 'pipe',
    detached: process.platform !== 'win32',
  });

  const execution = {
    id: executionId,
    cwd: targetCwd,
    scriptName: scriptName || 'Custom Script',
    scriptContent: scriptContent || '',
    status: 'running',
    cancelRequested: false,
    output: '',
    exitCode: null,
    signal: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    process: child,
  };

  executions.set(executionId, execution);

  const finishExecution = (code, signal) => {
    if (execution.finishedAt) return;
    execution.exitCode = code;
    execution.signal = signal;
    execution.finishedAt = new Date().toISOString();
    if (execution.cancelRequested) {
      execution.status = 'canceled';
    } else {
      execution.status = code === 0 ? 'completed' : 'failed';
    }
    if (execution.process) {
      try {
        execution.process.stdout?.destroy();
        execution.process.stderr?.destroy();
      } catch {}
      execution.process = null;
    }
  };

  const onData = (chunk) => {
    appendOutput(execution, typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', (error) => {
    appendOutput(execution, `\n[error] ${error.message}\n`);
    execution.status = execution.cancelRequested ? 'canceled' : 'failed';
    execution.finishedAt = new Date().toISOString();
    if (execution.process) {
      try {
        execution.process.stdout?.destroy();
        execution.process.stderr?.destroy();
      } catch {}
      execution.process = null;
    }
  });

  child.on('exit', (code, signal) => {
    finishExecution(code, signal);
  });

  child.on('close', (code, signal) => {
    finishExecution(code, signal);
  });

  child.stdin.write(scriptContent);
  child.stdin.end();

  return toResponsePayload(execution);
}
