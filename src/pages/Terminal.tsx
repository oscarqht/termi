import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getCommonCmdExplanationMap } from '../commonCmds';

type Phase = 'confirm' | 'connecting' | 'connected' | 'exited' | 'error';

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#24292f',
  cursor: '#24292f',
  cursorAccent: '#ffffff',
  selectionBackground: '#b4d5fe',
  selectionForeground: '#24292f',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#4d3800',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f',
};

const DARK_THEME = {
  background: '#0f1115',
  foreground: '#e6e6e6',
  cursor: '#e6e6e6',
  cursorAccent: '#0f1115',
  selectionBackground: 'rgba(79, 140, 255, 0.35)',
  selectionForeground: '#ffffff',
  black: '#282c34',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#be5046',
  brightGreen: '#98c379',
  brightYellow: '#d19a66',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

function getSystemTheme() {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return LIGHT_THEME;
  }
  return DARK_THEME;
}

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
  const explanationMap = getCommonCmdExplanationMap();
  const [uploading, setUploading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(initial.session);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  function showToast(msg: string) {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToastError(msg);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastError(null);
      toastTimeoutRef.current = null;
    }, 4000);
  }

  function shellQuote(value: string) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  function sendInput(data: string) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  }

  function formatImageName(file: File, index = 0): string {
    const ext = file.type.split('/')[1] || 'png';
    const cleanExt = ext === 'jpeg' ? 'jpg' : ext;
    if (file.name && file.name !== 'image.png' && file.name !== 'blob' && !file.name.startsWith('image.')) {
      return file.name;
    }
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const suffix = index > 0 ? `-${index + 1}` : '';
    return `pasted-image-${timestamp}${suffix}.${cleanExt}`;
  }

  async function uploadAndInsertFiles(files: File[]) {
    const sessionId = sessionIdRef.current;
    if (!sessionId || files.length === 0) return;
    setUploading(true);
    try {
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = formatImageName(file, i);
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
      const msg = (err as Error).message;
      setError(msg);
      showToast(msg);
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
        theme: getSystemTheme(),
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
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (e: MediaQueryListEvent) => {
      if (xtermRef.current) {
        xtermRef.current.options.theme = e.matches ? DARK_THEME : LIGHT_THEME;
      }
    };
    mql.addEventListener('change', handleThemeChange);
    return () => {
      mql.removeEventListener('change', handleThemeChange);
    };
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
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) imageFiles.push(f);
        }
      }
      if (imageFiles.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      uploadAndInsertFiles(imageFiles);
    }

    container.addEventListener('dragover', onDragOver);
    container.addEventListener('dragleave', onDragLeave);
    container.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste, true);
    return () => {
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('dragleave', onDragLeave);
      container.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste, true);
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
                {explanationMap[cmds[0]] && (
                  <span className="cmd-explanation"> — {explanationMap[cmds[0]]}</span>
                )}
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
                {explanationMap[c] && (
                  <span className="cmd-explanation"> — {explanationMap[c]}</span>
                )}
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
      {toastError && (
        <div className="terminal-toast-error" role="alert">
          {toastError}
        </div>
      )}
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
