import { normalizePath, formatPathDisplay } from './pathUtils';

export interface SessionInfo {
  id: string;
  cwd: string;
  cmd: string;
  title?: string;
  createdAt: number;
  lastActiveTime?: number;
  connected: boolean;
  dormant?: boolean;
  git?: {
    repoRoot?: string;
    branch?: string;
    isWorktree?: boolean;
  };
}

export interface SessionGroup {
  groupKey: string;
  name: string;
  displayPath: string;
  fullPath: string;
  isRepo: boolean;
  maxLastActive: number;
  sessions: SessionInfo[];
}

export function formatRelativeTime(timestamp?: number, now = Date.now()): string {
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

export function detectSessionGit(session: SessionInfo): { repoRoot?: string; branch?: string; isWorktree?: boolean } | null {
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

export function groupAndSortSessions(sessions: SessionInfo[], defaultCwd = ''): SessionGroup[] {
  const groupsMap = new Map<string, SessionGroup>();

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

  const result: SessionGroup[] = [];

  for (const group of groupsMap.values()) {
    // Sort sessions within each group by lastActiveTime (or createdAt) DESC
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

  // Sort groups by their most recently active session DESC
  result.sort((a, b) => b.maxLastActive - a.maxLastActive);

  return result;
}
