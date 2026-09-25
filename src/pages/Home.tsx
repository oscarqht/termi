import { useEffect, useState } from 'react';
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

export type SessionInfo = {
  id: string;
  cwd: string;
  cmd: string;
  title?: string;
  terminalTitle?: string;
  createdAt: number;
  connected: boolean;
  dormant?: boolean;
};

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

  function termUrl() {
    const params = new URLSearchParams();
    if (cwd.trim()) params.set('cwd', cwd.trim());
    const seen = new Set<string>();
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

  function openTerminal(e?: React.FormEvent) {
    if (e) e.preventDefault();
    rememberCurrentValues();
    window.location.href = termUrl();
  }

  function openInNewTab() {
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


  function resumeSession(id: string, cwd?: string) {
    const params = new URLSearchParams();
    params.set('session', id);
    if (cwd) params.set('cwd', cwd);
    window.location.href = `/term?${params.toString()}`;
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
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setCustomScriptsModalOpen(true)}
              title="Manage and run custom bash scripts"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span>Custom Scripts</span>
            </Button>
            <HeaderUpdater />
          </>
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
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

              <div className="form-actions" style={{ marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                <Button type="submit" variant="primary">
                  Open terminal
                </Button>
                <Button type="button" variant="secondary" onClick={openInNewTab}>
                  Open in new tab
                </Button>
                <Button type="button" variant="secondary" onClick={copyUrl}>
                  {copied ? 'Copied!' : 'Copy URL'}
                </Button>
              </div>
            </div>
          </Card>

          <Card
            title="Common Commands"
            subtitle="Preset commands automatically included when selected"
            badge={
              <Badge variant={commonCmds.some((c) => c.enabled) ? 'info' : 'default'}>
                {commonCmds.filter((c) => c.enabled).length} active
              </Badge>
            }
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            }
            extra={
              commonCmds.length > 0 && (
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
              )
            }
          >
            <div className="common-cmds-section" style={{ margin: 0, padding: 0, border: 'none' }}>
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
          </Card>
        </form>

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
            <ul className="session-list" style={{ margin: 0 }}>
              {sessions.map((s) => (
                <li key={s.id} className={s.connected ? 'connected' : 'disconnected'}>
                  <div className="session-info">
                    <span className="dot" />
                    <div className="session-details">
                      {s.title?.trim() ? (
                        <div className="session-title" title={s.title.trim()}>
                          {s.title.trim()}
                          {s.dormant && <span style={{ marginLeft: 6, fontSize: '0.75rem', opacity: 0.6 }}>(Restored)</span>}
                        </div>
                      ) : s.terminalTitle?.trim() ? (
                        <div className="session-title" title={s.terminalTitle.trim()}>
                          {s.terminalTitle.trim()}
                        </div>
                      ) : s.dormant ? (
                        <div className="session-title" style={{ fontSize: '0.75rem', opacity: 0.6 }}>(Restored session)</div>
                      ) : null}
                      <div className="session-cwd">
                        <CopyableCode code={s.cwd} />
                      </div>
                      {s.cmd?.trim() ? (
                        <div className="session-cmd">
                          <CopyableCode code={s.cmd.trim()} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="session-actions">
                    <Button type="button" variant="secondary" size="sm" onClick={() => resumeSession(s.id, s.cwd)}>
                      Resume
                    </Button>
                    <Button type="button" variant="danger" size="sm" onClick={() => closeSession(s.id)}>
                      Close
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

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
    </main>
  );
}

