import { useEffect, useState, useMemo } from 'react';
import {
  type CommonCmd,
  DEFAULT_COMMON_CMDS,
  loadCommonCmds,
  saveCommonCmds,
} from '../commonCmds';
import { CopyableCode } from '../components/CopyableCode';
import {
  type SavedPrompt,
  loadSavedPrompts,
  fetchSavedPrompts,
  saveSavedPrompts,
  subscribeSavedPrompts,
} from '../savedPrompts';
import { SavedPromptsModal } from '../components/SavedPromptsModal';
import { CustomScriptsModal } from '../components/CustomScriptsModal';
import {
  type CustomScript,
  loadCustomScripts,
  fetchCustomScripts,
  subscribeCustomScripts,
} from '../customScripts';
import { useCustomScriptExecution } from '../contexts/CustomScriptExecutionContext';
import HeaderUpdater from '../components/HeaderUpdater';
import { abbreviatePath, formatPathDisplay, isSameCwd } from '../pathUtils';
import { Card, Button, Badge, Header } from '../components/ui';
import {
  type GitInfo,
  type GitWorktree,
  fetchGitInfo,
  deleteWorktreeApi,
  normalizeBranchName,
  filterValidBranches,
} from '../gitUtils';
import {
  type SessionInfo,
  groupAndSortSessions,
  formatRelativeTime,
  detectSessionGit,
} from '../sessionUtils';

export type { SessionInfo };

const RECENT_CMDS_KEY = 'termi:recentCmds';
const MAX_RECENT = 10;

function loadRecent(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function rememberRecent(key: string, value: string, current: string[]): string[] {
  const trimmed = value.trim();
  if (!trimmed) return current;
  const next = [trimmed, ...current.filter((v) => v !== trimmed)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // ignore storage errors (e.g. private browsing quota)
  }
  return next;
}

export default function Home() {
  const [cwd, setCwd] = useState('');
  const [defaultCwd, setDefaultCwd] = useState('');
  const [cmds, setCmds] = useState(['']);
  const [commonCmds, setCommonCmds] = useState<CommonCmd[]>(() => loadCommonCmds());
  const [newCmd, setNewCmd] = useState('');
  const [newExplanation, setNewExplanation] = useState('');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [copied, setCopied] = useState(false);
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [recentCmds, setRecentCmds] = useState<string[]>([]);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(() => loadSavedPrompts());
  const [customScripts, setCustomScripts] = useState<CustomScript[]>(() => loadCustomScripts());
  const { startScript } = useCustomScriptExecution();
  const [savedPromptsModalOpen, setSavedPromptsModalOpen] = useState(false);
  const [customScriptsModalOpen, setCustomScriptsModalOpen] = useState(false);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [newPromptTitle, setNewPromptTitle] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');
  const [activeTab, setActiveTab] = useState<'sessions' | 'prompts' | 'scripts'>('sessions');

  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitMode, setGitMode] = useState<'none' | 'branch' | 'worktree'>('none');
  const [baseBranch, setBaseBranch] = useState('');
  const [newBranchInput, setNewBranchInput] = useState('');
  const [selectedWorktreePath, setSelectedWorktreePath] = useState('');
  const [deleteWorktreeTarget, setDeleteWorktreeTarget] = useState<GitWorktree | null>(null);
  const [deletingWorktree, setDeletingWorktree] = useState(false);

  useEffect(() => {
    if (!cwd.trim()) {
      setGitInfo(null);
      return;
    }
    let active = true;
    setGitLoading(true);
    const timer = setTimeout(() => {
      fetchGitInfo(cwd).then((info) => {
        if (!active) return;
        setGitInfo(info);
        setGitLoading(false);
        if (info.isRepo) {
          const validBranches = filterValidBranches(info.branches);
          if (info.currentBranch && validBranches.includes(info.currentBranch)) {
            setBaseBranch(info.currentBranch);
          } else if (validBranches.length > 0) {
            setBaseBranch(validBranches[0]);
          }
          const secondary = (info.worktrees || []).filter((w) => !w.isMain);
          if (secondary.length > 0 && !selectedWorktreePath) {
            setSelectedWorktreePath(secondary[0].path);
          }
        } else {
          setGitMode('none');
        }
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [cwd]);

  const secondaryWorktrees = (gitInfo?.worktrees || []).filter((w) => !w.isMain);
  const normalizedBranchPreview = normalizeBranchName(newBranchInput);
  const isBranchNameMissing = gitMode === 'branch' && !normalizedBranchPreview;

  const sessionGroups = useMemo(() => {
    return groupAndSortSessions(sessions, defaultCwd);
  }, [sessions, defaultCwd]);

  function addSavedPromptFromHome() {
    const titleTrim = newPromptTitle.trim();
    const contentTrim = newPromptContent.trim();
    if (!titleTrim && !contentTrim) return;

    const newPrompt: SavedPrompt = {
      id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: titleTrim || 'Untitled Prompt',
      content: newPromptContent,
    };

    setSavedPrompts((prev) => {
      const next = [newPrompt, ...prev];
      saveSavedPrompts(next);
      return next;
    });
    setNewPromptTitle('');
    setNewPromptContent('');
  }

  function removeSavedPromptFromHome(id: string) {
    setSavedPrompts((prev) => {
      const next = prev.filter((p) => p.id !== id);
      saveSavedPrompts(next);
      return next;
    });
  }

  async function copySavedPromptFromHome(id: string, content: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = content;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedPromptId(id);
      setTimeout(() => setCopiedPromptId(null), 1500);
    } catch {}
  }

  useEffect(() => {
    document.title = 'termi';
    setRecentCmds(loadRecent(RECENT_CMDS_KEY));

    fetch('/api/recent-cwds')
      .then((r) => r.json())
      .then((data) => {
        if (data?.defaultCwd) setDefaultCwd(data.defaultCwd);
        if (Array.isArray(data?.cwds) && data.cwds.length > 0) {
          setRecentCwds(data.cwds);
          setCwd(data.cwds[0]);
        } else if (data?.defaultCwd) {
          setCwd(data.defaultCwd);
        }
      })
      .catch(() => {
        fetch('/api/default-cwd')
          .then((r) => r.json())
          .then((d) => {
            if (d?.cwd) {
              setDefaultCwd(d.cwd);
              setCwd(d.cwd);
            }
          })
          .catch(() => {});
      });

    fetchSavedPrompts().then(setSavedPrompts);
    const unsubPrompts = subscribeSavedPrompts(setSavedPrompts);
    fetchCustomScripts().then(setCustomScripts);
    const unsubCustomScripts = subscribeCustomScripts(setCustomScripts);
    return () => {
      unsubPrompts();
      unsubCustomScripts();
    };
  }, []);

  function updateCmd(index: number, value: string) {
    setCmds((prev) => prev.map((c, i) => (i === index ? value : c)));
  }

  function addCmd() {
    setCmds((prev) => [...prev, '']);
  }

  function removeCmd(index: number) {
    setCmds((prev) => prev.filter((_, i) => i !== index));
  }

  useEffect(() => {
    const refresh = () => {
      fetch('/api/sessions')
        .then((r) => r.json())
        .then(setSessions)
        .catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, 3000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', refresh);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  function toggleCommonCmd(id: string) {
    setCommonCmds((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c));
      saveCommonCmds(next);
      return next;
    });
  }

  function removeCommonCmd(id: string) {
    setCommonCmds((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveCommonCmds(next);
      return next;
    });
  }

  function addCommonCmd() {
    const trimmedCmd = newCmd.trim();
    if (!trimmedCmd) return;
    const newEntry: CommonCmd = {
      id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      cmd: trimmedCmd,
      explanation: newExplanation.trim(),
      enabled: true,
    };
    setCommonCmds((prev) => {
      const next = [...prev, newEntry];
      saveCommonCmds(next);
      return next;
    });
    setNewCmd('');
    setNewExplanation('');
  }

  function resetCommonCmds() {
    setCommonCmds(DEFAULT_COMMON_CMDS);
    saveCommonCmds(DEFAULT_COMMON_CMDS);
  }

  function termUrl(opts?: {
    overrideCwd?: string;
    overrideCmd?: string;
    baseBranch?: string;
    newBranch?: string;
    existingWorktree?: string;
  }) {
    const params = new URLSearchParams();
    const effectiveCwd = opts?.overrideCwd !== undefined ? opts.overrideCwd : cwd;
    if (effectiveCwd.trim()) params.set('cwd', effectiveCwd.trim());

    if (opts?.existingWorktree) {
      params.set('existingWorktree', opts.existingWorktree);
    } else if (opts?.baseBranch && opts?.newBranch) {
      params.set('baseBranch', opts.baseBranch);
      params.set('newBranch', opts.newBranch);
    } else if (gitMode === 'branch') {
      const normalized = normalizeBranchName(newBranchInput);
      if (baseBranch && normalized) {
        params.set('baseBranch', baseBranch);
        params.set('newBranch', normalized);
      }
    } else if (gitMode === 'worktree') {
      if (selectedWorktreePath) {
        params.set('existingWorktree', selectedWorktreePath);
      }
    }

    const seen = new Set<string>();
    if (opts?.overrideCmd !== undefined) {
      if (opts.overrideCmd.trim()) params.append('cmd', opts.overrideCmd.trim());
    } else {
      for (const cmd of cmds) {
        const trimmed = cmd.trim();
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          params.append('cmd', trimmed);
        }
      }
      for (const item of commonCmds) {
        const trimmed = item.cmd.trim();
        if (item.enabled && trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          params.append('cmd', trimmed);
        }
      }
    }
    return `${window.location.origin}/term?${params.toString()}`;
  }

  function rememberCurrentValues() {
    const trimmedCwd = cwd.trim();
    if (trimmedCwd) {
      fetch('/api/recent-cwds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: trimmedCwd }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data?.cwds)) setRecentCwds(data.cwds);
        })
        .catch(() => {});
      setRecentCwds((prev) => [trimmedCwd, ...prev.filter((p) => p !== trimmedCwd)]);
    }
    setRecentCmds((prev) => {
      let next = prev;
      for (const cmd of cmds) {
        next = rememberRecent(RECENT_CMDS_KEY, cmd, next);
      }
      return next;
    });
  }

  async function removeRecentCwdEntry(targetPath: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const res = await fetch('/api/recent-cwds', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: targetPath }),
      });
      const data = await res.json();
      if (Array.isArray(data?.cwds)) {
        setRecentCwds(data.cwds);
      } else {
        setRecentCwds((prev) => prev.filter((p) => p !== targetPath));
      }
    } catch {
      setRecentCwds((prev) => prev.filter((p) => p !== targetPath));
    }
  }

  function resumeWorktree(wt: GitWorktree, inNewTab = false) {
    rememberCurrentValues();
    const url = termUrl({
      overrideCwd: wt.path,
      existingWorktree: wt.path,
    });
    if (inNewTab) {
      window.open(url, '_blank');
    } else {
      window.location.href = url;
    }
  }

  async function confirmDeleteWorktree() {
    if (!deleteWorktreeTarget || !gitInfo?.repoRoot) return;
    setDeletingWorktree(true);
    const res = await deleteWorktreeApi({
      cwd: gitInfo.repoRoot,
      worktreePath: deleteWorktreeTarget.path,
      branch: deleteWorktreeTarget.branch,
    });
    setDeletingWorktree(false);
    setDeleteWorktreeTarget(null);
    if (res.ok && res.gitInfo) {
      setGitInfo(res.gitInfo);
      if (selectedWorktreePath === deleteWorktreeTarget.path) {
        const remaining = (res.gitInfo.worktrees || []).filter((w) => !w.isMain);
        setSelectedWorktreePath(remaining.length > 0 ? remaining[0].path : '');
        if (remaining.length === 0 && gitMode === 'worktree') {
          setGitMode('none');
        }
      }
    } else if (res.error) {
      alert(`Failed to delete worktree: ${res.error}`);
    }
  }

  function openTerminal(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (isBranchNameMissing) {
      return;
    }
    if (gitMode === 'branch') {
      const normalized = normalizeBranchName(newBranchInput);
      if (!normalized) {
        alert('Please enter a branch or task name.');
        return;
      }
    }
    rememberCurrentValues();
    window.location.href = termUrl();
  }

  function openInNewTab() {
    if (isBranchNameMissing) {
      return;
    }
    if (gitMode === 'branch') {
      const normalized = normalizeBranchName(newBranchInput);
      if (!normalized) {
        alert('Please enter a branch or task name.');
        return;
      }
    }
    rememberCurrentValues();
    window.open(termUrl(), '_blank');
  }

  async function browseFolder() {
    try {
      const res = await fetch('/api/choose-folder', { method: 'POST' });
      const data = await res.json();
      if (data.cwd) {
        setCwd(data.cwd);
        setRecentCwds((prev) => [data.cwd, ...prev.filter((p) => p !== data.cwd)]);
      } else if (data.error) alert(data.error);
    } catch {
      alert('Failed to open folder picker');
    }
  }

  async function copyUrl() {
    if (isBranchNameMissing) {
      return;
    }
    rememberCurrentValues();
    const url = termUrl();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }


  function resumeSession(id: string, cwd?: string, inNewTab = false) {
    const params = new URLSearchParams();
    params.set('session', id);
    if (cwd) params.set('cwd', cwd);
    const url = `/term?${params.toString()}`;
    if (inNewTab) {
      window.open(url, '_blank');
    } else {
      window.location.href = url;
    }
  }

  async function closeSession(id: string) {
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      alert('Failed to close session');
    }
  }

  return (
    <main className="page">
      <Header
        title="termi"
        subtitle="Open a browser tab backed by a real local terminal."
        iconSrc="/app-icon.png"
        actions={<HeaderUpdater />}
      />

      <nav className="home-tabs-nav" aria-label="Main Navigation">
        <button
          type="button"
          className={`home-tab-btn ${activeTab === 'sessions' ? 'active' : ''}`}
          onClick={() => setActiveTab('sessions')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span>Sessions</span>
          <Badge variant={sessions.length > 0 ? 'success' : 'default'}>
            {sessions.length}
          </Badge>
        </button>
        <button
          type="button"
          className={`home-tab-btn ${activeTab === 'prompts' ? 'active' : ''}`}
          onClick={() => setActiveTab('prompts')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          <span>Saved Prompts</span>
          <Badge variant="default">
            {savedPrompts.length}
          </Badge>
        </button>
        <button
          type="button"
          className={`home-tab-btn ${activeTab === 'scripts' ? 'active' : ''}`}
          onClick={() => setActiveTab('scripts')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          <span>Custom Scripts</span>
          <Badge variant="default">
            {customScripts.length}
          </Badge>
        </button>
      </nav>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {activeTab === 'sessions' && (
          <>
            <form onSubmit={openTerminal} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <Card
                title="Launch Session"
                subtitle="Configure working directory and startup commands"
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                }
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                    Working directory
                    <div className="input-with-button">
                      <input
                        value={cwd}
                        onChange={(e) => setCwd(e.target.value)}
                        placeholder="~/projects/my-app"
                        list="recent-cwds"
                      />
                      <Button type="button" variant="secondary" onClick={browseFolder}>
                        Browse…
                      </Button>
                    </div>
                  </label>

                  {recentCwds.length > 0 && (
                    <div className="recent-cwds-container">
                      <span className="recent-cwds-label">Recently used</span>
                      <div className="recent-cwds-chips">
                        {recentCwds.map((pathItem) => {
                          const { name } = formatPathDisplay(pathItem, defaultCwd);
                          const abbr = abbreviatePath(pathItem, defaultCwd);
                          const isSelected = isSameCwd(cwd, pathItem, defaultCwd);
                          return (
                            <button
                              key={pathItem}
                              type="button"
                              className={`recent-cwd-chip ${isSelected ? 'active' : ''}`}
                              onClick={() => setCwd(pathItem)}
                              title={pathItem}
                            >
                              <span className="recent-cwd-chip-name">{name}</span>
                              <span className="recent-cwd-chip-abbr">({abbr})</span>
                              <span
                                role="button"
                                tabIndex={0}
                                className="recent-cwd-chip-remove"
                                onClick={(e) => removeRecentCwdEntry(pathItem, e)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    removeRecentCwdEntry(pathItem, e as unknown as React.MouseEvent);
                                  }
                                }}
                                title={`Remove ${pathItem} from history`}
                                aria-label={`Remove ${pathItem}`}
                              >
                                ×
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <datalist id="recent-cwds">
                    {recentCwds.map((c) => (
                      <option value={c} key={c} />
                    ))}
                  </datalist>
                  <datalist id="recent-cmds">
                    {recentCmds.map((c) => (
                      <option value={c} key={c} />
                    ))}
                  </datalist>

                  {gitInfo?.isRepo && (
                    <div className="git-session-section">
                      <div className="git-session-header">
                        <div className="git-session-title">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="6" y1="3" x2="6" y2="15" />
                            <circle cx="18" cy="6" r="3" />
                            <circle cx="6" cy="18" r="3" />
                            <path d="M18 9a9 9 0 0 1-9 9" />
                          </svg>
                          <span>Git &amp; Worktree Isolation</span>
                        </div>
                        <div className="git-session-badge" title="Current repository branch">
                          Current: <strong>{gitInfo.currentBranch || 'detached'}</strong>
                        </div>
                      </div>

                      <div className="git-mode-selector">
                        <label className={`git-mode-option ${gitMode === 'none' ? 'active' : ''}`}>
                          <input
                            type="radio"
                            name="gitMode"
                            checked={gitMode === 'none'}
                            onChange={() => setGitMode('none')}
                          />
                          <span>Direct directory</span>
                        </label>

                        <label className={`git-mode-option ${gitMode === 'branch' ? 'active' : ''}`}>
                          <input
                            type="radio"
                            name="gitMode"
                            checked={gitMode === 'branch'}
                            onChange={() => setGitMode('branch')}
                          />
                          <span>Branch from base branch</span>
                        </label>

                        {secondaryWorktrees.length > 0 && (
                          <label className={`git-mode-option ${gitMode === 'worktree' ? 'active' : ''}`}>
                            <input
                              type="radio"
                              name="gitMode"
                              checked={gitMode === 'worktree'}
                              onChange={() => setGitMode('worktree')}
                            />
                            <span>Reuse worktree ({secondaryWorktrees.length})</span>
                          </label>
                        )}
                      </div>

                      {gitMode === 'branch' && (
                        <div className="git-branch-form">
                          <div className="git-field-label">
                            Base branch (pulls remote latest before branching)
                            <select
                              value={baseBranch}
                              onChange={(e) => setBaseBranch(e.target.value)}
                              className="git-select"
                            >
                              {filterValidBranches(gitInfo.branches).map((b) => (
                                <option key={b} value={b}>
                                  {b} {b === gitInfo.currentBranch ? '(current)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="git-field-label">
                            New branch / task name
                            <input
                              value={newBranchInput}
                              onChange={(e) => setNewBranchInput(e.target.value)}
                              placeholder="e.g. add-oauth-login or fix/session-leak"
                              className="git-input"
                            />
                            {normalizedBranchPreview ? (
                              <div className="git-normalized-preview">
                                <span>Branch to create:</span>
                                <code>{normalizedBranchPreview}</code>
                                <span className="git-preview-path">
                                  (.worktrees/{normalizedBranchPreview.replace(/\//g, '-')})
                                </span>
                              </div>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                Enter a task or feature name. It will be normalized to a clean git branch and worktree.
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {gitMode === 'worktree' && secondaryWorktrees.length > 0 && (
                        <div className="git-worktree-form">
                          <div className="git-field-label">
                            Existing worktree to resume (auto-syncs with remote rebase)
                            <select
                              value={selectedWorktreePath}
                              onChange={(e) => setSelectedWorktreePath(e.target.value)}
                              className="git-select"
                            >
                              {secondaryWorktrees.map((wt) => (
                                <option key={wt.path} value={wt.path}>
                                  {wt.branch || wt.relative} — {wt.commitMsg ? `"${wt.commitMsg.slice(0, 40)}"` : wt.head}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="cmd-list">
                    <span className="cmd-list-label">Initial command (optional)</span>
                    {cmds.map((cmd, i) => (
                      <div className="input-with-button" key={i}>
                        <input
                          value={cmd}
                          onChange={(e) => updateCmd(i, e.target.value)}
                          placeholder="npm run dev"
                          list="recent-cmds"
                        />
                        {cmds.length > 1 && (
                          <Button type="button" variant="secondary" onClick={() => removeCmd(i)}>
                            Remove
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button type="button" variant="secondary" size="sm" onClick={addCmd}>
                      + Add another command
                    </Button>
                  </div>

                  <div className="common-cmds-section" style={{ borderTop: '1px solid var(--border-subtle)', marginTop: '0.85rem', paddingTop: '0.85rem' }}>
                    <div className="common-cmds-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Common Commands</span>
                        <Badge variant={commonCmds.some((c) => c.enabled) ? 'info' : 'default'}>
                          {commonCmds.filter((c) => c.enabled).length} active
                        </Badge>
                      </div>
                      {commonCmds.length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const allEnabled = commonCmds.every((c) => c.enabled);
                            setCommonCmds((prev) => {
                              const next = prev.map((c) => ({ ...c, enabled: !allEnabled }));
                              saveCommonCmds(next);
                              return next;
                            });
                          }}
                        >
                          {commonCmds.every((c) => c.enabled) ? 'Deselect all' : 'Select all'}
                        </Button>
                      )}
                    </div>
                    <p className="common-cmds-desc" style={{ marginTop: '0.15rem', marginBottom: '0.4rem' }}>
                      Preset commands automatically included when selected
                    </p>

                    <div className="common-cmds-list">
                      {commonCmds.map((c) => (
                        <div key={c.id} className={`common-cmd-item${c.enabled ? ' active' : ''}`}>
                          <label className="common-cmd-label">
                            <input
                              type="checkbox"
                              checked={c.enabled}
                              onChange={() => toggleCommonCmd(c.id)}
                            />
                            <div className="common-cmd-info">
                              <CopyableCode code={c.cmd} />
                              {c.explanation && (
                                <span className="common-cmd-explanation" title={c.explanation}>{c.explanation}</span>
                              )}
                            </div>
                          </label>
                          <button
                            type="button"
                            className="common-cmd-remove-btn"
                            onClick={() => removeCommonCmd(c.id)}
                            title="Remove command"
                            aria-label={`Remove ${c.cmd}`}
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                      {commonCmds.length === 0 && (
                        <div className="common-cmds-empty">
                          <p className="muted">No common commands configured.</p>
                          <button
                            type="button"
                            className="link-button"
                            onClick={resetCommonCmds}
                          >
                            Restore default examples
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="add-common-cmd-row">
                      <input
                        value={newCmd}
                        onChange={(e) => setNewCmd(e.target.value)}
                        placeholder="Command (e.g. agy)"
                        className="add-common-cmd-input"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addCommonCmd();
                          }
                        }}
                      />
                      <input
                        value={newExplanation}
                        onChange={(e) => setNewExplanation(e.target.value)}
                        placeholder="Concise explanation (e.g. Google Antigravity CLI)"
                        className="add-common-explanation-input"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addCommonCmd();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={addCommonCmd}
                        disabled={!newCmd.trim()}
                      >
                        + Add
                      </Button>
                    </div>
                  </div>

                  <div className="form-actions" style={{ marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={isBranchNameMissing}
                      title={isBranchNameMissing ? 'Please provide a new branch name' : undefined}
                    >
                      Open terminal
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={openInNewTab}
                      disabled={isBranchNameMissing}
                      title={isBranchNameMissing ? 'Please provide a new branch name' : undefined}
                    >
                      Open in new tab
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={copyUrl}
                      disabled={isBranchNameMissing}
                      title={isBranchNameMissing ? 'Please provide a new branch name' : undefined}
                    >
                      {copied ? 'Copied!' : 'Copy URL'}
                    </Button>
                  </div>
                </div>
              </Card>
            </form>

            {gitInfo?.isRepo && secondaryWorktrees.length > 0 && (
              <Card
                title="Git Worktrees"
                subtitle={`Isolated workspaces in ${gitInfo.repoRoot ? abbreviatePath(gitInfo.repoRoot, defaultCwd) : 'repository'}`}
                badge={
                  <Badge variant="info">
                    {secondaryWorktrees.length} active
                  </Badge>
                }
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                }
              >
                <ul className="worktree-list">
                  {secondaryWorktrees.map((wt) => (
                    <li key={wt.path} className="worktree-item">
                      <div className="worktree-info">
                        <div className="worktree-header">
                          <Badge variant="success">{wt.branch || 'detached'}</Badge>
                          <span className="worktree-relative-path">{wt.relative}</span>
                        </div>
                        {wt.commitMsg && (
                          <div className="worktree-commit">
                            <span className="commit-sha">{wt.head}</span>
                            <span className="commit-msg">{wt.commitMsg}</span>
                          </div>
                        )}
                      </div>
                      <div className="worktree-actions">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => resumeWorktree(wt, false)}
                          title="Open terminal session in this worktree"
                        >
                          Open Terminal
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => setDeleteWorktreeTarget(wt)}
                          title="Delete worktree and its branch"
                        >
                          Delete
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card
              title="Active Sessions"
              subtitle="Running terminals currently managed by termi"
              badge={
                <Badge variant={sessions.length > 0 ? 'success' : 'default'}>
                  {sessions.length} running
                </Badge>
              }
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 14 14" />
                </svg>
              }
            >
              {sessions.length === 0 && <p className="muted" style={{ margin: '0.25rem 0' }}>No terminals running.</p>}
              {sessions.length > 0 && (
                <div className="session-groups">
                  {sessionGroups.map((group) => (
                    <div key={group.groupKey} className="session-group">
                      <div className="session-group-header">
                        <div className="session-group-title" title={group.fullPath}>
                          {group.isRepo ? (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="session-group-icon">
                              <circle cx="18" cy="18" r="3" />
                              <circle cx="6" cy="6" r="3" />
                              <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                              <line x1="6" y1="9" x2="6" y2="21" />
                            </svg>
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="session-group-icon">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                          )}
                          <span className="session-group-name">{group.name}</span>
                          <span className="session-group-path">{group.displayPath}</span>
                        </div>
                        <Badge variant="default" size="sm">
                          {group.sessions.length} {group.sessions.length === 1 ? 'session' : 'sessions'}
                        </Badge>
                      </div>

                      <ul className="session-list" style={{ margin: 0 }}>
                        {group.sessions.map((s) => {
                          const git = detectSessionGit(s);
                          const isWorktree = git?.isWorktree || (s.cwd && s.cwd.includes('/.worktrees/'));
                          const branch = git?.branch || (s.cwd ? s.cwd.match(/[/\\]\.worktrees[/\\]([^/\\]+)/)?.[1] : undefined);
                          const titleText = s.title?.trim() || (!s.cmd?.trim() ? 'Terminal' : '');
                          const activeTimeStr = formatRelativeTime(s.lastActiveTime || s.createdAt);

                          return (
                            <li
                              key={s.id}
                              className={`session-item ${s.connected ? 'connected' : 'disconnected'}`}
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                const selection = window.getSelection()?.toString();
                                if (selection && selection.length > 0) return;
                                if (e.metaKey || e.ctrlKey) {
                                  resumeSession(s.id, s.cwd, true);
                                } else {
                                  resumeSession(s.id, s.cwd, false);
                                }
                              }}
                              onAuxClick={(e) => {
                                if (e.button === 1) {
                                  e.preventDefault();
                                  resumeSession(s.id, s.cwd, true);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  resumeSession(s.id, s.cwd, false);
                                }
                              }}
                              title={
                                s.title?.trim()
                                  ? `Resume "${s.title.trim()}" (Click to open, ⌘/Ctrl+click for new tab)`
                                  : `Resume session (Click to open, ⌘/Ctrl+click for new tab)`
                              }
                            >
                              <div className="session-info">
                                <span className="dot" />
                                <div className="session-details">
                                  <div className="session-title-row">
                                    {isWorktree && branch ? (
                                      <Badge variant="info" size="sm" className="session-branch-badge" title={`Worktree branch: ${branch}`}>
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 3, verticalAlign: -1 }}>
                                          <line x1="6" y1="3" x2="6" y2="15" />
                                          <circle cx="18" cy="6" r="3" />
                                          <circle cx="6" cy="18" r="3" />
                                          <path d="M18 9a9 9 0 0 1-9 9" />
                                        </svg>
                                        {branch}
                                      </Badge>
                                    ) : null}

                                    {titleText ? (
                                      <span className="session-title" title={titleText}>
                                        {titleText}
                                      </span>
                                    ) : null}

                                    {s.dormant ? (
                                      <span className="session-restored-tag">(Restored)</span>
                                    ) : null}

                                    {activeTimeStr ? (
                                      <span
                                        className="session-time"
                                        title={`Last active: ${new Date(s.lastActiveTime || s.createdAt).toLocaleString()}`}
                                      >
                                        {activeTimeStr}
                                      </span>
                                    ) : null}
                                  </div>

                                  {s.cmd?.trim() ? (
                                    <div className="session-cmd">
                                      <CopyableCode code={s.cmd.trim()} />
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                              <div className="session-actions" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  type="button"
                                  variant="danger"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    closeSession(s.id);
                                  }}
                                  title="Close session"
                                >
                                  Close
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}

        {activeTab === 'prompts' && (
          <Card
            title="Saved Prompts"
            subtitle="Reusable prompt templates accessible across all terminal sessions and editor"
            badge={
              <Badge variant="info">
                {savedPrompts.length}
              </Badge>
            }
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            }
            extra={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setSavedPromptsModalOpen(true)}
              >
                Manage prompts
              </Button>
            }
          >
            <div className="saved-prompts-home-list" style={{ marginTop: '0.25rem' }}>
              {savedPrompts.map((p) => (
                <div key={p.id} className="saved-prompt-home-item">
                  <div className="saved-prompt-home-item-header">
                    <span className="saved-prompt-home-item-title">{p.title}</span>
                    <div className="saved-prompt-home-item-actions">
                      <button
                        type="button"
                        className={`icon-button small${copiedPromptId === p.id ? ' copied' : ''}`}
                        onClick={() => copySavedPromptFromHome(p.id, p.content)}
                        title={copiedPromptId === p.id ? 'Copied!' : 'Copy prompt text'}
                        aria-label={copiedPromptId === p.id ? 'Copied' : 'Copy prompt text'}
                      >
                        {copiedPromptId === p.id ? (
                          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="5" y="5" width="8" height="8" rx="1.5" />
                            <path d="M3 11V3a1.5 1.5 0 0 1 1.5-1.5H11" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        className="common-cmd-remove-btn"
                        onClick={() => removeSavedPromptFromHome(p.id)}
                        title="Remove prompt"
                        aria-label={`Remove ${p.title}`}
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                  <div className="saved-prompt-home-preview">{p.content}</div>
                </div>
              ))}
              {savedPrompts.length === 0 && (
                <p className="muted">No saved prompts configured.</p>
              )}
            </div>

            <div className="add-saved-prompt-home-row">
              <input
                value={newPromptTitle}
                onChange={(e) => setNewPromptTitle(e.target.value)}
                placeholder="Prompt title (e.g. Code Review)"
                className="add-saved-prompt-title-input"
              />
              <textarea
                value={newPromptContent}
                onChange={(e) => setNewPromptContent(e.target.value)}
                placeholder="Prompt content / instructions..."
                rows={2}
                className="add-saved-prompt-content-input"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={addSavedPromptFromHome}
                disabled={!newPromptTitle.trim() && !newPromptContent.trim()}
              >
                + Add prompt
              </Button>
            </div>
          </Card>
        )}

        {activeTab === 'scripts' && (
          <Card
            title="Custom Scripts"
            subtitle="Reusable bash automation scripts executed in your working directory"
            badge={
              <Badge variant="info">
                {customScripts.length}
              </Badge>
            }
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            }
            extra={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setCustomScriptsModalOpen(true)}
              >
                Manage scripts
              </Button>
            }
          >
            <div className="custom-scripts-home-list" style={{ marginTop: '0.25rem' }}>
              {customScripts.map((script) => (
                <div key={script.id} className="custom-script-home-item">
                  <div className="custom-script-home-item-header">
                    <span className="custom-script-home-item-title">{script.name}</span>
                    <div className="custom-script-home-item-actions">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => startScript({ cwd: cwd.trim() || defaultCwd, script })}
                        title={`Run ${script.name} in ${cwd.trim() || defaultCwd || 'working directory'}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        Run
                      </Button>
                    </div>
                  </div>
                  {script.description && (
                    <div className="custom-script-home-desc">{script.description}</div>
                  )}
                  <div className="custom-script-home-preview">
                    <code>{script.content.trim().split('\n').slice(0, 2).join('\n')}</code>
                  </div>
                </div>
              ))}
              {customScripts.length === 0 && (
                <p className="muted" style={{ margin: '0.5rem 0' }}>
                  No custom scripts yet. Click <strong>Manage scripts</strong> to add one or reset defaults.
                </p>
              )}
            </div>
          </Card>
        )}
      </div>

      <SavedPromptsModal
        isOpen={savedPromptsModalOpen}
        onClose={() => {
          setSavedPromptsModalOpen(false);
          fetchSavedPrompts().then(setSavedPrompts);
        }}
        initialManageMode={true}
      />

      <CustomScriptsModal
        isOpen={customScriptsModalOpen}
        onClose={() => setCustomScriptsModalOpen(false)}
        currentCwd={cwd || defaultCwd}
      />

      {deleteWorktreeTarget && (
        <div className="modal-backdrop" onClick={() => !deletingWorktree && setDeleteWorktreeTarget(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>Delete Worktree &amp; Branch</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => !deletingWorktree && setDeleteWorktreeTarget(null)}
                disabled={deletingWorktree}
              >
                &times;
              </button>
            </div>
            <div className="modal-body" style={{ padding: '1rem 0' }}>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                Are you sure you want to delete this worktree?
              </p>
              <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: 6, fontSize: '0.85rem' }}>
                <div><strong>Branch:</strong> <span style={{ color: '#38bdf8' }}>{deleteWorktreeTarget.branch || 'detached'}</span></div>
                <div style={{ marginTop: 4 }}><strong>Path:</strong> <code>{deleteWorktreeTarget.relative}</code></div>
              </div>
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: 'var(--error-color)' }}>
                This will remove the worktree directory from disk and force-delete the git branch.
              </p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDeleteWorktreeTarget(null)}
                disabled={deletingWorktree}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={confirmDeleteWorktree}
                disabled={deletingWorktree}
              >
                {deletingWorktree ? 'Deleting...' : 'Delete Worktree & Branch'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

