import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

type Phase = 'confirm' | 'connecting' | 'connected' | 'exited' | 'error';

const LAST_INITIAL_CMD_KEY = 'termi:lastInitialCmd';

function loadLastInitialCmd(): string | null {
  try {
    return window.localStorage.getItem(LAST_INITIAL_CMD_KEY);
  } catch {
    return null;
  }
}

function rememberInitialCmd(cmd: string) {
  try {
    window.localStorage.setItem(LAST_INITIAL_CMD_KEY, cmd);
  } catch {
    // ignore quota/access errors
  }
}

function paramsFromLocation() {
  const url = new URL(window.location.href);
  return {
    cwd: url.searchParams.get('cwd') ?? '',
    cmds: url.searchParams.getAll('cmd').filter((c) => c.trim()),
    session: url.searchParams.get('session'),
  };
}

function setSessionParam(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('session', id);
  window.history.replaceState(null, '', url.toString());
}

export default function Terminal() {
  const initial = paramsFromLocation();
  const [cwd, setCwd] = useState(initial.cwd);
  const [cmds] = useState(initial.cmds);
  const [cmd, setCmd] = useState(() => {
    const lastChoice = loadLastInitialCmd();
    if (lastChoice && initial.cmds.includes(lastChoice)) return lastChoice;
    return initial.cmds[0] ?? '';
  });
  const [phase, setPhase] = useState<Phase>(
    initial.session || initial.cmds.length === 0 ? 'connecting' : 'confirm',
  );
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(initial.session);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function shellQuote(value: string) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  function sendInput(data: string) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  }

  async function uploadAndInsertFiles(files: File[]) {
    const sessionId = sessionIdRef.current;
    if (!sessionId || files.length === 0) return;
    setUploading(true);
    try {
      const paths: string[] = [];
      for (const file of files) {
        const name = file.name || 'pasted-image.png';
        const res = await fetch(
          `/api/sessions/${sessionId}/upload?name=${encodeURIComponent(name)}`,
          { method: 'POST', body: file },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Failed to upload ${name}`);
        }
        const data = await res.json();
        paths.push(data.path as string);
      }
      sendInput(paths.map(shellQuote).join(' '));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function connect(sessionId: string) {
    sessionIdRef.current = sessionId;
    setPhase('connecting');

    const container = containerRef.current;
    if (!container) return;

    if (!xtermRef.current) {
      const term = new XTerm({
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);
      fit.fit();
      xtermRef.current = term;

      const resizeObserver = new ResizeObserver(() => {
        fit.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      });
      resizeObserver.observe(container);
      resizeObserverRef.current = resizeObserver;

      term.onData((data) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }));
        }
      });
    }

    const wsUrl = new URL('/ws/pty', window.location.href);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.searchParams.set('session', sessionId);
    const ws = new WebSocket(wsUrl.toString());
    wsRef.current = ws;

    ws.onopen = () => {
      setPhase('connected');
      const term = xtermRef.current!;
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output') {
        xtermRef.current?.write(msg.data);
      } else if (msg.type === 'exit') {
        setPhase('exited');
      }
    };

    ws.onerror = () => {
      // If we never got past 'connecting', the session id was likely stale
      // (e.g. server restarted) — fall back to letting the user re-launch it.
      setPhase((p) => (p === 'connecting' ? 'error' : p));
    };

    ws.onclose = () => {
      setPhase((p) => (p === 'connecting' ? 'error' : p === 'connected' ? 'exited' : p));
    };
  }

  useEffect(() => {
    if (initial.session) {
      connect(initial.session);
    } else if (initial.cmds.length === 0) {
      startTerminal();
    }
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      xtermRef.current?.dispose();
      xtermRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || phase !== 'connected') return;

    function onDragOver(e: DragEvent) {
      e.preventDefault();
      setDragActive(true);
    }
    function onDragLeave() {
      setDragActive(false);
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      setDragActive(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) uploadAndInsertFiles(files);
    }
    function onPaste(e: ClipboardEvent) {
      const items = [...(e.clipboardData?.items ?? [])];
      const files = items
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length === 0) return;
      e.preventDefault();
      uploadAndInsertFiles(files);
    }

    container.addEventListener('dragover', onDragOver);
    container.addEventListener('dragleave', onDragLeave);
    container.addEventListener('drop', onDrop);
    container.addEventListener('paste', onPaste);
    return () => {
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('dragleave', onDragLeave);
      container.removeEventListener('drop', onDrop);
      container.removeEventListener('paste', onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function handleAttachClick() {
    fileInputRef.current?.click();
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length) uploadAndInsertFiles(files);
  }

  async function startTerminal() {
    setError(null);
    setPhase('connecting');
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, cmd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to start terminal');
        setPhase('confirm');
        return;
      }
      setSessionParam(data.id);
      connect(data.id);
    } catch (err) {
      setError((err as Error).message);
      setPhase('confirm');
    }
  }


  async function handleClose() {
    if (sessionIdRef.current) {
      try {
        await fetch(`/api/sessions/${sessionIdRef.current}`, { method: 'DELETE' });
        window.close();
      } catch (err) {
        console.error('Failed to close session', err);
      }
    }
  }

  if (phase === 'confirm' || phase === 'error') {
    return (
      <main className="page confirm-page">
        <h1>Open a terminal here?</h1>
        <dl className="confirm-details">
          <dt>Working directory</dt>
          <dd>
            <code>{cwd || '(home directory)'}</code>
          </dd>
          {cmds.length === 1 && (
            <>
              <dt>Initial command</dt>
              <dd>
                <code>{cmds[0]}</code>
              </dd>
            </>
          )}
        </dl>
        {phase === 'error' && (
          <p className="error">This session is no longer running on the server.</p>
        )}
        {error && <p className="error">{error}</p>}
        <label className="confirm-cwd">
          Working directory
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} />
        </label>
        {cmds.length > 1 && (
          <div className="cmd-choices">
            <span className="cmd-list-label">Choose an initial command</span>
            {cmds.map((c) => (
              <label className="cmd-choice" key={c}>
                <input
                  type="radio"
                  name="cmd-choice"
                  checked={cmd === c}
                  onChange={() => {
                    setCmd(c);
                    rememberInitialCmd(c);
                  }}
                />
                <code>{c}</code>
              </label>
            ))}
          </div>
        )}
        <button onClick={startTerminal}>Start terminal</button>
      </main>
    );
  }

return (
    <div className="terminal-page">
      <div className="floating-toolbar">
        {phase === 'connected' && (
          <button
            className="icon-button"
            onClick={handleAttachClick}
            title="Attach a file or image"
            aria-label="Attach a file or image"
            disabled={uploading}
          >
            {uploading ? (
              <svg viewBox="0 0 24 24" width="18" height="18" className="spin" aria-hidden="true">
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="42"
                  strokeDashoffset="14"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path
                  d="M17.5 9.5 9.75 17.25a3.5 3.5 0 1 1-4.95-4.95l8.4-8.4a2.5 2.5 0 1 1 3.54 3.54l-8.13 8.13a1.5 1.5 0 1 1-2.12-2.12l6.72-6.72"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        )}
        <button
          className="icon-button danger"
          onClick={handleClose}
          title="Close session"
          aria-label="Close session"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />
      {phase === 'exited' && <div className="banner">Process exited.</div>}
      <div
        ref={containerRef}
        className={`xterm-container${dragActive ? ' drag-active' : ''}`}
      />
    </div>
  );
}
