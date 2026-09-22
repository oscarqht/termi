import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getCommonCmdExplanationMap } from '../commonCmds';
import { MobileAccessoryBar } from '../components/MobileAccessoryBar';
import type { SessionInfo } from './Home';
import { isSameCwd, normalizePath } from '../pathUtils';

type Phase = 'confirm' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'exited' | 'error';

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

const MAX_RECONNECT_ATTEMPTS = 5;
const BACKOFF_DELAYS = [1000, 2000, 3000, 5000, 8000];

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
    start: url.searchParams.get('start') === '1',
  };
}

function setSessionParam(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('session', id);
  url.searchParams.delete('start');
  url.searchParams.delete('cmd');
  window.history.replaceState(null, '', url.toString());
}

export function getFolderName(dirPath: string): string {
  const trimmed = dirPath.trim();
  if (!trimmed) return '';
  const stripped = trimmed.replace(/[/\\]+$/, '');
  if (!stripped) return '/';
  const parts = stripped.split(/[/\\]/);
  return parts[parts.length - 1] || stripped;
}


export default function Terminal() {
  const initial = paramsFromLocation();
  const [cwd, setCwd] = useState(initial.cwd);
  const [sessionTitle, setSessionTitle] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const currentTitle = sessionTitle.trim() || (cwd.trim() ? getFolderName(cwd) : '') || 'termi';

  useEffect(() => {
    if (sessionTitle.trim()) {
      document.title = sessionTitle.trim();
    } else {
      const folderName = getFolderName(cwd);
      document.title = folderName ? `termi > ${folderName}` : 'termi';
    }
    return () => {
      document.title = 'termi';
    };
  }, [cwd, sessionTitle]);
  const [cmds] = useState(initial.cmds);
  const [cmd, setCmd] = useState(() => {
    const lastChoice = loadLastInitialCmd();
    if (lastChoice && initial.cmds.includes(lastChoice)) return lastChoice;
    return initial.cmds[0] ?? '';
  });
  const [phase, setPhase] = useState<Phase>(
    initial.session || initial.cmds.length === 0 || initial.start ? 'connecting' : 'confirm',
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
  const fitAddonRef = useRef<FitAddon | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const [defaultCwd, setDefaultCwd] = useState('');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  useEffect(() => {
    fetch('/api/default-cwd')
      .then((r) => r.json())
      .then((d) => {
        if (d?.cwd) setDefaultCwd(d.cwd);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (phase !== 'confirm' && phase !== 'error') return;

    const refresh = () => {
      fetch('/api/sessions')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setSessions(data);
        })
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
  }, [phase]);

  const matchingSessions = useMemo(() => {
    return sessions.filter((s) => isSameCwd(s.cwd, cwd, defaultCwd));
  }, [sessions, cwd, defaultCwd]);

  function resumeSession(id: string, sessionCwd?: string) {
    const params = new URLSearchParams();
    params.set('session', id);
    if (sessionCwd) params.set('cwd', sessionCwd);
    window.location.href = `/term?${params.toString()}`;
  }

  async function closeSession(id: string) {
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
      } else {
        alert('Failed to close session');
      }
    } catch {
      alert('Failed to close session');
    }
  }

  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

  const isExplicitExitRef = useRef(false);
  const hasConnectedOnceRef = useRef(false);
  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const isUnmountedRef = useRef(false);

  const [isTouchDevice, setIsTouchDevice] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(hover: none) and (pointer: coarse)').matches ||
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0
    );
  });
  const [ctrlActive, setCtrlActiveState] = useState(false);
  const [altActive, setAltActiveState] = useState(false);
  const ctrlActiveRef = useRef(false);
  const altActiveRef = useRef(false);
  const [barCollapsed, setBarCollapsed] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportTop, setViewportTop] = useState<number>(0);

  const setCtrlActive = (updater: (prev: boolean) => boolean) => {
    setCtrlActiveState((prev) => {
      const next = updater(prev);
      ctrlActiveRef.current = next;
      return next;
    });
  };

  const setAltActive = (updater: (prev: boolean) => boolean) => {
    setAltActiveState((prev) => {
      const next = updater(prev);
      altActiveRef.current = next;
      return next;
    });
  };

  const handleSendKey = (data: string) => {
    let processed = data;
    if (ctrlActiveRef.current && processed.length === 1) {
      const code = processed.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) {
        processed = String.fromCharCode(code - 64);
      }
      ctrlActiveRef.current = false;
      setCtrlActiveState(false);
    }
    if (altActiveRef.current) {
      processed = '\x1b' + processed;
      altActiveRef.current = false;
      setAltActiveState(false);
    }
    sendInput(processed);
  };

  const toggleKeyboard = () => {
    if (!xtermRef.current) return;
    const textarea = containerRef.current?.querySelector('textarea');
    if (document.activeElement === textarea) {
      textarea?.blur();
    } else {
      xtermRef.current.focus();
    }
  };

  useEffect(() => {
    if (isTouchDevice) return;
    const onTouch = () => {
      setIsTouchDevice(true);
    };
    window.addEventListener('touchstart', onTouch, { passive: true, once: true });
    return () => {
      window.removeEventListener('touchstart', onTouch);
    };
  }, [isTouchDevice]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const handleVisualViewport = () => {
      setViewportHeight(vv.height);
      setViewportTop(vv.offsetTop);
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit();
          const term = xtermRef.current;
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        } catch {}
      }
    };

    vv.addEventListener('resize', handleVisualViewport);
    vv.addEventListener('scroll', handleVisualViewport);
    handleVisualViewport();

    return () => {
      vv.removeEventListener('resize', handleVisualViewport);
      vv.removeEventListener('scroll', handleVisualViewport);
    };
  }, [phase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (xtermRef.current && fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
          const term = xtermRef.current;
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        } catch {}
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [barCollapsed]);

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
    if (phaseRef.current !== 'connected') return;
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

  function clearReconnectTimer() {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function handleUnexpectedClose() {
    if (isExplicitExitRef.current || isUnmountedRef.current) return;
    setPhase('reconnecting');
    scheduleReconnect(false);
  }

  function scheduleReconnect(immediate = false) {
    if (isExplicitExitRef.current || isUnmountedRef.current) return;
    clearReconnectTimer();

    if (immediate) {
      runReconnect();
      return;
    }

    const delay = BACKOFF_DELAYS[retryCountRef.current] ?? 8000;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      runReconnect();
    }, delay);
  }

  async function runReconnect() {
    const sessionId = sessionIdRef.current;
    if (!sessionId || isExplicitExitRef.current || isUnmountedRef.current) return;

    if (retryCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setPhase('disconnected');
      return;
    }

    setPhase('reconnecting');

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (res.status === 404) {
        isExplicitExitRef.current = true;
        setPhase('exited');
        return;
      }
    } catch {
      retryCountRef.current += 1;
      if (retryCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setPhase('disconnected');
      } else {
        scheduleReconnect(false);
      }
      return;
    }

    if (isExplicitExitRef.current || isUnmountedRef.current) return;
    connectWebSocket(sessionId);
  }

  function connectWebSocket(sessionId: string) {
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    const wsUrl = new URL('/ws/pty', window.location.href);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.searchParams.set('session', sessionId);
    const ws = new WebSocket(wsUrl.toString());
    wsRef.current = ws;

    ws.onopen = () => {
      if (isUnmountedRef.current || wsRef.current !== ws) return;
      clearReconnectTimer();
      retryCountRef.current = 0;

      if (hasConnectedOnceRef.current) {
        xtermRef.current?.reset();
      }
      hasConnectedOnceRef.current = true;

      setPhase('connected');
      const term = xtermRef.current;
      if (term && fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        } catch {}
      }
    };

    ws.onmessage = (event) => {
      if (isUnmountedRef.current || wsRef.current !== ws) return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'output') {
        xtermRef.current?.write(msg.data);
      } else if (msg.type === 'exit') {
        isExplicitExitRef.current = true;
        clearReconnectTimer();
        setPhase('exited');
      }
    };

    ws.onerror = () => {
      if (isUnmountedRef.current || wsRef.current !== ws) return;
      if (!hasConnectedOnceRef.current) {
        setPhase('error');
      }
    };

    ws.onclose = () => {
      if (isUnmountedRef.current || wsRef.current !== ws) return;
      if (isExplicitExitRef.current) {
        setPhase('exited');
        return;
      }
      if (!hasConnectedOnceRef.current) {
        setPhase('error');
        return;
      }
      handleUnexpectedClose();
    };
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
        scrollback: 2000,
      });
      const fit = new FitAddon();
      fitAddonRef.current = fit;
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
        if (phaseRef.current !== 'connected') return;
        let processed = data;
        if (ctrlActiveRef.current && processed.length === 1) {
          const code = processed.toUpperCase().charCodeAt(0);
          if (code >= 64 && code <= 95) {
            processed = String.fromCharCode(code - 64);
          }
          ctrlActiveRef.current = false;
          setCtrlActiveState(false);
        }
        if (altActiveRef.current) {
          processed = '\x1b' + processed;
          altActiveRef.current = false;
          setAltActiveState(false);
        }
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data: processed }));
        }
      });
    }

    connectWebSocket(sessionId);
  }

  useEffect(() => {
    if (initial.session) {
      fetch(`/api/sessions/${encodeURIComponent(initial.session)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.cwd) {
            setCwd(data.cwd);
          }
          if (data?.title) {
            setSessionTitle(data.title);
          }
        })
        .catch(() => {});
      connect(initial.session);
    } else if (initial.cmds.length === 0 || initial.start) {
      startTerminal(initial.cwd, initial.start ? (initial.cmds[0] ?? '') : undefined);
    }
    return () => {
      isUnmountedRef.current = true;
      clearReconnectTimer();
      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      fitAddonRef.current = null;
      xtermRef.current?.dispose();
      xtermRef.current = null;
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleWakeup = () => {
      if (document.visibilityState === 'visible' && !isExplicitExitRef.current) {
        const currentPhase = phaseRef.current;
        const ws = wsRef.current;
        const isSocketClosed = !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING;
        if (
          currentPhase === 'reconnecting' ||
          currentPhase === 'disconnected' ||
          (currentPhase === 'connected' && isSocketClosed)
        ) {
          retryCountRef.current = 0;
          scheduleReconnect(true);
        }
      }
    };

    const handleOnline = () => {
      if (!isExplicitExitRef.current) {
        retryCountRef.current = 0;
        scheduleReconnect(true);
      }
    };

    document.addEventListener('visibilitychange', handleWakeup);
    window.addEventListener('focus', handleWakeup);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleWakeup);
      window.removeEventListener('focus', handleWakeup);
      window.removeEventListener('online', handleOnline);
    };
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

  async function startTerminal(targetCwd?: string, targetCmd?: string) {
    const effectiveCwd = targetCwd !== undefined ? targetCwd : cwd;
    const effectiveCmd = targetCmd !== undefined ? targetCmd : cmd;
    setError(null);
    setPhase('connecting');
    isExplicitExitRef.current = false;
    hasConnectedOnceRef.current = false;
    retryCountRef.current = 0;
    clearReconnectTimer();
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: effectiveCwd, cmd: effectiveCmd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to start terminal');
        setPhase('confirm');
        return;
      }
      if (data.cwd) {
        setCwd(data.cwd);
      }
      if (data.title) {
        setSessionTitle(data.title);
      }
      setSessionParam(data.id);
      connect(data.id);
    } catch (err) {
      setError((err as Error).message);
      setPhase('confirm');
    }
  }

  function handleManualRetry() {
    retryCountRef.current = 0;
    scheduleReconnect(true);
  }

  function startInNewTab() {
    const params = new URLSearchParams();
    if (cwd.trim()) params.set('cwd', cwd.trim());
    if (cmd.trim()) {
      params.set('cmd', cmd.trim());
      rememberInitialCmd(cmd.trim());
    }
    params.set('start', '1');
    window.open(`/term?${params.toString()}`, '_blank');
  }

  function handleOpenSettings() {
    setDraftTitle(sessionTitle);
    setSettingsOpen(true);
  }

  function handleCloseSettings() {
    setSettingsOpen(false);
  }

  async function handleSaveSettings(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!sessionIdRef.current) return;
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/sessions/${sessionIdRef.current}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draftTitle.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setSessionTitle(data.title ?? draftTitle.trim());
        setSettingsOpen(false);
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || 'Failed to update settings');
      }
    } catch {
      showToast('Failed to update settings');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleClose() {
    isExplicitExitRef.current = true;
    clearReconnectTimer();
    if (sessionIdRef.current) {
      try {
        await fetch(`/api/sessions/${sessionIdRef.current}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to close session', err);
      }
    }
    window.location.href = '/';
  }

  if (phase === 'confirm' || phase === 'error') {
    return (
      <main className="page confirm-page">
        <div className="header-brand">
          <img src="/app-icon.png" alt="termi" className="header-app-icon" />
          <h1>Open a terminal here?</h1>
        </div>
        <dl className="confirm-details">
          <dt>Working directory</dt>
          <dd>
            <code>{cwd || '(home directory)'}</code>
          </dd>
        </dl>
        {phase === 'error' && (
          <p className="error">This session is no longer running on the server.</p>
        )}
        {error && <p className="error">{error}</p>}
        <label className="confirm-cwd">
          Working directory
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                startTerminal();
              }
            }}
          />
        </label>
        {cmds.length > 0 && (
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
            <label className="cmd-choice">
              <input
                type="radio"
                name="cmd-choice"
                checked={cmd === ''}
                onChange={() => {
                  setCmd('');
                }}
              />
              <span className="cmd-no-cmd">(no command)</span>
            </label>
          </div>
        )}
        <div className="form-actions">
          <button type="button" onClick={() => startTerminal()}>
            Start terminal
          </button>
          <button type="button" className="secondary" onClick={startInNewTab}>
            Start in new tab
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              window.location.href = '/';
            }}
          >
            Home
          </button>
        </div>

        <section className="confirm-ongoing-sessions" style={{ marginTop: '2.5rem' }}>
          <h2>On-going sessions in this directory</h2>
          {matchingSessions.length === 0 ? (
            <p className="muted">No on-going sessions in this directory.</p>
          ) : (
            <ul className="session-list">
              {matchingSessions.map((s) => (
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
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => resumeSession(s.id, s.cwd)}
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      className="danger small"
                      onClick={() => closeSession(s.id)}
                    >
                      Close
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    );
  }

  return (
    <div
      className="terminal-page"
      style={
        isTouchDevice && viewportHeight
          ? {
              height: `${viewportHeight}px`,
              top: `${viewportTop}px`,
              position: 'fixed',
              left: 0,
              right: 0,
            }
          : undefined
      }
    >
      <div className="floating-toolbar">
        <button
          type="button"
          className="toolbar-session-title"
          onClick={phase === 'connected' ? handleOpenSettings : undefined}
          title={phase === 'connected' ? `${currentTitle} (click to edit)` : currentTitle}
          aria-label={`Session: ${currentTitle}`}
          disabled={phase !== 'connected'}
        >
          <img src="/app-icon.png" alt="" className="toolbar-app-icon" />
          <span className="toolbar-session-title-text">{currentTitle}</span>
        </button>
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
        {phase === 'connected' && (
          <button
            className="icon-button"
            onClick={handleOpenSettings}
            title="Session settings"
            aria-label="Session settings"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
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
      {settingsOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseSettings();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') handleCloseSettings();
          }}
        >
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
          >
            <div className="modal-header">
              <h2 id="settings-dialog-title">Session settings</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={handleCloseSettings}
                aria-label="Close settings dialog"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSaveSettings}>
              <div className="modal-body">
                <label className="modal-label" htmlFor="page-title-input">
                  Page title
                  <input
                    id="page-title-input"
                    type="text"
                    className="modal-input"
                    placeholder="e.g. Frontend Dev (leave blank for default)"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    autoFocus
                  />
                </label>
                <p className="modal-help-text">
                  Sets the browser tab title. Blank defaults to <code>termi &gt; &#123;folder&#125;</code>.
                </p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="secondary"
                  onClick={handleCloseSettings}
                  disabled={savingSettings}
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingSettings}>
                  {savingSettings ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
      {phase === 'reconnecting' && (
        <div className="banner warning" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" className="spin" aria-hidden="true">
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeDasharray="42"
                strokeDashoffset="14"
                strokeLinecap="round"
              />
            </svg>
            Reconnecting to session…
          </span>
        </div>
      )}
      {phase === 'disconnected' && (
        <div className="banner warning" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Connection lost.</span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="banner-button"
              onClick={handleManualRetry}
            >
              Retry
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                window.location.href = '/';
              }}
              style={{ color: 'inherit', textDecoration: 'underline' }}
            >
              Back to home
            </button>
          </div>
        </div>
      )}
      {phase === 'exited' && (
        <div className="banner danger" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Process exited.</span>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              window.location.href = '/';
            }}
            style={{ color: 'inherit', textDecoration: 'underline' }}
          >
            Back to home
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        className={`xterm-container${dragActive ? ' drag-active' : ''}`}
      />
      {phase === 'connected' && isTouchDevice && (
        <MobileAccessoryBar
          onSendKey={handleSendKey}
          ctrlActive={ctrlActive}
          setCtrlActive={setCtrlActive}
          altActive={altActive}
          setAltActive={setAltActive}
          onToggleKeyboard={toggleKeyboard}
          collapsed={barCollapsed}
          setCollapsed={setBarCollapsed}
        />
      )}
    </div>
  );
}
