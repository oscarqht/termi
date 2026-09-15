import { useEffect, useState } from 'react';

type SessionInfo = {
  id: string;
  cwd: string;
  cmd: string;
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
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [copied, setCopied] = useState(false);
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [recentCmds, setRecentCmds] = useState<string[]>([]);

  useEffect(() => {
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
    return () => clearInterval(id);
  }, []);

  function termUrl() {
    const params = new URLSearchParams();
    if (cwd.trim()) params.set('cwd', cwd.trim());
    for (const cmd of cmds) {
      if (cmd.trim()) params.append('cmd', cmd.trim());
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
            <span className="dot" />
            <code>{s.cwd}</code>
            {s.cmd && <span className="cmd"> — {s.cmd}</span>}
          </li>
        ))}
      </ul>
    </main>
  );
}
