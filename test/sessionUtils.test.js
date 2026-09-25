import test from 'node:test';
import assert from 'node:assert/strict';

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

function formatPathDisplay(fullPath, defaultDir = '') {
  const norm = normalizePath(fullPath, defaultDir);
  const normDefault = normalizePath(defaultDir);

  const parts = norm.split('/').filter(Boolean);
  const name = parts.length > 0 ? parts[parts.length - 1] : '/';

  let displayPath = norm;
  if (normDefault && (norm === normDefault || norm.startsWith(normDefault + '/'))) {
    displayPath = '~' + norm.slice(normDefault.length);
  }

  return { name, displayPath };
}

function detectSessionGit(session) {
  if (session.git) return session.git;
  if (!session.cwd) return null;
  const wtMatch = session.cwd.match(/^(.*?)[/\\]\.worktrees[/\\]([^/\\]+)/);
  if (wtMatch) {
    return {
      repoRoot: wtMatch[1],
      branch: wtMatch[2],
      isWorktree: true,
    };
  }
  return null;
}

function groupAndSortSessions(sessions, defaultCwd = '') {
  const groupsMap = new Map();

  for (const s of sessions) {
    const git = detectSessionGit(s);
    let groupFullPath = s.cwd || defaultCwd || '/';
    let isRepo = false;

    if (git?.repoRoot) {
      groupFullPath = git.repoRoot;
      isRepo = true;
    }

    const normKey = normalizePath(groupFullPath, defaultCwd);
    let group = groupsMap.get(normKey);
    if (!group) {
      const { name, displayPath } = formatPathDisplay(groupFullPath, defaultCwd);
      group = {
        groupKey: normKey,
        name,
        displayPath,
        fullPath: groupFullPath,
        isRepo,
        maxLastActive: 0,
        sessions: [],
      };
      groupsMap.set(normKey, group);
    } else if (isRepo) {
      group.isRepo = true;
    }

    group.sessions.push(s);
  }

  const result = [];

  for (const group of groupsMap.values()) {
    group.sessions.sort((a, b) => {
      const timeA = a.lastActiveTime ?? a.createdAt ?? 0;
      const timeB = b.lastActiveTime ?? b.createdAt ?? 0;
      return timeB - timeA;
    });

    const topTime = group.sessions[0]
      ? (group.sessions[0].lastActiveTime ?? group.sessions[0].createdAt ?? 0)
      : 0;
    group.maxLastActive = topTime;
    result.push(group);
  }

  result.sort((a, b) => b.maxLastActive - a.maxLastActive);
  return result;
}

function formatRelativeTime(timestamp, now = Date.now()) {
  if (!timestamp || isNaN(timestamp)) return '';
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 10) return 'active just now';
  if (diffSec < 60) return `active ${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `active ${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `active ${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `active ${diffDays}d ago`;
}

test('formatRelativeTime produces human friendly timestamps', () => {
  const now = 1700000000000;
  assert.equal(formatRelativeTime(now - 5000, now), 'active just now');
  assert.equal(formatRelativeTime(now - 45000, now), 'active 45s ago');
  assert.equal(formatRelativeTime(now - 120000, now), 'active 2m ago');
  assert.equal(formatRelativeTime(now - 7200000, now), 'active 2h ago');
  assert.equal(formatRelativeTime(now - 172800000, now), 'active 2d ago');
});

test('groupAndSortSessions groups by directory and sorts by lastActiveTime DESC within group', () => {
  const defaultCwd = '/Users/tangqh';
  const sessions = [
    { id: '1', cwd: '/Users/tangqh/dir-a', lastActiveTime: 1000, createdAt: 1000 },
    { id: '2', cwd: '/Users/tangqh/dir-a', lastActiveTime: 3000, createdAt: 1000 },
    { id: '3', cwd: '/Users/tangqh/dir-b', lastActiveTime: 2000, createdAt: 1000 },
  ];

  const groups = groupAndSortSessions(sessions, defaultCwd);
  assert.equal(groups.length, 2);

  // dir-a has most recent activity (3000 vs 2000), so it should be first
  assert.equal(groups[0].fullPath, '/Users/tangqh/dir-a');
  assert.equal(groups[0].sessions.length, 2);
  assert.equal(groups[0].sessions[0].id, '2'); // 3000
  assert.equal(groups[0].sessions[1].id, '1'); // 1000

  assert.equal(groups[1].fullPath, '/Users/tangqh/dir-b');
  assert.equal(groups[1].sessions.length, 1);
  assert.equal(groups[1].sessions[0].id, '3');
});

test('groupAndSortSessions groups worktrees under parent repo', () => {
  const defaultCwd = '/Users/tangqh';
  const sessions = [
    {
      id: 'main-session',
      cwd: '/Users/tangqh/repo',
      lastActiveTime: 1000,
      createdAt: 1000,
      git: { repoRoot: '/Users/tangqh/repo', branch: 'main' },
    },
    {
      id: 'wt-session',
      cwd: '/Users/tangqh/repo/.worktrees/feat-x',
      lastActiveTime: 5000,
      createdAt: 2000,
      git: { repoRoot: '/Users/tangqh/repo', branch: 'feat-x', isWorktree: true },
    },
    {
      id: 'other-session',
      cwd: '/Users/tangqh/other',
      lastActiveTime: 2000,
      createdAt: 2000,
    },
  ];

  const groups = groupAndSortSessions(sessions, defaultCwd);
  assert.equal(groups.length, 2);

  // repo group should be first because wt-session has lastActiveTime 5000
  assert.equal(groups[0].fullPath, '/Users/tangqh/repo');
  assert.equal(groups[0].sessions.length, 2);
  assert.equal(groups[0].sessions[0].id, 'wt-session');
  assert.equal(groups[0].sessions[1].id, 'main-session');

  assert.equal(groups[1].fullPath, '/Users/tangqh/other');
});
