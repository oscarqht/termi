import { useEffect, useState } from 'react';
import {
  type CommonCmd,
  DEFAULT_COMMON_CMDS,
  loadCommonCmds,
  saveCommonCmds,
} from '../commonCmds';

export type SessionInfo = {
  id: string;
  cwd: string;
  cmd: string;
  title?: string;
  createdAt: number;
  connected: boolean;
};

const RECENT_CWDS_KEY = 'termi:recentCwds';
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
  const [cmds, setCmds] = useState(['']);
  const [commonCmds, setCommonCmds] = useState<CommonCmd[]>(() => loadCommonCmds());
  const [newCmd, setNewCmd] = useState('');
  const [newExplanation, setNewExplanation] = useState('');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [copied, setCopied] = useState(false);
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [recentCmds, setRecentCmds] = useState<string[]>([]);

  useEffect(() => {
    document.title = 'termi';
    setRecentCwds(loadRecent(RECENT_CWDS_KEY));
    setRecentCmds(loadRecent(RECENT_CMDS_KEY));
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
    fetch('/api/default-cwd')
      .then((r) => r.json())
      .then((d) => setCwd(d.cwd))
      .catch(() => {});
  }, []);

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
    setRecentCwds((prev) => rememberRecent(RECENT_CWDS_KEY, cwd, prev));
    setRecentCmds((prev) => {
      let next = prev;
      for (const cmd of cmds) {
        next = rememberRecent(RECENT_CMDS_KEY, cmd, next);
      }
      return next;
    });
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
      if (data.cwd) setCwd(data.cwd);
      else if (data.error) alert(data.error);
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
      <h1>termi</h1>
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
                    <code>{c.cmd}</code>
                    {c.explanation && (
                      <span className="common-cmd-explanation">{c.explanation}</span>
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
              {s.title ? (
                <>
                  <span className="session-title">{s.title}</span>
                  <code className="session-cwd">{s.cwd}</code>
                </>
              ) : (
                <code>{s.cwd}</code>
              )}
              {s.cmd && <span className="cmd"> — {s.cmd}</span>}
            </div>
            <div className="session-actions">
              <button type="button" className="secondary small" onClick={() => resumeSession(s.id, s.cwd)}>Resume</button>
              <button type="button" className="danger small" onClick={() => closeSession(s.id)}>Close</button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
