import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

async function runGit(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), ok: true };
  } catch (err) {
    return {
      stdout: err.stdout ? String(err.stdout).trim() : '',
      stderr: err.stderr ? String(err.stderr).trim() : (err.message || ''),
      ok: false,
      error: err,
    };
  }
}

export function normalizeBranchName(raw) {
  if (typeof raw !== 'string') return '';
  let str = raw.trim();
  // Normalize slashes
  str = str.replace(/[\\/]+/g, '/');
  // Lowercase
  str = str.toLowerCase();
  // Replace invalid characters with '-'
  str = str.replace(/[^a-z0-9/._-]+/g, '-');
  // Collapse multiple dashes and dots
  str = str.replace(/-+/g, '-');
  str = str.replace(/\.+/g, '.');
  // Sanitize each path segment
  str = str
    .split('/')
    .map((seg) => seg.replace(/^[-.]+|[-.]+$/g, ''))
    .filter(Boolean)
    .join('/');
  return str;
}

export async function ensureWorktreesExcluded(repoRoot, commonDir) {
  try {
    const infoDir = path.join(commonDir, 'info');
    const excludeFile = path.join(infoDir, 'exclude');
    await fsp.mkdir(infoDir, { recursive: true });
    let content = '';
    try {
      content = await fsp.readFile(excludeFile, 'utf8');
    } catch {
      content = '';
    }
    const lines = content.split('\n').map((l) => l.trim());
    if (!lines.includes('.worktrees') && !lines.includes('.worktrees/')) {
      const addition = (content && !content.endsWith('\n') ? '\n' : '') + '.worktrees\n';
      await fsp.appendFile(excludeFile, addition, 'utf8');
    }
  } catch (err) {
    console.warn('[termi] Failed to ensure .worktrees in exclude:', err.message);
  }
}

export async function getGitInfo(targetCwd) {
  if (!targetCwd) return { isRepo: false };
  const resolved = path.resolve(targetCwd.replace(/^~/, process.env.HOME ?? ''));

  // 1. Check if git repo
  const insideRes = await runGit(['rev-parse', '--is-inside-work-tree'], resolved);
  if (!insideRes.ok || insideRes.stdout !== 'true') {
    return { isRepo: false };
  }

  // 2. Repo root and git dir
  const topRes = await runGit(['rev-parse', '--show-toplevel'], resolved);
  const repoRoot = topRes.stdout || resolved;

  const commonDirRes = await runGit(['rev-parse', '--git-common-dir'], repoRoot);
  const commonDir = path.resolve(repoRoot, commonDirRes.stdout || '.git');

  // 3. Current branch
  const currentBranchRes = await runGit(['branch', '--show-current'], resolved);
  let currentBranch = currentBranchRes.stdout;
  if (!currentBranch) {
    const abbrevRes = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], resolved);
    currentBranch = abbrevRes.stdout === 'HEAD' ? '' : abbrevRes.stdout;
  }

  // 4. List branches (local heads + remote origin)
  const refsRes = await runGit(
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/origin/'],
    repoRoot
  );

  const branchSet = new Set();
  if (refsRes.ok && refsRes.stdout) {
    for (const line of refsRes.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'origin' || trimmed === 'origin/HEAD') continue;
      // Strip 'origin/' prefix for branch choice list if remote matches local
      const branchName = trimmed.startsWith('origin/') ? trimmed.slice('origin/'.length) : trimmed;
      if (branchName) branchSet.add(branchName);
    }
  }

  // Fallback if branchSet empty: try listing branches
  if (branchSet.size === 0) {
    const listRes = await runGit(['branch', '-a', '--format=%(refname:short)'], repoRoot);
    if (listRes.ok && listRes.stdout) {
      for (const line of listRes.stdout.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) branchSet.add(trimmed.replace(/^origin\//, ''));
      }
    }
  }

  const branches = Array.from(branchSet).sort((a, b) => {
    // Put main / master / current branch first
    if (a === currentBranch) return -1;
    if (b === currentBranch) return 1;
    if (a === 'main') return -1;
    if (b === 'main') return 1;
    if (a === 'master') return -1;
    if (b === 'master') return 1;
    return a.localeCompare(b);
  });

  // 5. List worktrees
  const worktreesRes = await runGit(['worktree', 'list', '--porcelain'], repoRoot);
  const worktrees = [];

  if (worktreesRes.ok && worktreesRes.stdout) {
    const blocks = worktreesRes.stdout.split(/\n\s*\n/);
    for (const block of blocks) {
      if (!block.trim()) continue;
      const lines = block.split('\n');
      let wtPath = '';
      let wtHead = '';
      let wtBranch = '';
      let isBare = false;
      let isDetached = false;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wtPath = line.slice('worktree '.length).trim();
        } else if (line.startsWith('HEAD ')) {
          wtHead = line.slice('HEAD '.length).trim();
        } else if (line.startsWith('branch ')) {
          const ref = line.slice('branch '.length).trim();
          wtBranch = ref.replace(/^refs\/heads\//, '');
        } else if (line.trim() === 'bare') {
          isBare = true;
        } else if (line.trim() === 'detached') {
          isDetached = true;
        }
      }

      if (wtPath && !isBare) {
        const isMain = path.resolve(wtPath) === path.resolve(repoRoot);
        let commitMsg = '';
        if (wtHead) {
          const msgRes = await runGit(['log', '-1', '--format=%s', wtHead], repoRoot);
          if (msgRes.ok) commitMsg = msgRes.stdout;
        }

        worktrees.push({
          path: wtPath,
          head: wtHead ? wtHead.slice(0, 7) : '',
          branch: wtBranch || (isDetached ? `detached (${wtHead.slice(0, 7)})` : ''),
          commitMsg,
          isMain,
          relative: path.relative(repoRoot, wtPath) || '.',
        });
      }
    }
  }

  return {
    isRepo: true,
    repoRoot,
    commonDir,
    currentBranch,
    branches,
    worktrees,
  };
}

export async function createWorktreeSession({ repoRoot, baseBranch, newBranch }) {
  if (!repoRoot) throw new Error('Repository root required');
  if (!baseBranch) throw new Error('Base branch required');

  const normalized = normalizeBranchName(newBranch);
  if (!normalized) {
    throw new Error('Invalid branch name. Must contain alphanumeric characters.');
  }

  // Get common dir and ensure .worktrees is excluded
  const commonDirRes = await runGit(['rev-parse', '--git-common-dir'], repoRoot);
  const commonDir = path.resolve(repoRoot, commonDirRes.stdout || '.git');
  await ensureWorktreesExcluded(repoRoot, commonDir);

  // Check if branch already exists
  const branchExistsRes = await runGit(['rev-parse', '--verify', `refs/heads/${normalized}`], repoRoot);
  if (branchExistsRes.ok) {
    throw new Error(`Branch "${normalized}" already exists. Please choose a different branch name.`);
  }

  // Attempt to fetch latest base branch from remote
  let remoteSyncWarning = null;
  const fetchRes = await runGit(['fetch', 'origin', baseBranch], repoRoot);
  if (!fetchRes.ok) {
    // Try plain fetch origin
    const generalFetch = await runGit(['fetch', 'origin'], repoRoot);
    if (!generalFetch.ok) {
      remoteSyncWarning = `Could not reach remote: ${fetchRes.stderr || 'Using local base branch'}`;
    }
  }

  // Determine start point: origin/<baseBranch> if available, otherwise <baseBranch>
  let startPoint = baseBranch;
  const remoteRefRes = await runGit(['rev-parse', '--verify', `refs/remotes/origin/${baseBranch}`], repoRoot);
  if (remoteRefRes.ok) {
    startPoint = `origin/${baseBranch}`;
  }

  // Worktree path: repoRoot/.worktrees/<slug>
  const folderSlug = normalized.replace(/\//g, '-');
  const worktreesDir = path.join(repoRoot, '.worktrees');
  await fsp.mkdir(worktreesDir, { recursive: true });
  const worktreePath = path.join(worktreesDir, folderSlug);

  // If path already exists, clean up stale worktrees first
  if (fs.existsSync(worktreePath)) {
    await runGit(['worktree', 'prune'], repoRoot);
    if (fs.existsSync(worktreePath)) {
      throw new Error(`Worktree folder "${folderSlug}" already exists at ${worktreePath}`);
    }
  }

  // Add worktree and branch
  const addRes = await runGit(['worktree', 'add', '-b', normalized, worktreePath, startPoint], repoRoot);
  if (!addRes.ok) {
    throw new Error(`Failed to create worktree: ${addRes.stderr || addRes.stdout}`);
  }

  return {
    worktreePath,
    branch: normalized,
    baseBranch,
    remoteSyncWarning,
  };
}

export async function syncExistingWorktree(worktreePath) {
  if (!worktreePath || !fs.existsSync(worktreePath)) {
    return { ok: false, warning: 'Worktree directory not found' };
  }

  const pullRes = await runGit(['pull', '--rebase', '--autostash'], worktreePath);
  if (!pullRes.ok) {
    return {
      ok: false,
      warning: `Auto-sync warning: ${pullRes.stderr || pullRes.stdout || 'Failed to rebase from remote'}`,
    };
  }

  return { ok: true };
}

export async function deleteWorktree({ repoRoot, worktreePath, branch }) {
  if (!repoRoot || !worktreePath) {
    throw new Error('Repository root and worktree path are required');
  }

  const resolvedRoot = path.resolve(repoRoot);
  const resolvedWt = path.resolve(worktreePath);

  if (resolvedWt === resolvedRoot) {
    throw new Error('Cannot delete the main repository worktree.');
  }

  // 1. Remove the worktree
  const removeRes = await runGit(['worktree', 'remove', '--force', resolvedWt], resolvedRoot);
  if (!removeRes.ok && fs.existsSync(resolvedWt)) {
    // If git worktree remove fails, remove folder manually then prune
    try {
      await fsp.rm(resolvedWt, { recursive: true, force: true });
    } catch {}
  }

  await runGit(['worktree', 'prune'], resolvedRoot);

  // 2. Delete the branch if specified and not main/master
  let branchDeleted = false;
  let branchError = null;
  if (branch && branch !== 'main' && branch !== 'master') {
    const branchRes = await runGit(['branch', '-D', branch], resolvedRoot);
    if (branchRes.ok) {
      branchDeleted = true;
    } else {
      branchError = branchRes.stderr;
    }
  }

  const updatedInfo = await getGitInfo(resolvedRoot);
  return {
    ok: true,
    branchDeleted,
    branchError,
    gitInfo: updatedInfo,
  };
}
