export interface GitWorktree {
  path: string;
  head: string;
  branch: string;
  commitMsg: string;
  isMain: boolean;
  relative: string;
}

export interface GitInfo {
  isRepo: boolean;
  repoRoot?: string;
  commonDir?: string;
  currentBranch?: string;
  branches?: string[];
  worktrees?: GitWorktree[];
  error?: string;
}

export function normalizeBranchName(raw: string): string {
  if (!raw) return '';
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

export function filterValidBranches(branches?: (string | null | undefined)[]): string[] {
  return (branches || []).filter(
    (b): b is string =>
      typeof b === 'string' &&
      b.trim() !== '' &&
      b !== 'origin' &&
      b !== 'HEAD' &&
      !b.endsWith('/HEAD') &&
      !b.includes('->')
  );
}

export async function fetchGitInfo(cwd: string): Promise<GitInfo> {
  if (!cwd || !cwd.trim()) return { isRepo: false };
  try {
    const res = await fetch(`/api/git/info?cwd=${encodeURIComponent(cwd.trim())}`);
    if (!res.ok) {
      return { isRepo: false };
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { isRepo: false };
    }
    const data: GitInfo = await res.json();
    if (data && Array.isArray(data.branches)) {
      data.branches = filterValidBranches(data.branches);
    }
    return data;
  } catch (err) {
    return { isRepo: false, error: (err as Error).message };
  }
}

export async function deleteWorktreeApi(params: {
  cwd: string;
  worktreePath: string;
  branch?: string;
}): Promise<{ ok: boolean; error?: string; gitInfo?: GitInfo }> {
  try {
    const res = await fetch('/api/git/worktrees', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error || 'Failed to delete worktree' };
    }
    return { ok: true, gitInfo: data.gitInfo };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
