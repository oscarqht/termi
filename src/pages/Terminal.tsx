import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

type Phase = 'confirm' | 'connecting' | 'connected' | 'exited' | 'error';

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
  const [cmd, setCmd] = useState(initial.cmds[0] ?? '');
  const [phase, setPhase] = useState<Phase>(
    initial.session || initial.cmds.length === 0 ? 'connecting' : 'confirm',
  );
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(initial.session);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

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
                  onChange={() => setCmd(c)}
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
      {phase === 'exited' && <div className="banner">Process exited.</div>}
      <div ref={containerRef} className="xterm-container" />
    </div>
  );
}
