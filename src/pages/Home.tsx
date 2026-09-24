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
import HeaderUpdater from '../components/HeaderUpdater';
import { abbreviatePath, formatPathDisplay, isSameCwd } from '../pathUtils';

export type SessionInfo = {
  id: string;
  cwd: string;
  cmd: string;
  title?: string;
  createdAt: number;
  connected: boolean;
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
  const [savedPromptsModalOpen, setSavedPromptsModalOpen] = useState(false);
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
    return () => {
      unsubPrompts();
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

  function openTerminal(e: React.FormEvent) {
    e.preventDefault();
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
      <div className="header-row">
        <div className="header-brand">
          <img src="/app-icon.png" alt="termi" className="header-app-icon" />
          <h1>termi</h1>
        </div>
        <HeaderUpdater />
      </div>
      <p className="subtitle">Open a browser tab backed by a real local terminal.</p>

      <form onSubmit={openTerminal} className="new-terminal-form">
        <label>
          Working directory
          <div className="input-with-button">
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="~/projects/my-app"
              list="recent-cwds"
            />
            <button type="button" className="secondary" onClick={browseFolder}>
              Browse…
            </button>
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
                <button type="button" className="secondary" onClick={() => removeCmd(i)}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <button type="button" className="secondary" onClick={addCmd}>
            + Add another command
          </button>
        </div>

        <div className="common-cmds-section">
          <div className="common-cmds-header">
            <div>
              <span className="cmd-list-label">Common initial commands</span>
              <p className="common-cmds-desc">
                Select commands to include in Open Terminal or Copy URL.
              </p>
            </div>
            {commonCmds.length > 0 && (
              <div className="common-cmds-header-actions">
                <button
                  type="button"
                  className="link-button"
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
                </button>
              </div>
            )}
          </div>

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
            <button
              type="button"
              className="secondary"
              onClick={addCommonCmd}
              disabled={!newCmd.trim()}
            >
              + Add
            </button>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit">Open terminal</button>
          <button type="button" className="secondary" onClick={copyUrl}>
            {copied ? 'Copied!' : 'Copy URL'}
          </button>
        </div>
      </form>

      <h2>Active sessions</h2>
      {sessions.length === 0 && <p className="muted">No terminals running.</p>}
      <ul className="session-list">
        {sessions.map((s) => (
          <li key={s.id} className={s.connected ? 'connected' : 'disconnected'}>
            <div className="session-info">
              <span className="dot" />
              <div className="session-details">
                {s.title?.trim() ? (
                  <div className="session-title" title={s.title.trim()}>{s.title.trim()}</div>
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
              <button type="button" className="secondary small" onClick={() => resumeSession(s.id, s.cwd)}>Resume</button>
              <button type="button" className="danger small" onClick={() => closeSession(s.id)}>Close</button>
            </div>
          </li>
        ))}
      </ul>

      <section className="saved-prompts-home-section" style={{ marginTop: '2.5rem' }}>
        <div className="saved-prompts-home-header">
          <div>
            <h2>Saved prompts ({savedPrompts.length})</h2>
            <p className="saved-prompts-desc">
              Reusable prompt templates accessible across all terminal sessions and the text editor.
            </p>
          </div>
          <div className="saved-prompts-header-actions">
            <button
              type="button"
              className="secondary small"
              onClick={() => setSavedPromptsModalOpen(true)}
            >
              Manage prompts
            </button>
          </div>
        </div>

        <div className="saved-prompts-home-list">
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
          <button
            type="button"
            className="secondary"
            onClick={addSavedPromptFromHome}
            disabled={!newPromptTitle.trim() && !newPromptContent.trim()}
          >
            + Add prompt
          </button>
        </div>
      </section>

      <SavedPromptsModal
        isOpen={savedPromptsModalOpen}
        onClose={() => {
          setSavedPromptsModalOpen(false);
          fetchSavedPrompts().then(setSavedPrompts);
        }}
        initialManageMode={true}
      />
    </main>
  );
}
