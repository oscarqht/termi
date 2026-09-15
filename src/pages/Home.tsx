import { useEffect, useState } from 'react';

type SessionInfo = {
  id: string;
  cwd: string;
  cmd: string;
  createdAt: number;
  connected: boolean;
};

export default function Home() {
  const [cwd, setCwd] = useState('');
  const [cmd, setCmd] = useState('');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [copied, setCopied] = useState(false);

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
    if (cmd.trim()) params.set('cmd', cmd.trim());
    return `${window.location.origin}/term?${params.toString()}`;
  }

  function openTerminal(e: React.FormEvent) {
    e.preventDefault();
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
            />
            <button type="button" className="secondary" onClick={browseFolder}>
              Browse…
            </button>
          </div>
        </label>
        <label>
          Initial command (optional)
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder="npm run dev"
          />
        </label>
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
